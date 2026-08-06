import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../src/plugins/auth.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.after();
  app.post('/test/me', { onRequest: [app.authenticate] }, async (request) => ({
    user: { id: request.user.sub, role: request.user.role },
  }));
  app.post('/test/admin', { onRequest: [app.requireRole('ADMIN')] }, async () => ({ ok: true }));
  app.get('/test/refresh-cookie', async (_request, reply) => {
    setRefreshCookie(reply, 'token-de-prueba');
    return { ok: true };
  });
  app.get('/test/clear-cookie', async (_request, reply) => {
    clearRefreshCookie(reply);
    return { ok: true };
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('decorator authenticate', () => {
  it('rechaza petición sin token con 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/test/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Token de acceso inválido o expirado' },
    });
  });

  it('rechaza token inválido con 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/test/me',
      headers: { authorization: 'Bearer token-invalido' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('deja pasar token válido y expone request.user', async () => {
    const token = app.jwt.sign({ sub: 'user-123', role: 'USER' });
    const res = await app.inject({
      method: 'POST',
      url: '/test/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ user: { id: 'user-123', role: 'USER' } });
  });
});

describe('decorator requireRole', () => {
  it('rechaza con 403 a usuario sin el rol', async () => {
    const token = app.jwt.sign({ sub: 'user-123', role: 'USER' });
    const res = await app.inject({
      method: 'POST',
      url: '/test/admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'No tienes permisos para esta acción' },
    });
  });

  it('deja pasar a admin', async () => {
    const token = app.jwt.sign({ sub: 'admin-1', role: 'ADMIN' });
    const res = await app.inject({
      method: 'POST',
      url: '/test/admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('cookie de refresh', () => {
  it('se setea firmada con HttpOnly, SameSite=strict y path /api/v1/auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/refresh-cookie' });
    expect(res.statusCode).toBe(200);
    const setCookie = res.headers['set-cookie'] as string | string[];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(raw).toBeTruthy();
    expect(raw).toContain(`${REFRESH_COOKIE_NAME}=`);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Strict');
    expect(raw).toContain('Path=/api/v1/auth');
    expect(raw).not.toContain('Secure');
  });

  it('se limpia en logout', async () => {
    const res = await app.inject({ method: 'GET', url: '/test/clear-cookie' });
    const setCookie = res.headers['set-cookie'] as string | string[];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(raw).toContain('refresh_token=');
    expect(raw).toContain('Max-Age=0');
  });
});
