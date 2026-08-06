import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 con status ok', async () => {
    const response = await request(app.server).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
  });

  it('incluye uptime y timestamp', async () => {
    const response = await request(app.server).get('/health').expect(200);
    expect(typeof response.body.uptime).toBe('number');
    expect(typeof response.body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
  });

  it('es público (no requiere auth)', async () => {
    const response = await request(app.server).get('/health').expect(200);
    expect(response.body).toHaveProperty('status', 'ok');
  });
});
