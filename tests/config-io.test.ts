import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock the fs module before importing the module under test
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

import { loadPrompts } from '../src/config.js';
import { existsSync, readFileSync } from 'fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe('loadPrompts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('parses valid YAML and returns PromptConfig', () => {
    const yamlContent = [
      'version: "1.0"',
      'finding_assessment:',
      '  system: "You are a security analyst."',
      '  user: "Assess this."',
      '  common_false_positives: ""',
      '  genuine_concerns: ""',
      'executive_summary:',
      '  system: "Summarize."',
      '  user: "Write summary."',
      'finding_prose:',
      '  system: "Describe."',
      '  user: "Write prose."',
    ].join('\n');

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(yamlContent);

    const config = loadPrompts('/fake/prompts.yaml');

    expect(config.version).toBe('1.0');
    expect(config.finding_assessment.system).toBe('You are a security analyst.');
    expect(config.executive_summary.user).toBe('Write summary.');
  });

  it('throws when path is empty', () => {
    expect(() => loadPrompts('')).toThrow('Prompts file path is required');
  });

  it('throws when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    expect(() => loadPrompts('/missing/prompts.yaml')).toThrow('Prompts file not found');
  });
});
