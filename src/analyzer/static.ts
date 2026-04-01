/**
 * Static analyzer for VS Code extensions
 * Port of Python analyzer.py static analysis logic
 */

import { readdirSync, readFileSync, statSync, existsSync, openSync, readSync, closeSync } from 'fs';
import { join, extname, basename, relative, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import AdmZip from 'adm-zip';
import type {
  AnalysisResult,
  Finding,
  FileInfo,
  EndpointInfo,
  BinaryInfo,
  FileStats,
  PatternsConfig,
} from '../types/index.js';
import { loadPatterns, getAllPatterns } from './patterns.js';

// ES Module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Magic bytes for file type detection
const MAGIC_SIGNATURES: Record<string, { signature: Buffer; mime: string; description: string }> = {
  png: { signature: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mime: 'image/png', description: 'PNG image' },
  jpeg: { signature: Buffer.from([0xff, 0xd8, 0xff]), mime: 'image/jpeg', description: 'JPEG image' },
  gif: { signature: Buffer.from('GIF87a'), mime: 'image/gif', description: 'GIF image' },
  zip: { signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]), mime: 'application/zip', description: 'ZIP archive' },
  exe_mz: { signature: Buffer.from('MZ'), mime: 'application/x-msdownload', description: 'Windows executable' },
  elf: { signature: Buffer.from([0x7f, 0x45, 0x4c, 0x46]), mime: 'application/x-elf', description: 'Linux executable' },
  macho_64: { signature: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), mime: 'application/x-mach-binary', description: 'macOS executable' },
  wasm: { signature: Buffer.from([0x00, 0x61, 0x73, 0x6d]), mime: 'application/wasm', description: 'WebAssembly' },
  pdf: { signature: Buffer.from('%PDF'), mime: 'application/pdf', description: 'PDF document' },
};

/**
 * Detect file type using magic bytes
 */
function detectFileType(filePath: string): { type: string; description: string; confidence: string } {
  const buffer = readFileSync(filePath);
  const header = buffer.subarray(0, 64);
  
  for (const { signature, mime, description } of Object.values(MAGIC_SIGNATURES)) {
    if (header.length >= signature.length) {
      const matches = signature.every((byte, i) => header[i] === byte);
      if (matches) {
        return { type: mime, description, confidence: 'high' };
      }
    }
  }
  
  // Check for text-based files
  const ext = extname(filePath).toLowerCase();
  const textExtensions: Record<string, string> = {
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.cjs': 'application/javascript',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript-jsx',
    '.json': 'application/json',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.scss': 'text/x-scss',
    '.less': 'text/x-less',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.xml': 'application/xml',
    '.svg': 'image/svg+xml',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.py': 'text/x-python',
  };
  
  if (ext in textExtensions) {
    return { type: textExtensions[ext], description: ext.slice(1).toUpperCase() + ' file', confidence: 'high' };
  }
  
  return { type: 'application/octet-stream', description: 'Unknown file type', confidence: 'low' };
}

/**
 * Check if file is binary - uses limited read to avoid loading large files
 */
function isBinaryFile(filePath: string): boolean {
  const stats = statSync(filePath);
  const MAX_CHECK_SIZE = 8000;

  // Large files are likely binary (images, WASM, etc.)
  if (stats.size > MAX_CHECK_SIZE * 10) {
    return true;
  }

  // Small files: read only what we need
  const buffer = Buffer.alloc(MAX_CHECK_SIZE);
  const fd = openSync(filePath, 'r');
  const bytesRead = readSync(fd, buffer, 0, MAX_CHECK_SIZE, 0);
  closeSync(fd);

  // Check for null bytes
  for (let i = 0; i < bytesRead; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Get file SHA256 hash
 */
function getFileHash(filePath: string): string {
  const stats = statSync(filePath);
  const MAX_HASH_SIZE = 10 * 1024 * 1024; // 10MB

  // Skip hashing very large files to avoid memory issues
  if (stats.size > MAX_HASH_SIZE) {
    return 'skipped-large-file';
  }

  // Small files: read fully (existing behavior)
  const buffer = readFileSync(filePath);
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Extract URLs from content
 */
// Network function patterns to detect operational URLs - defined first
const NETWORK_PATTERNS = [
  /fetch\s*\(/,
  /axios\.(get|post|put|delete|request)\s*\(/,
  /axios\s*\(/,
  /http\.(get|post|put|delete|request)\s*\(/,
  /https\.(get|post|put|delete|request)\s*\(/,
  /http\.request\s*\(/,
  /https\.request\s*\(/,
  /got\s*\(/,
  /new\s+WebSocket\s*\(/,
  /superagent/,
  /request\s*\(/,
  /needle\s*\(/,
  /undici\./,
];

/**
 * Check if a line contains a network function call
 */
function isNetworkCall(line: string): boolean {
  return NETWORK_PATTERNS.some(pattern => pattern.test(line));
}

/**
 * Extract URLs from a file - uses chunked reading for large files
 */
function extractUrlsFromFile(filePath: string, relativePath: string): EndpointInfo[] {
  const stats = statSync(filePath);
  const CHUNK_SIZE = 512 * 1024; // 512KB

  try {
    // Small files: read fully
    if (stats.size <= CHUNK_SIZE) {
      const content = readFileSync(filePath, 'utf-8');
      return extractUrls(content, relativePath);
    }

    // Large files: read in chunks
    const endpoints: EndpointInfo[] = [];
    const fd = openSync(filePath, 'r');
    let lineNumber = 0;
    let leftover = '';

    try {
      const buffer = Buffer.alloc(CHUNK_SIZE);
      let bytesRead: number;

      while ((bytesRead = readSync(fd, buffer, 0, CHUNK_SIZE, -1)) > 0) {
        const chunk = buffer.toString('utf-8', 0, bytesRead);
        const data = leftover + chunk;
        const lines = data.split('\n');
        leftover = lines.pop() || '';

        for (const line of lines) {
          lineNumber++;
          const lineEndpoints = extractUrlsFromLine(line, relativePath, lineNumber);
          endpoints.push(...lineEndpoints);
        }
      }

      // Process remaining line
      if (leftover) {
        lineNumber++;
        const lineEndpoints = extractUrlsFromLine(leftover, relativePath, lineNumber);
        endpoints.push(...lineEndpoints);
      }
    } finally {
      closeSync(fd);
    }

    return endpoints;
  } catch {
    return [];
  }
}

/**
 * Extract URLs from a single line
 */
function extractUrlsFromLine(line: string, filePath: string, lineNum: number): EndpointInfo[] {
  const urlRegex = /["'](https?:\/\/[^"'\s<>]+|wss?:\/\/[^"'\s<>]+)["']/gi;
  const endpoints: EndpointInfo[] = [];

  let match;
  while ((match = urlRegex.exec(line)) !== null) {
    const operational = isNetworkCall(line);
    endpoints.push({
      url: match[1],
      file: filePath,
      line: lineNum,
      context: line,
      method: 'unknown',
      operational,
    });
  }

  return endpoints;
}

function extractUrls(content: string, filePath: string): EndpointInfo[] {
  const urlRegex = /["'](https?:\/\/[^"'\s<>]+|wss?:\/\/[^"'\s<>]+)["']/gi;
  const endpoints: EndpointInfo[] = [];
  const lines = content.split('\n');

  let match;
  while ((match = urlRegex.exec(content)) !== null) {
    const url = match[1];
    // Find line number
    const beforeMatch = content.substring(0, match.index);
    const lineNum = beforeMatch.split('\n').length;

    // Check if this is an operational URL (line contains network call)
    const lineContent = lines[lineNum - 1] || '';
    const operational = isNetworkCall(lineContent);

    // Get context (surrounding lines)
    const contextLines = lines.slice(Math.max(0, lineNum - 2), lineNum + 1).join('\n');

    endpoints.push({
      url,
      file: filePath,
      line: lineNum,
      context: contextLines.slice(0, 200),
      method: 'unknown',
      operational,
    });
  }

  return endpoints;
}

/**
 * Categorize file by extension and content
 */
function categorizeFile(filePath: string, ext: string): string {
  const jsExtensions = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'];
  const configExtensions = ['.json', '.yaml', '.yml', '.xml', '.toml'];
  const assetExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.eot'];
  const agentFiles = ['.cursorrules', '.claude', '.cursor', '.windsurf', 'copilot-instructions.md'];
  
  if (jsExtensions.includes(ext)) return 'js';
  if (configExtensions.includes(ext)) return 'config';
  if (assetExtensions.includes(ext)) return 'asset';
  
  const baseName = basename(filePath).toLowerCase();
  if (agentFiles.some(f => baseName.includes(f.replace('.', '')))) return 'agent_config';
  
  if (isBinaryFile(filePath)) return 'binary';
  
  return 'text';
}

export interface StaticAnalyzerOptions {
  verbose?: boolean;
  patternsFile?: string;
}

/**
 * Static analyzer class
 */
export class StaticAnalyzer {
  private extensionPath: string;
  private verbose: boolean;
  private patterns: PatternsConfig;
  private compiledPatterns: ReturnType<typeof getAllPatterns>;
  // Maps "file:lineRange" → dependency name for bundled code regions
  private bundleRegions: Map<string, string> = new Map();
  
  constructor(extensionPath: string, options: StaticAnalyzerOptions = {}) {
    this.extensionPath = extensionPath;
    this.verbose = options.verbose ?? false;
    // Use default patterns path if none provided (matches config.ts default)
    const defaultPatternsPath = join(__dirname, '..', '..', 'docs', 'patterns.yaml');
    this.patterns = loadPatterns(options.patternsFile || defaultPatternsPath);
    this.compiledPatterns = getAllPatterns(this.patterns);
  }
  
  /**
   * Run complete static analysis
   */
  async analyze(): Promise<AnalysisResult> {
    const startTime = Date.now();
    
    // Collect all files
    const files = this.collectFiles();
    
    // Parse package.json for metadata
    const packageJson = this.parsePackageJson(files);
    
    // Categorize files
    const fileTypes = files.map(f => this.analyzeFile(f));
    
    // Detect bundled dependencies (populates this.bundleRegions)
    const bundledDependencies = this.detectBundledDependencies(files);

    // Run pattern matching
    const findings = this.runPatternMatching(files);

    // Enrich findings: override probableOrigin when location falls in a bundle region
    for (const f of findings) {
      const [relPath, lineStr] = f.location.split(':');
      const lineNum = parseInt(lineStr, 10);
      const dep = this.getBundledDepForLocation(relPath, lineNum);
      if (dep) {
        f.probableOrigin = 'bundled_dependency';
        f.context = f.context ? `${f.context} [bundled: ${dep}]` : `[bundled: ${dep}]`;
      }
    }

    // Extract endpoints
    const endpoints = this.extractAllEndpoints(files);
    
    // Generate binary hashes
    const binaries = fileTypes
      .filter(f => f.category === 'binary')
      .map(f => this.generateBinaryInfo(f.path));
    
    // Build file stats
    const fileStats = this.buildFileStats(fileTypes);
    
    // Verify repository URL accessibility
    // repository can be a string or an object with a url property
    const repoUrl = typeof packageJson.repository === 'string'
      ? packageJson.repository
      : packageJson.repository?.url;
    if (repoUrl) {
      const repoFinding = await this.verifyRepositoryUrl(repoUrl);
      if (repoFinding) findings.push(repoFinding);
    }

    // Note: package.json vs VSIX manifest version comparison was removed.
    // The VSIX manifest Version attribute is set by `vsce package` at build time
    // and routinely differs from package.json (CI versioning, pre-release builds, etc.).

    const elapsed = Date.now() - startTime;
    if (this.verbose) {
      console.log(`[Static] Analysis complete in ${elapsed}ms`);
      console.log(`[Static] Files: ${files.length}, Findings: ${findings.length}, Endpoints: ${endpoints.length}`);
    }
    
    return {
      extensionName: packageJson.name || 'Unknown Extension',
      extensionId: packageJson.publisher && packageJson.name ? `${packageJson.publisher}.${packageJson.name}` : (packageJson.id || this.extractExtensionId()),
      version: packageJson.version || '0.0.0',
      analysisDate: new Date().toISOString(),
      publisher: packageJson.publisher || '',
      description: packageJson.description || '',
      repository: packageJson.repository?.url || '',
      homepage: packageJson.homepage || '',
      installCount: '',
      categories: packageJson.categories || [],
      activationEvents: packageJson.activationEvents || [],
      contributes: packageJson.contributes,
      jsFiles: fileTypes.filter(f => f.category === 'js').map(f => f.path),
      binaryFiles: fileTypes.filter(f => f.category === 'binary').map(f => f.path),
      configFiles: fileTypes.filter(f => f.category === 'config').map(f => f.path),
      assetFiles: fileTypes.filter(f => f.category === 'asset').map(f => f.path),
      agentConfigFiles: fileTypes.filter(f => f.category === 'agent_config').map(f => f.path),
      fileStats,
      fileTypes,
      totalSize: fileTypes.reduce((sum, f) => sum + f.size, 0),
      permissions: packageJson.contributes || {},
      bundledDependencies,
      dependencies: packageJson.dependencies || {},
      notableDependencies: this.findNotableDependencies(packageJson.dependencies || {}),
      telemetryConfig: this.extractTelemetryConfig(packageJson),
      vsixManifest: {},
      endpoints,
      findings,
      patternsSearched: {},
      binaryHashes: binaries,
      executiveSummary: null,
      verdict: null,
    };
  }
  
  /**
   * Recursively collect all files in extension
   */
  private collectFiles(): string[] {
    const files: string[] = [];
    
    const walk = (dir: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            // Skip node_modules and hidden directories
            if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
              walk(fullPath);
            }
          } else if (entry.isFile()) {
            files.push(fullPath);
          }
        }
      } catch {
        // Ignore permission errors
      }
    };
    
    walk(this.extensionPath);
    return files;
  }
  
  /**
   * Parse package.json
   */
  private parsePackageJson(files: string[]): {
    name?: string;
    id?: string;
    version?: string;
    publisher?: string;
    description?: string;
    repository?: { url?: string };
    homepage?: string;
    categories?: string[];
    activationEvents?: string[];
    contributes?: Record<string, unknown>;
    dependencies?: Record<string, string>;
  } {
    const pkgPath = files.find(f => f.endsWith('package.json'));
    if (!pkgPath) return {};
    
    try {
      const content = readFileSync(pkgPath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {};
    }
  }
  
  /**
   * Extract extension ID from directory name
   */
  private extractExtensionId(): string {
    const parts = basename(this.extensionPath).split('.');
    return parts.length >= 2 ? parts.slice(0, 2).join('.') : basename(this.extensionPath);
  }
  
  /**
   * Analyze a single file
   */
  private analyzeFile(filePath: string): FileInfo {
    const ext = extname(filePath).toLowerCase();
    const stats = statSync(filePath);
    const category = categorizeFile(filePath, ext);
    const detected = detectFileType(filePath);
    
    // Check for mismatch
    let mismatch = false;
    let mismatchDetail = '';
    
    if (category === 'binary' && ['.txt', '.md', '.json'].includes(ext)) {
      mismatch = true;
      mismatchDetail = `File claims to be ${ext} but is binary`;
    }
    
    return {
      path: filePath,
      extension: ext,
      detectedType: detected.type,
      description: detected.description,
      size: stats.size,
      category,
      confidence: detected.confidence,
      mismatch,
      mismatchDetail,
    };
  }
  
  /**
   * Run pattern matching on all files using chunked sync reads to prevent OOM
   */
  private runPatternMatching(files: string[]): Finding[] {
    const findings: Finding[] = [];
    const jsFiles = files.filter(f => ['.js', '.mjs', '.ts', '.tsx'].includes(extname(f)));
    const CHUNK_SIZE = 512 * 1024; // 512KB chunks

    for (const filePath of jsFiles) {
      try {
        const relativePath = relative(this.extensionPath, filePath);
        const stats = statSync(filePath);

        // For small files, use the original full-read approach
        if (stats.size <= CHUNK_SIZE) {
          const content = readFileSync(filePath, 'utf-8');
          const fileFindings = this.matchPatternsInContent(content, relativePath);
          findings.push(...fileFindings);
        } else {
          // For large files, read in chunks
          const fileFindings = this.matchPatternsInChunks(filePath, relativePath);
          findings.push(...fileFindings);
        }
      } catch {
        // Ignore file read errors
      }
    }

    return findings;
  }

  /**
   * Extract file type from path (e.g., "d.ts", "js", "ts", "json", "md")
   */
  private getFileType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    return ext ? ext.slice(1) : '';
  }

  /**
   * Check if file appears to be minified (average line length > 200 chars)
   */
  private isMinified(content: string): boolean {
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return false;
    const avgLength = lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
    return avgLength > 200;
  }

  /**
   * Determine probable origin from file path
   */
  private getProbableOrigin(filePath: string): 'extension_code' | 'bundled_dependency' | 'unknown' {
    const path = filePath.toLowerCase();

    // Bundled dependency indicators
    if (path.includes('node_modules/') ||
        path.includes('dist/vendor/') ||
        path.includes('dist/node_modules/') ||
        path.includes('.webpack/') ||
        /\/chunk\.\d+\./.test(path) ||
        /_\d+\.[a-z]{2,4}\.js$/.test(path)) {
      return 'bundled_dependency';
    }

    // Extension code indicators
    if (path.includes('src/') ||
        path.includes('out/') ||
        path.includes('lib/') ||
        path.endsWith('package.json')) {
      return 'extension_code';
    }

    return 'unknown';
  }

  /**
   * Pre-scan JS files for bundled dependency markers (webpack banners, JSON.parse
   * package metadata, esbuild/rollup regions). Populates this.bundleRegions and
   * returns deduplicated list of detected dependency names.
   */
  private detectBundledDependencies(files: string[]): string[] {
    const deps = new Set<string>();
    const jsFiles = files.filter(f => ['.js', '.mjs'].includes(extname(f)));
    const CHUNK_SIZE = 512 * 1024;

    // Patterns for webpack banner comments: /*! lodash 4.17.21 */ or /** @license React */
    const webpackBanner = /\/\*[!*]\s+([a-z@][a-z0-9_./@-]+?)(?:\s+v?[\d.]+)?\s*\*\//gi;
    // JSON.parse('{"name":"axios",...}') — common in bundled metadata
    const jsonParseMeta = /JSON\.parse\s*\(\s*'(\{[^']*?"name"\s*:\s*"([^"]+)"[^']*?\})'\s*\)/g;
    // Webpack module comment: /***/ "./node_modules/lodash/lodash.js":
    const webpackModule = /\/\*{3}\/ +"\.\/node_modules\/([^/]+)/g;
    // esbuild banner: // node_modules/axios/lib/axios.js
    const esbuildBanner = /^\/\/ node_modules\/([a-z@][a-z0-9_./@-]*?)\/(?:lib|dist|src|index)/gm;

    for (const filePath of jsFiles) {
      try {
        const stats = statSync(filePath);
        const relativePath = relative(this.extensionPath, filePath);
        const wasTruncated = stats.size > 1024 * 1024;

        // Only scan the first 1MB for dependency markers (they appear early in bundles)
        const content = stats.size <= CHUNK_SIZE
          ? readFileSync(filePath, 'utf-8')
          : readFileSync(filePath, { encoding: 'utf-8', flag: 'r' }).slice(0, 1024 * 1024);

        const lines = content.split('\n');
        let currentDep: string | null = null;
        let regionStart = 1; // 1-indexed to match finding line numbers
        const fileDeps = new Set<string>();

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNum1 = i + 1; // 1-indexed line number

          // Check all patterns
          for (const [regex, groupIdx] of [
            [webpackBanner, 1], [jsonParseMeta, 2], [webpackModule, 1], [esbuildBanner, 1],
          ] as [RegExp, number][]) {
            const re = new RegExp(regex.source, regex.flags);
            let m: RegExpExecArray | null;
            while ((m = re.exec(line)) !== null) {
              const depName = m[groupIdx]?.replace(/\/.*$/, ''); // strip sub-paths
              if (depName && depName.length > 1 && depName.length < 80) {
                deps.add(depName);
                fileDeps.add(depName);

                // Close previous region and start new one
                if (currentDep) {
                  this.bundleRegions.set(`${relativePath}:${regionStart}-${lineNum1 - 1}`, currentDep);
                }
                currentDep = depName;
                regionStart = lineNum1;
              }
            }
          }
        }

        // Close final region — extend to end of file (use MAX_SAFE_INTEGER
        // when the scan was truncated so findings beyond the scan are still tagged)
        if (currentDep) {
          const endLine = wasTruncated ? Number.MAX_SAFE_INTEGER : lines.length;
          this.bundleRegions.set(`${relativePath}:${regionStart}-${endLine}`, currentDep);
        }

        // For minified files (very few lines), line-based regions are unreliable
        // because multiple dep markers share the same line — intermediate regions
        // collapse to empty ranges. Replace with a single file-wide region.
        if (fileDeps.size > 0 && lines.length <= 10) {
          for (const key of [...this.bundleRegions.keys()]) {
            if (key.startsWith(`${relativePath}:`)) {
              this.bundleRegions.delete(key);
            }
          }
          const depLabel = fileDeps.size === 1
            ? [...fileDeps][0]
            : `${fileDeps.size} bundled modules`;
          this.bundleRegions.set(`${relativePath}:1-${Number.MAX_SAFE_INTEGER}`, depLabel);
        }
      } catch {
        // Skip unreadable files
      }
    }

    return [...deps].sort();
  }

  /**
   * Look up whether a finding's location falls inside a known bundled dependency region.
   */
  private getBundledDepForLocation(relativePath: string, lineNum: number): string | null {
    for (const [key, dep] of this.bundleRegions) {
      const [file, range] = key.split(':');
      if (file !== relativePath) continue;
      const [start, end] = range.split('-').map(Number);
      if (lineNum >= start && lineNum <= end) return dep;
    }
    return null;
  }

  /**
   * HEAD-request the repository URL. Returns a supply_chain Finding if
   * the repo is unreachable (404, timeout, DNS failure).
   */
  private async verifyRepositoryUrl(rawUrl: string): Promise<Finding | null> {
    // Normalize git+https:// and .git suffix
    let url = rawUrl.replace(/^git\+/, '').replace(/\.git$/, '');
    try {
      new URL(url);
    } catch {
      return null; // Not a valid URL, skip
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(url, { method: 'HEAD', signal: controller.signal, redirect: 'follow' });
      clearTimeout(timeout);

      if (resp.status >= 400) {
        return {
          category: 'supply_chain',
          title: 'Repository URL Unreachable',
          location: 'package.json:repository',
          observation: `Repository URL returned HTTP ${resp.status}. The declared source repo may have been deleted or moved, which is a supply chain risk indicator.`,
          evidence: url,
          lineStart: 0, lineEnd: 0, context: '', isFalsePositive: false, falsePositiveReason: '',
          riskLevel: resp.status === 404 ? 'high' : 'medium',
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('abort')) {
        return {
          category: 'supply_chain',
          title: 'Repository URL Unreachable',
          location: 'package.json:repository',
          observation: `Repository URL timed out after 8s. The declared source repo may be unavailable.`,
          evidence: url,
          lineStart: 0, lineEnd: 0, context: '', isFalsePositive: false, falsePositiveReason: '',
          riskLevel: 'medium',
        };
      }
      // DNS/network errors
      return {
        category: 'supply_chain',
        title: 'Repository URL Unreachable',
        location: 'package.json:repository',
        observation: `Repository URL is unreachable: ${msg}. This could indicate a deleted or hijackable repository.`,
        evidence: url,
        lineStart: 0, lineEnd: 0, context: '', isFalsePositive: false, falsePositiveReason: '',
        riskLevel: 'medium',
      };
    }

    return null;
  }

  /**
   * Extract evidence centered on the match position within a line/chunk.
   * For long lines (minified bundles), centers a 500-char window on the match
   * and trims to semicolons for readability. For short lines, uses surrounding
   * context lines.
   */
  private extractEvidence(text: string, lines: string[] | null, lineNum: number, regex: RegExp): string {
    const re = new RegExp(regex.source, regex.flags);
    const match = re.exec(text);
    const matchIndex = match ? match.index : 0;

    if (text.length > 1000) {
      // Long line / minified: center 500-char window on match
      const halfWindow = 250;
      let start = Math.max(0, matchIndex - halfWindow);
      let end = Math.min(text.length, matchIndex + halfWindow);

      // Expand to nearest semicolons for readability (within 50 chars)
      const semiBeforeStart = text.lastIndexOf(';', start);
      if (semiBeforeStart >= 0 && start - semiBeforeStart < 50) {
        start = semiBeforeStart + 1;
      }
      const semiAfterEnd = text.indexOf(';', end);
      if (semiAfterEnd >= 0 && semiAfterEnd - end < 50) {
        end = semiAfterEnd + 1;
      }

      return text.substring(start, end);
    }

    // Short lines: use surrounding context lines if available
    if (lines) {
      return lines.slice(Math.max(0, lineNum - 2), lineNum + 3).join('\n').slice(0, 500);
    }

    return text.slice(0, 500);
  }

  /**
   * Extract the exact matched substring from the line
   */
  private getMatchHighlight(line: string, pattern: RegExp): string {
    const match = line.match(pattern);
    if (match && match[0]) {
      return match[0].slice(0, 200);
    }
    return '';
  }

  /**
   * Find import/require statements within N lines before the match
   */
  private getNeighboringImports(lines: string[], matchLineNum: number, lookBack: number = 20, maxEntries: number = 10): string {
    const startLine = Math.max(0, matchLineNum - lookBack);
    const precedingLines = lines.slice(startLine, matchLineNum);

    const imports: string[] = [];
    for (const line of precedingLines) {
      // Match require() and import statements
      const requireMatch = line.match(/require\s*\(\s*['"][^'"]+['"]\s*\)/);
      const importMatch = line.match(/^\s*import\s+.*?\s+from\s+['"][^'"]+['"]/);
      const dynamicImport = line.match(/import\s*\(\s*['"][^'"]+['"]\s*\)/);

      if (requireMatch) imports.push(requireMatch[0]);
      if (importMatch) imports.push(importMatch[0]);
      if (dynamicImport) imports.push(dynamicImport[0]);

      if (imports.length >= maxEntries) break;
    }

    return imports.length > 0 ? imports.join('\n') : 'None found';
  }

  /**
   * Match patterns in file content (small files)
   */
  private matchPatternsInContent(content: string, relativePath: string): Finding[] {
    const findings: Finding[] = [];
    const lines = content.split('\n');
    const fileType = this.getFileType(relativePath);
    const isMinified = this.isMinified(content);
    const probableOrigin = this.getProbableOrigin(relativePath);

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      for (const { category, name, definition, regex } of this.compiledPatterns) {
        const re = new RegExp(regex.source, regex.flags);
        if (re.test(line)) {
          findings.push({
            category,
            title: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            location: `${relativePath}:${lineNum + 1}`,
            observation: definition.description,
            evidence: this.extractEvidence(line, lines, lineNum, re),
            lineStart: Math.max(1, lineNum),
            lineEnd: lineNum + 1,
            context: '',
            isFalsePositive: false,
            falsePositiveReason: '',
            riskLevel: definition.risk,
            // Pattern key that matched
            patternName: name,
            // New enhanced fields
            fileType,
            isMinified,
            probableOrigin,
            matchHighlight: this.getMatchHighlight(line, re),
            neighboringImports: this.getNeighboringImports(lines, lineNum),
          });
        }
      }
    }
    return findings;
  }

  /**
   * Match patterns in large files using chunked reading
   */
  private matchPatternsInChunks(filePath: string, relativePath: string): Finding[] {
    const findings: Finding[] = [];
    const CHUNK_SIZE = 512 * 1024;
    const fd = openSync(filePath, 'r');
    let lineNumber = 0;
    let leftover = '';

    // Compute static file metadata once
    const fileType = this.getFileType(relativePath);
    const probableOrigin = this.getProbableOrigin(relativePath);

    try {
      const buffer = Buffer.alloc(CHUNK_SIZE);
      let bytesRead: number;

      while ((bytesRead = readSync(fd, buffer, 0, CHUNK_SIZE, -1)) > 0) {
        const chunk = buffer.toString('utf-8', 0, bytesRead);
        const data = leftover + chunk;
        const lines = data.split('\n');

        // Keep last partial line for next chunk
        leftover = lines.pop() || '';

        for (const line of lines) {
          lineNumber++;

          for (const { category, name, definition, regex } of this.compiledPatterns) {
            const re = new RegExp(regex.source, regex.flags);
            if (re.test(line)) {
              findings.push({
                category,
                title: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                location: `${relativePath}:${lineNumber}`,
                observation: definition.description,
                evidence: this.extractEvidence(line, null, lineNumber, re),
                lineStart: lineNumber,
                lineEnd: lineNumber,
                context: '',
                isFalsePositive: false,
                falsePositiveReason: '',
                riskLevel: definition.risk,
                // Pattern key that matched
                patternName: name,
                // New enhanced fields
                fileType,
                isMinified: false, // Unknown for chunked files
                probableOrigin,
                matchHighlight: this.getMatchHighlight(line, re),
                neighboringImports: 'None found', // Can't reliably compute for chunked files
              });
            }
          }
        }
      }

      // Process remaining line
      if (leftover) {
        lineNumber++;
        for (const { category, name, definition, regex } of this.compiledPatterns) {
          const re = new RegExp(regex.source, regex.flags);
          if (re.test(leftover)) {
            findings.push({
              category,
              title: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
              location: `${relativePath}:${lineNumber}`,
              observation: definition.description,
              evidence: this.extractEvidence(leftover, null, lineNumber, re),
              lineStart: lineNumber,
              lineEnd: lineNumber,
              context: '',
              isFalsePositive: false,
              falsePositiveReason: '',
              riskLevel: definition.risk,
              // Pattern key that matched
              patternName: name,
              // New enhanced fields
              fileType,
              isMinified: false,
              probableOrigin,
              matchHighlight: this.getMatchHighlight(leftover, re),
              neighboringImports: 'None found',
            });
          }
        }
      }
    } finally {
      closeSync(fd);
    }

    return findings;
  }

  /**
   * Extract all endpoints from files
   */
  private extractAllEndpoints(files: string[]): EndpointInfo[] {
    const endpoints: EndpointInfo[] = [];
    const jsFiles = files.filter(f => ['.js', '.mjs', '.ts', '.tsx', '.json'].includes(extname(f)));

    for (const filePath of jsFiles) {
      try {
        const relativePath = relative(this.extensionPath, filePath);
        const fileEndpoints = extractUrlsFromFile(filePath, relativePath);
        endpoints.push(...fileEndpoints);
      } catch {
        // Ignore file read errors
      }
    }
    
    // Deduplicate by URL
    const seen = new Set<string>();
    return endpoints.filter(e => {
      if (seen.has(e.url)) return false;
      seen.add(e.url);
      return true;
    });
  }
  
  /**
   * Generate binary info with hash
   */
  private generateBinaryInfo(filePath: string): BinaryInfo {
    const stats = statSync(filePath);
    return {
      path: relative(this.extensionPath, filePath),
      sha256: getFileHash(filePath),
      size: stats.size,
      architecture: 'unknown',
    };
  }
  
  /**
   * Build file stats by category
   */
  private buildFileStats(fileTypes: FileInfo[]): Record<string, FileStats> {
    const stats: Record<string, FileStats> = {};
    
    for (const file of fileTypes) {
      const cat = file.category;
      if (!stats[cat]) {
        stats[cat] = { count: 0, totalSize: 0 };
      }
      stats[cat].count++;
      stats[cat].totalSize += file.size;
    }
    
    return stats;
  }
  
  /**
   * Find notable dependencies
   */
  private findNotableDependencies(deps: Record<string, string>): Record<string, string> {
    const notable = [
      'posthog-node', 'posthog-js', 'analytics-node', 'mixpanel', 'segment',
      'electron', '@electron/remote', 'node-pty', 'pty.js',
      'ws', 'socket.io', 'socket.io-client',
      'puppeteer', 'playwright', 'keytar',
    ];
    
    const result: Record<string, string> = {};
    for (const [pkg, version] of Object.entries(deps)) {
      if (notable.some(n => pkg.includes(n))) {
        result[pkg] = version;
      }
    }
    return result;
  }
  
  /**
   * Extract telemetry config from package.json
   */
  private extractTelemetryConfig(pkg: Record<string, unknown>): Record<string, unknown> {
    const telemetry: Record<string, unknown> = {};
    
    if (pkg.activationEvents && Array.isArray(pkg.activationEvents)) {
      telemetry.activationEvents = pkg.activationEvents;
    }
    
    return telemetry;
  }
}

/**
 * Extract VSIX file to a temporary directory
 */
export function extractVsix(vsixPath: string, outputDir?: string): string {
  const targetDir = outputDir || `/tmp/vsix_${Date.now()}`;
  
  const zip = new AdmZip(vsixPath);
  zip.extractAllTo(targetDir, true);
  
  // VSIX structure: extension is in 'extension/' subfolder
  const extensionDir = join(targetDir, 'extension');
  return existsSync(extensionDir) ? extensionDir : targetDir;
}
