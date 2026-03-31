/**
 * Configuration management
 */


import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { load } from 'js-yaml';
import type { ServerConfig, LlmConfig, AppConfig, ModelSlotConfig } from './types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface PromptConfig {
  version: string;
  finding_assessment: {
    system: string;
    user: string;
    common_false_positives: string;
    genuine_concerns: string;
  };
  executive_summary: {
    system: string;
    user: string;
  };
  finding_prose: {
    system: string;
    user: string;
  };
  triage_batch?: {
    system: string;
    user: string;
  };
  profiles?: Record<string, PromptProfileOverride>;
}

/** Per-model prompt overrides — only specified keys replace defaults */
export interface PromptProfileOverride {
  finding_assessment?: Partial<PromptConfig['finding_assessment']>;
  executive_summary?: Partial<PromptConfig['executive_summary']>;
  finding_prose?: Partial<PromptConfig['finding_prose']>;
  triage_batch?: Partial<NonNullable<PromptConfig['triage_batch']>>;
}

/**
 * Load prompts from YAML file - throws if not found
 */
export function loadPrompts(promptsFile: string): PromptConfig {
  if (!promptsFile) {
    throw new Error('Prompts file path is required');
  }

  if (!existsSync(promptsFile)) {
    throw new Error(`Prompts file not found: ${promptsFile}`);
  }

  try {
    const content = readFileSync(promptsFile, 'utf-8');
    const config = load(content) as PromptConfig;
    console.log(`[Prompts] Loaded ${promptsFile} (version: ${config.version || 'unknown'})`);
    return config;
  } catch (error) {
    throw new Error(`Failed to load prompts file ${promptsFile}: ${error}`);
  }
}

/**
 * Load configuration from environment and defaults
 */
export async function loadConfig(): Promise<ServerConfig> {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8001;
  
  const llmConfig: LlmConfig = {
    model: process.env.LLM_MODEL || 'llama3.2',
    baseUrl: process.env.LLM_URL || 'http://localhost:11434',
    apiStyle: (process.env.LLM_API_STYLE as LlmConfig['apiStyle']) || 'auto',
    timeout: parseInt(process.env.LLM_TIMEOUT || '180000', 10),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '32000', 10),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
    concurrency: parseInt(process.env.LLM_CONCURRENCY || '10', 10),
    assessmentMode: (process.env.LLM_ASSESSMENT_MODE as LlmConfig['assessmentMode']) || 'strategic',
    stream: process.env.LLM_STREAM === 'true' || process.env.LLM_STREAM === '1',
  };
  
  return {
    port,
    host: process.env.HOST || '127.0.0.1',
    reportsDir: process.env.REPORTS_DIR || join(__dirname, '..', 'assets', 'reports'),
    patternsFile: process.env.PATTERNS_FILE || join(__dirname, '..', 'docs', 'patterns.yaml'),
    historyFile: process.env.HISTORY_FILE || join(__dirname, '..', 'assets', 'reports', 'scan_history.json'),
    llm: llmConfig,
  };
}

// Singleton config instance
let _config: ServerConfig | null = null;
let _prompts: PromptConfig | null = null;

export async function getConfig(): Promise<ServerConfig> {
  if (!_config) {
    _config = await loadConfig();
  }
  return _config;
}

export function getPrompts(promptsFile?: string): PromptConfig {
  if (!_prompts) {
    const file = promptsFile || join(__dirname, '..', 'prompts.yaml');
    _prompts = loadPrompts(file);
  }
  return _prompts;
}

/**
 * Get prompts for a specific profile, deep-merging overrides on top of defaults.
 * Returns a full PromptConfig with the profile's overrides applied.
 */
export function getPromptsForProfile(profile: string, basePrompts?: PromptConfig): PromptConfig {
  const prompts = basePrompts || getPrompts();
  if (!profile || profile === 'default' || !prompts.profiles?.[profile]) {
    return prompts;
  }

  const overrides = prompts.profiles[profile];
  return {
    ...prompts,
    finding_assessment: { ...prompts.finding_assessment, ...overrides.finding_assessment },
    executive_summary: { ...prompts.executive_summary, ...overrides.executive_summary },
    finding_prose: { ...prompts.finding_prose, ...overrides.finding_prose },
    triage_batch: overrides.triage_batch
      ? { ...prompts.triage_batch, ...overrides.triage_batch } as NonNullable<PromptConfig['triage_batch']>
      : prompts.triage_batch,
  };
}

// ---------------------------------------------------------------
// AppConfig: Multi-model configuration with JSON persistence
// ---------------------------------------------------------------

const CONFIG_FILE = join(__dirname, '..', 'config.json');

function defaultModelSlot(id: string, label: string): ModelSlotConfig {
  return {
    id, label, enabled: id === 'main',
    provider: 'ollama',
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434',
    apiStyle: 'auto',
    timeout: 180000,
    maxTokens: 32000,
    temperature: 0.3,
  };
}

function defaultAppConfig(): AppConfig {
  return {
    version: '1',
    main: defaultModelSlot('main', 'Main Model'),
    judges: [],
    consensus: { judgesValidateAllFindings: false },
    assessmentMode: 'strategic',
    promptProfile: 'default',
    concurrency: 10,
    defaultNoLlm: false,
    defaultFull: false,
  };
}

/**
 * Convert a ModelSlotConfig to an LlmConfig for use by LlmClient
 */
export function slotToLlmConfig(slot: ModelSlotConfig, appConfig: AppConfig): LlmConfig {
  return {
    model: slot.model,
    baseUrl: slot.baseUrl,
    apiStyle: slot.apiStyle,
    timeout: slot.timeout,
    maxTokens: slot.maxTokens,
    temperature: slot.temperature,
    concurrency: appConfig.concurrency,
    assessmentMode: appConfig.assessmentMode,
  };
}

let _appConfig: AppConfig | null = null;

/**
 * Load AppConfig from config.json, with env var overrides for main model.
 * If config.json doesn't exist, builds from env vars (zero judges = single-model).
 */
export function loadAppConfig(): AppConfig {
  if (_appConfig) return _appConfig;

  let appConfig = defaultAppConfig();

  // Load from config.json if it exists
  if (existsSync(CONFIG_FILE)) {
    try {
      const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) as Partial<AppConfig>;
      appConfig = { ...appConfig, ...raw, main: { ...appConfig.main, ...raw.main }, consensus: { ...appConfig.consensus, ...raw.consensus } };
      if (Array.isArray(raw.judges)) {
        appConfig.judges = raw.judges;
      }
      console.log(`[Config] Loaded config.json (version: ${appConfig.version}, judges: ${appConfig.judges.length})`);
    } catch (err) {
      console.warn(`[Config] Failed to parse config.json, using defaults:`, err);
    }
  }

  // Env vars override main model fields (backward compat)
  if (process.env.LLM_MODEL) appConfig.main.model = process.env.LLM_MODEL;
  if (process.env.LLM_URL) appConfig.main.baseUrl = process.env.LLM_URL;
  if (process.env.LLM_API_STYLE) appConfig.main.apiStyle = process.env.LLM_API_STYLE as ModelSlotConfig['apiStyle'];
  if (process.env.LLM_TIMEOUT) appConfig.main.timeout = parseInt(process.env.LLM_TIMEOUT, 10);
  if (process.env.LLM_MAX_TOKENS) appConfig.main.maxTokens = parseInt(process.env.LLM_MAX_TOKENS, 10);
  if (process.env.LLM_TEMPERATURE) appConfig.main.temperature = parseFloat(process.env.LLM_TEMPERATURE);
  if (process.env.LLM_CONCURRENCY) appConfig.concurrency = parseInt(process.env.LLM_CONCURRENCY, 10);
  if (process.env.LLM_ASSESSMENT_MODE) appConfig.assessmentMode = process.env.LLM_ASSESSMENT_MODE as AppConfig['assessmentMode'];

  _appConfig = appConfig;
  return appConfig;
}

/**
 * Save AppConfig to config.json and update in-memory cache.
 */
export function saveAppConfig(appConfig: AppConfig): void {
  _appConfig = appConfig;
  writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2), 'utf-8');
  console.log(`[Config] Saved config.json (judges: ${appConfig.judges.length})`);
}

/**
 * Get the cached AppConfig (loads if needed).
 */
export function getAppConfig(): AppConfig {
  return _appConfig || loadAppConfig();
}
