/**
 * SEC-03 — rate limit dedicado en `/auth/*` (OWASP API4:2023 Unrestricted
 * Resource Consumption + API2:2023 Broken Authentication).
 *
 * Verifica que los endpoints sensibles a abuso tengan un umbral propio, más
 * estricto que el global de `app.ts`, y que el 429 resultante respete el
 * envelope de error del proyecto.
 *
 * AISLAMIENTO — el store del rate-limit es in-memory y vive en la instancia de
 * la app, así que un test que dispare el límite contaminaría a los demás. Cada
 * caso manda una `x-forwarded-for` sintética distinta: como la app corre con
 * `trustProxy: true`, el keyGenerator por defecto del plugin (`request.ip`)
 * resuelve esa cabecera y cada test obtiene su propio contador.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { LOGIN_RATE_LIMIT_MAX, REGISTER_RATE_LIMIT_MAX } from '../src/modules/auth/routes.js';

const AUTH_PREFIX = '/api/v1/auth';
const TEST_EMAIL_DOMAIN = '@ratelimit.test';
const WRONG_PASSWORD = 'password-incorrecta';

/**
 * bcrypt (12 rondas) corre una vez por intento de login, así que agotar el
 * umbral es lento a propósito; se amplía el timeout por test.
 */
const SLOW_TEST_TIMEOUT_MS = 30_000;

let app: FastifyInstance;

/** Cabeceras con una IP sintética única por caso (ver nota de AISLAMIENTO). */
function fromIp(octet: number): Record<string, string> {
  return { 'x-forwarded-for': `10.0.0.${octet}` };
}

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}${TEST_EMAIL_DOMAIN}`;
}

/** Un intento de login con credenciales inexistentes (siempre 401 si no hay límite). */
async function attemptLogin(octet: number) {
  return app.inject({
    method: 'POST',
    url: `${AUTH_PREFIX}/login`,
    headers: fromIp(octet),
    payload: { email: uniqueEmail('bruteforce'), password: WRONG_PASSWORD },
  });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { user: { email: { endsWith: TEST_EMAIL_DOMAIN } } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  await app.close();
});

describe('SEC-03 — rate limit de POST /auth/login', () => {
  it(
    'devuelve 429 al superar el umbral de intentos desde la misma IP',
    async () => {
      const octet = 11;

      // Los primeros `max` intentos siguen siendo credenciales inválidas (401).
      for (let i = 0; i < LOGIN_RATE_LIMIT_MAX; i += 1) {
        const res = await attemptLogin(octet);
        expect(res.statusCode).toBe(401);
      }

      // El intento `max + 1` ya no llega al handler: lo corta el rate limit.
      const blocked = await attemptLogin(octet);
      expect(blocked.statusCode).toBe(429);
      // El umbral anunciado es el de la ruta, no el global de `app.ts`.
      expect(Number(blocked.headers['x-ratelimit-limit'])).toBe(LOGIN_RATE_LIMIT_MAX);
      expect(blocked.headers['retry-after']).toBeDefined();
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'no afecta a otra IP: el contador es por cliente, no global',
    async () => {
      const attacker = 12;
      const innocent = 13;

      for (let i = 0; i < LOGIN_RATE_LIMIT_MAX + 1; i += 1) {
        await attemptLogin(attacker);
      }
      // Sanity check: la IP del atacante quedó efectivamente bloqueada.
      expect((await attemptLogin(attacker)).statusCode).toBe(429);

      // Un cliente legítimo desde otra IP sigue recibiendo la respuesta normal.
      const other = await attemptLogin(innocent);
      expect(other.statusCode).toBe(401);
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'la respuesta 429 respeta el envelope de error del proyecto y no filtra internals',
    async () => {
      const octet = 14;

      for (let i = 0; i < LOGIN_RATE_LIMIT_MAX; i += 1) {
        await attemptLogin(octet);
      }
      const blocked = await attemptLogin(octet);

      expect(blocked.statusCode).toBe(429);
      const body = blocked.json() as { error: { code: string; message: string } };
      expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(typeof body.error.message).toBe('string');
      // Sin stack traces ni rutas internas (mismo criterio que security.test.ts).
      expect(blocked.body).not.toContain('at Object.');
      expect(blocked.body).not.toContain('node_modules');
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});

describe('SEC-03 — rate limit de POST /auth/register', () => {
  it(
    'tiene su propio contador: agotar login no bloquea register desde la misma IP',
    async () => {
      const octet = 15;

      for (let i = 0; i < LOGIN_RATE_LIMIT_MAX + 1; i += 1) {
        await attemptLogin(octet);
      }
      expect((await attemptLogin(octet)).statusCode).toBe(429);

      const res = await app.inject({
        method: 'POST',
        url: `${AUTH_PREFIX}/register`,
        headers: fromIp(octet),
        payload: { email: uniqueEmail('register-ok'), password: 'password123', name: 'Rate Limit' },
      });

      expect(res.statusCode).toBe(201);
      expect(Number(res.headers['x-ratelimit-limit'])).toBe(REGISTER_RATE_LIMIT_MAX);
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});
