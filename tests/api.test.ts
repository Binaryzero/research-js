import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// Mock saveAppConfig so POST /api/config doesn't overwrite the real config.json
vi.mock('../src/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config.js')>();
  return {
    ...actual,
    saveAppConfig: vi.fn(),
  };
});

import { createServer } from '../src/index.js';
import type { FastifyInstance } from 'fastify';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('API Endpoints', () => {
  let server: FastifyInstance;
  
  beforeAll(async () => {
    const result = await createServer();
    server = result.fastify;
  });
  
  afterAll(async () => {
    await server.close();
  });
  
  describe('Health Check', () => {
    it('GET /health should return ok', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/health',
      });
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
    });
  });
  
  describe('Models API', () => {
    it('GET /api/models should return array', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/models',
      });
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.models)).toBe(true);
    });
  });
  
  describe('Reports API', () => {
    it('GET /api/reports should return array', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/reports',
      });
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.reports)).toBe(true);
    });
  });
  
  describe('History API', () => {
    it('GET /api/history should return scans object', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/history',
      });
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(typeof body.scans).toBe('object');
      expect(typeof body.total).toBe('number');
    });
  });
  
  describe('Prompts API', () => {
    it('GET /api/prompts should return prompts config', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/prompts',
      });
      
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.prompts).toBeDefined();
      expect(body.prompts.version).toMatch(/^\d+\.\d+$/); // e.g., "1.0", "1.3"
    });
  });
  
  describe('Search API', () => {
    it('POST /api/search should accept form data', async () => {
      const formData = new URLSearchParams();
      formData.append('search_text', 'python');
      formData.append('page', '1');
      
      const response = await server.inject({
        method: 'POST',
        url: '/api/search',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });
      
      // Should not return 404 or 500
      expect(response.statusCode).toBeLessThan(500);
    });
  });

  describe('Config API', () => {
    it('GET /api/config should return config', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/config',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.main).toBeDefined();
      expect(body.assessmentMode).toBeDefined();
    });

    it('POST /api/config should save config', async () => {
      const config = {
        version: '1',
        main: {
          id: 'main',
          label: 'Main',
          enabled: true,
          provider: 'ollama',
          model: 'llama3.2',
          baseUrl: 'http://localhost:11434',
          timeout: 180000,
          maxTokens: 32000,
          temperature: 0.3,
        },
        judges: [],
        consensus: { judgesValidateAllFindings: false },
        assessmentMode: 'strategic',
        promptProfile: 'default',
        concurrency: 10,
        defaultNoLlm: false,
        defaultFull: false,
      };
      const response = await server.inject({
        method: 'POST',
        url: '/api/config',
        payload: config,
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.saved).toBe(true);
    });

    it('POST /api/config should reject missing main', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/config',
        payload: { judges: [] },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Connection Test', () => {
    it('POST /api/test-connection should handle unreachable endpoint', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/test-connection',
        payload: { baseUrl: 'http://localhost:19999', model: 'test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toBeDefined();
      // Should indicate failure since nothing is listening on that port
      expect(body.ok).toBe(false);
      expect(body.error).toBeDefined();
    });

    it('POST /api/test-connection should reject missing baseUrl', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/test-connection',
        payload: { model: 'test' },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('baseUrl required');
    });
  });

  describe('Scan Cancel', () => {
    it('DELETE /api/scan/:scanId should return 404 for unknown scan', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/scan/nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('not found');
    });
  });
});

describe('Pattern Matching', () => {
  const patternsPath = join(__dirname, '..', 'docs', 'patterns.yaml');

  it('should load patterns from YAML', async () => {
    const { loadPatterns } = await import('../src/analyzer/patterns.js');
    const patterns = loadPatterns(patternsPath);

    expect(patterns.version).toBeDefined();
    expect(patterns.supply_chain).toBeDefined();
    expect(patterns.permission_abuse).toBeDefined();
  });
});

describe('Scoring', () => {
  it('should calculate correct risk labels', async () => {
    const { getRiskLabel, getRiskColor } = await import('../src/analyzer/scoring.js');
    
    expect(getRiskLabel(60)).toBe('Very Suspicious');
    expect(getRiskLabel(40)).toBe('Suspicious');
    expect(getRiskLabel(20)).toBe('Moderate');
    expect(getRiskLabel(5)).toBe('Low Risk');
    
    expect(getRiskColor(60)).toBe('red');
    expect(getRiskColor(40)).toBe('orange');
    expect(getRiskColor(20)).toBe('yellow');
    expect(getRiskColor(5)).toBe('green');
  });
});
