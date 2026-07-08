import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from '../src/index.js';
import type { FastifyInstance } from 'fastify';
import { readdirSync } from 'fs';

describe('Upload API', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    const result = await createServer();
    server = result.fastify;
  });

  afterAll(async () => {
    await server.close();
  });

  it('should handle file upload using multipart/form-data', async () => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.vsix"',
      'Content-Type: application/octet-stream',
      '',
      'dummy vsix content',
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const response = await server.inject({
      method: 'POST',
      url: '/api/scan',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(response.statusCode).toBe(200);
    const result = JSON.parse(response.body);
    expect(result.scan_id).toBeDefined();
  });

  it('should handle concurrent uploads without directory collisions', async () => {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="test.vsix"',
      'Content-Type: application/octet-stream',
      '',
      'dummy vsix content',
      `--${boundary}--`,
      ''
    ].join('\r\n');

    // Fire multiple uploads concurrently
    const promises = Array.from({ length: 5 }).map(() =>
      server.inject({
        method: 'POST',
        url: '/api/scan',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload: body,
      })
    );

    const responses = await Promise.all(promises);
    responses.forEach(response => {
      expect(response.statusCode).toBe(200);
      const result = JSON.parse(response.body);
      expect(result.scan_id).toBeDefined();
    });
  });
});
