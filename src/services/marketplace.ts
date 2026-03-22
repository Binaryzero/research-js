/**
 * VS Code Marketplace API client
 * Search and retrieve extension information
 */

// Marketplace API endpoint
const MARKETPLACE_API = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery';

// Filter types for the gallery API
const FILTER_TARGET = 8;           // Microsoft.VisualStudio.Code
const FILTER_SEARCH_TEXT = 10;     // Free-text search
const FILTER_CATEGORY = 5;         // Category name

// Flags control which data comes back
const FLAGS_FULL = 914;  // Include versions, files, stats, etc.

// Sort mappings - keys match template display names
const SORT_CODES: Record<string, number> = {
  'Relevance': 0,
  'Installs': 4,
  'Rating': 6,
  'Name': 2,
  'Published Date': 10,  // Note: matches template key with space
  'Updated Date': 1,      // Note: matches template key with space
  'PublishedDate': 10,    // Also accept without space
  'UpdatedDate': 1,       // Also accept without space
};

// Category mappings
export const CATEGORY_MAP: Record<string, string> = {
  'All categories': '',
  'Azure': 'Azure',
  'Data Science': 'Data Science',
  'Debuggers': 'Debuggers',
  'Education': 'Education',
  'Extension Packs': 'Extension Packs',
  'Formatters': 'Formatters',
  'Keymaps': 'Keymaps',
  'Language Packs': 'Language Packs',
  'Linters': 'Linters',
  'Machine Learning': 'Machine Learning',
  'Notebooks': 'Notebooks',
  'Other': 'Other',
  'Programming Languages': 'Programming Languages',
  'SCM Providers': 'SCM Providers',
  'Snippets': 'Snippets',
  'Testing': 'Testing',
  'Themes': 'Themes',
  'Visualization': 'Visualization',
};

export interface MarketplaceExtension {
  extensionId: string;
  extensionName: string;
  displayName: string;
  publisher: {
    publisherId: string;
    publisherName: string;
    displayName: string;
  };
  shortDescription: string;
  versions: Array<{
    version: string;
    lastUpdated: string;
  }>;
  statistics: {
    installCount: number;
    rating: number;
    ratingCount: number;
  };
  categories: string[];
  tags: string[];
  // Augmented by server with scan history
  scan?: {
    score: number;
    risk_label: string;
    risk_color: string;
    findings_count: number;
    llm_analyzed: boolean;
    report_name: string;
    scan_date: string;
    breakdown: Record<string, unknown>;
    static_score?: number;
    true_positives?: number;
    verdict?: string | null;
  };
}

export interface SearchOptions {
  searchText?: string;
  category?: string;
  sortBy?: string;
  page?: number;
  pageSize?: number;
}

/**
 * Build marketplace query payload
 */
function buildQueryPayload(options: SearchOptions): object {
  const { searchText = '', category = '', sortBy = 'Installs', page = 1, pageSize = 50 } = options;
  
  // Always include the VS Code target filter
  const criteria: Array<{ filterType: number; value: string }> = [
    { filterType: FILTER_TARGET, value: 'Microsoft.VisualStudio.Code' },
  ];
  
  // Add text filter
  if (searchText) {
    criteria.push({ filterType: FILTER_SEARCH_TEXT, value: searchText });
  }
  
  // Add category filter
  if (category && CATEGORY_MAP[category]) {
    criteria.push({ filterType: FILTER_CATEGORY, value: CATEGORY_MAP[category] });
  }
  
  const sortCode = SORT_CODES[sortBy] ?? SORT_CODES['Installs'];
  
  return {
    filters: [
      {
        criteria,
        pageNumber: page,
        pageSize,
        sortBy: sortCode,
        sortOrder: 2, // Descending
      },
    ],
    flags: FLAGS_FULL,
  };
}

/**
 * Search for extensions in the marketplace
 */
export async function searchExtensions(
  options: SearchOptions = {}
): Promise<MarketplaceExtension[]> {
  const payload = buildQueryPayload(options);
  
  try {
    const response = await fetch(MARKETPLACE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json;api-version=3.0-preview.1',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    
    if (!response.ok) {
      throw new Error(`Marketplace API error: ${response.status}`);
    }
    
    const data = await response.json() as {
      results?: Array<{
        extensions?: Array<{
          extensionId: string;
          extensionName: string;
          displayName: string;
          publisher: {
            publisherId: string;
            publisherName: string;
            displayName: string;
          };
          shortDescription: string;
          versions: Array<{ version: string; lastUpdated: string }>;
          statistics?: Array<{ statisticName: string; value: number }>;
          categories?: string[];
          tags?: string[];
        }>;
      }>;
    };
    
    if (!data.results || !data.results[0]?.extensions) {
      return [];
    }
    
    return data.results[0].extensions.map(ext => {
      const stats = ext.statistics || [];
      const installCount = stats.find(s => s.statisticName === 'install')?.value || 0;
      const rating = stats.find(s => s.statisticName === 'averagerating')?.value || 0;
      const ratingCount = stats.find(s => s.statisticName === 'ratingcount')?.value || 0;
      
      return {
        extensionId: `${ext.publisher.publisherName}.${ext.extensionName}`,
        extensionName: ext.extensionName,
        displayName: ext.displayName || ext.extensionName,
        publisher: ext.publisher,
        shortDescription: ext.shortDescription || '',
        versions: ext.versions || [],
        statistics: {
          installCount,
          rating,
          ratingCount,
        },
        categories: ext.categories || [],
        tags: ext.tags || [],
      };
    });
  } catch (error) {
    console.error('Marketplace search error:', error);
    throw error;
  }
}

/**
 * Get extension details by ID
 */
export async function getExtensionDetails(
  publisher: string,
  extension: string
): Promise<MarketplaceExtension | null> {
  const payload = {
    filters: [
      {
        criteria: [
          {
            filterType: 7, // Extension ID
            value: `${publisher}.${extension}`,
          },
        ],
        pageNumber: 1,
        pageSize: 1,
      },
    ],
    assetTypes: [],
    flags: 870,
  };
  
  try {
    const response = await fetch(MARKETPLACE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json;api-version=6.1-preview.1',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    
    if (!response.ok) {
      return null;
    }
    
    const data = await response.json() as {
      results?: Array<{
        extensions?: Array<{
          extensionId: string;
          extensionName: string;
          displayName: string;
          publisher: {
            publisherId: string;
            publisherName: string;
            displayName: string;
          };
          shortDescription: string;
          versions: Array<{ version: string; lastUpdated: string }>;
          statistics?: Array<{ statisticName: string; value: number }>;
          categories?: string[];
          tags?: string[];
        }>;
      }>;
    };
    
    const ext = data.results?.[0]?.extensions?.[0];
    if (!ext) return null;
    
    const stats = ext.statistics || [];
    const installCount = stats.find(s => s.statisticName === 'install')?.value || 0;
    const rating = stats.find(s => s.statisticName === 'averagerating')?.value || 0;
    const ratingCount = stats.find(s => s.statisticName === 'ratingcount')?.value || 0;
    
    return {
      extensionId: `${ext.publisher.publisherName}.${ext.extensionName}`,
      extensionName: ext.extensionName,
      displayName: ext.displayName || ext.extensionName,
      publisher: ext.publisher,
      shortDescription: ext.shortDescription || '',
      versions: ext.versions || [],
      statistics: {
        installCount,
        rating,
        ratingCount,
      },
      categories: ext.categories || [],
      tags: ext.tags || [],
    };
  } catch {
    return null;
  }
}

/**
 * Parse a marketplace search URL to extract search parameters
 */
export function parseSearchUrl(url: string): SearchOptions {
  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    
    const result: SearchOptions = {};
    
    // Search text
    const searchText = params.get('search');
    if (searchText) {
      result.searchText = searchText;
    }
    
    // Category
    const category = params.get('category');
    if (category) {
      result.category = category;
    }
    
    // Sort
    const sortBy = params.get('sortBy');
    if (sortBy) {
      result.sortBy = sortBy;
    }
    
    return result;
  } catch {
    return {};
  }
}
