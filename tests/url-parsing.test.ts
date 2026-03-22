/**
 * Tests for pure URL parsing functions from download.ts and marketplace.ts
 */

import { describe, it, expect } from 'vitest';
import {
  parseMarketplaceUrl,
  isMarketplaceUrl,
  isDirectVsixUrl,
} from '../src/services/download.js';
import {
  parseSearchUrl,
} from '../src/services/marketplace.js';

// ─── parseMarketplaceUrl ────────────────────────────────────────

describe('parseMarketplaceUrl', () => {
  it('parses standard marketplace URL with itemName parameter', () => {
    const result = parseMarketplaceUrl(
      'https://marketplace.visualstudio.com/items?itemName=ms-python.python'
    );
    expect(result).toEqual({ publisher: 'ms-python', extension: 'python' });
  });

  it('parses marketplace URL with path-based format', () => {
    const result = parseMarketplaceUrl(
      'https://marketplace.visualstudio.com/items/ms-python.python'
    );
    expect(result).toEqual({ publisher: 'ms-python', extension: 'python' });
  });

  it('handles URL-encoded characters', () => {
    const result = parseMarketplaceUrl(
      'https://marketplace.visualstudio.com/items?itemName=publisher.%E7%8C%9B%E7%A9%BA-MCP'
    );
    expect(result).not.toBeNull();
    expect(result!.publisher).toBe('publisher');
  });

  it('returns null for non-marketplace URL', () => {
    const result = parseMarketplaceUrl('https://github.com/some/repo');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseMarketplaceUrl('');
    expect(result).toBeNull();
  });

  it('returns null for malformed marketplace URL without itemName', () => {
    const result = parseMarketplaceUrl(
      'https://marketplace.visualstudio.com/items'
    );
    expect(result).toBeNull();
  });

  it('handles URL with additional query parameters', () => {
    const result = parseMarketplaceUrl(
      'https://marketplace.visualstudio.com/items?itemName=ms-vscode.cpptools&ssr=false'
    );
    expect(result).toEqual({ publisher: 'ms-vscode', extension: 'cpptools' });
  });

  it('handles publisher names with hyphens', () => {
    const result = parseMarketplaceUrl(
      'https://marketplace.visualstudio.com/items?itemName=my-org.my-extension'
    );
    expect(result).not.toBeNull();
    expect(result!.publisher).toBe('my-org');
  });

  it('handles extension names with hyphens', () => {
    const result = parseMarketplaceUrl(
      'https://marketplace.visualstudio.com/items?itemName=publisher.my-cool-ext'
    );
    expect(result).not.toBeNull();
    expect(result!.extension).toBe('my-cool-ext');
  });
});

// ─── isMarketplaceUrl ───────────────────────────────────────────

describe('isMarketplaceUrl', () => {
  it('returns true for marketplace URL', () => {
    expect(isMarketplaceUrl('https://marketplace.visualstudio.com/items?itemName=foo.bar')).toBe(true);
  });

  it('returns true for marketplace URL without https', () => {
    expect(isMarketplaceUrl('http://marketplace.visualstudio.com/items')).toBe(true);
  });

  it('returns false for non-marketplace URL', () => {
    expect(isMarketplaceUrl('https://github.com/foo/bar')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isMarketplaceUrl('')).toBe(false);
  });

  it('returns true when marketplace domain appears in path', () => {
    // The implementation uses simple includes() check
    expect(isMarketplaceUrl('https://marketplace.visualstudio.com')).toBe(true);
  });
});

// ─── isDirectVsixUrl ────────────────────────────────────────────

describe('isDirectVsixUrl', () => {
  it('returns true for URL ending in .vsix', () => {
    expect(isDirectVsixUrl('https://example.com/extension.vsix')).toBe(true);
  });

  it('returns true for URL with .vsix followed by query string', () => {
    expect(isDirectVsixUrl('https://example.com/extension.vsix?token=abc')).toBe(true);
  });

  it('returns false for non-vsix URL', () => {
    expect(isDirectVsixUrl('https://example.com/extension.zip')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isDirectVsixUrl('')).toBe(false);
  });

  it('returns false for marketplace URL without .vsix', () => {
    expect(isDirectVsixUrl('https://marketplace.visualstudio.com/items?itemName=foo.bar')).toBe(false);
  });

  it('returns true for vsix file with path segments', () => {
    expect(isDirectVsixUrl('https://cdn.example.com/releases/v1/my-ext-1.0.0.vsix')).toBe(true);
  });
});

// ─── parseSearchUrl ─────────────────────────────────────────────

describe('parseSearchUrl', () => {
  it('extracts searchText from URL', () => {
    const result = parseSearchUrl(
      'https://marketplace.visualstudio.com/search?search=python'
    );
    expect(result.searchText).toBe('python');
  });

  it('extracts category from URL', () => {
    const result = parseSearchUrl(
      'https://marketplace.visualstudio.com/search?category=Themes'
    );
    expect(result.category).toBe('Themes');
  });

  it('extracts sortBy from URL', () => {
    const result = parseSearchUrl(
      'https://marketplace.visualstudio.com/search?sortBy=Installs'
    );
    expect(result.sortBy).toBe('Installs');
  });

  it('extracts multiple parameters', () => {
    const result = parseSearchUrl(
      'https://marketplace.visualstudio.com/search?search=docker&category=Debuggers&sortBy=Rating'
    );
    expect(result.searchText).toBe('docker');
    expect(result.category).toBe('Debuggers');
    expect(result.sortBy).toBe('Rating');
  });

  it('returns empty object for URL with no relevant params', () => {
    const result = parseSearchUrl('https://marketplace.visualstudio.com/search');
    expect(result.searchText).toBeUndefined();
    expect(result.category).toBeUndefined();
    expect(result.sortBy).toBeUndefined();
  });

  it('returns empty object for malformed URL', () => {
    const result = parseSearchUrl('not a url');
    expect(result).toEqual({});
  });

  it('handles URL-encoded search text', () => {
    const result = parseSearchUrl(
      'https://marketplace.visualstudio.com/search?search=c%2B%2B'
    );
    expect(result.searchText).toBe('c++');
  });
});
