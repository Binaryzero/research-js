/**
 * Tests for FastRiskAssessor behavior via LlmClient.
 *
 * FastRiskAssessor is a private class inside llm.ts. We test it indirectly
 * by creating an LlmClient with a mock provider and calling batchAssessFindings
 * on findings that should be fast-assessed without any LLM calls.
 */

import { describe, it, expect } from 'vitest';
import { LlmClient } from '../src/analyzer/llm.js';
import type { LlmProvider } from '../src/providers/llm-provider.js';
import { makeFinding, makeLlmConfig, makePromptConfig } from './fixtures.js';

/**
 * Mock provider that tracks calls and fails if invoked unexpectedly.
 */
function createMockProvider(opts?: { shouldBeCalled?: boolean }): LlmProvider & { callCount: number } {
  const provider = {
    id: 'mock',
    model: 'mock-model',
    callCount: 0,
    async isAvailable() {
      return true;
    },
    async generate(_prompt: string, _system?: string) {
      provider.callCount++;
      if (!opts?.shouldBeCalled) {
        throw new Error('LLM provider should NOT have been called for fast-assessed findings');
      }
      return '';
    },
  };
  return provider;
}

function createClient(provider: LlmProvider) {
  const config = makeLlmConfig({ assessmentMode: 'strategic' });
  const prompts = makePromptConfig();
  return new LlmClient(config, prompts, provider);
}

// ─── License text fast assessment ───────────────────────────────

describe('FastRiskAssessor — license patterns', () => {
  const licenseTexts = [
    'MIT License\n\nCopyright (c) 2024',
    'Licensed under the Apache License, Version 2.0',
    'BSD License - redistribution permitted',
    'Permission is hereby granted, free of charge, without restriction, including without limitation',
    'Use without restriction for any purpose',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY',
    'no limitation on the rights to use, copy, modify',
  ];

  for (const text of licenseTexts) {
    it(`dismisses license text: "${text.slice(0, 50)}..."`, async () => {
      const provider = createMockProvider();
      const client = createClient(provider);

      const finding = makeFinding({ evidence: text });
      const results = await client.batchAssessFindings([finding]);

      expect(results).toHaveLength(1);
      expect(results[0].isFalsePositive).toBe(true);
      expect(results[0].recommendation).toBe('dismiss');
      expect(results[0].riskLevel).toBe('none');
      expect(provider.callCount).toBe(0);
    });
  }
});

// ─── Test file fast assessment ──────────────────────────────────

describe('FastRiskAssessor — test file patterns', () => {
  const testLocations = [
    'src/__tests__/helper.js:5',
    'test/unit/scanner.test.js:10',
    'spec/integration.spec.ts:20',
    'tests/mock/data.js:3',
    'fixtures/sample.js:1',
  ];

  for (const location of testLocations) {
    it(`marks test file as likely_benign: ${location}`, async () => {
      const provider = createMockProvider();
      const client = createClient(provider);

      const finding = makeFinding({ location, evidence: 'fetch("http://test-server.local")' });
      const results = await client.batchAssessFindings([finding]);

      expect(results).toHaveLength(1);
      expect(results[0].isFalsePositive).toBe(true);
      expect(results[0].recommendation).toBe('likely_benign');
      expect(results[0].riskLevel).toBe('low');
      expect(provider.callCount).toBe(0);
    });
  }
});

// ─── Non-English text fast assessment ───────────────────────────

describe('FastRiskAssessor — non-English patterns', () => {
  const nonEnglishTexts = [
    'das ist ein Test',      // German "the"
    'dans le fichier',       // French "in"
    'der Benutzer klickt',   // German "the"
    'die Datei wurde',       // German "the"
    'los archivos del',      // Spanish "the"
    'las configuraciones',   // Spanish "the"
  ];

  for (const text of nonEnglishTexts) {
    it(`dismisses non-English text: "${text}"`, async () => {
      const provider = createMockProvider();
      const client = createClient(provider);

      const finding = makeFinding({ evidence: text });
      const results = await client.batchAssessFindings([finding]);

      expect(results).toHaveLength(1);
      expect(results[0].isFalsePositive).toBe(true);
      expect(results[0].recommendation).toBe('dismiss');
      expect(results[0].riskLevel).toBe('none');
      expect(provider.callCount).toBe(0);
    });
  }
});

// ─── TypeScript compilation artifacts ───────────────────────────

describe('FastRiskAssessor — TypeScript compilation artifacts', () => {
  it('marks _123.method() pattern as likely_benign', async () => {
    const provider = createMockProvider();
    const client = createClient(provider);

    const finding = makeFinding({ evidence: '_42.someMethod(arg1, arg2)' });
    const results = await client.batchAssessFindings([finding]);

    expect(results).toHaveLength(1);
    expect(results[0].isFalsePositive).toBe(true);
    expect(results[0].recommendation).toBe('likely_benign');
    expect(provider.callCount).toBe(0);
  });

  it('marks require("./local") pattern as likely_benign', async () => {
    const provider = createMockProvider();
    const client = createClient(provider);

    const finding = makeFinding({ evidence: 'const m = require("./utils")' });
    const results = await client.batchAssessFindings([finding]);

    expect(results).toHaveLength(1);
    expect(results[0].isFalsePositive).toBe(true);
    expect(results[0].recommendation).toBe('likely_benign');
    expect(provider.callCount).toBe(0);
  });
});

// ─── Normal findings pass through to LLM ────────────────────────

describe('FastRiskAssessor — pass-through to LLM', () => {
  it('does not fast-assess normal suspicious code', async () => {
    const provider = createMockProvider({ shouldBeCalled: true });
    const config = makeLlmConfig({ assessmentMode: 'strategic' });
    const prompts = makePromptConfig();
    const client = new LlmClient(config, prompts, provider);

    // This evidence should NOT match any fast-assessment patterns
    const finding = makeFinding({
      location: 'src/extension.js:42',
      evidence: 'process.spawn("/bin/sh", ["-c", userInput])',
    });

    // This will call the LLM; since mock returns empty string, result will be a default.
    // We just verify the provider WAS called.
    await client.batchAssessFindings([finding]);
    expect(provider.callCount).toBeGreaterThan(0);
  });
});

// ─── Mixed batch: some fast, some LLM ───────────────────────────

describe('FastRiskAssessor — mixed batch', () => {
  it('fast-assesses some findings and sends others to LLM', async () => {
    const provider = createMockProvider({ shouldBeCalled: true });
    const config = makeLlmConfig({ assessmentMode: 'strategic' });
    const prompts = makePromptConfig();
    const client = new LlmClient(config, prompts, provider);

    const findings = [
      makeFinding({ evidence: 'MIT License\nCopyright 2024' }),       // fast: license
      makeFinding({ location: 'test/foo.test.js:1' }),                 // fast: test file
      makeFinding({ location: 'src/main.js:5', evidence: 'process.spawn("/bin/sh")' }), // LLM
    ];

    const results = await client.batchAssessFindings(findings);

    expect(results).toHaveLength(3);
    // First two should be fast-assessed
    expect(results[0].isFalsePositive).toBe(true);
    expect(results[1].isFalsePositive).toBe(true);
    // Provider should have been called for the third finding
    expect(provider.callCount).toBeGreaterThan(0);
  });
});
