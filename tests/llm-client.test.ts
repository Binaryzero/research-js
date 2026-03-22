import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LlmClient } from '../src/analyzer/llm.js';
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
  readonly id = 'mock';
  readonly model = 'mock-model';
  calls: Array<{ prompt: string; system?: string }> = [];
  responses: string[] = [];
  private responseIndex = 0;
  available = true;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async generate(prompt: string, system?: string): Promise<string> {
    this.calls.push({ prompt, system });
    return this.responses[this.responseIndex++] ?? '';
  }
}

describe('LlmClient', () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('delegates to provider and returns true', async () => {
      provider.available = true;
      const client = new LlmClient(makeLlmConfig(), makePromptConfig(), provider);

      expect(await client.isAvailable()).toBe(true);
    });

    it('delegates to provider and returns false', async () => {
      provider.available = false;
      const client = new LlmClient(makeLlmConfig(), makePromptConfig(), provider);

      expect(await client.isAvailable()).toBe(false);
    });
  });

  describe('batchAssessFindings — fast assessment path', () => {
    it('marks license text as false positive without LLM calls', async () => {
      const findings = [
        makeFinding({ evidence: 'MIT License: THE SOFTWARE IS PROVIDED "AS IS"' }),
        makeFinding({ evidence: 'Apache License, Version 2.0' }),
      ];

      const client = new LlmClient(makeLlmConfig(), makePromptConfig(), provider);
      const results = await client.batchAssessFindings(findings);

      expect(results).toHaveLength(2);
      for (const r of results) {
        expect(r.isFalsePositive).toBe(true);
        expect(r.riskLevel).toBe('none');
      }
      // No LLM calls should have been made
      expect(provider.calls).toHaveLength(0);
    });
  });

  describe('batchAssessFindings — empty LLM response', () => {
    it('returns default assessment when provider returns empty string', async () => {
      const findings = [makeFinding({ evidence: 'suspicious_code()' })];
      provider.responses = [''];

      const client = new LlmClient(makeLlmConfig(), makePromptConfig(), provider);
      const results = await client.batchAssessFindings(findings);

      expect(results).toHaveLength(1);
      // Should have a default assessment since parse failed
      expect(results[0].recommendation).toBe('investigate');
    });
  });

  describe('batchAssessFindings — strategic mode with valid response', () => {
    it('parses LLM response and returns assessments for each finding', async () => {
      const findings = [
        makeFinding({ category: 'network', title: 'fetch call', evidence: 'fetch(url)', patternName: 'fetch' }),
        makeFinding({ category: 'obfuscation', title: 'base64 decode', evidence: 'atob(encoded)', patternName: 'base64' }),
      ];

      // Strategic mode sends grouped prompts; provide valid JSON array responses
      const assessmentResponse = JSON.stringify([
        { risk_level: 'low', is_false_positive: true, false_positive_reason: 'normal fetch', explanation: 'Standard API call', recommendation: 'dismiss' },
      ]);
      // Provide enough responses for all potential LLM calls
      provider.responses = Array(10).fill(assessmentResponse);

      const client = new LlmClient(makeLlmConfig(), makePromptConfig(), provider);
      const results = await client.batchAssessFindings(findings);

      expect(results).toHaveLength(2);
      // Each finding should have an assessment (either from LLM parse or default)
      for (const r of results) {
        expect(r).toHaveProperty('riskLevel');
        expect(r).toHaveProperty('recommendation');
      }
    });

    it('correctly maps parsed assessment fields from valid LLM JSON', async () => {
      // Single finding in one category to get a clean 1:1 mapping
      const findings = [
        makeFinding({ category: 'network', title: 'fetch call', evidence: 'fetch("https://evil.com")', riskLevel: 'medium' }),
      ];

      const assessmentResponse = JSON.stringify([
        {
          risk_level: 'high',
          is_false_positive: false,
          false_positive_reason: '',
          explanation: 'Fetches from external domain',
          recommendation: 'investigate',
        },
      ]);
      provider.responses = Array(10).fill(assessmentResponse);

      const client = new LlmClient(makeLlmConfig(), makePromptConfig(), provider);
      const results = await client.batchAssessFindings(findings);

      expect(results).toHaveLength(1);
      expect(results[0].riskLevel).toBe('high');
      expect(results[0].isFalsePositive).toBe(false);
      expect(results[0].explanation).toBe('Fetches from external domain');
      expect(results[0].recommendation).toBe('investigate');
      // Provider should have been called (not fast-assessed)
      expect(provider.calls.length).toBeGreaterThan(0);
    });
  });
});
