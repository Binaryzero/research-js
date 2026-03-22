import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
