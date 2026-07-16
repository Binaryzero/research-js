/**
 * Sanitize text before it is sent to an LLM API.
 *
 * Extension source is frequently binary or mis-decoded: minified bundles embed
 * binary blobs, and files read as UTF-8 leave U+FFFD replacement characters and
 * raw control bytes (NUL, etc.) in the string. The Ollama-cloud `/v1/responses`
 * endpoint rejects any request whose content carries these with a generic
 * `400 Bad Request (ref: …)` — which silently killed the executive summary
 * (a real minified bundle produced a chunk with ~239 K control chars and ~24 K
 * replacement chars, and every attempt to summarize it 400'd).
 *
 * Stripping them is lossless for our purposes: control bytes and replacement
 * chars carry no meaning for the model. Tab (U+0009), newline (U+000A), and
 * carriage return (U+000D) are preserved so code stays readable.
 */

// Built from escapes (no literal control chars in source). Removes C0 controls
// except tab/newline/CR, DEL, the U+FFFD replacement char, and lone surrogates
// (unpaired halves are invalid when the string is encoded for the request).
const DISALLOWED = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\uFFFD]' +
    '|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])' +
    '|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]',
  'g',
);

/** Remove characters that make an LLM API reject the request. */
export function sanitizeForLlm(text: string): string {
  if (!text) return text;
  return text.replace(DISALLOWED, '');
}

/** Sanitize an optional system prompt, preserving `undefined`. */
export function sanitizeOptional(text: string | undefined): string | undefined {
  return text === undefined ? undefined : sanitizeForLlm(text);
}
