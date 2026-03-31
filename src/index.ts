/**
 * Fastify server with SSE endpoints
 */

import Fastify from 'fastify';
import staticPlugin from '@fastify/static';
import viewPlugin from '@fastify/view';
import multipartPlugin from '@fastify/multipart';
import corsPlugin from '@fastify/cors';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, readFileSync, rmSync } from 'fs';
import nunjucks from 'nunjucks';

import { getConfig, getPrompts, getAppConfig, saveAppConfig, slotToLlmConfig, getPromptsForProfile } from './config.js';
import type { AppConfig } from './types/index.js';
import { StaticAnalyzer, extractVsix } from './analyzer/static.js';
import { LlmClient, ConsensusOrchestrator, parseVerdictFromSummary } from './analyzer/llm.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { ReportGenerator } from './analyzer/report.js';
import { calculateSuspicionScore, getRiskLabel, getRiskColor } from './analyzer/scoring.js';
import { downloadExtension, parseMarketplaceUrl, isMarketplaceUrl } from './services/download.js';
import { searchExtensions } from './services/marketplace.js';
import type { AnalysisResult, ScanTask } from './types/index.js';
import type { PromptConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '..', 'assets', 'templates');

// Configure Nunjucks (Jinja2-compatible)
nunjucks.configure(TEMPLATES_DIR, {
  autoescape: true,
  watch: false,  // Disabled - tsx watch handles hot reload
  noCache: true,
});

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
  
  complete(result: AnalysisResult) {
    this.status = 'complete';
    this.result = result;
    this.progress = 1;
    this.emit('done', { status: 'complete', result });
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
    .filter(([, task]) => task.status === 'complete' || task.status === 'failed')
    .sort((a, b) => (a[1].result?.analysisDate || '').localeCompare(b[1].result?.analysisDate || ''));
  
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

export async function createServer(configOverride?: Partial<Awaited<ReturnType<typeof getConfig>>>) {
  const defaultConfig = await getConfig();
  const config = { ...defaultConfig, ...configOverride };
  let prompts = getPrompts();
  
  const fastify = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: { colorize: true },
      },
    },
  });
  
  // Register plugins
  await fastify.register(staticPlugin, {
    root: join(__dirname, '..', 'assets', 'static'),
    prefix: '/static/',
  });
  
  // Register view plugin with Nunjucks (Jinja2-compatible)
  await fastify.register(viewPlugin, {
    engine: {
      nunjucks: nunjucks,
    },
    root: TEMPLATES_DIR,
    viewExt: 'html',
    options: {
      useHtmlMinifier: false,
    },
  });
  
  await fastify.register(multipartPlugin);
  await fastify.register(corsPlugin);
  
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
    // Handle both JSON and form data
    let params: Record<string, string> = {};
    
    if (request.isMultipart()) {
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'field') {
          params[part.fieldname] = part.value as string;
        }
      }
    } else {
      params = request.body as Record<string, string>;
    }
    
    const inputSource = params.input_source || params.url || '';
    const noLlm = params.no_llm !== undefined
      ? String(params.no_llm).toLowerCase() === 'true'
      : config.defaultNoLlm;

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
      return reply.status(400).send({ error: 'input_source or url required' });
    }

    const task = new ScanTaskEmitter();
    scans.set(task.id, task);

    // Run scan in background
    runScan(task, inputSource, {
      noLlm,
      modelName,
      ollamaUrl,
      reportsDir,
      config,
      prompts,
      extensionInfo,
    }).catch(err => task.fail(err.message));
    
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
  
  // ---------------------------------------------------------------
  // API: List reports
  // ---------------------------------------------------------------
  fastify.get('/api/reports', async () => {
    const reports: Array<{ name: string; mtime: string; size: number }> = [];
    
    if (existsSync(reportsDir)) {
      const files = readdirSync(reportsDir).filter(f => f.endsWith('.md'));
      
      for (const file of files) {
        const stats = statSync(join(reportsDir, file));
        reports.push({
          name: file,
          mtime: stats.mtime.toISOString(),
          size: stats.size,
        });
      }
    }
    
    reports.sort((a, b) => b.mtime.localeCompare(a.mtime));
    return { reports };
  });
  
  // ---------------------------------------------------------------
  // API: Get report content
  // ---------------------------------------------------------------
  fastify.get('/api/reports/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    
    // Security: prevent path traversal
    if (name.includes('..') || name.includes('/') || !name.endsWith('.md')) {
      return reply.status(400).send({ error: 'Invalid report name' });
    }
    
    const reportPath = join(reportsDir, name);
    
    if (!existsSync(reportPath)) {
      return reply.status(404).send({ error: 'Report not found' });
    }
    
    const content = readFileSync(reportPath, 'utf-8');
    return { name, content };
  });
  
  // ---------------------------------------------------------------
  // API: Delete report
  // ---------------------------------------------------------------
  fastify.delete('/api/reports/:name', async (request, reply) => {
    const { name } = request.params as { name: string };
    
    if (name.includes('..') || name.includes('/') || !name.endsWith('.md')) {
      return reply.status(400).send({ error: 'Invalid report name' });
    }
    
    const reportPath = join(reportsDir, name);
    
    if (!existsSync(reportPath)) {
      return reply.status(404).send({ error: 'Report not found' });
    }
    
    unlinkSync(reportPath);
    return { deleted: true };
  });
  
  // ---------------------------------------------------------------
  // API: Scan History
  // ---------------------------------------------------------------
  const historyPath = config.historyFile;
  
  function loadHistory(): Record<string, unknown> {
    if (existsSync(historyPath)) {
      try {
        const content = readFileSync(historyPath, 'utf-8');
        const data = JSON.parse(content);
        return data.scans || {};
      } catch {
        return {};
      }
    }
    return {};
  }
  
  function saveHistory(scans: Record<string, unknown>): void {
    const dir = dirname(historyPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(historyPath, JSON.stringify({ scans, last_updated: new Date().toISOString() }, null, 2));
  }

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
    
    let scans = loadHistory();
    const entries = Object.entries(scans);
    
    // Filter by search term
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      const filtered = entries.filter(([eid]) => eid.toLowerCase().includes(searchLower));
      scans = Object.fromEntries(filtered);
    }
    
    // Filter by risk level
    if (query.risk) {
      const filtered = entries.filter(([, info]) => {
        const scanInfo = info as Record<string, unknown>;
        const score = (scanInfo.llm_adjusted_score as number) ?? (scanInfo.suspicion_score as number) ?? 0;
        const label = getRiskLabel(score);
        return label === query.risk;
      });
      scans = Object.fromEntries(filtered);
    }
    
    // Filter by LLM status
    if (query.llm === 'llm') {
      const filtered = entries.filter(([, info]) => {
        const scanInfo = info as Record<string, unknown>;
        return scanInfo.llm_analyzed === true;
      });
      scans = Object.fromEntries(filtered);
    } else if (query.llm === 'no-llm') {
      const filtered = entries.filter(([, info]) => {
        const scanInfo = info as Record<string, unknown>;
        return scanInfo.llm_analyzed !== true;
      });
      scans = Object.fromEntries(filtered);
    }
    
    // Calculate display values
    const displayScans: Record<string, Record<string, unknown>> = {};
    for (const [eid, info] of Object.entries(scans)) {
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
    saveHistory({});
    return { cleared: true };
  });
  
  fastify.delete('/api/history/:extension_id', async (request, reply) => {
    const { extension_id } = request.params as { extension_id: string };
    const scans = loadHistory();

    // Case-insensitive lookup
    const found = findScanByExtensionId(scans, extension_id);
    if (!found) {
      return reply.status(404).send({ error: 'Scan not found' });
    }

    delete scans[found.key];
    saveHistory(scans);
    return { deleted: extension_id };
  });
  
  // ---------------------------------------------------------------
  // API: List models
  // ---------------------------------------------------------------
  fastify.get('/api/models', async (request, _reply) => {
    const query = request.query as { ollama_url?: string };
    const baseUrl = query.ollama_url || config.llm.baseUrl;
    
    try {
      const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json() as { models?: Array<{ name: string }> };
        return { models: data.models?.map(m => m.name) || [] };
      }
    } catch {}
    
    // Try OpenAI-compatible endpoint
    try {
      const response = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json() as { data?: Array<{ id: string }> };
        return { models: data.data?.map(m => m.id) || [] };
      }
    } catch {}
    
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
      
      // Augment with scan history (case-insensitive lookup)
      const scans = loadHistory();
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
            ...(info.true_positives !== undefined && { true_positives: info.true_positives as number }),
            verdict: (info.verdict as string) || null,
          };
        }
      }
      
      return { results, total: results.length };
    } catch (error) {
      return reply.status(500).send({ error: 'Marketplace search failed' });
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
  
  // ---------------------------------------------------------------
  // API: Save settings
  // ---------------------------------------------------------------
  fastify.post('/api/models', async (request) => {
    const body = request.body as {
      ollamaUrl?: string;
      model?: string;
      apiStyle?: string;
      defaultNoLlm?: boolean;
      defaultFull?: boolean;
      assessmentMode?: 'strategic' | 'bulk';
    };

    console.log('[Settings] Received settings:', body);
    console.log('[Settings] Current assessmentMode:', config.llm.assessmentMode);

    // Save settings to app state for use by LLM clients
    if (body.apiStyle) {
      config.llm.apiStyle = body.apiStyle as 'openai' | 'chat' | 'generate' | 'auto';
    }
    if (body.assessmentMode) {
      config.llm.assessmentMode = body.assessmentMode;
      console.log('[Settings] Updated assessmentMode to:', body.assessmentMode);
    }
    config.defaultNoLlm = body.defaultNoLlm;
    config.defaultFull = body.defaultFull;

    return { saved: true, assessmentMode: config.llm.assessmentMode };
  });

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

    const current = getAppConfig();
    const updated: AppConfig = {
      version: body.version || current.version,
      main: { ...current.main, ...body.main },
      judges: Array.isArray(body.judges) ? body.judges : current.judges,
      consensus: { ...current.consensus, ...body.consensus },
      assessmentMode: body.assessmentMode || current.assessmentMode,
      promptProfile: body.promptProfile || current.promptProfile,
      concurrency: body.concurrency ?? current.concurrency,
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
    const { baseUrl, model, apiStyle } = request.body as { baseUrl?: string; model?: string; apiStyle?: string };
    if (!baseUrl) return { ok: false, error: 'baseUrl required' };

    try {
      const res = await fetch(baseUrl.replace(/\/$/, ''), { method: 'GET', signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return { ok: true, model: model || 'unknown', apiStyle: apiStyle || 'auto' };
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
      console.error('Failed to save prompts:', e);
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
      api_style?: string;
      assessment_mode?: 'strategic' | 'bulk';
    };

    let publisher = body.publisher;
    let extensionName = body.extension_name;

    // Model config comes from server-side AppConfig (config.json), not client
    const appCfg = getAppConfig();
    const modelName = appCfg.main.model;
    const assessmentMode = appCfg.assessmentMode;
    const apiStyle = appCfg.main.apiStyle;

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
        apiStyle: apiStyle as 'openai' | 'chat' | 'generate' | 'auto',
        assessmentMode,
      },
    };

    console.log(`[LLM Analyze] Using model: ${modelName}, api style: ${apiStyle}, assessment mode: ${assessmentMode}`);

    // Run LLM analysis in background
    runScan(task, downloadUrl, {
      noLlm: false,
      modelName,
      ollamaUrl: appCfg.main.baseUrl,
      reportsDir: config.reportsDir,
      config: configWithMode,
      prompts,
      extensionInfo: { publisher, extension: extensionName },
    }).catch(err => task.fail(err.message));

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
    });

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
      api_style?: string;
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

    console.log(`[Batch LLM] Using model: ${modelName}, assessment mode: ${assessmentMode}`);

    // Run batch LLM analysis in background
    runBatchLlmAnalysis(task, extensions, {
      modelName,
      ollamaUrl,
      apiStyle: appCfg.main.apiStyle,
      verbose: body.verbose || false,
      reportsDir: config.reportsDir,
      config: configWithMode,
      prompts,
    }).catch(err => task.fail(err.message));

    return { scan_id: task.id };
  });

  // ---------------------------------------------------------------
  // Health check
  // ---------------------------------------------------------------
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
  
  return { fastify, config };
}

/**
 * Run scan in background
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
  }
): Promise<void> {
  task.status = 'running';
  task.emitProgress(0, 'Starting analysis...');
  
  const tempDirs: string[] = [];
  
  try {
    let extensionPath = inputSource;
    
    // Handle URL downloads
    if (inputSource.startsWith('http://') || inputSource.startsWith('https://')) {
      task.emitProgress(0.02, 'Downloading extension...');
      
      const tempDir = `/tmp/vsix_download_${Date.now()}`;
      mkdirSync(tempDir, { recursive: true });
      tempDirs.push(tempDir);
      
      try {
        const result = await downloadExtension(inputSource, tempDir);
        task.emitProgress(0.08, `Downloaded: ${result.filename}`);
        
        // Extract VSIX
        task.emitProgress(0.1, 'Extracting VSIX...');
        extensionPath = extractVsix(result.path);
        tempDirs.push(extensionPath);
      } catch (error) {
        throw new Error(`Failed to download extension: ${error instanceof Error ? error.message : error}`);
      }
    } else if (inputSource.endsWith('.vsix')) {
      // Local VSIX file
      task.emitProgress(0.05, 'Extracting VSIX...');
      extensionPath = extractVsix(inputSource);
      tempDirs.push(extensionPath);
    }
    
    if (task.cancelled) {
      task.status = 'cancelled';
      return;
    }
    
    // Static analysis
    task.emitProgress(0.15, 'Running static analysis...');
    const analyzer = new StaticAnalyzer(extensionPath, { verbose: true, patternsFile: options.config.patternsFile });
    const result = await analyzer.analyze();
    task.emitProgress(0.4, `Static analysis complete: ${result.findings.length} findings`);
    
    if (task.cancelled) {
      task.status = 'cancelled';
      return;
    }
    
    // LLM enhancement
    let orchestrator: ConsensusOrchestrator | null = null;
    const basePrompts = options.prompts || getPrompts();

    if (!options.noLlm && options.modelName) {
      task.emitProgress(0.42, `Connecting to LLM (${options.modelName})...`);

      // Global prompt profile applies to ALL models uniformly
      const appConfig = getAppConfig();
      const profiledPrompts = getPromptsForProfile(appConfig.promptProfile, basePrompts);

      const mainClient = new LlmClient({
        ...options.config.llm,
        model: options.modelName,
        baseUrl: options.ollamaUrl,
      }, profiledPrompts);

      // Build judge clients — same prompts as main (blind assessment)
      const judgeClients = appConfig.judges
        .filter(j => j.enabled)
        .map(j => {
          const provider = new OllamaProvider(
            { id: j.id, model: j.model },
            { baseUrl: j.baseUrl.replace(/\/$/, ''), apiStyle: j.apiStyle, timeout: j.timeout },
            { maxTokens: j.maxTokens, temperature: j.temperature },
          );
          return new LlmClient(slotToLlmConfig(j, appConfig), profiledPrompts, provider);
        });

      orchestrator = new ConsensusOrchestrator(mainClient, judgeClients, appConfig.consensus);

      const available = await orchestrator.isAvailable();

      if (available) {
        // Verify judges are reachable if any are configured
        if (judgeClients.length > 0) {
          try {
            await orchestrator.verifyJudges();
            task.emitProgress(0.43, `${judgeClients.length} judge(s) verified`);
          } catch (err) {
            task.emitProgress(0.43, `Judge verification failed: ${err instanceof Error ? err.message : err}`);
            throw err;
          }
        }

        if (result.findings.length > 0) {
          task.emitProgress(0.45, `LLM analyzing ${result.findings.length} findings...`);

          const assessments = await orchestrator.batchAssessFindings(result.findings, {
            onProgress: (p, m) => task.emitProgress(0.45 + p * 0.4, m),
            extensionName: result.extensionName,
          });

          // Apply assessments to findings (assessments may be truncated)
          for (let i = 0; i < assessments.length; i++) {
            const assessment = assessments[i];
            if (assessment) {
              result.findings[i].riskLevel = assessment.riskLevel;
              result.findings[i].isFalsePositive = assessment.isFalsePositive;
              result.findings[i].falsePositiveReason = assessment.falsePositiveReason;
              if (assessment.recommendation) result.findings[i].recommendation = assessment.recommendation;
              if (assessment.injectionDetected) result.findings[i].injectionDetected = assessment.injectionDetected;
              if (assessment.consensus) result.findings[i].consensus = assessment.consensus;
            }
          }
        }

        task.emitProgress(0.88, 'Generating executive summary...');
        const summary = await orchestrator.generateExecutiveSummary(result, extensionPath);
        if (summary) {
          const { verdict, prose } = parseVerdictFromSummary(summary);
          result.verdict = verdict;
          result.executiveSummary = prose;
        } else {
          result.executiveSummary = null;
        }
      } else {
        task.emitProgress(0.45, 'LLM not available');
        orchestrator = null;
      }
    }
    
    // Calculate score
    const [score, breakdown] = calculateSuspicionScore(result, { adjustForLlm: !!orchestrator });

    // Always override extensionId from URL - we know this is the correct ID from marketplace
    // The analyzer may detect wrong ID from package.json (especially for non-English extensions)
    if (options.extensionInfo) {
      result.extensionId = `${options.extensionInfo.publisher}.${options.extensionInfo.extension}`;
      if (!result.extensionName || result.extensionName === 'Unknown Extension') {
        result.extensionName = options.extensionInfo.extension;
      }
    }

    // Generate report
    task.emitProgress(0.9, 'Generating report...');
    const generator = new ReportGenerator(result, { fullOutput: true });
    const markdown = generator.generate();

    // Save report
    const safeName = result.extensionId.replace(/[<>:"/\\|?*]/g, '_');
    const reportPath = join(options.reportsDir, `${safeName}.md`);
    writeFileSync(reportPath, markdown);
    
    // Save to history
    const historyPath = options.config.historyFile;
    const historyDir = dirname(historyPath);
    if (!existsSync(historyDir)) {
      mkdirSync(historyDir, { recursive: true });
    }
    
    let historyData: Record<string, unknown> = {};
    if (existsSync(historyPath)) {
      try {
        const historyContent = readFileSync(historyPath, 'utf-8');
        const parsed = JSON.parse(historyContent);
        historyData = parsed.scans || {};
      } catch {
        historyData = {};
      }
    }
    
    historyData[result.extensionId.toLowerCase()] = {
      extension_name: result.extensionName,
      version: result.version,
      scan_date: new Date().toISOString(),
      suspicion_score: score,
      llm_adjusted_score: !!orchestrator ? score : null,
      llm_analyzed: !!orchestrator,
      findings_count: result.findings.length,
      true_positives: result.findings.filter(f => !f.isFalsePositive).length,
      report_path: reportPath,
      breakdown,
      verdict: result.verdict || null,
    };

    writeFileSync(historyPath, JSON.stringify({ scans: historyData, last_updated: new Date().toISOString() }, null, 2));

    task.emitProgress(1, `Complete - score ${score} (${getRiskLabel(score)})`);
    task.complete(result);
    cleanupOldScans();
    
  } catch (error) {
    task.fail(error instanceof Error ? error.message : 'Unknown error');
    cleanupOldScans();
  } finally {
    // Cleanup temp directories
    for (const dir of tempDirs) {
      try {
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Run batch LLM analysis in background
 */
async function runBatchLlmAnalysis(
  task: ScanTaskEmitter,
  extensions: Array<{ publisher: string; extensionName: string }>,
  options: {
    modelName: string;
    ollamaUrl: string;
    apiStyle?: string;
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
  
  const historyPath = options.config.historyFile;

  for (let i = 0; i < total; i++) {
    if (task.cancelled) {
      task.status = 'cancelled';
      return;
    }
    
    const ext = extensions[i];
    const extensionId = `${ext.publisher}.${ext.extensionName}`;
    task.emitProgress(i / total, `[${i + 1}/${total}] Analyzing ${extensionId} with LLM...`);
    
    let tempDir: string | undefined;
    let extPath: string | undefined;
    
    try {
      // Download extension
      tempDir = `/tmp/batch_llm_dl_${Date.now()}_${i}`;
      mkdirSync(tempDir, { recursive: true });

      const downloadUrl = `https://marketplace.visualstudio.com/items?itemName=${ext.publisher}.${ext.extensionName}`;
      const downloadResult = await downloadExtension(downloadUrl, tempDir);
      task.emitProgress(i / total, `[${i + 1}/${total}] Downloaded: ${downloadResult.filename}`);

      // Extract VSIX
      extPath = extractVsix(downloadResult.path);
      
      // Static analysis
      task.emitProgress(i / total, `[${i + 1}/${total}] Static analysis...`);
      const analyzer = new StaticAnalyzer(extPath, { verbose: options.verbose, patternsFile: options.config.patternsFile });
      const result = await analyzer.analyze();

      // Always override extensionId from search result - we know this is the correct ID
      result.extensionId = extensionId;

      task.emitProgress(i / total, `[${i + 1}/${total}] ${result.findings.length} findings`);
      
      if (task.cancelled) {
        task.status = 'cancelled';
        return;
      }
      
      // LLM enhancement
      let batchOrchestrator: ConsensusOrchestrator | null = null;
      const basePrompts = options.prompts || getPrompts();
      const batchAppConfig = getAppConfig();
      const profiledPrompts = getPromptsForProfile(batchAppConfig.promptProfile, basePrompts);

      task.emitProgress(i / total, `[${i + 1}/${total}] LLM analyzing...`);

      const batchMainClient = new LlmClient({
        ...options.config.llm,
        model: options.modelName,
        baseUrl: options.ollamaUrl,
      }, profiledPrompts);

      const batchJudgeClients = batchAppConfig.judges
        .filter(j => j.enabled)
        .map(j => {
          const provider = new OllamaProvider(
            { id: j.id, model: j.model },
            { baseUrl: j.baseUrl.replace(/\/$/, ''), apiStyle: j.apiStyle, timeout: j.timeout },
            { maxTokens: j.maxTokens, temperature: j.temperature },
          );
          return new LlmClient(slotToLlmConfig(j, batchAppConfig), profiledPrompts, provider);
        });

      batchOrchestrator = new ConsensusOrchestrator(batchMainClient, batchJudgeClients, batchAppConfig.consensus);

      const available = await batchOrchestrator.isAvailable();

      if (available) {
        if (batchJudgeClients.length > 0) {
          await batchOrchestrator.verifyJudges();
        }

        if (result.findings.length > 0) {
          const assessments = await batchOrchestrator.batchAssessFindings(result.findings, {
            onProgress: (p, m) => task.emitProgress(i / total + p * 0.2, `[${i + 1}/${total}] ${m}`),
            extensionName: result.extensionName,
          });

          // Apply assessments to findings (assessments may be truncated)
          for (let j = 0; j < assessments.length; j++) {
            const assessment = assessments[j];
            if (assessment) {
              result.findings[j].riskLevel = assessment.riskLevel;
              result.findings[j].isFalsePositive = assessment.isFalsePositive;
              result.findings[j].falsePositiveReason = assessment.falsePositiveReason;
              if (assessment.recommendation) result.findings[j].recommendation = assessment.recommendation;
              if (assessment.injectionDetected) result.findings[j].injectionDetected = assessment.injectionDetected;
              if (assessment.consensus) result.findings[j].consensus = assessment.consensus;
            }
          }
        }

        task.emitProgress(i / total, `[${i + 1}/${total}] Generating executive summary...`);
        const summary = await batchOrchestrator.generateExecutiveSummary(result, extPath!);
        if (summary) {
          const { verdict, prose } = parseVerdictFromSummary(summary);
          result.verdict = verdict;
          result.executiveSummary = prose;
        } else {
          result.executiveSummary = null;
        }
      } else {
        task.emitProgress(i / total, `[${i + 1}/${total}] LLM not available`);
        batchOrchestrator = null;
      }

      // Calculate score
      const [score, breakdown] = calculateSuspicionScore(result, { adjustForLlm: !!batchOrchestrator });
      
      // Generate report
      task.emitProgress(i / total, `[${i + 1}/${total}] Generating report...`);
      const generator = new ReportGenerator(result, { fullOutput: true });
      const markdown = generator.generate();
      
      // Save report
      const safeName = result.extensionId.replace(/[<>:"/\\|?*]/g, '_');
      const reportPath = join(options.reportsDir, `${safeName}.md`);
      writeFileSync(reportPath, markdown);
      
      // Save to history
      const historyDir = dirname(historyPath);
      if (!existsSync(historyDir)) {
        mkdirSync(historyDir, { recursive: true });
      }
      
      let historyData: Record<string, unknown> = {};
      if (existsSync(historyPath)) {
        try {
          const historyContent = readFileSync(historyPath, 'utf-8');
          const parsed = JSON.parse(historyContent);
          historyData = parsed.scans || {};
        } catch {
          historyData = {};
        }
      }
      
      historyData[result.extensionId.toLowerCase()] = {
        extension_name: result.extensionName,
        version: result.version,
        scan_date: new Date().toISOString(),
        suspicion_score: score,
        llm_adjusted_score: !!batchOrchestrator ? score : null,
        llm_analyzed: !!batchOrchestrator,
        findings_count: result.findings.length,
        true_positives: result.findings.filter(f => !f.isFalsePositive).length,
        report_path: reportPath,
        breakdown,
        verdict: result.verdict || null,
      };
      
      writeFileSync(historyPath, JSON.stringify({ scans: historyData, last_updated: new Date().toISOString() }, null, 2));
      
      scannedCount++;
      task.emitProgress(i / total, `[${i + 1}/${total}] ${extensionId}: score ${score} (${getRiskLabel(score)})`);
      
    } catch (error) {
      task.emitProgress(i / total, `[${i + 1}/${total}] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (tempDir && existsSync(tempDir)) {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
      if (extPath && existsSync(extPath)) {
        try {
          rmSync(extPath, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }
  
  task.emitProgress(1, `Batch LLM analysis complete: ${scannedCount}/${total} extensions analyzed`);
  task.complete({ extensionId: 'batch', extensionName: 'Batch Analysis', version: '', findings: [], endpoints: [], scanDate: new Date().toISOString(), totalScanned: scannedCount } as any);
}

/**
 * Run batch static scan in background
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

  const historyPath = options.config.historyFile;

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
    
    let tempDir: string | undefined;
    let extPath: string | undefined;

    try {
      // Download extension
      tempDir = `/tmp/batch_static_dl_${Date.now()}_${i}`;
      mkdirSync(tempDir, { recursive: true });

      const downloadUrl = `https://marketplace.visualstudio.com/items?itemName=${extensionId}`;
      const downloadResult = await downloadExtension(downloadUrl, tempDir);
      task.emitProgress(i / total, `[${i + 1}/${total}] Downloaded: ${downloadResult.filename}`);

      // Extract VSIX
      extPath = extractVsix(downloadResult.path);
      
      // Static analysis
      task.emitProgress(i / total, `[${i + 1}/${total}] Static analysis...`);
      const analyzer = new StaticAnalyzer(extPath, { verbose: true, patternsFile: options.config.patternsFile });
      const result = await analyzer.analyze();

      // Always override extensionId from search result - we know this is the correct ID from marketplace
      // The analyzer may detect wrong ID from package.json (especially for non-English extensions)
      result.extensionId = extensionId;

      task.emitProgress(i / total, `[${i + 1}/${total}] ${result.findings.length} findings`);
      
      if (task.cancelled) {
        task.status = 'cancelled';
        return;
      }
      
      // Calculate score
      const [score, breakdown] = calculateSuspicionScore(result, { adjustForLlm: false });
      
      // Generate report
      task.emitProgress(i / total, `[${i + 1}/${total}] Generating report...`);
      const generator = new ReportGenerator(result, { fullOutput: true });
      const markdown = generator.generate();
      
      // Save report
      const safeName = result.extensionId.replace(/[<>:"/\\|?*]/g, '_');
      const reportPath = join(options.reportsDir, `${safeName}.md`);
      writeFileSync(reportPath, markdown);
      
      // Save to history
      const historyDir = dirname(historyPath);
      if (!existsSync(historyDir)) {
        mkdirSync(historyDir, { recursive: true });
      }
      
      let historyData: Record<string, unknown> = {};
      if (existsSync(historyPath)) {
        try {
          const historyContent = readFileSync(historyPath, 'utf-8');
          const parsed = JSON.parse(historyContent);
          historyData = parsed.scans || {};
        } catch {
          historyData = {};
        }
      }
      
      historyData[result.extensionId.toLowerCase()] = {
        extension_name: result.extensionName,
        version: result.version,
        scan_date: new Date().toISOString(),
        suspicion_score: score,
        llm_adjusted_score: null,
        llm_analyzed: false,
        findings_count: result.findings.length,
        true_positives: result.findings.filter(f => !f.isFalsePositive).length,
        report_path: reportPath,
        breakdown,
      };
      
      writeFileSync(historyPath, JSON.stringify({ scans: historyData, last_updated: new Date().toISOString() }, null, 2));
      
      scannedCount++;
      task.emitProgress(i / total, `[${i + 1}/${total}] ${extensionId}: score ${score} (${getRiskLabel(score)})`);
      
    } catch (error) {
      task.emitProgress(i / total, `[${i + 1}/${total}] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      // Clean up temp directories immediately after each extension
      if (extPath && existsSync(extPath)) {
        try {
          rmSync(extPath, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
      if (tempDir && existsSync(tempDir)) {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  task.emitProgress(1, `Batch static scan complete: ${scannedCount}/${total} extensions scanned`);
  task.complete({ extensionId: 'batch', extensionName: 'Batch Analysis', version: '', findings: [], endpoints: [], scanDate: new Date().toISOString(), totalScanned: scannedCount } as any);
}

/**
 * Start server
 */
export async function main() {
  const { fastify, config } = await createServer();
  
  await fastify.listen({ port: config.port, host: config.host });
  
  console.log(`
  Extension Security Analyzer (TypeScript)

  Server running at: http://${config.host}:${config.port}

  Press Ctrl+C to stop
  `);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
