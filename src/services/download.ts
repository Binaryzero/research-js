/**
 * Extension download utilities
 * Support for downloading VSIX files from VS Code Marketplace
 */

import { mkdirSync, existsSync, statSync } from 'fs';
import { join, basename } from 'path';
import { request } from 'undici';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';

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
 * Download extension from URL using undici for better memory management
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
  
  // Handle marketplace URLs
  if (isMarketplaceUrl(url)) {
    const parsed = parseMarketplaceUrl(url);
    if (!parsed) {
      throw new Error(`Failed to parse marketplace URL: ${url}`);
    }
    downloadUrl = await getMarketplaceDownloadUrl(parsed.publisher, parsed.extension);
    filename = `${parsed.publisher}.${parsed.extension}.vsix`;
  } else if (isDirectVsixUrl(url)) {
    // Extract filename from URL
    const urlPath = new URL(url).pathname;
    filename = basename(urlPath);
    if (!filename.endsWith('.vsix')) {
      filename = 'extension.vsix';
    }
  } else {
    throw new Error(`Unsupported URL format: ${url}`);
  }
  
  const destPath = join(destDir, filename);
  
  // Download using undici for better memory management
  try {
    const response = await request(downloadUrl, {
      method: 'GET',
      headers: {
        'user-agent': 'extension-security-analyzer/1.0',
      },
    });
    
    if (response.statusCode >= 300 && response.statusCode < 400) {
      // Handle redirect manually
      const location = response.headers['location'];
      if (location) {
        const redirectUrl = Array.isArray(location) ? location[0] : location;
        return downloadExtension(redirectUrl, destDir, redirectCount + 1);
      }
    }
    
    if (response.statusCode >= 400) {
      throw new Error(`Download failed: ${response.statusCode}`);
    }
    
    // Stream directly to disk - no buffering in memory
    await pipeline(response.body, createWriteStream(destPath));

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
