/**
 * Guardrail against over-relaxed assessment.
 *
 * The rubric changes that suppress benign false positives (rating behavior in
 * context, discounting likely_benign findings) must NOT blind the scorer to a
 * genuinely malicious extension. These tests pin the deterministic scoring
 * layer: given assessments that represent a real attack (exfiltration chain,
 * prompt-injection payload), the score must stay firmly in the alarming band
 * regardless of the benign-discount factor.
 *
 * This is the layer we control without a live model. The prompt rubric that
 * produces these assessments is validated separately against real scans; this
 * pins the invariant that "confirmed malicious findings score high" can't
 * regress via a scoring-config tweak.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  calculateSuspicionScore,
  getRiskLabel,
  setScoringConfig,
  DEFAULT_SCORING,
} from '../src/analyzer/scoring.js';
import type { AnalysisResult, Finding } from '../src/types/index.js';

function finding(overrides: Partial<Finding>): Finding {
  return {
    category: 'exfiltration', title: 'X', location: 'out/evil.js:1',
    observation: '', evidence: '', lineStart: 1, lineEnd: 1, context: '',
    isFalsePositive: false, falsePositiveReason: '', riskLevel: 'critical',
    recommendation: 'investigate',
    ...overrides,
  };
}

// A synthetic malicious extension: a fake "theme" that reads secrets and POSTs
// them out, plus an AI-config write and an injection payload. These are the
// red-flag behaviors the rubric says purpose can never excuse.
function maliciousResult(): AnalysisResult {
  return {
    findings: [
      finding({ category: 'exfiltration', title: 'Env Exfiltration', riskLevel: 'critical', recommendation: 'investigate' }),
      finding({ category: 'code_execution', title: 'Download Execute', riskLevel: 'critical', recommendation: 'investigate' }),
      finding({ category: 'credentials', title: 'Token Theft', riskLevel: 'critical', recommendation: 'investigate' }),
      finding({ category: 'malicious_agent_instructions', title: 'AI Config Write', riskLevel: 'high', recommendation: 'investigate', injectionDetected: true }),
      finding({ category: 'backdoor_indicators', title: 'Error Triggered Payload', riskLevel: 'high', recommendation: 'investigate' }),
    ],
    binaryFiles: [], fileTypes: [], notableDependencies: {},
    repository: '', agentConfigFiles: ['.github/copilot-instructions.md'],
  } as unknown as AnalysisResult;
}

describe('malicious extension guardrail', () => {
  afterEach(() => setScoringConfig(DEFAULT_SCORING));

  it('scores a genuine attack chain in the Very Suspicious band after LLM triage', () => {
    const [score] = calculateSuspicionScore(maliciousResult(), { adjustForLlm: true });
    expect(getRiskLabel(score)).toBe('Very Suspicious');
    expect(score).toBeGreaterThanOrEqual(DEFAULT_SCORING.thresholds.verySuspicious);
  });

  it('injection-flagged findings are scored even if the model marks them false positive', () => {
    // Simulates a prompt-injection payload coercing a false-positive verdict:
    // the scorer must still count injection-flagged findings (see scoring.ts).
    const result = maliciousResult();
    result.findings = result.findings.map(f =>
      f.injectionDetected ? { ...f, isFalsePositive: true } : f,
    );
    const [score] = calculateSuspicionScore(result, { adjustForLlm: true });
    expect(getRiskLabel(score)).toBe('Very Suspicious');
  });

  it('the likely_benign discount cannot pull a real attack out of the alarm band', () => {
    // Even at the maximum discount (factor 0), the investigate-flagged criticals
    // are untouched (discount only applies to likely_benign), so the attack
    // still scores as Very Suspicious.
    setScoringConfig({ ...DEFAULT_SCORING, likelyBenignFactor: 0 });
    const [score] = calculateSuspicionScore(maliciousResult(), { adjustForLlm: true });
    expect(getRiskLabel(score)).toBe('Very Suspicious');
  });

  it('a benign purpose-congruent extension stays out of the alarm band', () => {
    // Counterpart: many low/medium likely_benign findings (a Git tool) should
    // NOT reach Very Suspicious once discounted.
    const benign = {
      findings: Array.from({ length: 20 }, (_, i) =>
        finding({
          category: 'permission_abuse', title: `Git op ${i}`,
          riskLevel: i % 3 === 0 ? 'medium' : 'low',
          recommendation: 'likely_benign',
        }),
      ),
      binaryFiles: [], fileTypes: [], notableDependencies: {},
      repository: 'https://github.com/acme/git-tool', agentConfigFiles: [],
    } as unknown as AnalysisResult;
    const [score] = calculateSuspicionScore(benign, { adjustForLlm: true });
    expect(getRiskLabel(score)).not.toBe('Very Suspicious');
  });
});
