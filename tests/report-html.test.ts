import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { generateHtmlReport, BOOT_SCRIPT } from '../src/analyzer/report-html.js';
import { toRenderModel } from '../src/analyzer/render-model.js';
import { makeFinding, makeAnalysisResult } from './fixtures.js';
import type { EndpointFilteringConfig } from '../src/analyzer/patterns.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const emptyFilterConfig: EndpointFilteringConfig = {
  excluded_domains: [],
  excluded_url_patterns: [],
  endpoint_classification: [],
};

function makePayload(overrides: Parameters<typeof makeAnalysisResult>[0] = {}) {
  return toRenderModel(makeAnalysisResult(overrides), { score: 10, filterConfig: emptyFilterConfig });
}

function extractEmbeddedJson(html: string): string {
  const start = html.indexOf('<script type="application/json" id="report-data">');
  const from = start + '<script type="application/json" id="report-data">'.length;
  const end = html.indexOf('</script>', from);
  return html.slice(from, end);
}

describe('generateHtmlReport', () => {
  it('produces a full HTML document embedding the renderer and boot script', () => {
    const html = generateHtmlReport(makePayload());

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('id="report-root"');
    expect(html).toContain('window.ReportView');
    expect(html).toContain('body class="rv-page"');
  });

  it('neutralizes </script> breakout attempts in attacker-controlled evidence', () => {
    const hostile = '</script><script>alert(document.cookie)</script>';
    const html = generateHtmlReport(makePayload({
      findings: [makeFinding({ evidence: hostile, title: hostile, observation: hostile })],
      executiveSummary: hostile,
    }));

    // The document must contain exactly the three intended script blocks
    // (data + renderer + boot); a breakout would add more.
    const opens = html.match(/<script[\s>]/g) || [];
    expect(opens).toHaveLength(3);
    // No raw '<' survives inside the embedded JSON.
    expect(extractEmbeddedJson(html)).not.toContain('<');
  });

  it('embedded JSON round-trips to the exact payload', () => {
    const payload = makePayload({
      findings: [makeFinding({ evidence: 'line sep and "quotes" and \\backslash' })],
    });
    const html = generateHtmlReport(payload);
    const parsed = JSON.parse(extractEmbeddedJson(html));

    expect(parsed).toEqual(JSON.parse(JSON.stringify(payload)));
  });

  it('CSP allows exactly the two inline scripts by hash', () => {
    const html = generateHtmlReport(makePayload());
    const cspMatch = html.match(/Content-Security-Policy" content="([^"]+)"/);
    expect(cspMatch).not.toBeNull();
    const csp = cspMatch![1];

    const rendererSource = readFileSync(join(__dirname, '..', 'assets', 'static', 'report-view.js'), 'utf-8');
    const rendererHash = createHash('sha256').update(rendererSource, 'utf8').digest('base64');
    const bootHash = createHash('sha256').update(BOOT_SCRIPT, 'utf8').digest('base64');

    expect(csp).toContain(`'sha256-${rendererHash}'`);
    expect(csp).toContain(`'sha256-${bootHash}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('unsafe-eval');
    // script-src must not fall back to unsafe-inline
    const scriptSrc = csp.split(';').find(d => d.trim().startsWith('script-src')) || '';
    expect(scriptSrc).not.toContain('unsafe-inline');
  });

  it('the inline script blocks byte-match their CSP hashes', () => {
    const html = generateHtmlReport(makePayload());
    // Grab all plain <script>…</script> blocks (the JSON block has a type attr).
    const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    expect(blocks).toHaveLength(2);

    for (const block of blocks) {
      const hash = createHash('sha256').update(block, 'utf8').digest('base64');
      expect(html).toContain(`'sha256-${hash}'`);
    }
  });

  it('escapes hostile extension ids in the document title', () => {
    const html = generateHtmlReport(makePayload({ extensionId: '<img src=x onerror=alert(1)>' }));
    const title = html.match(/<title>([\s\S]*?)<\/title>/)![1];

    expect(title).not.toContain('<img');
    expect(title).toContain('&lt;img');
  });
});
