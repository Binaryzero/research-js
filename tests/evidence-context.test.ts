import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StaticAnalyzer } from '../src/analyzer/static.js';
import { buildStrategicBulkPrompt } from '../src/analyzer/llm-batch.js';
import { getAnalysisLimits } from '../src/analyzer/analysis-limits.js';
import { makeFinding, makePromptConfig } from './fixtures.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = join(__dirname, '..', '.temp-test', `evidence-context-${process.pid}`);

function contextLine(n: number): string {
  return `const contextValue${n} = computeStep${n}(input); // context line ${n}`;
}

describe('evidence capture context window', () => {
  beforeAll(async () => {
    mkdirSync(testDir, { recursive: true });
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'ctx-test', publisher: 'tester', version: '1.0.0',
      engines: { vscode: '^1.0.0' },
    }));

    // A readable file where the interesting call sits at line 26,
    // surrounded by 25 numbered lines on each side.
    const before = Array.from({ length: 25 }, (_, i) => contextLine(i + 1));
    const after = Array.from({ length: 25 }, (_, i) => contextLine(i + 26));
    writeFileSync(join(testDir, 'readable.js'),
      [...before, 'eval(payload);', ...after].join('\n'));

    // A minified file: one long line with the match ~2000 chars in.
    const filler = 'var x=1;'.repeat(250); // 2000 chars
    writeFileSync(join(testDir, 'minified.js'),
      filler + 'eval(payload);' + filler);
  });

  afterAll(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('captures a multi-line window around matches in readable code', async () => {
    const analyzer = new StaticAnalyzer(testDir, { verbose: false });
    const result = await analyzer.analyze();
    const finding = result.findings.find(
      f => f.location.includes('readable.js') && f.evidence.includes('eval(payload)'),
    );

    expect(finding).toBeDefined();
    // Much wider than the old ±2 lines: several lines of context each way.
    expect(finding!.evidence).toContain('context line 20'); // 6 lines before
    expect(finding!.evidence).toContain('context line 33'); // 8 lines after
    expect(finding!.evidence.length).toBeLessThanOrEqual(getAnalysisLimits().maxEvidenceChars);
  });

  it('captures a wider window in minified code and keeps the match inside it', async () => {
    const analyzer = new StaticAnalyzer(testDir, { verbose: false });
    const result = await analyzer.analyze();
    const finding = result.findings.find(
      f => f.location.includes('minified.js') && f.evidence.includes('eval(payload)'),
    );

    expect(finding).toBeDefined();
    // Old window was 500 chars; the new one scales with maxEvidenceChars.
    expect(finding!.evidence.length).toBeGreaterThan(1000);
    expect(finding!.evidence.length).toBeLessThanOrEqual(getAnalysisLimits().maxEvidenceChars);
  });
});

describe('extension context in prompts', () => {
  it('strategic bulk prompt carries the extension self-description block', () => {
    const finding = makeFinding();
    const fileGroup = {
      filePath: 'src/main.js', findings: [finding], indices: [0],
      isExtensionCode: true, isBundledDependency: false, isConfig: false,
    };
    const prompt = buildStrategicBulkPrompt(
      { patternName: 'x', category: 'network', risk: 'high', fileGroups: [fileGroup], totalCount: 1 },
      [{ finding, originalIndex: 0, fileGroup, reason: 'test' }],
      makePromptConfig(),
      600,
      { name: 'gitnav-workflows', description: 'Visual Git history and workflows.', categories: 'SCM Providers' },
    );

    expect(prompt.user).toContain('gitnav-workflows');
    expect(prompt.user).toContain('Visual Git history and workflows.');
    expect(prompt.user).toContain('SCM Providers');
    expect(prompt.user).toContain('use for congruence only');
  });

  it('omits the block when no extension context is provided', () => {
    const finding = makeFinding();
    const fileGroup = {
      filePath: 'src/main.js', findings: [finding], indices: [0],
      isExtensionCode: true, isBundledDependency: false, isConfig: false,
    };
    const prompt = buildStrategicBulkPrompt(
      { patternName: 'x', category: 'network', risk: 'high', fileGroups: [fileGroup], totalCount: 1 },
      [{ finding, originalIndex: 0, fileGroup, reason: 'test' }],
      makePromptConfig(),
      600,
    );

    expect(prompt.user).not.toContain('self-described metadata');
  });
});

describe('LLM prompt evidence slicing', () => {
  it('keeps the pattern match visible when evidence exceeds the prompt cap', () => {
    // Match sits past the cap: a head-slice would lose it entirely.
    const evidence = 'a'.repeat(1000) + 'eval(payload)' + 'b'.repeat(1000);
    const finding = makeFinding({ evidence, matchHighlight: 'eval(payload)' });
    const fileGroup = {
      filePath: 'src/main.js', findings: [finding], indices: [0],
      isExtensionCode: true, isBundledDependency: false, isConfig: false,
    };
    const prompt = buildStrategicBulkPrompt(
      { patternName: 'eval_usage', category: 'code_execution', risk: 'high', fileGroups: [fileGroup], totalCount: 1 },
      [{ finding, originalIndex: 0, fileGroup, reason: 'test sample' }],
      makePromptConfig(),
      600,
    );

    expect(prompt.user).toContain('eval(payload)');
  });
});
