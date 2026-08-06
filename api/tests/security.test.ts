/**
 * QA de seguridad — batería de pruebas basada en los checklists de las skills
 * instaladas (`testing-jwt-token-security`, `testing-api-for-broken-object-level-authorization`,
 * `testing-api-security-with-owasp-top-10`) mapeados a OWASP API Security Top 10 (2023).
 *
 * Cada `describe` corresponde a una categoría OWASP. Las aserciones expresan el
 * comportamiento SEGURO esperado: un test que falla = hallazgo de seguridad real
 * que debe resolverse (ver PENDING.md). Los tests que pasan confirman que el
 * control ya está implementado correctamente.
 *
 * Se ejecuta contra la instancia real de Fastify (`buildApp()` + `app.inject()`),
 * mismo patrón que el resto de la suite de integración.
 */
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { env } from '../src/config/env.js';

const AUTH_PREFIX = '/api/v1/auth';
const TEST_EMAIL_DOMAIN = '@security.test';
const TEST_DATA_PREFIX = 'SecTest-';

let app: FastifyInstance;

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Forja un JWT a mano (sin librería) para los ataques del skill de JWT:
 * - `alg: 'none'` con firma vacía (algorithm none attack).
 * - firma HS256 con un secreto arbitrario (wrong key).
 * `exp` opcional en segundos epoch.
 */
function forgeJwt(
  payload: Record<string, unknown>,
  opts: { alg: 'none' | 'HS256'; secret?: string; exp?: number },
): string {
  const header = base64url(JSON.stringify({ alg: opts.alg, typ: 'JWT' }));
  const body = base64url(JSON.stringify(opts.exp ? { ...payload, exp: opts.exp } : payload));
  const signingInput = `${header}.${body}`;
  if (opts.alg === 'none') {
    return `${signingInput}.`;
  }
  const signature = createHmac('sha256', opts.secret ?? '')
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}

async function createUser(role: 'ADMIN' | 'USER', label: string) {
  return prisma.user.create({
    data: {
      email: `${label}-${uniqueSuffix()}${TEST_EMAIL_DOMAIN}`,
      name: `${TEST_DATA_PREFIX}${label}`,
      role,
      // Hash irrelevante para estos tests (no se prueba login por password acá).
      passwordHash: 'x'.repeat(60),
    },
  });
}

function tokenFor(user: { id: string; role: 'ADMIN' | 'USER' }): string {
  return app.jwt.sign({ sub: user.id, role: user.role });
}

/** Crea una orden directa en DB perteneciente a `userId` (sin pasar por POST /orders). */
async function createOrderOwnedBy(userId: string, customerId: string) {
  return prisma.order.create({
    data: { userId, customerId, status: 'PENDIENTE', total: 0 },
  });
}

async function createCustomer(label: string) {
  return prisma.customer.create({
    data: { name: `${TEST_DATA_PREFIX}${label}-${uniqueSuffix()}` },
  });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  // Limpieza: borra todo lo creado por estos tests (orders → users/customers).
  await prisma.order.deleteMany({ where: { customer: { name: { startsWith: TEST_DATA_PREFIX } } } });
  await prisma.customer.deleteMany({ where: { name: { startsWith: TEST_DATA_PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  await app.close();
});

/* ------------------------------------------------------------------ *
 * OWASP API2:2023 — Broken Authentication / JWT (testing-jwt-token-security)
 * ------------------------------------------------------------------ */
describe('API2 Broken Authentication — JWT', () => {
  it('rechaza un token forjado con alg=none (algorithm none attack)', async () => {
    const user = await createUser('USER', 'algnone');
    // Token con alg=none y firma vacía, escalando role a ADMIN en los claims.
    const forged = forgeJwt({ sub: user.id, role: 'ADMIN' }, { alg: 'none' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${forged}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rechaza un token con firma manipulada (tampered signature)', async () => {
    const user = await createUser('USER', 'tampered');
    const valid = tokenFor(user);
    // Muta el último carácter de la firma para invalidarla.
    const tampered = valid.slice(0, -1) + (valid.at(-1) === 'a' ? 'b' : 'a');

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${tampered}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rechaza un token firmado con otro secreto (wrong key)', async () => {
    const user = await createUser('USER', 'wrongkey');
    const forged = forgeJwt({ sub: user.id, role: 'ADMIN' }, { alg: 'HS256', secret: 'otro-secreto-atacante' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${forged}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rechaza un token expirado', async () => {
    const user = await createUser('USER', 'expired');
    const expired = forgeJwt(
      { sub: user.id, role: 'USER' },
      { alg: 'HS256', secret: env.JWT_SECRET, exp: Math.floor(Date.now() / 1000) - 60 }, // ya expirado
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: { authorization: `Bearer ${expired}` },
    });

    expect(res.statusCode).toBe(401);
  });

  it('rechaza acceso sin token a una ruta protegida', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/orders' });
    expect(res.statusCode).toBe(401);
  });

  it('rechaza un Authorization header malformado', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/orders',
      headers: { authorization: 'Bearer no-es-un-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });
});

/* ------------------------------------------------------------------ *
 * OWASP API5:2023 — Broken Function Level Authorization (RBAC / BFLA)
 * ------------------------------------------------------------------ */
describe('API5 Broken Function Level Authorization — RBAC', () => {
  it('un USER no puede crear inventory (solo ADMIN escribe)', async () => {
    const user = await createUser('USER', 'bfla-inv');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/inventory',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { name: 'x', type: 'ALIMENTO', category: 'c', stock: 1, unit: 'KG', minStock: 1, pricePerUnit: 1 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un USER no puede crear customers', async () => {
    const user = await createUser('USER', 'bfla-cust');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un USER no puede listar usuarios (endpoint admin)', async () => {
    const user = await createUser('USER', 'bfla-users');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('un USER no puede cambiar el rol de otro usuario (escalada de privilegios)', async () => {
    const attacker = await createUser('USER', 'bfla-escalate');
    const victim = await createUser('USER', 'bfla-victim');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/users/${victim.id}/role`,
      headers: { authorization: `Bearer ${tokenFor(attacker)}` },
      payload: { role: 'ADMIN' },
    });
    expect(res.statusCode).toBe(403);
  });
});

/* ------------------------------------------------------------------ *
 * OWASP API1:2023 — Broken Object Level Authorization (BOLA / IDOR)
 * (testing-api-for-broken-object-level-authorization)
 * ------------------------------------------------------------------ */
describe('API1 Broken Object Level Authorization — Orders', () => {
  it('un USER no debe poder LEER la orden de otro usuario por id', async () => {
    const owner = await createUser('USER', 'bola-owner-read');
    const attacker = await createUser('USER', 'bola-attacker-read');
    const customer = await createCustomer('bola-read');
    const order = await createOrderOwnedBy(owner.id, customer.id);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/orders/${order.id}`,
      headers: { authorization: `Bearer ${tokenFor(attacker)}` },
    });

    // Seguro: 403 (o 404 para no filtrar existencia). Inseguro: 200 con la orden ajena.
    expect([403, 404]).toContain(res.statusCode);
  });

  it('el listado de orders no debe exponer las órdenes de otros usuarios', async () => {
    const owner = await createUser('USER', 'bola-owner-list');
    const attacker = await createUser('USER', 'bola-attacker-list');
    const customer = await createCustomer('bola-list');
    const order = await createOrderOwnedBy(owner.id, customer.id);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/orders?limit=100',
      headers: { authorization: `Bearer ${tokenFor(attacker)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Array<{ id: string; userId: string }> };
    const leaked = body.data.some((o) => o.id === order.id);
    // Seguro: el atacante NO ve la orden de otro. Inseguro: la ve (tenancy rota).
    expect(leaked).toBe(false);
  });

  it('un USER no debe poder MODIFICAR el estado de la orden de otro usuario', async () => {
    const owner = await createUser('USER', 'bola-owner-patch');
    const attacker = await createUser('USER', 'bola-attacker-patch');
    const customer = await createCustomer('bola-patch');
    const order = await createOrderOwnedBy(owner.id, customer.id);

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/orders/${order.id}/status`,
      headers: { authorization: `Bearer ${tokenFor(attacker)}` },
      payload: { status: 'CANCELADO' },
    });

    expect([403, 404]).toContain(res.statusCode);
  });
});

/* ------------------------------------------------------------------ *
 * OWASP API3:2023 — Broken Object Property Level Authorization (mass assignment)
 * ------------------------------------------------------------------ */
describe('API3 Mass Assignment — register', () => {
  it('no permite escalar rol vía campo role en el body de register', async () => {
    const email = `massassign-${uniqueSuffix()}${TEST_EMAIL_DOMAIN}`;
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'Mass Assign', role: 'ADMIN' },
    });

    expect(res.statusCode).toBe(201);
    const created = await prisma.user.findUnique({ where: { email } });
    // El role inyectado en el body debe ignorarse; el usuario nace como USER.
    expect(created?.role).toBe('USER');
  });

  it('nunca devuelve passwordHash en la respuesta de register', async () => {
    const email = `nohash-${uniqueSuffix()}${TEST_EMAIL_DOMAIN}`;
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/register`,
      payload: { email, password: 'password123', name: 'No Hash' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.body).not.toContain('passwordHash');
    expect(res.body).not.toContain('x'.repeat(20));
  });
});

/* ------------------------------------------------------------------ *
 * OWASP API8:2023 — Security Misconfiguration (info disclosure / headers)
 * ------------------------------------------------------------------ */
describe('API8 Security Misconfiguration', () => {
  it('aplica cabeceras de seguridad de helmet (p.ej. X-Content-Type-Options)', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('una ruta inexistente devuelve 404 sin filtrar stack trace', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/ruta-que-no-existe' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('at Object.');
    expect(res.body).not.toContain('node_modules');
  });

  /**
   * SEC-07 — El fallback de `shared/error-handler.ts` hardcodeaba `reply.code(500)`
   * e ignoraba `error.statusCode`, así que cualquier error nativo de Fastify que no
   * fuera `AppError`/`ZodError`/Prisma/`error.validation` degradaba a 500 y se
   * logueaba a nivel `error` como "Error no controlado" (ruido de logs que puede
   * enmascarar incidentes reales, además de romper la semántica 4xx/5xx).
   */
  it('un body con JSON malformado devuelve 400, no 500 (SEC-07)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/login`,
      // IP sintética propia: `/auth/login` tiene rate-limit dedicado (5/min por
      // IP, Fase QA-2) y el store es in-memory compartido en la instancia de
      // app; aislar la IP evita que estos tests se estorben entre sí.
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.0.1' },
      payload: '{"email": "roto",,,}',
    });

    expect(res.statusCode).toBe(400);

    const body = res.json() as { error?: { code?: string; message?: string } };
    expect(body.error).toBeDefined();
    expect(typeof body.error?.code).toBe('string');
    expect(typeof body.error?.message).toBe('string');
    expect(body.error?.code).not.toBe('INTERNAL_ERROR');
  });

  it('la respuesta a un JSON malformado no filtra stack traces ni rutas internas (SEC-07)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/login`,
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.0.2' },
      payload: '{"email": "roto",,,}',
    });

    expect(res.body).not.toContain('at Object.');
    expect(res.body).not.toContain('node_modules');
    expect(res.body).not.toContain('/src/');
  });

  it('un content-type no JSON sigue devolviendo 400 por validación (no regresión)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `${AUTH_PREFIX}/login`,
      headers: { 'content-type': 'text/plain', 'x-forwarded-for': '10.1.0.3' },
      payload: 'no soy json',
    });

    expect(res.statusCode).toBe(400);

    const body = res.json() as { error?: { code?: string } };
    expect(body.error?.code).toBeDefined();
    expect(body.error?.code).not.toBe('INTERNAL_ERROR');
  });
});
