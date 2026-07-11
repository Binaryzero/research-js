/**
 * Shared evidence bounding.
 *
 * Evidence snippets are attacker-controlled source captured at scan time.
 * Every consumer that bounds them (LLM prompt builders, the HTML render
 * model) must keep the pattern match visible: a plain head-slice drops the
 * match whenever it sits past the limit — exactly on the long-evidence
 * findings where scrutiny matters most.
 */

/**
 * Bound evidence to `limit` characters, keeping it useful.
 *
 * When the first `matchHighlight` occurrence would be cut off, the window
 * recenters around it: 40% of the budget as leading context (the setup
 * feeding the pattern), 60% trailing (what is done with the result).
 * Ellipsis markers signal the cuts and are budgeted so the result never
 * exceeds `limit`.
 */
export function truncateEvidence(
  evidence: string,
  matchHighlight: string | undefined,
  limit: number,
): { text: string; truncated: boolean } {
  if (evidence.length <= limit) {
    return { text: evidence, truncated: false };
  }

  const ELLIPSIS = '…';

  // Degenerate limits (smaller than the window's two ellipsis markers plus
  // one char of content) would produce a negative budget below; hard-slice so
  // the never-exceeds-limit invariant holds for any caller-supplied limit.
  if (limit <= 2 * ELLIPSIS.length + 1) {
    return { text: evidence.slice(0, Math.max(0, limit)), truncated: true };
  }
  const matchIndex = matchHighlight ? evidence.indexOf(matchHighlight) : -1;
  const matchEnd = matchIndex >= 0 ? matchIndex + (matchHighlight as string).length : -1;

  // No match, or the match survives a head-slice: cut the tail.
  if (matchIndex < 0 || matchEnd <= limit - 1) {
    return { text: evidence.slice(0, limit - 1) + ELLIPSIS, truncated: true };
  }

  // Window around the first match, both cut edges marked with an ellipsis.
  const budget = limit - 2 * ELLIPSIS.length;
  const lead = Math.floor(budget * 0.4);
  let start = Math.max(0, matchIndex - lead);
  let end = start + budget;
  if (end > evidence.length) {
    end = evidence.length;
    start = Math.max(0, end - budget);
  }
  const prefix = start > 0 ? ELLIPSIS : '';
  const suffix = end < evidence.length ? ELLIPSIS : '';
  return { text: prefix + evidence.slice(start, end) + suffix, truncated: true };
}

/**
 * Convenience for prompt builders: bounded evidence text with the match kept
 * visible, no metadata.
 */
export function sliceEvidenceForPrompt(
  evidence: string,
  matchHighlight: string | undefined,
  limit: number,
): string {
  return truncateEvidence(evidence, matchHighlight, limit).text;
}
