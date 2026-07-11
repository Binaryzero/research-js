/**
 * Fastify server with SSE endpoints
 */

import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import viewPlugin from '@fastify/view';
import multipartPlugin from '@fastify/multipart';
import corsPlugin from '@fastify/cors';
import { join, dirname, basename } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { readdir, stat, writeFile } from 'fs/promises';
import { marked } from 'marked';
import nunjucks from 'nunjucks';

import { getConfig, getPrompts, getAppConfig, saveAppConfig, slotToLlmConfig, getPromptsForProfile } from './config.js';
import type { AppConfig } from './types/index.js';
import { StaticAnalyzer, extractVsix } from './analyzer/static.js';
import { LlmClient, ConsensusOrchestrator, parseVerdictFromSummary } from './analyzer/llm.js';
import { createProvider } from './providers/index.js';
import { ReportGenerator } from './analyzer/report.js';
import { toRenderModel } from './analyzer/render-model.js';
import { generateHtmlReport } from './analyzer/report-html.js';
import { getEndpointFiltering } from './analyzer/patterns.js';
import { calculateSuspicionScore, getRiskLabel, getRiskColor, type ScoreBreakdown } from './analyzer/scoring.js';
import { downloadExtension, parseMarketplaceUrl, isMarketplaceUrl } from './services/download.js';
import { searchExtensions } from './services/marketplace.js';
import { loadHistory, updateHistory, saveHistory } from './history.js';
import type { AnalysisResult, ScanTask } from './types/index.js';
import type { PromptConfig } from './config.js';
import { logger, getComponentLogger } from "./services/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'assets', 'templates');

// Nunjucks will be configured by @fastify/view
// We just need to pass the nunjucks module itself

// In-memory scan registry
const scans = new Map<string, ScanTaskEmitter>();

class ScanTaskEmitter extends EventEmitter {
  id: string;
  status: ScanTask['status'] = 'pending';
  progress = 0;
  message = '';
  log: string[] = [];
  result: AnalysisResult | null = null;
  error: string | null = null;
  cancelled = false;
  
  constructor() {
    super();
    this.id = randomUUID().slice(0, 12);
  }
  
  emitProgress(progress: number, message: string) {
    this.progress = progress;
    this.message = message;
    // Limit log size to prevent memory issues (keep last 100 entries)
    if (this.log.length >= 100) {
      this.log.shift();
    }
    this.log.push(message);
    this.emit('progress', { progress, message, status: this.status });
  }
  
  complete(result: AnalysisResult, summary?: Record<string, unknown>) {
    this.status = 'complete';
    this.result = result;
    this.progress = 1;
    this.emit('done', { status: 'complete', result: summary || result });
  }
  
  fail(error: string) {
    this.status = 'failed';
    this.error = error;
    this.emit('done', { status: 'failed', error });
  }
  
  /**
   * Clear the result to free memory. Call after the result has been retrieved.
   */
  clearResult() {
    // Clear the entire result to free memory
    // The report has already been saved to disk
    this.result = null;
    this.log = []; // Clear log to free memory
  }
}

// Maximum number of completed scans to keep in memory (configurable via env)
const MAX_SCANS_IN_MEMORY = parseInt(process.env.MAX_SCANS_IN_MEMORY || '10', 10);

/**
 * Clean up old completed scans from the registry
 */
function cleanupOldScans() {
  const completedScans = Array.from(scans.entries())
    .filter(([, task]) => task.status === 'complete' || task.status === 'failed' || task.status === 'cancelled')
    // Failed/cancelled tasks have result === null (no analysisDate). Sort those
    // LAST (treat as newest) so a just-run failed/cancelled scan isn't evicted
    // first — otherwise the user gets a 404 fetching its status.
    .sort((a, b) => {
      const dateA = a[1].result?.analysisDate;
      const dateB = b[1].result?.analysisDate;
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return dateA.localeCompare(dateB);
    });
  
  // Remove oldest scans if we have too many
  while (completedScans.length > MAX_SCANS_IN_MEMORY) {
    const [oldestId] = completedScans.shift()!;
    const task = scans.get(oldestId);
    if (task) {
      task.clearResult();
      task.removeAllListeners();
    }
    scans.delete(oldestId);
  }
}

/**
 * Validate that a URL is safe to use as an LLM base URL.
 * Rejects non-HTTP/S schemes and cloud metadata / private IP ranges.
 */
function validateLlmBaseUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname;
    if (/^169\.254\./.test(host)) return false; // link-local / AWS metadata
    if (/^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\./.test(host)) return false; // RFC-1918 — loopback (127.x, localhost) intentionally allowed for local Ollama
    return true;
  } catch {
    return false;
  }
}

export async function createServer(configOverride?: Partial<Awaited<ReturnType<typeof getConfig>>>) {
  const defaultConfig = await getConfig();
  const config = { ...defaultConfig, ...configOverride };

  // Sync legacy config.llm from AppConfig (config.json) on startup
  // so provider/model/baseUrl reflect saved settings from the first request
  const initialAppCfg = getAppConfig();
  config.llm = slotToLlmConfig(initialAppCfg.main, initialAppCfg);
  config.defaultNoLlm = initialAppCfg.defaultNoLlm;
  config.defaultFull = initialAppCfg.defaultFull;

  let prompts = getPrompts();
  
  const fastify = Fastify({
    logger: process.env.NODE_ENV !== 'production'
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : true,
  });
  
  // Register plugins
  await fastify.register(staticPlugin, {
    root: join(__dirname, '..', 'assets', 'static'),
    prefix: '/static/',
  });
  
  // Register view plugin with Nunjucks
  await fastify.register(viewPlugin, {
    engine: {
      nunjucks: nunjucks,
    },
    root: TEMPLATES_DIR,
    viewExt: 'html',
    options: {
      autoescape: true,
      noCache: true
    }
  });
  
  await fastify.register(multipartPlugin, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50 MB — typical VSIX ceiling
      files: 1,
      fields: 10,
    },
  });

  const port = config.port || 8001;
  await fastify.register(corsPlugin, {
    origin: [`http://localhost:${port}`, `http://127.0.0.1:${port}`],
    methods: ['GET', 'POST', 'DELETE'],
  });
  
  // Add urlencoded body parser for form submissions
  fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const params = new URLSearchParams(body as string);
      const result: Record<string, string> = {};
      for (const [key, value] of params.entries()) {
        result[key] = value;
      }
      done(null, result);
    } catch (err) {
      done(err as Error);
    }
  });
  
  // Storage paths
  const reportsDir = config.reportsDir;
  if (!existsSync(reportsDir)) {
    mkdirSync(reportsDir, { recursive: true });
  }
  
  // ---------------------------------------------------------------
  // Page routes - render HTML templates with Nunjucks
  // ---------------------------------------------------------------
  fastify.get('/', async (request, reply) => {
    return reply.view('index', { request });
  });
  
  fastify.get('/batch', async (request, reply) => {
    return reply.view('batch', { 
      request,
      categories: Object.keys({
        'All categories': '',
        'Programming Languages': 'Programming Languages',
        'Snippets': 'Snippets',
        'Linters': 'Linters',
        'Themes': 'Themes',
        'Debuggers': 'Debuggers',
        'Formatters': 'Formatters',
        'Keymaps': 'Keymaps',
        'Extension Packs': 'Extension Packs',
        'Language Packs': 'Language Packs',
        'Data Science': 'Data Science',
        'Machine Learning': 'Machine Learning',
        'Testing': 'Testing',
        'Other': 'Other',
      }),
      sort_options: Object.keys({
        'Published Date': 'publishedDate',
        'Installs': 'installCount',
        'Rating': 'weightedRating',
        'Updated Date': 'lastUpdated',
        'Name': 'displayName',
      }),
    });
  });
  
  fastify.get('/history', async (_request, reply) => {
    return reply.redirect('/batch');
  });
  
  fastify.get('/settings', async (request, reply) => {
    return reply.view('settings', { request });
  });
  
  fastify.get('/report/:name', async (request, reply) => {
    const params = request.params as { name: string };
    return reply.view('report', { request, report_name: params.name });
  });
  
  // ---------------------------------------------------------------
  // API: Start scan
  // ---------------------------------------------------------------
  fastify.post('/api/scan', async (request, reply) => {
    // Handle both JSON and form data (including file uploads)
    let params: Record<string, string> = {};
    let uploadedFilePath: string | null = null;

    if (request.isMultipart()) {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'field') {
          params[part.fieldname] = part.value as string;
        } else if (part.type === 'file' && part.filename) {
          // Save uploaded VSIX to a temp directory
          const tempDir = `/tmp/vsix_upload_${Date.now()}`;
          mkdirSync(tempDir, { recursive: true });
          const safeFilename = basename(part.filename).replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload.vsix';
          const filePath = join(tempDir, safeFilename);
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          writeFileSync(filePath, Buffer.concat(chunks));
          uploadedFilePath = filePath;
        }
      }
    } else {
      params = request.body as Record<string, string>;
    }

    // Uploaded file takes precedence when no URL/path is provided
    const inputSource = params.input_source || params.url || uploadedFilePath || '';
    const noLlm = params.no_llm !== undefined
      ? String(params.no_llm).toLowerCase() === 'true'
      : config.defaultNoLlm ?? false;

    // Model config comes from server-side AppConfig (config.json), not client
    const appCfg = getAppConfig();
    const modelName = appCfg.main.model;
    const ollamaUrl = appCfg.main.baseUrl;

    // Parse the URL to get extension info (for proper naming)
    let extensionInfo: { publisher: string; extension: string } | null = null;
    if (isMarketplaceUrl(inputSource)) {
      extensionInfo = parseMarketplaceUrl(inputSource);
    }

    if (!inputSource) {
      return reply.status(400).send({ error: 'input_source, url, or vsix file required' });
    }

    const task = new ScanTaskEmitter();
    scans.set(task.id, task);

    // Inject provider from AppConfig so the correct LLM provider class is used
    const configWithProvider = {
      ...config,
      llm: {
        ...config.llm,
        provider: appCfg.main.provider,
      },
    };

    // Run scan in background
    runScan(task, inputSource, {
      noLlm,
      modelName,
      ollamaUrl,
      reportsDir,
      config: configWithProvider,
      prompts,
      extensionInfo,
    }).catch(err => task.fail(err instanceof Error ? err.message : String(err)));
    
    return { scan_id: task.id };
  });
  
  // ---------------------------------------------------------------
  // API: Scan progress (SSE)
  // ---------------------------------------------------------------
  fastify.get('/api/scan/:scanId/progress', async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const task = scans.get(scanId);
    
    if (!task) {
      return reply.status(404).send({ error: 'Scan not found' });
    }
    
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    
    const sendEvent = (event: string, data: object) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    
    // Send current state
    sendEvent('progress', { progress: task.progress, message: task.message, status: task.status });
    
    const onProgress = (data: object) => sendEvent('progress', data);
    const onDone = (data: object) => {
      sendEvent('done', data);
      reply.raw.end();
    };
    
    task.on('progress', onProgress);
    task.on('done', onDone);
    
    // Keepalive
    const keepalive = setInterval(() => {
      if (task.status === 'complete' || task.status === 'failed') {
        clearInterval(keepalive);
        return;
      }
      reply.raw.write(': keepalive\n\n');
    }, 15000);
    
    request.raw.on('close', () => {
      clearInterval(keepalive);
      task.off('progress', onProgress);
      task.off('done', onDone);
    });
  });
  
  // ---------------------------------------------------------------
  // API: Get scan result
  // ---------------------------------------------------------------
  fastify.get('/api/scan/:scanId/result', async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const task = scans.get(scanId);
    
    if (!task) {
      return reply.status(404).send({ error: 'Scan not found' });
    }
    
    const response = {
      status: task.status,
      progress: task.progress,
      result: task.result,
      error: task.error,
      log: task.log,
    };
    
    // Clear result data after it's been retrieved to free memory
    // (The report file has already been saved to disk)
    if (task.status === 'complete' || task.status === 'failed') {
      setImmediate(() => task.clearResult());
    }
    
    return response;
  });
  
  // ---------------------------------------------------------------
  // API: Cancel scan
  // ---------------------------------------------------------------
  fastify.delete('/api/scan/:scanId', async (request, reply) => {
    const { scanId } = request.params as { scanId: string };
    const task = scans.get(scanId);
    
    if (!task) {
      return reply.status(404).send({ error: 'Scan not found' });
    }
    
    task.cancelled = true;
    task.status = 'cancelled';
    task.emit('done', { status: 'cancelled' });
    
    return { cancelled: true };
  });
  
  /**
   * Validate a client-supplied report name before joining it onto reportsDir.
   * Rejects traversal on both POSIX and Windows separators (backslash is a
   * path separator on Windows, so "..\\" would escape reportsDir there).
   */
  function isValidReportName(name: string): boolean {
    return !name.includes('..') && !name.includes('/') && !name.includes('\\') && name.endsWith('.md');
  }

  // ---------------------------------------------------------------
  // API: List reports
  // ---------------------------------------------------------------
  fastify.get('/api/reports', async () => {
    if (!existsSync(reportsDir)) {
      return { reports: [] };
    }

    const files = (await readdir(reportsDir)).filter(f => f.endsWith('.md'));

    // stat each file concurrently; skip any that fail (e.g. deleted mid-scan)
    // rather than failing the whole listing.
    const settled = await Promise.allSettled(
      files.map(async (file) => {
        const stats = await stat(join(reportsDir, file));
        return {
          name: file,
          mtime: stats.mtime.toISOString(),
          size: stats.size,
        };
      })
    );

    const reports = settled
      .filter((r): r is PromiseFulfilledResult<{ name: string; mtime: string; size: number }> => r.status === 'fulfilled')
      .map((r) => r.value)
      .sort((a, b) => b.mtime.localeCompare(a.mtime));

    return { reports };
  });
  
  // ---------------------------------------------------------------
  // API: Get report content
  // ---------------------------------------------------------------
  fastify.get('/api/reports/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    
    // Security: prevent path traversal
    if (!isValidReportName(name)) {
      return reply.status(400).send({ error: 'Invalid report name' });
    }
    
    const reportPath = join(reportsDir, name);
    
    if (!existsSync(reportPath)) {
      return reply.status(404).send({ error: 'Report not found' });
    }
    
    const content = readFileSync(reportPath, 'utf-8');
    const html = await marked(content, { gfm: true, breaks: false });
    return { name, content, html };
  });

  // ---------------------------------------------------------------
  // API: Get structured report data (render model for the interactive viewer)
  // ---------------------------------------------------------------
  fastify.get('/api/reports/:name/data', async (request, reply) => {
    const { name } = request.params as { name: string };

    if (!isValidReportName(name)) {
      return reply.status(400).send({ error: 'Invalid report name' });
    }

    const extensionId = name.slice(0, -'.md'.length);
    const persisted = loadPersistedResult(reportsDir, extensionId);
    if (!persisted) {
      // Older scans have no persisted JSON — the client falls back to markdown.
      return reply.status(404).send({ error: 'No structured data for this report' });
    }

    let score: number | null = null;
    try {
      const scans = loadHistory(config.historyFile);
      const entry = findScanByExtensionId(scans, persisted.extensionId || extensionId);
      if (entry) {
        const data = entry.data as Record<string, unknown>;
        score = (data.llm_adjusted_score as number) ?? (data.suspicion_score as number) ?? null;
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to look up score from history');
    }

    const filterConfig = getEndpointFiltering(join(__dirname, '..', 'docs', 'patterns.yaml'));
    return toRenderModel(persisted, { score, filterConfig });
  });

  // ---------------------------------------------------------------
  // API: Download standalone HTML report
  // ---------------------------------------------------------------
  fastify.get('/api/reports/:name/html', async (request, reply) => {
    const { name } = request.params as { name: string };

    if (!isValidReportName(name)) {
      return reply.status(400).send({ error: 'Invalid report name' });
    }

    const htmlPath = join(reportsDir, name.slice(0, -'.md'.length) + '.html');
    if (!existsSync(htmlPath)) {
      return reply.status(404).send({ error: 'No HTML report for this scan' });
    }

    // Served as an attachment: the file is a self-contained report (with its
    // own meta CSP) meant to be saved and shared, not rendered on this origin.
    // The filename derives from attacker-controlled extension metadata: keep
    // the header value printable-ASCII-only so it can never carry control
    // characters or quotes into a response-header sink (scans persisted
    // before scan-time sanitization may still have hostile names on disk).
    const headerSafeName = basename(htmlPath).replace(/[^\x20-\x7e]|"/g, '_');
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Disposition', `attachment; filename="${headerSafeName}"`)
      .send(readFileSync(htmlPath, 'utf-8'));
  });

  // ---------------------------------------------------------------
  // API: Delete report
  // ---------------------------------------------------------------
  fastify.delete('/api/reports/:name', async (request, reply) => {
    const { name } = request.params as { name: string };

    if (!isValidReportName(name)) {
      return reply.status(400).send({ error: 'Invalid report name' });
    }

    const reportPath = join(reportsDir, name);

    if (!existsSync(reportPath)) {
      return reply.status(404).send({ error: 'Report not found' });
    }

    unlinkSync(reportPath);

    // Remove the structured-data and HTML siblings so a delete removes the
    // whole scan artifact set, not just the markdown.
    const base = reportPath.slice(0, -'.md'.length);
    for (const ext of ['.json', '.html']) {
      try {
        if (existsSync(base + ext)) unlinkSync(base + ext);
      } catch (err) {
        logger.warn({ err, path: base + ext }, 'Failed to delete report sibling');
      }
    }

    return { deleted: true };
  });
  
  // ---------------------------------------------------------------
  // API: Scan History
  // ---------------------------------------------------------------
  const historyPath = config.historyFile;

  /**
   * Look up a scan by extension ID with case-insensitive matching.
   * Returns the scan data with its original key, or undefined if not found.
   * Note: New entries are stored with lowercase keys for O(1) lookup.
   */
  function findScanByExtensionId(scans: Record<string, unknown>, extensionId: string): { key: string; data: Record<string, unknown> } | undefined {
    // Primary lookup: lowercase key (new entries are normalized)
    const lowerId = extensionId.toLowerCase();
    if (lowerId in scans) {
      return { key: lowerId, data: scans[lowerId] as Record<string, unknown> };
    }
    // Fallback: try original case (for legacy entries)
    if (extensionId in scans) {
      return { key: extensionId, data: scans[extensionId] as Record<string, unknown> };
    }
    // Last resort: case-insensitive search (for legacy entries with mixed case)
    for (const [key, value] of Object.entries(scans)) {
      if (key.toLowerCase() === lowerId) {
        return { key, data: value as Record<string, unknown> };
      }
    }
    return undefined;
  }

  fastify.get('/api/history', async (request, _reply) => {
    const query = request.query as {
      search?: string;
      risk?: string;
      llm?: string;
      limit?: number;
      offset?: number;
    };
    
    const scans = loadHistory(historyPath);
    // Filters COMPOSE: each narrows the running result rather than re-deriving
    // from the full history (the previous code re-filtered the original entries
    // in every block, so only the last-applied filter took effect).
    let entries = Object.entries(scans);

    // Filter by search term
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      entries = entries.filter(([eid]) => eid.toLowerCase().includes(searchLower));
    }

    // Filter by risk level
    if (query.risk) {
      entries = entries.filter(([, info]) => {
        const scanInfo = info as Record<string, unknown>;
        const score = (scanInfo.llm_adjusted_score as number) ?? (scanInfo.suspicion_score as number) ?? 0;
        return getRiskLabel(score) === query.risk;
      });
    }

    // Filter by LLM status
    if (query.llm === 'llm') {
      entries = entries.filter(([, info]) => (info as Record<string, unknown>).llm_analyzed === true);
    } else if (query.llm === 'no-llm') {
      entries = entries.filter(([, info]) => (info as Record<string, unknown>).llm_analyzed !== true);
    }

    // Calculate display values from the composed result
    const displayScans: Record<string, Record<string, unknown>> = {};
    for (const [eid, info] of entries) {
      const scanInfo = info as Record<string, unknown>;
      const score = (scanInfo.llm_adjusted_score as number) ?? (scanInfo.suspicion_score as number) ?? 0;
      displayScans[eid] = {
        ...scanInfo,
        risk_label: getRiskLabel(score),
        risk_color: getRiskColor(score),
        display_score: score,
      };
    }
    
    // Pagination
    const allEntries = Object.entries(displayScans);
    const total = allEntries.length;
    const limit = query.limit || 100;
    const offset = query.offset || 0;
    const paginated = Object.fromEntries(allEntries.slice(offset, offset + limit));
    
    return { scans: paginated, total, limit, offset };
  });
  
  fastify.delete('/api/history', async () => {
    await saveHistory(historyPath, {});
    return { cleared: true };
  });

  fastify.delete('/api/history/:extension_id', async (request, reply) => {
    const { extension_id } = request.params as { extension_id: string };

    const deleted = await updateHistory(historyPath, scans => {
      const target = findScanByExtensionId(scans, extension_id);
      if (!target) return false;
      delete scans[target.key];
      return true;
    });

    if (!deleted) {
      return reply.status(404).send({ error: 'Scan not found' });
    }
    return { deleted: extension_id };
  });
  
  // ---------------------------------------------------------------
  // API: List models
  // ---------------------------------------------------------------
  fastify.get('/api/models', async (request, _reply) => {
    const query = request.query as { ollama_url?: string; provider?: string };
    const appCfg = getAppConfig();
    // Ignore client-supplied ollama_url — use only the server-side configured value
    // to prevent SSRF via the query parameter.
    const baseUrl = config.llm.baseUrl;
    const provider = query.provider || appCfg.main.provider || 'ollama';

    // Try the provider-appropriate endpoint first, then fall back
    if (provider === 'ollama') {
      try {
        const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const data = await response.json() as { models?: Array<{ name: string }> };
          return { models: data.models?.map(m => m.name) || [] };
        }
      } catch {}
      // Fallback: try OpenAI-compatible endpoint (some Ollama proxies expose this)
      try {
        const response = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const data = await response.json() as { data?: Array<{ id: string }> };
          return { models: data.data?.map(m => m.id) || [] };
        }
      } catch {}
    } else {
      // OpenAI-compatible provider: try /v1/models first
      try {
        const response = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const data = await response.json() as { data?: Array<{ id: string }> };
          return { models: data.data?.map(m => m.id) || [] };
        }
      } catch {}
      // Fallback: try Ollama endpoint (user might have Ollama on an OpenAI-compat URL)
      try {
        const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
          const data = await response.json() as { models?: Array<{ name: string }> };
          return { models: data.models?.map(m => m.name) || [] };
        }
      } catch {}
    }

    return { models: [] };
  });
  
  // ---------------------------------------------------------------
  // API: Marketplace search
  // ---------------------------------------------------------------
  fastify.post('/api/search', async (request, reply) => {
    // Handle both JSON and form data
    let params: {
      search_text?: string;
      category?: string;
      sort_by?: string;
      page?: number;
      page_size?: number;
    } = {};
    
    if (request.isMultipart()) {
      // Parse multipart form data
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'field') {
          (params as Record<string, string | number>)[part.fieldname] = part.value as string;
        }
      }
    } else {
      params = request.body as typeof params;
    }
    
    try {
      const results = await searchExtensions({
        searchText: params.search_text || '',
        category: params.category || '',
        sortBy: params.sort_by || 'Installs',
        page: params.page || 1,
        pageSize: params.page_size || 50,
      });
      
      // Augment with scan history (case-insensitive lookup). A corrupt history
      // file (loadHistory now throws on parse failure) must not blank the whole
      // search — degrade to un-augmented results instead of a blanket 500.
      try {
        const scans = loadHistory(historyPath);
        for (const ext of results) {
          const found = findScanByExtensionId(scans, ext.extensionId);
          if (found) {
            const info = found.data;
            const score = (info.llm_adjusted_score as number) ?? (info.suspicion_score as number) ?? 0;
            ext.scan = {
              score,
              risk_label: getRiskLabel(score),
              risk_color: getRiskColor(score),
              findings_count: (info.findings_count as number) || 0,
              llm_analyzed: (info.llm_analyzed as boolean) || false,
              report_name: info.report_path ? basename(info.report_path as string) : '',
              scan_date: (info.scan_date as string) || '',
              breakdown: (info.breakdown as Record<string, unknown>) || {},
              static_score: info.suspicion_score as number | undefined,
              // Include true_positives for LLM-analyzed extensions (used by batch UI)
              ...(typeof info.true_positives === 'number' && { true_positives: info.true_positives }),
              verdict: (info.verdict as string) || null,
            };
          }
        }
      } catch (histError) {
        logger.error({ err: histError }, 'History augmentation failed; returning un-augmented search results');
      }

      return { results, total: results.length };
    } catch (error) {
      // Surface the real cause instead of swallowing it behind a generic message —
      // this is what made the "search returns nothing" failure so hard to diagnose.
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error }, 'Marketplace search failed');
      return reply.status(500).send({ error: `Marketplace search failed: ${message}` });
    }
  });
  
  // ---------------------------------------------------------------
  // API: Parse search URL
  // ---------------------------------------------------------------
  fastify.post('/api/parse-search-url', async (request, reply) => {
    let url: string | undefined;
    
    if (request.isMultipart()) {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'url') {
          url = part.value as string;
        }
      }
    } else {
      const body = request.body as { url?: string };
      url = body.url;
    }
    
    if (!url) {
      return reply.status(400).send({ error: 'url required' });
    }
    
    // Check if it's a marketplace URL
    if (isMarketplaceUrl(url)) {
      const parsed = parseMarketplaceUrl(url);
      if (parsed) {
        return {
          type: 'extension',
          publisher: parsed.publisher,
          extension: parsed.extension,
          extension_id: `${parsed.publisher}.${parsed.extension}`,
        };
      }
    }
    
    return { type: 'search', url };
  });
  
  // NOTE: Legacy POST /api/models endpoint removed — settings are saved via POST /api/config

  // ---------------------------------------------------------------
  // API: Get multi-model config (AppConfig)
  // ---------------------------------------------------------------
  fastify.get('/api/config', async () => {
    const appConfig = getAppConfig();
    // Strip apiKey values before sending to client
    const sanitize = (slot: AppConfig['main']) => ({ ...slot, apiKey: slot.apiKey ? '***' : undefined });
    return {
      ...appConfig,
      main: sanitize(appConfig.main),
      judges: appConfig.judges.map(sanitize),
    };
  });

  // ---------------------------------------------------------------
  // API: Save multi-model config (AppConfig)
  // ---------------------------------------------------------------
  fastify.post('/api/config', async (request, reply) => {
    const body = request.body as Partial<AppConfig>;
    if (!body.main) {
      return reply.status(400).send({ error: 'main model config required' });
    }

    if (body.main.baseUrl && !validateLlmBaseUrl(body.main.baseUrl)) {
      return reply.status(400).send({ error: 'Invalid or disallowed main.baseUrl' });
    }
    if (Array.isArray(body.judges)) {
      for (const judge of body.judges) {
        if (judge.baseUrl && !validateLlmBaseUrl(judge.baseUrl)) {
          return reply.status(400).send({ error: `Invalid or disallowed baseUrl for judge: ${judge.baseUrl}` });
        }
      }
    }

    const current = getAppConfig();
    const updated: AppConfig = {
      version: body.version || current.version,
      main: { ...current.main, ...body.main },
      judges: Array.isArray(body.judges) ? body.judges : current.judges,
      consensus: { ...current.consensus, ...body.consensus },
      assessmentMode: body.assessmentMode || current.assessmentMode,
      promptProfile: body.promptProfile || current.promptProfile,
      concurrency: body.concurrency ?? current.concurrency,
      // Deep-merge tuning so a partial update preserves the other knobs.
      llmTuning: {
        ...current.llmTuning,
        ...body.llmTuning,
        evidenceMaxChars: {
          ...current.llmTuning.evidenceMaxChars,
          ...(body.llmTuning?.evidenceMaxChars ?? {}),
        },
      },
      // Deep-merge scoring weights so a partial update preserves the rest.
      scoring: {
        ...current.scoring,
        ...body.scoring,
        riskWeights: { ...current.scoring.riskWeights, ...(body.scoring?.riskWeights ?? {}) },
        verdictBoost: { ...current.scoring.verdictBoost, ...(body.scoring?.verdictBoost ?? {}) },
        thresholds: { ...current.scoring.thresholds, ...(body.scoring?.thresholds ?? {}) },
      },
      analysisLimits: { ...current.analysisLimits, ...body.analysisLimits },
      defaultNoLlm: body.defaultNoLlm ?? current.defaultNoLlm,
      defaultFull: body.defaultFull ?? current.defaultFull,
    };

    saveAppConfig(updated);

    // Sync main model back to legacy ServerConfig for backward compat
    config.llm = slotToLlmConfig(updated.main, updated);
    config.defaultNoLlm = updated.defaultNoLlm;
    config.defaultFull = updated.defaultFull;

    return { saved: true, judges: updated.judges.length };
  });

  // ---------------------------------------------------------------
  // API: Test connection to an LLM endpoint
  // ---------------------------------------------------------------
  fastify.post('/api/test-connection', async (request) => {
    const { baseUrl, model, provider } = request.body as { baseUrl?: string; model?: string; provider?: string };
    if (!baseUrl) return { ok: false, error: 'baseUrl required' };
    if (!validateLlmBaseUrl(baseUrl)) return { ok: false, error: 'Invalid or disallowed base URL' };

    try {
      // Test based on provider type
      if (provider === 'openai') {
        // Test OpenAI-compatible endpoint
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, { 
          method: 'GET', 
          signal: AbortSignal.timeout(5000) 
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true, model: model || 'unknown', provider: provider || 'ollama' };
      } else {
        // Test Ollama endpoint
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, { 
          method: 'GET', 
          signal: AbortSignal.timeout(5000) 
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return { ok: true, model: model || 'unknown', provider: provider || 'ollama' };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ---------------------------------------------------------------
  // API: Get prompts configuration
  // ---------------------------------------------------------------
  fastify.get('/api/prompts', async () => {
    return { prompts: prompts };
  });
  
  // ---------------------------------------------------------------
  // API: Update prompts configuration (saves to prompts.yaml)
  // ---------------------------------------------------------------
  fastify.post('/api/prompts', async (request, reply) => {
    const body = request.body as { prompts?: PromptConfig };
    
    if (!body.prompts) {
      return reply.status(400).send({ error: 'prompts required' });
    }
    
    try {
      // Update in-memory prompts
      prompts = body.prompts;
      
      // Save to prompts.yaml file
      const promptsPath = join(__dirname, '..', 'prompts.yaml');
      const indent = (s: string, n = 4) => (s || '').split('\n').map((l: string) => ' '.repeat(n) + l).join('\n');

      let yamlContent = `# LLM Prompt Configuration
# Customize prompts for security analysis

version: "${prompts.version || '1.0'}"

# System prompt for assessing security findings
finding_assessment:
  system: |
${indent(prompts.finding_assessment?.system)}
  user: |
${indent(prompts.finding_assessment?.user)}
  common_false_positives: |
${indent(prompts.finding_assessment?.common_false_positives)}
  genuine_concerns: |
${indent(prompts.finding_assessment?.genuine_concerns)}

# System prompt for generating executive summaries
executive_summary:
  system: |
${indent(prompts.executive_summary?.system)}
  user: |
${indent(prompts.executive_summary?.user)}

# Prose generation for findings
finding_prose:
  system: |
${indent(prompts.finding_prose?.system)}
  user: |
${indent(prompts.finding_prose?.user)}

# Batch triage prompt
triage_batch:
  system: |
${indent(prompts.triage_batch?.system || '')}
  user: |
${indent(prompts.triage_batch?.user || '')}
`;

      // Serialize profile overrides if any exist
      if (prompts.profiles && Object.keys(prompts.profiles).length > 0) {
        yamlContent += `\n# Per-model prompt profile overrides\nprofiles:\n`;
        for (const [profileName, overrides] of Object.entries(prompts.profiles)) {
          yamlContent += `  ${profileName}:\n`;
          for (const section of ['finding_assessment', 'executive_summary', 'finding_prose', 'triage_batch'] as const) {
            const sectionOverrides = (overrides as Record<string, Record<string, string>>)[section];
            if (sectionOverrides && Object.keys(sectionOverrides).length > 0) {
              yamlContent += `    ${section}:\n`;
              for (const [key, value] of Object.entries(sectionOverrides)) {
                yamlContent += `      ${key}: |\n${indent(value, 8)}\n`;
              }
            }
          }
        }
      }
      writeFileSync(promptsPath, yamlContent);

      return { saved: true, message: 'Prompts saved to prompts.yaml and active in-memory.' };
    } catch (e) {
      logger.error({ err: e }, 'Failed to save prompts');
      return reply.status(500).send({ error: 'Failed to save prompts to file' });
    }
  });
  
  // ---------------------------------------------------------------
  // API: LLM analysis for single extension
  // ---------------------------------------------------------------
  fastify.post('/api/llm-analyze', async (request, reply) => {
    const body = request.body as {
      extension_id?: string;
      publisher?: string;
      extension_name?: string;
      model?: string;
      model_name?: string;
      full_output?: boolean;
      ollama_url?: string;
      assessment_mode?: 'strategic' | 'bulk';
    };

    let publisher = body.publisher;
    let extensionName = body.extension_name;

    // Model config comes from server-side AppConfig (config.json), not client
    const appCfg = getAppConfig();
    const modelName = appCfg.main.model;
    const assessmentMode = appCfg.assessmentMode;

    // Handle extension_id format (publisher.extensionName)
    if (!publisher && !extensionName && body.extension_id) {
      const parts = body.extension_id.split('.');
      if (parts.length >= 2) {
        publisher = parts[0];
        extensionName = parts.slice(1).join('.');
      } else {
        return reply.status(400).send({ error: 'Invalid extension_id format. Use publisher.extensionName' });
      }
    }

    if (!publisher || !extensionName) {
      return reply.status(400).send({ error: 'publisher and extension_name are required (or extension_id)' });
    }

    if (!modelName) {
      return reply.status(400).send({ error: 'No model configured. Please configure a model in Settings.' });
    }

    const downloadUrl = `https://marketplace.visualstudio.com/items?itemName=${publisher}.${extensionName}`;

    const task = new ScanTaskEmitter();
    scans.set(task.id, task);

    // Config from server-side AppConfig
    const configWithMode = {
      ...config,
      llm: {
        ...config.llm,
        provider: appCfg.main.provider,
        assessmentMode,
      },
    };

    getComponentLogger('LLM Analyze').info({ modelName, assessmentMode }, 'Using model');

    // Reuse the stored findings from the prior static scan when available, so we
    // don't re-download and re-run static analysis just to feed the LLM.
    const persisted = loadPersistedResult(config.reportsDir, `${publisher}.${extensionName}`);

    // Run LLM analysis in background
    runScan(task, downloadUrl, {
      noLlm: false,
      modelName,
      ollamaUrl: appCfg.main.baseUrl,
      reportsDir: config.reportsDir,
      config: configWithMode,
      prompts,
      extensionInfo: { publisher, extension: extensionName },
      precomputedResult: persisted ?? undefined,
    }).catch(err => task.fail(err instanceof Error ? err.message : String(err)));

    return { scan_id: task.id };
  });

  // ---------------------------------------------------------------
  // API: Batch static scan
  // ---------------------------------------------------------------
  fastify.post('/api/batch-scan', async (request, reply) => {
    const body = request.body as {
      extensions: Array<{ 
        extensionId?: string;
        publisher?: { publisherName: string };
        extensionName?: string;
      }>;
    };

    const extensions = body.extensions;
    
    if (!extensions || extensions.length === 0) {
      return reply.status(400).send({ error: 'extensions array is required' });
    }

    const task = new ScanTaskEmitter();
    scans.set(task.id, task);

    // Run batch static scan in background
    runBatchScan(task, extensions, {
      reportsDir: config.reportsDir,
      config,
      prompts: getPrompts(),
    }).catch(err => task.fail(err instanceof Error ? err.message : String(err)));

    return { scan_id: task.id };
  });

  // ---------------------------------------------------------------
  // API: Batch LLM analysis
  // ---------------------------------------------------------------
  fastify.post('/api/batch-llm-analyze', async (request, reply) => {
    const body = request.body as {
      extensions: Array<{ publisher: string; extensionName: string }>;
      ollama_url?: string;
      model_name?: string;
      verbose?: boolean;
      assessment_mode?: 'strategic' | 'bulk';
    };

    const extensions = body.extensions;

    // Model config comes from server-side AppConfig (config.json), not client
    const appCfg = getAppConfig();
    const modelName = appCfg.main.model;
    const ollamaUrl = appCfg.main.baseUrl;
    const assessmentMode = appCfg.assessmentMode;

    if (!extensions || extensions.length === 0) {
      return reply.status(400).send({ error: 'extensions array is required' });
    }

    if (!modelName) {
      return reply.status(400).send({ error: 'No model configured. Please configure a model in Settings.' });
    }

    const task = new ScanTaskEmitter();
    scans.set(task.id, task);

    // Config from server-side AppConfig
    const configWithMode = {
      ...config,
      llm: {
        ...config.llm,
        assessmentMode,
      },
    };

    getComponentLogger('Batch LLM').info({ modelName, assessmentMode }, 'Using model');

    // Run batch LLM analysis in background
    runBatchLlmAnalysis(task, extensions, {
      modelName,
      ollamaUrl,
      verbose: body.verbose || false,
      reportsDir: config.reportsDir,
      config: configWithMode,
      prompts,
    }).catch(err => task.fail(err instanceof Error ? err.message : String(err)));

    return { scan_id: task.id };
  });

  // ---------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  
  return { fastify, config };
}


/**
 * Persist one scan's summary into the JSON history file.
 *
 * Uses updateHistory from history.js for atomic, serialized writes.
 */
export async function saveScanToHistory(
  historyPath: string,
  extensionId: string,
  entry: Record<string, unknown>
): Promise<void> {
  await updateHistory(historyPath, (scans) => {
    scans[extensionId.toLowerCase()] = entry;
  });
}

interface ExtensionScanOptions {
  noLlm: boolean;
  modelName?: string;
  ollamaUrl?: string;
  reportsDir: string;
  historyPath: string;
  config: Awaited<ReturnType<typeof getConfig>>;
  prompts?: PromptConfig;
  /** Used when a marketplace URL is the source; overrides analyzer-detected ID */
  extensionInfo?: { publisher: string; extension: string } | null;
  /** Used by batch flows where the caller already knows the canonical ID */
  forceExtensionId?: string;
  /** Reuse these findings instead of downloading + re-running static analysis (LLM re-analysis). */
  precomputedResult?: AnalysisResult;
  staticVerbose?: boolean;
  onProgress: (fraction: number, message: string) => void;
  isCancelled: () => boolean;
  /** Caller-owned cleanup list; core appends download/extract dirs to it */
  tempDirs: string[];
}

interface ExtensionScanOutcome {
  result: AnalysisResult;
  score: number;
  breakdown: ScoreBreakdown;
  reportPath: string;
  reportName: string;
  markdown: string;
  llmAnalyzed: boolean;
}

/**
 * Core single-extension scan pipeline: download/extract → static analysis →
 * optional LLM enhancement → score → report → history.
 *
 * Returns null if cancelled mid-flight. Callers own temp-dir cleanup
 * (paths are appended to options.tempDirs).
 */
async function runExtensionScan(
  inputSource: string,
  options: ExtensionScanOptions
): Promise<ExtensionScanOutcome | null> {
  let result: AnalysisResult;
  // Empty when reusing stored findings — the exec-summary source reader tolerates
  // a missing path (walkExtensionFiles swallows it) and builds from findings alone.
  let extensionPath = '';

  if (options.precomputedResult) {
    // LLM re-analysis: reuse the stored findings and skip download, extraction,
    // and static analysis entirely (also avoids marketplace version drift).
    result = options.precomputedResult;
    options.onProgress(0.4, `Reusing ${result.findings.length} stored findings (skipped re-scan)`);
  } else {
  extensionPath = inputSource;

  if (inputSource.startsWith('http://') || inputSource.startsWith('https://')) {
    options.onProgress(0.02, 'Downloading extension...');
    const tempDir = join(tmpdir(), `vsix_download_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(tempDir, { recursive: true });
    options.tempDirs.push(tempDir);

    try {
      const dl = await downloadExtension(inputSource, tempDir);
      options.onProgress(0.08, `Downloaded: ${dl.filename}`);
      options.onProgress(0.1, 'Extracting VSIX...');
      extensionPath = extractVsix(dl.path);
      options.tempDirs.push(extensionPath);
    } catch (err) {
      throw new Error(`Failed to download extension: ${err instanceof Error ? err.message : err}`);
    }
  } else if (inputSource.endsWith('.vsix')) {
    if (!inputSource.startsWith('/tmp/vsix_upload_') && !inputSource.startsWith('/tmp/vsix_download_')) {
      throw new Error('Only marketplace URLs, direct VSIX URLs, or uploaded files are supported');
    }
    options.onProgress(0.05, 'Extracting VSIX...');
    extensionPath = extractVsix(inputSource);
    options.tempDirs.push(extensionPath);
  } else if (!existsSync(inputSource)) {
    // Fail loudly: analyzing a nonexistent path would produce an empty result
    // that looks like a clean scan and silently overwrites prior artifacts.
    throw new Error(
      `Input not found: "${inputSource}" is not a marketplace/VSIX URL, an uploaded .vsix, or an existing directory`,
    );
  }

  if (options.isCancelled()) return null;

  options.onProgress(0.15, 'Running static analysis...');
  const analyzer = new StaticAnalyzer(extensionPath, {
    verbose: options.staticVerbose ?? true,
    patternsFile: options.config.patternsFile,
  });
  result = await analyzer.analyze();

  // A real VSIX always contains at least a manifest; zero inventoried files
  // means the input was empty or extraction failed. Fail instead of writing a
  // clean-looking empty report over any previous scan of this extension.
  if (result.fileTypes.length === 0 && result.totalSize === 0) {
    throw new Error(`No analyzable files found in "${inputSource}"; refusing to persist an empty result`);
  }

  options.onProgress(0.4, `Static analysis complete: ${result.findings.length} findings`);
  }

  LlmClient.clearFastAssessmentCache();

  if (options.isCancelled()) return null;

  let orchestrator: ConsensusOrchestrator | null = null;
  const basePrompts = options.prompts || getPrompts();

  if (!options.noLlm && options.modelName) {
    options.onProgress(0.42, `Connecting to LLM (${options.modelName})...`);

    const appConfig = getAppConfig();
    const profiledPrompts = getPromptsForProfile(appConfig.promptProfile, basePrompts);

    const mainClient = new LlmClient({
      ...options.config.llm,
      provider: appConfig.main.provider,
      model: options.modelName,
      baseUrl: options.ollamaUrl ?? options.config.llm.baseUrl,
    }, profiledPrompts);

    const judgeClients = appConfig.judges
      .filter(j => j.enabled)
      .map(j => {
        const provider = createProvider(
          j.provider,
          { id: j.id, model: j.model },
          { baseUrl: j.baseUrl.replace(/\/$/, ''), timeout: j.timeout, apiKey: j.apiKey },
          { maxTokens: j.maxTokens, temperature: j.temperature }
        );
        return new LlmClient(slotToLlmConfig(j, appConfig), profiledPrompts, provider);
      });

    orchestrator = new ConsensusOrchestrator(mainClient, judgeClients, appConfig.consensus);

    const available = await orchestrator.isAvailable();

    if (available) {
      if (judgeClients.length > 0) {
        try {
          await orchestrator.verifyJudges();
          options.onProgress(0.43, `${judgeClients.length} judge(s) verified`);
        } catch (err) {
          options.onProgress(0.43, `Judge verification failed: ${err instanceof Error ? err.message : err}`);
          throw err;
        }
      }

      if (result.findings.length > 0) {
        options.onProgress(0.45, `LLM analyzing ${result.findings.length} findings...`);

        const assessments = await orchestrator.batchAssessFindings(result.findings, {
          onProgress: (p, m) => options.onProgress(0.45 + p * 0.4, m),
          extensionName: result.extensionName,
        });

        for (let i = 0; i < assessments.length; i++) {
          const a = assessments[i];
          if (a) {
            result.findings[i].riskLevel = a.riskLevel;
            result.findings[i].isFalsePositive = a.isFalsePositive;
            result.findings[i].falsePositiveReason = a.falsePositiveReason;
            if (a.recommendation) result.findings[i].recommendation = a.recommendation;
            if (a.injectionDetected) result.findings[i].injectionDetected = a.injectionDetected;
            if (a.consensus) result.findings[i].consensus = a.consensus;
          }
        }
      }

      // A cancel during the (long) batch assessment should skip the equally
      // expensive executive-summary step rather than run it anyway.
      if (options.isCancelled()) return null;

      options.onProgress(0.88, 'Generating executive summary...');
      const summary = await orchestrator.generateExecutiveSummary(result, extensionPath);
      if (summary) {
        const { verdict, prose } = parseVerdictFromSummary(summary);
        result.verdict = verdict;
        result.executiveSummary = prose;
      } else {
        result.executiveSummary = null;
      }
    } else {
      options.onProgress(0.45, 'LLM not available');
      orchestrator = null;
    }
  }

  // The analyzer can detect a wrong ID from package.json (esp. non-English
  // extensions); the marketplace ID we already have is authoritative.
  if (options.forceExtensionId) {
    result.extensionId = options.forceExtensionId;
  } else if (options.extensionInfo) {
    result.extensionId = `${options.extensionInfo.publisher}.${options.extensionInfo.extension}`;
    if (!result.extensionName || result.extensionName === 'Unknown Extension') {
      result.extensionName = options.extensionInfo.extension;
    }
  }

  const llmAnalyzed = !!orchestrator;
  const [score, breakdown] = calculateSuspicionScore(result, { adjustForLlm: llmAnalyzed });

  options.onProgress(0.9, 'Generating report...');
  const generator = new ReportGenerator(result, { fullOutput: true });
  const markdown = generator.generate();

  const safeName = result.extensionId.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_');
  const reportName = `${safeName}.md`;
  const reportPath = join(options.reportsDir, reportName);
  await writeFile(reportPath, markdown);

  // Persist the structured result so LLM re-analysis can reuse the findings
  // instead of re-downloading and re-running static analysis.
  try {
    await writeFile(join(options.reportsDir, `${safeName}.json`), JSON.stringify(result, null, 2));
  } catch (err) {
    logger.warn({ err }, 'Failed to persist findings JSON');
  }

  // Standalone interactive HTML report next to the markdown one. Failure is
  // non-fatal: the .md and .json remain the durable outputs.
  try {
    const filterConfig = getEndpointFiltering(join(__dirname, '..', 'docs', 'patterns.yaml'));
    const payload = toRenderModel(result, { score, filterConfig });
    await writeFile(join(options.reportsDir, `${safeName}.html`), generateHtmlReport(payload));
  } catch (err) {
    logger.warn({ err }, 'Failed to write HTML report');
  }

  await saveScanToHistory(options.historyPath, result.extensionId, {
    extension_name: result.extensionName,
    version: result.version,
    scan_date: new Date().toISOString(),
    suspicion_score: score,
    llm_adjusted_score: llmAnalyzed ? score : null,
    llm_analyzed: llmAnalyzed,
    findings_count: result.findings.length,
    true_positives: result.findings.filter(f => !f.isFalsePositive).length,
    report_path: reportPath,
    breakdown,
    verdict: result.verdict || null,
  });

  return { result, score, breakdown, reportPath, reportName, markdown, llmAnalyzed };
}

/**
 * Load a persisted AnalysisResult (structured findings) for an extension, if a
 * prior scan saved one. Lets LLM re-analysis reuse findings instead of re-scanning.
 */
export function loadPersistedResult(reportsDir: string, extensionId: string): AnalysisResult | null {
  const safeName = extensionId.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_');
  const dataPath = join(reportsDir, `${safeName}.json`);
  if (!existsSync(dataPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(dataPath, 'utf-8')) as unknown;
    // Minimal shape check: a reusable result must at least carry a findings array.
    // A malformed file falls back to a full re-scan rather than feeding garbage
    // into the LLM/report pipeline.
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as AnalysisResult).findings)) {
      logger.warn({ extensionId }, 'Persisted findings JSON has unexpected shape; will re-scan');
      return null;
    }
    return parsed as AnalysisResult;
  } catch (err) {
    logger.warn({ err, extensionId }, 'Failed to read persisted findings JSON; will re-scan');
    return null;
  }
}

/**
 * Quietly remove temp dirs, ignoring errors.
 */
function cleanupTempDirs(dirs: string[]): void {
  for (const dir of dirs) {
    try {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run single-extension scan in background.
 */
async function runScan(
  task: ScanTaskEmitter,
  inputSource: string,
  options: {
    noLlm: boolean;
    modelName: string;
    ollamaUrl: string;
    reportsDir: string;
    config: Awaited<ReturnType<typeof getConfig>>;
    prompts?: PromptConfig;
    extensionInfo?: { publisher: string; extension: string } | null;
    precomputedResult?: AnalysisResult;
  }
): Promise<void> {
  task.status = 'running';
  task.emitProgress(0, 'Starting analysis...');

  const tempDirs: string[] = [];

  try {
    const outcome = await runExtensionScan(inputSource, {
      noLlm: options.noLlm,
      modelName: options.modelName,
      ollamaUrl: options.ollamaUrl,
      reportsDir: options.reportsDir,
      historyPath: options.config.historyFile,
      config: options.config,
      prompts: options.prompts,
      extensionInfo: options.extensionInfo,
      precomputedResult: options.precomputedResult,
      staticVerbose: true,
      onProgress: (p, m) => task.emitProgress(p, m),
      isCancelled: () => task.cancelled,
      tempDirs,
    });

    if (!outcome) {
      task.status = 'cancelled';
      return;
    }

    task.emitProgress(1, `Complete - score ${outcome.score} (${getRiskLabel(outcome.score)})`);

    const html = marked(outcome.markdown) as string;
    const clientSummary = {
      extensionId: outcome.result.extensionId,
      extensionName: outcome.result.extensionName,
      version: outcome.result.version,
      score: outcome.score,
      findings_count: outcome.result.findings.length,
      endpoints_count: outcome.result.endpoints.length,
      report_name: outcome.reportName,
      markdown: outcome.markdown,
      html,
      json: {
        findings_summary: {
          total: outcome.result.findings.length,
          confirmed: outcome.result.findings.filter(f => !f.isFalsePositive).length,
        },
        verdict: outcome.result.verdict || null,
        breakdown: outcome.breakdown,
      },
    };

    task.complete(outcome.result, clientSummary);
    cleanupOldScans();
  } catch (error) {
    task.fail(error instanceof Error ? error.message : 'Unknown error');
    cleanupOldScans();
  } finally {
    cleanupTempDirs(tempDirs);
  }
}

/**
 * Run batch LLM analysis in background.
 */
async function runBatchLlmAnalysis(
  task: ScanTaskEmitter,
  extensions: Array<{ publisher: string; extensionName: string }>,
  options: {
    modelName: string;
    ollamaUrl: string;
    verbose?: boolean;
    reportsDir: string;
    config: Awaited<ReturnType<typeof getConfig>>;
    prompts?: PromptConfig;
  }
): Promise<void> {
  task.status = 'running';
  const total = extensions.length;
  let scannedCount = 0;
  task.emitProgress(0, `Batch LLM analysis: ${total} extensions`);

  for (let i = 0; i < total; i++) {
    if (task.cancelled) {
      task.status = 'cancelled';
      return;
    }

    const ext = extensions[i];
    const extensionId = `${ext.publisher}.${ext.extensionName}`;
    task.emitProgress(i / total, `[${i + 1}/${total}] Analyzing ${extensionId} with LLM...`);

    const tempDirs: string[] = [];
    try {
      const downloadUrl = `https://marketplace.visualstudio.com/items?itemName=${ext.publisher}.${ext.extensionName}`;
      // Reuse stored findings from the prior static scan; only re-scan if none exist.
      const persisted = loadPersistedResult(options.reportsDir, extensionId);
      const outcome = await runExtensionScan(downloadUrl, {
        noLlm: false,
        modelName: options.modelName,
        ollamaUrl: options.ollamaUrl,
        reportsDir: options.reportsDir,
        historyPath: options.config.historyFile,
        config: options.config,
        prompts: options.prompts,
        forceExtensionId: extensionId,
        precomputedResult: persisted ?? undefined,
        staticVerbose: options.verbose,
        onProgress: (p, m) => task.emitProgress(i / total + p / total, `[${i + 1}/${total}] ${m}`),
        isCancelled: () => task.cancelled,
        tempDirs,
      });

      if (!outcome) {
        task.status = 'cancelled';
        return;
      }

      scannedCount++;
      task.emitProgress(i / total, `[${i + 1}/${total}] ${extensionId}: score ${outcome.score} (${getRiskLabel(outcome.score)})`);
    } catch (error) {
      task.emitProgress(i / total, `[${i + 1}/${total}] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      cleanupTempDirs(tempDirs);
    }
  }

  task.emitProgress(1, `Batch LLM analysis complete: ${scannedCount}/${total} extensions analyzed`);
  task.complete({
    extensionId: "batch",
    extensionName: "Batch Analysis",
    version: "",
    analysisDate: new Date().toISOString(),
    publisher: "",
    description: "",
    repository: "",
    homepage: "",
    installCount: "0",
    categories: [],
    activationEvents: [],
    jsFiles: [],
    binaryFiles: [],
    configFiles: [],
    assetFiles: [],
    agentConfigFiles: [],
    fileStats: {},
    fileTypes: [],
    totalSize: 0,
    permissions: {},
    dependencies: {},
    notableDependencies: {},
    telemetryConfig: {},
    vsixManifest: {},
    endpoints: [],
    bundledDependencies: [],
    findings: [],
    patternsSearched: {},
    binaryHashes: [],
    executiveSummary: "",
    verdict: null,
    totalScanned: scannedCount
  });
}

/**
 * Run batch static scan in background.
 */
async function runBatchScan(
  task: ScanTaskEmitter,
  extensions: Array<{
    extensionId?: string;
    publisher?: { publisherName: string };
    extensionName?: string;
  }>,
  options: {
    reportsDir: string;
    config: Awaited<ReturnType<typeof getConfig>>;
    prompts?: PromptConfig;
  }
): Promise<void> {
  task.status = 'running';
  const total = extensions.length;
  let scannedCount = 0;
  task.emitProgress(0, `Batch static scan: ${total} extensions`);

  for (let i = 0; i < total; i++) {
    if (task.cancelled) {
      task.status = 'cancelled';
      return;
    }

    const ext = extensions[i];
    const extensionId = ext.extensionId || `${ext.publisher?.publisherName}.${ext.extensionName}`;

    if (!extensionId) {
      task.emitProgress(i / total, `[${i + 1}/${total}] Skipped - no extension ID`);
      continue;
    }

    task.emitProgress(i / total, `[${i + 1}/${total}] Analyzing ${extensionId}...`);

    const tempDirs: string[] = [];
    try {
      const downloadUrl = `https://marketplace.visualstudio.com/items?itemName=${extensionId}`;
      const outcome = await runExtensionScan(downloadUrl, {
        noLlm: true,
        reportsDir: options.reportsDir,
        historyPath: options.config.historyFile,
        config: options.config,
        prompts: options.prompts,
        forceExtensionId: extensionId,
        staticVerbose: true,
        onProgress: (p, m) => task.emitProgress(i / total + p / total, `[${i + 1}/${total}] ${m}`),
        isCancelled: () => task.cancelled,
        tempDirs,
      });

      if (!outcome) {
        task.status = 'cancelled';
        return;
      }


      scannedCount++;
      task.emitProgress(i / total, `[${i + 1}/${total}] ${extensionId}: score ${outcome.score} (${getRiskLabel(outcome.score)})`);
    } catch (error) {
      task.emitProgress(i / total, `[${i + 1}/${total}] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      cleanupTempDirs(tempDirs);
    }
  }

  task.emitProgress(1, `Batch static scan complete: ${scannedCount}/${total} extensions scanned`);
  task.complete({
    extensionId: "batch",
    extensionName: "Batch Analysis",
    version: "",
    analysisDate: new Date().toISOString(),
    publisher: "",
    description: "",
    repository: "",
    homepage: "",
    installCount: "0",
    categories: [],
    activationEvents: [],
    jsFiles: [],
    binaryFiles: [],
    configFiles: [],
    assetFiles: [],
    agentConfigFiles: [],
    fileStats: {},
    fileTypes: [],
    totalSize: 0,
    permissions: {},
    dependencies: {},
    notableDependencies: {},
    telemetryConfig: {},
    vsixManifest: {},
    endpoints: [],
    bundledDependencies: [],
    findings: [],
    patternsSearched: {},
    binaryHashes: [],
    executiveSummary: "",
    verdict: null,
    totalScanned: scannedCount
  });
}

/**
 * Start server
 */
export async function main() {
  const { fastify, config } = await createServer();
  
  await fastify.listen({ port: config.port, host: config.host });
  
  logger.info(`
  Extension Security Analyzer (TypeScript)

  Server running at: http://${config.host}:${config.port}

  Press Ctrl+C to stop
  `);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  });
}
