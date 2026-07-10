/**
 * Extension download utilities
 * Support for downloading VSIX files from VS Code Marketplace
 */

import { mkdirSync, existsSync, statSync, createWriteStream } from 'fs';
import { join, basename } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

export interface DownloadResult {
  path: string;
  filename: string;
  size: number;
}

/**
 * Parse VS Code Marketplace URL to extract publisher and extension name
 */
export function parseMarketplaceUrl(url: string): { publisher: string; extension: string } | null {
  // Handle various marketplace URL formats
  // https://marketplace.visualstudio.com/items?itemName=ms-python.python
  // https://marketplace.visualstudio.com/items/ms-python.python
  // https://marketplace.visualstudio.com/items?itemName=publisher.%E7%8C%9B%E7%A9%BA-MCP (URL-encoded)

  // First try to decode the URL to handle encoded characters
  let decodedUrl;
  try {
    decodedUrl = decodeURIComponent(url);
  } catch {
    decodedUrl = url;
  }

  const patterns = [
    /marketplace\.visualstudio\.com\/items\?itemName=([^.&]+)\.([^&?]+)/,
    /marketplace\.visualstudio\.com\/items\/([^.&]+)\.([^.?]+)/,
    /marketplace\.visualstudio\.com\/publishers\/([^.]+)\?itemName=([^.&]+)/,
  ];

  for (const pattern of patterns) {
    const match = decodedUrl.match(pattern);
    if (match) {
      return { publisher: match[1], extension: match[2] };
    }
  }

  return null;
}

/**
 * Check if URL is a marketplace URL
 */
export function isMarketplaceUrl(url: string): boolean {
  return url.includes('marketplace.visualstudio.com');
}

/**
 * Check if URL is a direct VSIX download
 */
export function isDirectVsixUrl(url: string): boolean {
  return url.endsWith('.vsix') || url.includes('.vsix?');
}

/**
 * Get marketplace download URL for an extension
 */
export async function getMarketplaceDownloadUrl(publisher: string, extension: string): Promise<string> {
  // VS Code Marketplace uses a specific API endpoint for downloads
  // The URL format is: https://{publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/{publisher}/extension/{extension}/latest/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage
  
  const baseUrl = `https://${publisher}.gallery.vsassets.io/_apis/public/gallery/publisher/${publisher}/extension/${extension}/latest/assetbyname/Microsoft.VisualStudio.Services.VSIXPackage`;
  return baseUrl;
}

/**
 * Download extension from URL using native fetch
 */
export async function downloadExtension(
  url: string,
  destDir: string,
  redirectCount = 0
): Promise<DownloadResult> {
  // Prevent infinite redirect loops
  if (redirectCount > 10) {
    throw new Error('Too many redirects');
  }

  // Ensure destination directory exists
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  let downloadUrl = url;
  let filename: string;

  // Only marketplace.visualstudio.com and *.gallery.vsassets.io are trusted
  // download hosts. This allowlist prevents SSRF when callers pass arbitrary URLs.
  const ALLOWED_DOWNLOAD_HOSTS = /^([a-z0-9-]+\.gallery\.vsassets\.io|marketplace\.visualstudio\.com)$/i;

  // Handle marketplace URLs
  if (isMarketplaceUrl(url)) {
    const parsed = parseMarketplaceUrl(url);
    if (!parsed) {
      throw new Error(`Failed to parse marketplace URL: ${url}`);
    }
    downloadUrl = await getMarketplaceDownloadUrl(parsed.publisher, parsed.extension);
    filename = `${parsed.publisher}.${parsed.extension}.vsix`;
    // SSRF guard: the publisher slug is interpolated into the download host, so a
    // crafted itemName (e.g. containing '/' or a decimal-encoded IP) could point
    // the fetch at an internal host. Validate the resulting host against the allowlist.
    let marketplaceHost: string;
    try {
      marketplaceHost = new URL(downloadUrl).hostname;
    } catch {
      throw new Error('Failed to build a valid marketplace download URL');
    }
    if (!ALLOWED_DOWNLOAD_HOSTS.test(marketplaceHost)) {
      throw new Error(`Refusing marketplace download from disallowed host '${marketplaceHost}'`);
    }
  } else if (isDirectVsixUrl(url)) {
    // Allowlist applies to direct VSIX URLs — marketplace paths are already
    // constrained by isMarketplaceUrl above and produce a deterministic download URL.
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }
    if (!ALLOWED_DOWNLOAD_HOSTS.test(parsedUrl.hostname)) {
      throw new Error(`Direct VSIX download from '${parsedUrl.hostname}' is not allowed — use a marketplace URL instead`);
    }
    filename = basename(parsedUrl.pathname);
    if (!filename.endsWith('.vsix')) {
      filename = 'extension.vsix';
    }
  } else {
    throw new Error(`Unsupported URL format: ${url}`);
  }

  const destPath = join(destDir, filename);

  // Download using native fetch
  try {
    const response = await fetch(downloadUrl, {
      method: 'GET',
      headers: {
        'user-agent': 'extension-security-analyzer/1.0',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    // Stream directly to disk - no buffering in memory
    if (!response.body) {
      throw new Error('No response body');
    }
    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
    await pipeline(nodeStream, createWriteStream(destPath));

    const stats = statSync(destPath);
    return {
      path: destPath,
      filename,
      size: stats.size,
    };
  } catch (error) {
    throw new Error(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Resolve input source to a local path
 * Handles URLs, VSIX files, and directories
 */
export async function resolveInputSource(
  input: string,
  tempDir: string
): Promise<{ path: string; cleanup: () => void }> {
  // Check if it's a URL
  if (input.startsWith('http://') || input.startsWith('https://')) {
    const result = await downloadExtension(input, tempDir);
    return {
      path: result.path,
      cleanup: () => {
        // Cleanup will be handled by caller
      },
    };
  }
  
  // It's a local path
  return {
    path: input,
    cleanup: () => {},
  };
}
