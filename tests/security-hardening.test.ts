/** @vitest-environment node */
import { describe, it, expect, afterEach } from 'vitest';
import { tmpdir } from 'os';
import { downloadExtension } from '../src/services/download.js';
import { calculateSuspicionScore, setScoringConfig, DEFAULT_SCORING } from '../src/analyzer/scoring.js';
import { ReportGenerator } from '../src/analyzer/report.js';
import { makeAnalysisResult, makeFinding } from './fixtures.js';

describe('SSRF: marketplace download host allowlist', () => {
  it('rejects a crafted itemName whose download host is not allowlisted', async () => {
    // publisher slug carries a path/host, so the computed download host becomes
    // an internal host rather than *.gallery.vsassets.io.
    await expect(
      downloadExtension('https://marketplace.visualstudio.com/items?itemName=localhost/evil.pkg', tmpdir()),
    ).rejects.toThrow(/disallowed host|not allowed|valid marketplace/i);
  });
});

describe('Prompt-injection: score cannot be zeroed via false-positive coercion', () => {
  afterEach(() => setScoringConfig(DEFAULT_SCORING));

  it('keeps an injection-detected finding scored even when marked false-positive', () => {
    const injected = makeAnalysisResult({
      findings: [makeFinding({ riskLevel: 'critical', isFalsePositive: true, injectionDetected: true })],
    });
    const plainFp = makeAnalysisResult({
      findings: [makeFinding({ riskLevel: 'critical', isFalsePositive: true, injectionDetected: false })],
    });

    const [injectedScore] = calculateSuspicionScore(injected, { adjustForLlm: true });
    const [plainScore] = calculateSuspicionScore(plainFp, { adjustForLlm: true });

    // The plain false-positive is skipped; the injection-flagged one is not.
    expect(injectedScore).toBeGreaterThan(plainScore);
    expect(injectedScore).toBeGreaterThanOrEqual(DEFAULT_SCORING.riskWeights.critical + DEFAULT_SCORING.injectionBoost);
  });
});

describe('Stored XSS: attacker metadata is escaped in the report', () => {
  it('escapes HTML in the description instead of emitting raw tags', () => {
    const payload = '<img src=x onerror="fetch(String.fromCharCode(47))">';
    const result = makeAnalysisResult({ description: payload });
    const markdown = new ReportGenerator(result, { fullOutput: true }).generate();

    expect(markdown).not.toContain('<img src=x onerror');
    expect(markdown).toContain('&lt;img src=x onerror');
  });
});
