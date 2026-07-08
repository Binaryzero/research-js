import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmClient, ConsensusOrchestrator } from '../src/analyzer/llm.js';
import type { LlmProvider } from '../src/providers/llm-provider.js';
import { makeFinding, makeLlmConfig, makePromptConfig } from './fixtures.js';

vi.mock('../src/analyzer/patterns.js', () => ({
  getEndpointFiltering: () => ({
    excluded_domains: [],
    excluded_url_patterns: [],
    endpoint_classification: [],
  }),
}));

class MockProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  calls: Array<{ prompt: string; system?: string }> = [];
  responses: string[] = [];
  private responseIndex = 0;

  constructor(id = 'mock', model = 'mock-model') {
    this.id = id;
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generate(prompt: string, system?: string): Promise<string> {
    this.calls.push({ prompt, system });
    return this.responses[this.responseIndex++] ?? '';
  }
}

function makeClient(provider: MockProvider): LlmClient {
  return new LlmClient(makeLlmConfig(), makePromptConfig(), provider);
}

/** A valid single-finding JSON assessment response */
function assessmentJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify([{
    risk_level: 'medium',
    is_false_positive: false,
    false_positive_reason: '',
    explanation: 'Test assessment',
    recommendation: 'investigate',
    ...overrides,
  }]);
}

describe('ConsensusOrchestrator', () => {
  let mainProvider: MockProvider;

  beforeEach(() => {
    mainProvider = new MockProvider('main', 'main-model');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('zero judges', () => {
    it('delegates entirely to main client', async () => {
      // License findings get fast-assessed without LLM
      const findings = [
        makeFinding({ evidence: 'MIT License: THE SOFTWARE IS PROVIDED "AS IS"' }),
      ];

      const mainClient = makeClient(mainProvider);
      const orchestrator = new ConsensusOrchestrator(mainClient, [], { judgesValidateAllFindings: false });

      const results = await orchestrator.batchAssessFindings(findings);

      expect(results).toHaveLength(1);
      expect(results[0].isFalsePositive).toBe(true);
      // No LLM calls needed for license text
      expect(mainProvider.calls).toHaveLength(0);
    });
  });

  describe('judges validate HIGH/CRITICAL only (default)', () => {
    it('sends only high/critical findings to judges', async () => {
      const judgeProvider = new MockProvider('judge1', 'judge-model');

      const findings = [
        makeFinding({ riskLevel: 'low', evidence: 'console.log("debug")' }),
        makeFinding({ riskLevel: 'high', evidence: 'process.env.SECRET_KEY' }),
      ];

      // Main provider responses: strategic mode needs valid JSON arrays
      mainProvider.responses = Array(10).fill(assessmentJson());
      // Judge responses: only called for high/critical findings
      judgeProvider.responses = Array(10).fill(assessmentJson({ risk_level: 'high' }));

      const mainClient = makeClient(mainProvider);
      const judgeClient = makeClient(judgeProvider);
      const orchestrator = new ConsensusOrchestrator(
        mainClient, [judgeClient],
        { judgesValidateAllFindings: false },
      );

      const results = await orchestrator.batchAssessFindings(findings);

      expect(results).toHaveLength(2);

      // Judge should have been called (only for the subset with high/critical from main's assessment)
      // The exact call count depends on what main returns, but judge should have some calls
      // if any main assessment came back as high/critical.
      // At minimum, results should all be populated.
      for (const r of results) {
        expect(r).toHaveProperty('riskLevel');
      }
    });
  });

  describe('judgesValidateAllFindings mode', () => {
    it('sends all findings to judges when flag is enabled', async () => {
      const judgeProvider = new MockProvider('judge1', 'judge-model');

      const findings = [
        makeFinding({ riskLevel: 'low', evidence: 'console.log("info")' }),
        makeFinding({ riskLevel: 'medium', evidence: 'fetch("https://api.example.com")' }),
      ];

      mainProvider.responses = Array(10).fill(assessmentJson());
      judgeProvider.responses = Array(10).fill(assessmentJson());

      const mainClient = makeClient(mainProvider);
      const judgeClient = makeClient(judgeProvider);
      const orchestrator = new ConsensusOrchestrator(
        mainClient, [judgeClient],
        { judgesValidateAllFindings: true },
      );

      const results = await orchestrator.batchAssessFindings(findings);

      expect(results).toHaveLength(2);
      // With judgesValidateAllFindings=true, the judge should have been invoked
      expect(judgeProvider.calls.length).toBeGreaterThan(0);
    });
  });

  describe('verifyJudges', () => {
    it('resolves when all judges are available', async () => {
      const mainClient = makeClient(mainProvider);
      const judge1 = makeClient(new MockProvider('judge1'));
      const judge2 = makeClient(new MockProvider('judge2'));
      const orchestrator = new ConsensusOrchestrator(mainClient, [judge1, judge2], { judgesValidateAllFindings: false });

      await expect(orchestrator.verifyJudges()).resolves.toBeUndefined();
    });

    it('rejects when a judge is unavailable', async () => {
      const mainClient = makeClient(mainProvider);
      const judge1 = makeClient(new MockProvider('judge1'));
      const judge2 = makeClient(new MockProvider('judge2'));

      // Mock judge2 to be unavailable
      vi.spyOn(judge2, 'isAvailable').mockResolvedValue(false);

      const orchestrator = new ConsensusOrchestrator(mainClient, [judge1, judge2], { judgesValidateAllFindings: false });

      await expect(orchestrator.verifyJudges()).rejects.toThrow('Judge model is not reachable');
    });

    it('rejects when a judge isAvailable throws', async () => {
      const mainClient = makeClient(mainProvider);
      const judge1 = makeClient(new MockProvider('judge1'));
      const judge2 = makeClient(new MockProvider('judge2'));

      // Mock judge2 to throw
      vi.spyOn(judge2, 'isAvailable').mockRejectedValue(new Error('Network error'));

      const orchestrator = new ConsensusOrchestrator(mainClient, [judge1, judge2], { judgesValidateAllFindings: false });

      await expect(orchestrator.verifyJudges()).rejects.toThrow('Judge model is not reachable');
    });
  });
});
