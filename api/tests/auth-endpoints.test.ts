/**
 * NOTA (SEC-03): `/auth/register` tiene rate limit por-ruta (`REGISTER_RATE_LIMIT_MAX`,
 * ver `src/modules/auth/routes.ts`) y todos los `inject` de este archivo comparten la
 * misma IP por defecto (127.0.0.1) contra la misma instancia de app. Hoy el archivo
 * hace 9 registros, justo por debajo del umbral. Si se añaden más casos que registren
 * usuarios, aislarlos mandando una cabecera `x-forwarded-for` propia (la app corre con
 * `trustProxy: true`), como hace `auth-ratelimit.test.ts` — nunca subiendo el umbral.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { REFRESH_COOKIE_NAME } from '../src/plugins/auth.js';

const AUTH_PREFIX = '/api/v1/auth';
const TEST_EMAIL_DOMAIN = '@auth-endpoints.test';

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

function extractRefreshCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
  if (!cookie) {
    throw new Error('No se encontró la cookie de refresh en la respuesta');
  }
  return cookie.value;
}

async function findRefreshTokensForUser(userId: string) {
  return prisma.refreshToken.findMany({ where: { userId }, orderBy: { expiresAt: 'asc' } });
}

let app: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
});

describe('POST /auth/register', () => {
  it('registra un usuario nuevo y devuelve 201 con user, accessToken y cookie de refresh', async () => {
    const email = uniqueEmail('register-ok');
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'Ada Lovelace' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user).toEqual({ id: expect.any(String), email, name: 'Ada Lovelace', role: 'USER' });
    expect(body.user.passwordHash).toBeUndefined();
    expect(typeof body.accessToken).toBe('string');

    const cookie = res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
    expect(cookie).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.path).toBe('/api/v1/auth');

    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.passwordHash).not.toBe('password123');
  });

  it('responde 409 si el email ya está registrado', async () => {
    const email = uniqueEmail('register-dup');
    await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'Primero' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'Segundo' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBeTruthy();
  });

  it('responde 400 si la contraseña tiene menos de 8 caracteres', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email: uniqueEmail('register-weak'), password: 'short', name: 'Débil' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /auth/login', () => {
  it('responde 401 genérico si el email no existe', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/login`,
      payload: { email: uniqueEmail('login-missing'), password: 'password123' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).not.toMatch(/no existe|not found/i);
  });

  it('responde 401 genérico si la contraseña es incorrecta', async () => {
    const email = uniqueEmail('login-badpass');
    await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'Login Test' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/login`,
      payload: { email, password: 'wrong-password' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('login happy path devuelve 200 con user, accessToken y cookie de refresh', async () => {
    const email = uniqueEmail('login-ok');
    await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'Login Ok' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/login`,
      payload: { email, password: 'password123' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.email).toBe(email);
    expect(typeof body.accessToken).toBe('string');
    expect(res.cookies.find((c) => c.name === REFRESH_COOKIE_NAME)).toBeTruthy();
  });
});

describe('POST /auth/refresh', () => {
  it('responde 401 si falta la cookie de refresh', async () => {
    const res = await app.inject({ method: 'POST', url: `${AUTH_PREFIX}/refresh` });
    expect(res.statusCode).toBe(401);
  });

  it('rota el refresh token: emite uno nuevo y revoca (revokedAt no nulo) el anterior en DB', async () => {
    const email = uniqueEmail('refresh-rotation');
    const registerRes = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'Rotation Test' },
    });
    const userId = registerRes.json().user.id as string;
    const originalCookieValue = extractRefreshCookie(registerRes);

    const tokensBefore = await findRefreshTokensForUser(userId);
    expect(tokensBefore).toHaveLength(1);
    expect(tokensBefore[0]?.revokedAt).toBeNull();

    const refreshRes = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/refresh`,
      cookies: { [REFRESH_COOKIE_NAME]: originalCookieValue },
    });

    expect(refreshRes.statusCode).toBe(200);
    expect(typeof refreshRes.json().accessToken).toBe('string');
    const newCookieValue = extractRefreshCookie(refreshRes);
    expect(newCookieValue).not.toBe(originalCookieValue);

    const tokensAfter = await findRefreshTokensForUser(userId);
    expect(tokensAfter).toHaveLength(2);
    const original = tokensAfter.find((t) => t.id === tokensBefore[0]?.id);
    expect(original?.revokedAt).not.toBeNull();
    const rotated = tokensAfter.find((t) => t.id !== tokensBefore[0]?.id);
    expect(rotated?.revokedAt).toBeNull();
  });

  it('responde 401 al reutilizar un refresh token ya rotado/revocado', async () => {
    const email = uniqueEmail('refresh-reuse');
    const registerRes = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'Reuse Test' },
    });
    const originalCookieValue = extractRefreshCookie(registerRes);

    await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/refresh`,
      cookies: { [REFRESH_COOKIE_NAME]: originalCookieValue },
    });

    const reuseRes = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/refresh`,
      cookies: { [REFRESH_COOKIE_NAME]: originalCookieValue },
    });

    expect(reuseRes.statusCode).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revoca el refresh token en DB y limpia la cookie, respondiendo 204', async () => {
    const email = uniqueEmail('logout-ok');
    const registerRes = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'Logout Test' },
    });
    const userId = registerRes.json().user.id as string;
    const cookieValue = extractRefreshCookie(registerRes);

    const logoutRes = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/logout`,
      cookies: { [REFRESH_COOKIE_NAME]: cookieValue },
    });

    expect(logoutRes.statusCode).toBe(204);
    const clearedCookie = logoutRes.cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
    expect(clearedCookie?.value).toBe('');

    const [token] = await findRefreshTokensForUser(userId);
    expect(token?.revokedAt).not.toBeNull();
  });
});
