/**
 * Standalone HTML report generator.
 *
 * Produces a fully self-contained .html file from a ReportPayload: the shared
 * client renderer (assets/static/report-view.js/.css) is inlined, the payload
 * is embedded as inert JSON, and a hash-based Content-Security-Policy pins
 * script execution to exactly the two inline scripts this generator emits.
 *
 * Security model (all payload strings are attacker-controlled — they come
 * from scanned third-party extension code):
 *   - the JSON block escapes every '<' (plus U+2028/U+2029), so a hostile
 *     "</script>" in evidence can never terminate the data block
 *   - the renderer builds DOM exclusively via createElement/textContent
 *   - CSP script-src carries only the sha256 hashes of the renderer and boot
 *     scripts, so even a hypothetical injected inline handler cannot execute,
 *     and default-src 'none' blocks any network egress from the report
 */

import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ReportPayload } from './render-model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STATIC_DIR = join(__dirname, '..', '..', 'assets', 'static');

/**
 * Boot script inlined into every standalone report. Exported so tests can
 * verify the CSP hash against the exact source. Keep it dependency-free and
 * defensive: a malformed JSON block must degrade to an empty render, not a
 * blank page with a console error as the only clue.
 */
export const BOOT_SCRIPT = `(function () {
  'use strict';
  var payload = {};
  try {
    payload = JSON.parse(document.getElementById('report-data').textContent);
  } catch (e) { /* malformed payload: render an empty report shell */ }
  var id = payload && payload.result && payload.result.extensionId;
  if (id) document.title = 'Security Report — ' + id;
  window.ReportView.render(document.getElementById('report-root'), payload, { mode: 'standalone' });
})();`;

interface RendererAssets {
  css: string;
  js: string;
  jsHash: string;
  bootHash: string;
}

let _assets: RendererAssets | null = null;

function sha256Base64(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('base64');
}

function loadRendererAssets(): RendererAssets {
  if (!_assets) {
    const css = readFileSync(join(STATIC_DIR, 'report-view.css'), 'utf-8');
    const js = readFileSync(join(STATIC_DIR, 'report-view.js'), 'utf-8');
    _assets = {
      css,
      js,
      jsHash: sha256Base64(js),
      bootHash: sha256Base64(BOOT_SCRIPT),
    };
  }
  return _assets;
}

/** Reset the asset cache (test helper for asset-change scenarios). */
export function resetRendererAssetCache(): void {
  _assets = null;
}

/**
 * Escape a JSON string for embedding inside a <script> element: '<' prevents
 * "</script>" breakout (and "<!--" comment-state tricks), U+2028/U+2029 are
 * legal JSON but illegal JS line terminators in older parsers.
 */
function escapeJsonForScriptTag(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function generateHtmlReport(payload: ReportPayload): string {
  const assets = loadRendererAssets();
  const safeJson = escapeJsonForScriptTag(JSON.stringify(payload));
  const title = escapeHtmlText(`Security Report — ${payload.result?.extensionId || 'unknown'}`);

  const csp = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src 'sha256-${assets.jsHash}' 'sha256-${assets.bootHash}'`,
    "img-src data:",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${title}</title>
<style>
${assets.css}
</style>
</head>
<body class="rv-page">
<script type="application/json" id="report-data">${safeJson}</script>
<div id="report-root"></div>
<script>${assets.js}</script>
<script>${BOOT_SCRIPT}</script>
</body>
</html>
`;
}
