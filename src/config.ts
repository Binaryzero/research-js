/**
 * Configuration management
 */


import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { load } from 'js-yaml';
import type { ServerConfig, LlmConfig, AppConfig, ModelSlotConfig } from './types/index.js';
import { AppConfigSchema } from './schemas/config.js';
import { DEFAULT_SCORING, setScoringConfig } from './analyzer/scoring.js';
import { DEFAULT_ANALYSIS_LIMITS, setAnalysisLimits } from './analyzer/analysis-limits.js';
import { getComponentLogger } from "./services/logger.js";


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
    getComponentLogger('Prompts').info(`Loaded ${promptsFile} (version: ${config.version || 'unknown'})`);
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
    provider: (process.env.LLM_PROVIDER as LlmConfig['provider']) || 'ollama',
    timeout: parseInt(process.env.LLM_TIMEOUT || '180000', 10),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '32000', 10),
    temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.3'),
    concurrency: parseInt(process.env.LLM_CONCURRENCY || '20', 10),
    assessmentMode: (process.env.LLM_ASSESSMENT_MODE as LlmConfig['assessmentMode']) || 'strategic',
    stream: process.env.LLM_STREAM === 'true' || process.env.LLM_STREAM === '1',
    apiKey: process.env.LLM_API_KEY,
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
    // Aggressive default for network-bound cloud/hosted backends (calls are not
    // GPU-serialized). Override with LLM_CONCURRENCY. Lower it if you hit 429s.
    concurrency: 20,
    llmTuning: {
      tierABatchSize: 5,
      consensusVotes: 3,
      evidenceMaxChars: { strategic: 600, triage: 1500, bulk: 800, individual: 1500 },
    },
    scoring: DEFAULT_SCORING,
    analysisLimits: DEFAULT_ANALYSIS_LIMITS,
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
    provider: slot.provider,
    timeout: slot.timeout,
    maxTokens: slot.maxTokens,
    temperature: slot.temperature,
    concurrency: appConfig.concurrency,
    assessmentMode: appConfig.assessmentMode,
    apiKey: slot.apiKey,
    batchSize: slot.batchSize,
    llmTuning: appConfig.llmTuning,
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
      const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
      const validated = AppConfigSchema.partial().safeParse(raw);
      if (!validated.success) {
        getComponentLogger("Config").warn({ errors: validated.error.flatten().fieldErrors }, "config.json failed validation, using defaults");
      } else {
        appConfig = {
          ...appConfig,
          ...validated.data,
          main: { ...appConfig.main, ...validated.data.main },
          consensus: { ...appConfig.consensus, ...validated.data.consensus },
          // Deep-merge tuning so a partial llmTuning in config.json keeps the
          // other defaults instead of dropping them.
          llmTuning: {
            ...appConfig.llmTuning,
            ...validated.data.llmTuning,
            evidenceMaxChars: {
              ...appConfig.llmTuning.evidenceMaxChars,
              ...(validated.data.llmTuning?.evidenceMaxChars ?? {}),
            },
          },
          // Deep-merge scoring so a partial `scoring` in config.json keeps the
          // other defaults.
          scoring: {
            ...appConfig.scoring,
            ...validated.data.scoring,
            riskWeights: { ...appConfig.scoring.riskWeights, ...(validated.data.scoring?.riskWeights ?? {}) },
            verdictBoost: { ...appConfig.scoring.verdictBoost, ...(validated.data.scoring?.verdictBoost ?? {}) },
            thresholds: { ...appConfig.scoring.thresholds, ...(validated.data.scoring?.thresholds ?? {}) },
          },
          // analysisLimits is flat — a shallow merge keeps the other defaults.
          analysisLimits: { ...appConfig.analysisLimits, ...validated.data.analysisLimits },
        };
        if (Array.isArray(validated.data.judges)) {
          appConfig.judges = validated.data.judges;
        }
        getComponentLogger('Config').info(`Loaded config.json (version: ${appConfig.version}, judges: ${appConfig.judges.length})`);
      }
    } catch (err) {
      getComponentLogger("Config").warn({ err: err }, "Failed to parse config.json, using defaults");
    }
  }

  // Env vars override main model fields (backward compat)
  if (process.env.LLM_MODEL) appConfig.main.model = process.env.LLM_MODEL;
  if (process.env.LLM_URL) appConfig.main.baseUrl = process.env.LLM_URL;
  if (process.env.LLM_TIMEOUT) appConfig.main.timeout = parseInt(process.env.LLM_TIMEOUT, 10);
  if (process.env.LLM_MAX_TOKENS) appConfig.main.maxTokens = parseInt(process.env.LLM_MAX_TOKENS, 10);
  if (process.env.LLM_TEMPERATURE) appConfig.main.temperature = parseFloat(process.env.LLM_TEMPERATURE);
  if (process.env.LLM_CONCURRENCY) appConfig.concurrency = parseInt(process.env.LLM_CONCURRENCY, 10);
  if (process.env.LLM_ASSESSMENT_MODE) appConfig.assessmentMode = process.env.LLM_ASSESSMENT_MODE as AppConfig['assessmentMode'];
  // Only apply env overrides that parse to a valid positive integer, so a
  // typo'd value can't store NaN/0 into the config.
  const envPosInt = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined;
    const v = parseInt(raw, 10);
    return Number.isFinite(v) && v >= 1 ? v : undefined;
  };
  const tierA = envPosInt(process.env.LLM_TIER_A_BATCH_SIZE);
  if (tierA !== undefined) appConfig.llmTuning.tierABatchSize = tierA;
  const votes = envPosInt(process.env.LLM_CONSENSUS_VOTES);
  if (votes !== undefined) appConfig.llmTuning.consensusVotes = votes;

  // Sync the analyzer singletons with the loaded config.
  setScoringConfig(appConfig.scoring);
  setAnalysisLimits(appConfig.analysisLimits);

  _appConfig = appConfig;
  return appConfig;
}

/**
 * Save AppConfig to config.json and update in-memory cache.
 */
export function saveAppConfig(appConfig: AppConfig): void {
  _appConfig = appConfig;
  setScoringConfig(appConfig.scoring);
  setAnalysisLimits(appConfig.analysisLimits);
  writeFileSync(CONFIG_FILE, JSON.stringify(appConfig, null, 2), 'utf-8');
  getComponentLogger('Config').info(`Saved config.json (judges: ${appConfig.judges.length})`);
}

/**
 * Get the cached AppConfig (loads if needed).
 */
export function getAppConfig(): AppConfig {
  return _appConfig || loadAppConfig();
}
