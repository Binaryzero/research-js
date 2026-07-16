/**
 * Pattern loader - reads patterns from YAML configuration
 */

import { readFileSync, existsSync } from 'fs';
import { load } from 'js-yaml';
import type { PatternsConfig, PatternDefinition, PatternCategory } from '../types/index.js';
import { getComponentLogger } from "../services/logger.js";


/**
 * Load patterns from YAML file - throws if not found
 */
export function loadPatterns(patternsFile: string): PatternsConfig {
  if (!patternsFile) {
    throw new Error('Patterns file path is required');
  }

  if (!existsSync(patternsFile)) {
    throw new Error(`Patterns file not found: ${patternsFile}`);
  }

  try {
    const content = readFileSync(patternsFile, 'utf-8');
    const config = load(content) as PatternsConfig;
    // debug: patterns load on every scan (and in every analysis worker), so at
    // info this line dominates the log without saying anything new. The version
    // is still visible with LOG_LEVEL=debug when hot-reload debugging needs it.
    getComponentLogger('Patterns').debug(`Loaded ${patternsFile} (version: ${config.version || 'unknown'})`);
    return config;
  } catch (error) {
    throw new Error(`Failed to load patterns file ${patternsFile}: ${error}`);
  }
}

/**
 * Endpoint filtering configuration from patterns.yaml
 */
export interface EndpointFilteringConfig {
  excluded_domains: string[];
  excluded_url_patterns: string[];
  endpoint_classification: Array<{
    tag: string;
    host_patterns?: string[];
    url_patterns?: string[];
  }>;
  [key: string]: unknown;
}

// Cache for endpoint filtering config
let _endpointFiltering: EndpointFilteringConfig | null = null;

/**
 * Get endpoint filtering config - cached after first call
 */
export function getEndpointFiltering(patternsFile: string): EndpointFilteringConfig {
  if (!_endpointFiltering) {
    const config = loadPatterns(patternsFile);
    _endpointFiltering = (config.endpoint_filtering as EndpointFilteringConfig) || {
      excluded_domains: [],
      excluded_url_patterns: [],
      endpoint_classification: [],
    };
  }
  return _endpointFiltering;
}

/**
 * Reset endpoint filtering cache (useful for testing)
 */
export function resetEndpointFilteringCache(): void {
  _endpointFiltering = null;
}

/**
 * Compile a pattern string into a RegExp
 */
export function compilePattern(pattern: PatternDefinition): RegExp {
  let flags = '';
  
  if (pattern.flags) {
    if (pattern.flags.includes('IGNORECASE') || pattern.flags.includes('i')) {
      flags += 'i';
    }
    if (pattern.flags.includes('MULTILINE') || pattern.flags.includes('m')) {
      flags += 'm';
    }
    if (pattern.flags.includes('DOTALL') || pattern.flags.includes('s')) {
      flags += 's';
    }
  }
  
  return new RegExp(pattern.pattern, flags);
}

/**
 * Get all patterns as a flat array with metadata
 */
export function getAllPatterns(config: PatternsConfig): Array<{
  category: string;
  name: string;
  definition: PatternDefinition;
  regex: RegExp;
}> {
  const patterns: Array<{
    category: string;
    name: string;
    definition: PatternDefinition;
    regex: RegExp;
  }> = [];

  // Map snake_case YAML keys to config object - must match keys in patterns.yaml
  const categories: Record<string, PatternCategory | undefined> = {
    supply_chain: config.supply_chain,
    permission_abuse: config.permission_abuse,
    network: config.network,
    exfiltration: config.exfiltration,
    code_execution: config.code_execution,
    obfuscation: config.obfuscation,
    ai_agent: config.ai_agent,
    secrets: config.secrets,
    telemetry: config.telemetry,
    credentials: config.credentials,
    network_indicators: config.network_indicators,
    prompt_injection: config.prompt_injection,
    llm_prompt_surface: config.llm_prompt_surface,
    malicious_agent_instructions: config.malicious_agent_instructions,
    path_traversal: config.path_traversal,
    resource_exhaustion: config.resource_exhaustion,
    backdoor_indicators: config.backdoor_indicators,
  };

  for (const [category, categoryPatterns] of Object.entries(categories)) {
    if (!categoryPatterns) continue;

    for (const [name, definition] of Object.entries(categoryPatterns)) {
      // Skip metadata entries (they start with _ or don't have pattern)
      if (name.startsWith('_') || !definition || !definition.pattern) continue;

      patterns.push({
        category,
        name,
        definition,
        regex: compilePattern(definition),
      });
    }
  }
  
  return patterns;
}
