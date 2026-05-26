/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { StaticAnalyzer } from '../src/analyzer/static.js';
import { buildSourceFiles } from '../src/analyzer/llm.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '..', 'reproducer', 'malicious-extension');

describe('Coverage gap reproducer', () => {
  it('synthesizes findings for non-walked file types (gap proof)', async () => {
    const analyzer = new StaticAnalyzer(FIXTURE, { verbose: false });
    const result = await analyzer.analyze();

    const byLocation = (substr: string) => result.findings.filter(f => f.location.includes(substr));

    // Pre-fix: the only regex hit was the "postinstall" entry in package.json.
    // Everything else (install.sh, probe.node, webview.html, the obfuscated
    // dropper.js) produced zero findings.
    //
    // Post-fix: the analyzer synthesizes virtual findings for non-walked
    // file classes so the LLM can examine them. Assertions below describe
    // the expected post-fix surface.

    // 1. install.sh — shell script content surfaced as a virtual finding.
    const installSh = byLocation('install.sh');
    expect(installSh.length).toBeGreaterThan(0);
    expect(installSh[0].category).toBe('code_execution');
    expect(installSh[0].evidence).toContain('curl');

    // 2. probe.node — native module presence surfaced as a virtual finding.
    const nativeMod = byLocation('probe.node');
    expect(nativeMod.length).toBeGreaterThan(0);
    expect(nativeMod[0].category).toBe('supply_chain');

    // 3. webview.html — webview asset surfaced as a virtual finding.
    const webview = byLocation('webview.html');
    expect(webview.length).toBeGreaterThan(0);
    expect(webview[0].evidence).toContain('<script');

    // 4. package.json scripts — the `configure` shell call (not just
    //    postinstall) should produce a finding because it invokes a shell
    //    script bundled in the extension.
    const configureScript = result.findings.find(
      f => f.location.startsWith('package.json') && /configure|install\.sh/i.test(f.evidence)
    );
    expect(configureScript).toBeDefined();
  });

  it('includes manifest, scripts, and webview in executive-summary input', () => {
    // buildSourceFiles is the input set for the executive_summary prompt.
    // Pre-fix: only files that produced regex hits were included.
    // Post-fix: package.json, shell scripts, and webview HTML are always
    // included so the LLM can reason about the full VSIX surface.
    const synthetic = [
      {
        category: 'supply_chain',
        title: 'Install Hook',
        location: 'package.json:scripts.postinstall',
        observation: '',
        evidence: 'postinstall: "node ./build.js"',
        lineStart: 0,
        lineEnd: 0,
        context: '',
        isFalsePositive: false,
        falsePositiveReason: '',
        riskLevel: 'medium',
      },
    ];
    const sources = buildSourceFiles(synthetic, FIXTURE);

    expect(sources).toContain('--- package.json ---');
    expect(sources).toContain('--- install.sh ---');
    expect(sources).toContain('--- media/webview.html ---');
  });
});
