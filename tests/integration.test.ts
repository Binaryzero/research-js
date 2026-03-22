/** @vitest-environment node */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from '../src/index.js';
import type { FastifyInstance } from 'fastify';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { StaticAnalyzer } from '../src/analyzer/static.js';
import { calculateSuspicionScore } from '../src/analyzer/scoring.js';
const fs = { readdirSync };

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = join(__dirname, '..', '.temp-test');
const HISTORY_DIR = join(TEMP_DIR, 'reports');
const HISTORY_FILE = join(HISTORY_DIR, 'scan_history.json');

describe('Integration: Full Scan Flow', () => {
  let server: FastifyInstance;
  
  beforeEach(async () => {
    // Create temp directory for tests
    if (!existsSync(HISTORY_DIR)) {
      mkdirSync(HISTORY_DIR, { recursive: true });
    }
    const result = await createServer({
      historyFile: HISTORY_FILE,
      reportsDir: HISTORY_DIR,
      patternsFile: join(process.cwd(), 'docs', 'patterns.yaml'),
    });
    server = result.fastify;
  });
  
  afterEach(async () => {
    await server.close();
    // Clean up temp directory
    if (existsSync(TEMP_DIR)) {
      rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  });
  
  it('should save report file after scan', async () => {
    // Create a test extension directory
    const testDir = '/tmp/test-report-save';
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    
    writeFileSync(join(testDir, 'package.json'), JSON.stringify({
      name: 'test-report-save',
      version: '1.0.0',
      publisher: 'test',
    }));
    writeFileSync(join(testDir, 'test.js'), '// test file');
    
    // Scan the local directory
    const scanResponse = await server.inject({
      method: 'POST',
      url: '/api/scan',
      payload: { input_source: testDir, no_llm: 'true' },
    });
    
    expect(scanResponse.statusCode).toBe(200);
    const scanBody = JSON.parse(scanResponse.body);
    expect(scanBody.scan_id).toBeDefined();
    
    // Poll for completion
    let attempts = 0;
    let scanResult;
    while (attempts < 20) {
      const resultResponse = await server.inject({
        method: 'GET',
        url: `/api/scan/${scanBody.scan_id}/result`,
      });
      scanResult = JSON.parse(resultResponse.body);
      
      if (scanResult.status === 'complete' || scanResult.status === 'failed') break;
      await new Promise(r => setTimeout(r, 500));
      attempts++;
    }
    
    expect(scanResult.status).toBe('complete');
    expect(scanResult.result).toBeDefined();
    expect(scanResult.result.extensionId).toBe('test.test-report-save');
    
    // Check report was saved
    const reportFiles = fs.readdirSync(HISTORY_DIR).filter(f => f.endsWith('.md'));
    expect(reportFiles.length).toBeGreaterThan(0);
    
    // Clean up
    rmSync(testDir, { recursive: true, force: true });
  }, 30000);
});

describe('Integration: Search and History', () => {
  let server: FastifyInstance;
  
  beforeEach(async () => {
    if (!existsSync(HISTORY_DIR)) {
      mkdirSync(HISTORY_DIR, { recursive: true });
    }
    const result = await createServer({
      historyFile: HISTORY_FILE,
      reportsDir: HISTORY_DIR,
      patternsFile: join(process.cwd(), 'docs', 'patterns.yaml'),
    });
    server = result.fastify;
  });
  
  afterEach(async () => {
    await server.close();
    if (existsSync(TEMP_DIR)) {
      rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  });
  
  it('should search marketplace extensions', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/search',
      payload: {
        search_text: 'test',
        page: 1,
        page_size: 5,
      },
    });
    
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
  });
  
  it('should return empty search when no results', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/search',
      payload: {
        search_text: 'this-query-returns-no-results-12345',
        page: 1,
        page_size: 5,
      },
    });
    
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    
    // Should return empty array, not error
    expect(body.results).toBeDefined();
    expect(Array.isArray(body.results)).toBe(true);
  });
});

describe('Integration: Pattern Matching', () => {
  it('should match patterns in extension code', async () => {
    // Verify pattern compilation works
    const { compilePattern } = await import('../src/analyzer/patterns.js');
    
    const definition = {
      pattern: 'testEvalPattern',
      flags: 'NONE',
      description: 'Test eval pattern',
      risk: 'critical',
    };
    
    const regex = compilePattern(definition);
    expect(regex).toBeDefined();
    expect(regex.test('testEvalPattern')).toBe(true);
    expect(regex.test('noMatchHere')).toBe(false);
  });
});

describe('Integration: Scoring System', () => {
  it('should score extensions correctly', async () => {
    // Create a test extension with known patterns
    const testDir = '/tmp/test-scorer';
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    
    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test-scorer',
        version: '1.0.0',
        publisher: 'test',
      })
    );
    
    writeFileSync(
      join(testDir, 'activator.js'),
      `
      const vscode = require('vscode');
      // Critical: eval
      eval(userInput);
      // Critical: Function constructor
      new Function("return 1");
      // High: File write
      require('fs').writeFileSync('/tmp/test', 'data');
      // Medium: fetch
      fetch('https://api.example.com');
      // Low: terminal
      vscode.window.createTerminal();
      `
    );
    
    try {
      const analyzer = new StaticAnalyzer(testDir, { verbose: false });
      const result = analyzer.analyze();
      
      const [score, breakdown] = calculateSuspicionScore(result);
      
      // Should have multiple findings
      expect(result.findings.length).toBeGreaterThan(0);
      
      // Score should be > 0
      expect(score).toBeGreaterThan(0);
      
      // Should detect critical findings
      expect(breakdown.details.critical).toBeGreaterThanOrEqual(1);
    } finally {
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    }
  });
});
