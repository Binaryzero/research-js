import { describe, it, expect } from 'vitest';
import { filterEndpoints } from '../src/analyzer/endpoint-filter.js';
import type { EndpointInfo } from '../src/types/index.js';
import type { EndpointFilteringConfig } from '../src/analyzer/patterns.js';

function makeEndpoint(overrides: Partial<EndpointInfo> = {}): EndpointInfo {
  return {
    url: 'https://api.example.com/v1/data',
    file: 'extension.js',
    line: 10,
    context: '',
    method: 'GET',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<EndpointFilteringConfig> = {}): EndpointFilteringConfig {
  return {
    excluded_domains: [],
    excluded_url_patterns: [],
    endpoint_classification: [],
    ...overrides,
  };
}

describe('filterEndpoints', () => {
  it('keeps ordinary endpoints when nothing is excluded', () => {
    const endpoints = [makeEndpoint()];
    const { filtered, excludedCount } = filterEndpoints(endpoints, {}, makeConfig());

    expect(filtered).toHaveLength(1);
    expect(excludedCount).toBe(0);
  });

  it('excludes endpoints matching excluded domains, including subdomains', () => {
    const endpoints = [
      makeEndpoint({ url: 'https://w3.org/TR/spec' }),
      makeEndpoint({ url: 'https://www.w3.org/1999/xhtml' }),
      makeEndpoint({ url: 'https://evil.com/w3.org' }),
    ];
    const config = makeConfig({ excluded_domains: ['w3.org'] });
    const { filtered, excludedCount } = filterEndpoints(endpoints, {}, config);

    expect(filtered.map(e => e.url)).toEqual(['https://evil.com/w3.org']);
    expect(excludedCount).toBe(2);
  });

  it('keeps operational endpoints even on excluded domains', () => {
    const endpoints = [
      makeEndpoint({ url: 'https://github.com/api/data', operational: true }),
      makeEndpoint({ url: 'https://github.com/some/readme-link' }),
    ];
    const config = makeConfig({ excluded_domains: ['github.com'] });
    const { filtered } = filterEndpoints(endpoints, {}, config);

    expect(filtered.map(e => e.url)).toEqual(['https://github.com/api/data']);
  });

  it('excludes URLs matching excluded_url_patterns case-insensitively', () => {
    const endpoints = [
      makeEndpoint({ url: 'https://cdn.example.com/FONTS/roboto.woff2' }),
      makeEndpoint({ url: 'https://api.example.com/v1/data' }),
    ];
    const config = makeConfig({ excluded_url_patterns: ['fonts'] });
    const { filtered } = filterEndpoints(endpoints, {}, config);

    expect(filtered.map(e => e.url)).toEqual(['https://api.example.com/v1/data']);
  });

  it('url-pattern exclusion applies even to operational endpoints (matches existing behavior)', () => {
    const endpoints = [
      makeEndpoint({ url: 'https://cdn.example.com/fonts/x.woff2', operational: true }),
    ];
    const config = makeConfig({ excluded_url_patterns: ['fonts'] });
    const { filtered } = filterEndpoints(endpoints, {}, config);

    expect(filtered).toHaveLength(0);
  });

  it('excludes package.json metadata URLs (repository/homepage host+path and bare host)', () => {
    const endpoints = [
      makeEndpoint({ url: 'https://github.com/acme/widget' }),
      makeEndpoint({ url: 'https://acme.dev/' }),
      makeEndpoint({ url: 'https://github.com/acme/other-repo' }),
    ];
    const { filtered } = filterEndpoints(
      endpoints,
      { repository: 'https://github.com/acme/widget', homepage: 'https://acme.dev/' },
      makeConfig(),
    );

    expect(filtered.map(e => e.url)).toEqual(['https://github.com/acme/other-repo']);
  });

  it('drops endpoints whose URL does not parse', () => {
    const endpoints = [makeEndpoint({ url: 'not a url' })];
    const { filtered, excludedCount } = filterEndpoints(endpoints, {}, makeConfig());

    expect(filtered).toHaveLength(0);
    expect(excludedCount).toBe(1);
  });

  it('ignores malformed repository/homepage URLs instead of throwing', () => {
    const endpoints = [makeEndpoint()];
    const { filtered } = filterEndpoints(
      endpoints,
      { repository: '::not-a-url::', homepage: '' },
      makeConfig(),
    );

    expect(filtered).toHaveLength(1);
  });

  it('does not mutate the input array', () => {
    const endpoints = [makeEndpoint({ url: 'https://w3.org/x' }), makeEndpoint()];
    const snapshot = JSON.parse(JSON.stringify(endpoints));
    filterEndpoints(endpoints, {}, makeConfig({ excluded_domains: ['w3.org'] }));

    expect(endpoints).toEqual(snapshot);
  });
});
