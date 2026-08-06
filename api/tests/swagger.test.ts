import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

describe('GET /docs (Swagger UI + OpenAPI)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /docs responde 200 con HTML', async () => {
    const response = await request(app.server).get('/docs').expect(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('swagger-ui');
  });

  it('GET /docs/json responde 200 con el spec OpenAPI', async () => {
    const response = await request(app.server).get('/docs/json').expect(200);

    expect(response.body).toHaveProperty('openapi');
    expect(response.body.info).toMatchObject({ title: 'mini-erp-api' });
    expect(response.body.paths).toHaveProperty('/api/v1/auth/register');
    expect(response.body.paths).toHaveProperty('/api/v1/inventory/');
  });

  it('define los security schemes bearerAuth y la cookie de refresh', async () => {
    const response = await request(app.server).get('/docs/json').expect(200);
    const schemes = response.body.components.securitySchemes;

    expect(schemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(schemes.refreshTokenCookie).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'refresh_token',
    });
  });

  it('captura los schemas Zod de las rutas ya existentes en el spec', async () => {
    const response = await request(app.server).get('/docs/json').expect(200);
    const registerOp = response.body.paths['/api/v1/auth/register'].post;

    expect(registerOp.requestBody).toBeDefined();
    expect(response.body.paths).toHaveProperty('/api/v1/users/');
    expect(response.body.paths).toHaveProperty('/api/v1/customers/');
    expect(response.body.paths).toHaveProperty('/api/v1/suppliers/');
  });

  it('es público (no requiere auth)', async () => {
    await request(app.server).get('/docs').expect(200);
    await request(app.server).get('/docs/json').expect(200);
  });
});
