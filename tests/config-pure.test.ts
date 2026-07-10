/**
 * Tests for pure functions from src/config.ts
 */

import { describe, it, expect } from 'vitest';
import { slotToLlmConfig, getPromptsForProfile } from '../src/config.js';
import type { PromptConfig } from '../src/config.js';
import { LlmTuningSchema, AppConfigSchema } from '../src/schemas/config.js';
import { makeModelSlot, makeAppConfig, makePromptConfig } from './fixtures.js';

// ─── LlmTuning config surface ──────────────────────────────────

describe('LlmTuningSchema', () => {
  it('fills every knob with its behavior-preserving default from {}', () => {
    const t = LlmTuningSchema.parse({});
    expect(t).toEqual({
      tierABatchSize: 5,
      consensusVotes: 3,
      evidenceMaxChars: { strategic: 600, triage: 1500, bulk: 800, individual: 1500 },
    });
  });

  it('keeps other defaults when only one knob is provided', () => {
    const t = LlmTuningSchema.parse({ tierABatchSize: 12, evidenceMaxChars: { triage: 8000 } });
    expect(t.tierABatchSize).toBe(12);
    expect(t.consensusVotes).toBe(3);
    expect(t.evidenceMaxChars).toEqual({ strategic: 600, triage: 8000, bulk: 800, individual: 1500 });
  });

  it('rejects out-of-range values', () => {
    expect(LlmTuningSchema.safeParse({ tierABatchSize: 0 }).success).toBe(false);
    expect(LlmTuningSchema.safeParse({ consensusVotes: 99 }).success).toBe(false);
  });

  it('lets a config.json without llmTuning validate (partial)', () => {
    const raw = { version: '1', concurrency: 20 };
    expect(AppConfigSchema.partial().safeParse(raw).success).toBe(true);
  });
});

// ─── slotToLlmConfig ───────────────────────────────────────────

describe('slotToLlmConfig', () => {
  it('maps slot fields to LlmConfig', () => {
    const slot = makeModelSlot({
      model: 'gpt-4o',
      baseUrl: 'https://api.openai.com',
      timeout: 60000,
      maxTokens: 8192,
      temperature: 0.7,
    });
    const appConfig = makeAppConfig({ concurrency: 5, assessmentMode: 'bulk' });

    const result = slotToLlmConfig(slot, appConfig);

    expect(result.model).toBe('gpt-4o');
    expect(result.baseUrl).toBe('https://api.openai.com');
    expect(result.timeout).toBe(60000);
    expect(result.maxTokens).toBe(8192);
    expect(result.temperature).toBe(0.7);
  });

  it('takes concurrency from appConfig, not slot', () => {
    const slot = makeModelSlot();
    const appConfig = makeAppConfig({ concurrency: 42 });

    const result = slotToLlmConfig(slot, appConfig);
    expect(result.concurrency).toBe(42);
  });

  it('takes assessmentMode from appConfig', () => {
    const slot = makeModelSlot();
    const appConfig = makeAppConfig({ assessmentMode: 'bulk' });

    const result = slotToLlmConfig(slot, appConfig);
    expect(result.assessmentMode).toBe('bulk');
  });

  it('uses default slot values when no overrides', () => {
    const slot = makeModelSlot();
    const appConfig = makeAppConfig();

    const result = slotToLlmConfig(slot, appConfig);

    expect(result.model).toBe('llama3.2');
    expect(result.baseUrl).toBe('http://localhost:11434');
    expect(result.provider).toBe('ollama');
    expect(result.timeout).toBe(180000);
    expect(result.temperature).toBe(0.3);
    expect(result.concurrency).toBe(10);
    expect(result.assessmentMode).toBe('strategic');
  });

  it('returns a plain object with exactly 11 keys', () => {
    const result = slotToLlmConfig(makeModelSlot(), makeAppConfig());
    const keys = Object.keys(result);
    expect(keys).toHaveLength(11);
    expect(keys).toEqual(expect.arrayContaining([
      'model', 'baseUrl', 'provider', 'timeout', 'maxTokens',
      'temperature', 'concurrency', 'assessmentMode', 'apiKey', 'batchSize', 'llmTuning',
    ]));
  });
});

// ─── getPromptsForProfile ───────────────────────────────────────

describe('getPromptsForProfile', () => {
  function makeBasePrompts(overrides?: Partial<PromptConfig>): PromptConfig {
    return {
      ...makePromptConfig(),
      ...overrides,
    };
  }

  it('returns base prompts unchanged for "default" profile', () => {
    const base = makeBasePrompts();
    const result = getPromptsForProfile('default', base);
    expect(result).toEqual(base);
  });

  it('returns base prompts unchanged for empty string profile', () => {
    const base = makeBasePrompts();
    const result = getPromptsForProfile('', base);
    expect(result).toEqual(base);
  });

  it('returns base prompts unchanged when profile not found in profiles', () => {
    const base = makeBasePrompts({ profiles: { other: {} } });
    const result = getPromptsForProfile('nonexistent', base);
    expect(result).toEqual(base);
  });

  it('returns base prompts when profiles field is undefined', () => {
    const base = makeBasePrompts();
    delete (base as any).profiles;
    const result = getPromptsForProfile('strict', base);
    expect(result).toEqual(base);
  });

  it('merges finding_assessment overrides from profile', () => {
    const base = makeBasePrompts({
      profiles: {
        strict: {
          finding_assessment: {
            system: 'Override system prompt for strict mode.',
          },
        },
      },
    });

    const result = getPromptsForProfile('strict', base);

    // Overridden field
    expect(result.finding_assessment.system).toBe('Override system prompt for strict mode.');
    // Non-overridden fields preserved
    expect(result.finding_assessment.user).toBe(base.finding_assessment.user);
    expect(result.finding_assessment.common_false_positives).toBe(base.finding_assessment.common_false_positives);
  });

  it('merges executive_summary overrides from profile', () => {
    const base = makeBasePrompts({
      profiles: {
        verbose: {
          executive_summary: {
            user: 'Write a very detailed summary.',
          },
        },
      },
    });

    const result = getPromptsForProfile('verbose', base);
    expect(result.executive_summary.user).toBe('Write a very detailed summary.');
    expect(result.executive_summary.system).toBe(base.executive_summary.system);
  });

  it('merges finding_prose overrides from profile', () => {
    const base = makeBasePrompts({
      profiles: {
        terse: {
          finding_prose: {
            system: 'Be very brief.',
            user: 'One sentence only.',
          },
        },
      },
    });

    const result = getPromptsForProfile('terse', base);
    expect(result.finding_prose.system).toBe('Be very brief.');
    expect(result.finding_prose.user).toBe('One sentence only.');
  });

  it('preserves version and other top-level fields', () => {
    const base = makeBasePrompts({
      version: '2.5',
      profiles: {
        custom: {
          finding_assessment: { system: 'Custom.' },
        },
      },
    });

    const result = getPromptsForProfile('custom', base);
    expect(result.version).toBe('2.5');
  });

  it('does not mutate the base prompts object', () => {
    const base = makeBasePrompts({
      profiles: {
        custom: {
          finding_assessment: { system: 'Overridden.' },
        },
      },
    });
    const originalSystem = base.finding_assessment.system;

    getPromptsForProfile('custom', base);

    expect(base.finding_assessment.system).toBe(originalSystem);
  });

  it('handles profile with empty overrides object', () => {
    const base = makeBasePrompts({
      profiles: {
        empty: {},
      },
    });

    const result = getPromptsForProfile('empty', base);
    // All fields should match base (spread of undefined is no-op)
    expect(result.finding_assessment).toEqual(base.finding_assessment);
    expect(result.executive_summary).toEqual(base.executive_summary);
    expect(result.finding_prose).toEqual(base.finding_prose);
  });
});
