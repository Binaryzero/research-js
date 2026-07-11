import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from '../src/index.js';
import { generateHtmlReport } from '../src/analyzer/report-html.js';
import { toRenderModel } from '../src/analyzer/render-model.js';
import { makeAnalysisResult, makeFinding } from './fixtures.js';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tempDir = join(__dirname, '..', '.temp-test', `report-data-api-${process.pid}`);
const reportsDir = join(tempDir, 'reports');
const historyFile = join(tempDir, 'history.json');

const EXT_ID = 'acme.widget';

describe('report data + html API', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    mkdirSync(reportsDir, { recursive: true });

    const result = makeAnalysisResult({
      extensionId: EXT_ID,
      findings: [makeFinding({ title: 'Data finding' })],
    });
    writeFileSync(join(reportsDir, `${EXT_ID}.md`), '# markdown report');
    writeFileSync(join(reportsDir, `${EXT_ID}.json`), JSON.stringify(result));
    const payload = toRenderModel(result, {
      score: 12,
      filterConfig: { excluded_domains: [], excluded_url_patterns: [], endpoint_classification: [] },
    });
    writeFileSync(join(reportsDir, `${EXT_ID}.html`), generateHtmlReport(payload));
    writeFileSync(historyFile, JSON.stringify({
      scans: { [EXT_ID]: { suspicion_score: 12, llm_adjusted_score: 34, llm_analyzed: true } },
    }));

    // Legacy scan: markdown only, no structured JSON
    writeFileSync(join(reportsDir, 'legacy.oldscan.md'), '# legacy');

    const created = await createServer({ reportsDir, historyFile });
    server = created.fastify;
  });

  afterAll(async () => {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /api/reports/:name/data returns the render model with history score', async () => {
    const response = await server.inject({ method: 'GET', url: `/api/reports/${EXT_ID}.md/data` });

    expect(response.statusCode).toBe(200);
    const payload = JSON.parse(response.body);
    expect(payload.result.extensionId).toBe(EXT_ID);
    expect(payload.result.findings).toHaveLength(1);
    expect(payload.score).toBe(34); // llm_adjusted_score wins over suspicion_score
    // Slimming happened: raw AnalysisResult fields are not exposed
    expect(payload.result.vsixManifest).toBeUndefined();
  });

  it('GET /api/reports/:name/data returns 404 for legacy scans without JSON', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/reports/legacy.oldscan.md/data' });
    expect(response.statusCode).toBe(404);
  });

  it('GET /api/reports/:name/data rejects traversal and non-md names', async () => {
    for (const bad of ['..%2Fsecrets.md', 'foo.txt', 'foo.html']) {
      const response = await server.inject({ method: 'GET', url: `/api/reports/${bad}/data` });
      expect([400, 404]).toContain(response.statusCode);
      expect(response.statusCode === 400 || bad.includes('%2F')).toBe(true);
    }
  });

  it('GET /api/reports/:name/html serves the standalone file as attachment', async () => {
    const response = await server.inject({ method: 'GET', url: `/api/reports/${EXT_ID}.md/html` });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.body).toContain('window.ReportView');
  });

  it('GET /api/reports/:name/html returns 404 when no HTML exists', async () => {
    const response = await server.inject({ method: 'GET', url: '/api/reports/legacy.oldscan.md/html' });
    expect(response.statusCode).toBe(404);
  });

  it('DELETE /api/reports/:name removes the md, json, and html siblings', async () => {
    const response = await server.inject({ method: 'DELETE', url: `/api/reports/${EXT_ID}.md` });

    expect(response.statusCode).toBe(200);
    expect(existsSync(join(reportsDir, `${EXT_ID}.md`))).toBe(false);
    expect(existsSync(join(reportsDir, `${EXT_ID}.json`))).toBe(false);
    expect(existsSync(join(reportsDir, `${EXT_ID}.html`))).toBe(false);
  });
});
