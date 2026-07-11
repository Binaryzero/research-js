/**
 * Shared endpoint filtering.
 *
 * A single implementation of the "which discovered URLs are worth showing"
 * rules, used by the markdown report, the HTML report, and the LLM context
 * builder. Rules (in order):
 *   1. package.json metadata URLs (repository/homepage) are dropped
 *   2. excluded_domains from patterns.yaml (subdomains included) are dropped,
 *      unless the endpoint is operational (used in an actual network call)
 *   3. excluded_url_patterns from patterns.yaml are dropped unconditionally
 *   4. unparseable URLs are dropped
 */

import type { EndpointInfo } from '../types/index.js';
import type { EndpointFilteringConfig } from './patterns.js';

export interface PackageMetaUrls {
  repository?: string | null;
  homepage?: string | null;
}

export interface EndpointFilterOutcome {
  filtered: EndpointInfo[];
  excludedCount: number;
}

function tryParseHostPath(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname + parsed.pathname;
  } catch {
    return null;
  }
}

export function filterEndpoints(
  endpoints: EndpointInfo[],
  meta: PackageMetaUrls,
  config: EndpointFilteringConfig,
): EndpointFilterOutcome {
  const excludedDomains = config.excluded_domains || [];
  const excludedUrlPatterns = (config.excluded_url_patterns || []).map(
    (p: string) => new RegExp(p, 'i'),
  );

  const isExcludedDomain = (hostname: string): boolean => {
    const normalized = hostname.toLowerCase();
    return excludedDomains.some(domain => {
      const d = domain.toLowerCase();
      return normalized === d || normalized.endsWith('.' + d);
    });
  };

  // package.json metadata URLs (host+path, and bare host) to exclude
  const pkgUrls = new Set<string>();
  for (const url of [meta.repository, meta.homepage]) {
    if (!url) continue;
    const hostPath = tryParseHostPath(url);
    if (hostPath) pkgUrls.add(hostPath);
  }

  const filtered = endpoints.filter(ep => {
    try {
      const epUrl = new URL(ep.url);
      const epPath = epUrl.hostname + epUrl.pathname;

      if (pkgUrls.has(epPath) || pkgUrls.has(epUrl.hostname)) {
        return false;
      }

      if (!ep.operational && isExcludedDomain(epUrl.hostname)) {
        return false;
      }

      for (const pattern of excludedUrlPatterns) {
        if (pattern.test(ep.url)) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  });

  return { filtered, excludedCount: endpoints.length - filtered.length };
}
