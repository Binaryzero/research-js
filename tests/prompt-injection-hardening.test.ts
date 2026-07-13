/**
 * Guards against attacker-controlled extension metadata corrupting assessment
 * prompts (PR #49 code review, Critical #1/#2/#3).
 *
 * Extension name/description/categories come from the scanned package.json and
 * are threaded into assessment prompts. A hostile value must not be able to
 * hijack another placeholder slot, be reinterpreted as a String.replace
 * pattern, or reach a prompt without the untrusted-input guardrail.
 */
import { describe, it, expect } from 'vitest';
import { fillTemplate, buildExtensionPromptContext } from '../src/analyzer/llm.js';

describe('fillTemplate (single-pass, injection-safe substitution)', () => {
  it('does not let an injected {token} hijack a later slot', () => {
    // Attacker description is literally "{evidence}". The real evidence slot
    // must still receive the real evidence, not the token collide.
    const template = 'Description: {description}\nEvidence: {evidence}';
    const out = fillTemplate(template, {
      description: '{evidence}',
      evidence: 'child_process.exec(atob(payload))',
    });

    expect(out).toBe('Description: {evidence}\nEvidence: child_process.exec(atob(payload))');
    // The real evidence is present in its own slot, not relocated.
    expect(out).toContain('Evidence: child_process.exec(atob(payload))');
  });

  it('inserts values verbatim even when they contain $-replacement patterns', () => {
    const template = 'Desc: {description}\nEvidence: {evidence}';
    const out = fillTemplate(template, { description: "trailing$`$&$$", evidence: 'CODE' });

    // No $-pattern expansion: the value appears literally.
    expect(out).toBe("Desc: trailing$`$&$$\nEvidence: CODE");
  });

  it('leaves unknown tokens intact', () => {
    expect(fillTemplate('a {known} b {unknown} c', { known: 'X' })).toBe('a X b {unknown} c');
  });

  it('substitutes every occurrence in a single pass', () => {
    expect(fillTemplate('{x}-{y}-{x}', { x: '1', y: '2' })).toBe('1-2-1');
  });
});

describe('buildExtensionPromptContext caps all attacker-controlled fields', () => {
  it('bounds name, description, and categories', () => {
    const ctx = buildExtensionPromptContext({
      extensionName: 'N'.repeat(500),
      extensionDescription: 'D'.repeat(500),
      extensionCategories: ['C'.repeat(500)],
    });

    expect(ctx.name.length).toBeLessThanOrEqual(120);
    expect(ctx.description.length).toBeLessThanOrEqual(300);
    expect(ctx.categories.length).toBeLessThanOrEqual(200);
  });

  it('falls back to safe defaults for missing fields', () => {
    const ctx = buildExtensionPromptContext({});
    expect(ctx.name).toBe('Unknown');
    expect(ctx.description).toBe('Not provided');
    expect(ctx.categories).toBe('None listed');
  });
});
