import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const CUSTOMERS_PREFIX = '/api/v1/customers';
const TEST_NAME_PREFIX = 'CustomersTest-';
const TEST_CUSTOMER_EMAIL_DOMAIN = '@customers-endpoints.test';
const TEST_USER_EMAIL_DOMAIN = '@customers-endpoints-users.test';
const BCRYPT_SALT_ROUNDS = 4; // bajo a propósito: velocidad de tests, no seguridad real.

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uniqueName(label: string): string {
  return `${TEST_NAME_PREFIX}${label}-${uniqueSuffix()}`;
}

function uniqueCustomerEmail(label: string): string {
  return `${label}-${uniqueSuffix()}${TEST_CUSTOMER_EMAIL_DOMAIN}`;
}

function uniqueUserEmail(label: string): string {
  return `${label}-${uniqueSuffix()}${TEST_USER_EMAIL_DOMAIN}`;
}

let app: FastifyInstance;

async function createAuthUser(params: { role: 'ADMIN' | 'USER'; label: string }) {
  const passwordHash = await bcrypt.hash('password123', BCRYPT_SALT_ROUNDS);
  return prisma.user.create({
    data: {
      email: uniqueUserEmail(params.label),
      name: `Auth ${params.label}`,
      role: params.role,
      passwordHash,
    },
  });
}

function tokenFor(user: { id: string; role: 'ADMIN' | 'USER' }): string {
  return app.jwt.sign({ sub: user.id, role: user.role });
}

async function createCustomer(params: { name?: string; email?: string; phone?: string }) {
  return prisma.customer.create({
    data: {
      name: params.name ?? uniqueName('seed'),
      email: params.email,
      phone: params.phone,
    },
  });
}

async function cleanupTestData(): Promise<void> {
  await prisma.customer.deleteMany({
    where: {
      OR: [{ name: { startsWith: TEST_NAME_PREFIX } }, { email: { endsWith: TEST_CUSTOMER_EMAIL_DOMAIN } }],
    },
  });
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_USER_EMAIL_DOMAIN } } });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await cleanupTestData();
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanupTestData();
});

describe('GET /customers', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: CUSTOMERS_PREFIX });
    expect(res.statusCode).toBe(401);
  });

  it('permite listar a un usuario autenticado no admin (RBAC: lectura abierta)', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'list-reader' });
    await createCustomer({ name: uniqueName('reader-visible') });

    const res = await app.inject({
      method: 'GET',
      url: CUSTOMERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('lista paginada happy path: data + meta, orden createdAt desc', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'list-admin' });
    // Token compartido por los fixtures de este test: se filtra por él (`q`)
    // para que el orden y el total no dependan de los customers que otros
    // archivos de test dejen vivos en la DB compartida (corren en paralelo).
    const scope = uniqueSuffix();
    const older = await createCustomer({ name: uniqueName(`older-${scope}`) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createCustomer({ name: uniqueName(`newer-${scope}`) });

    const res = await app.inject({
      method: 'GET',
      url: `${CUSTOMERS_PREFIX}?page=1&limit=20&q=${encodeURIComponent(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
    expect(Array.isArray(body.data)).toBe(true);

    const ids: string[] = body.data.map((c: { id: string }) => c.id);
    expect(ids).toEqual([newer.id, older.id]);
  });

  it('pagina correctamente con page/limit', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'paginate-admin' });
    for (let i = 0; i < 3; i += 1) {
      await createCustomer({ name: uniqueName(`page-${i}`) });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const res = await app.inject({
      method: 'GET',
      url: `${CUSTOMERS_PREFIX}?page=1&limit=2`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({ page: 1, limit: 2 });
    expect(body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('filtra por q en name o email (insensitive contains)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'q-admin' });
    const target = await createCustomer({ name: uniqueName('FindMeSpecial') });
    await createCustomer({ name: uniqueName('unrelated') });

    const res = await app.inject({
      method: 'GET',
      url: `${CUSTOMERS_PREFIX}?q=findmespecial`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(target.id);
  });
});

describe('GET /customers/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: `${CUSTOMERS_PREFIX}/some-id` });
    expect(res.statusCode).toBe(401);
  });

  it('happy path: devuelve el customer', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-one' });
    const customer = await createCustomer({
      name: uniqueName('get-one-target'),
      email: uniqueCustomerEmail('get-one'),
      phone: '555-0001',
    });

    const res = await app.inject({
      method: 'GET',
      url: `${CUSTOMERS_PREFIX}/${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    });
  });

  it('responde 404 si no existe', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-404' });

    const res = await app.inject({
      method: 'GET',
      url: `${CUSTOMERS_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /customers', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: CUSTOMERS_PREFIX,
      payload: { name: uniqueName('no-token') },
    });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'create-forbidden' });

    const res = await app.inject({
      method: 'POST',
      url: CUSTOMERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { name: uniqueName('forbidden') },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: crea el customer (name requerido, email/phone opcionales)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-admin' });
    const name = uniqueName('created');
    const email = uniqueCustomerEmail('created');

    const res = await app.inject({
      method: 'POST',
      url: CUSTOMERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name, email, phone: '555-1234' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ name, email, phone: '555-1234' });
    expect(typeof body.id).toBe('string');

    const dbCustomer = await prisma.customer.findUnique({ where: { id: body.id } });
    expect(dbCustomer).not.toBeNull();
  });

  it('permite crear sin email ni phone', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-minimal-admin' });
    const name = uniqueName('minimal');

    const res = await app.inject({
      method: 'POST',
      url: CUSTOMERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.email).toBeNull();
    expect(body.phone).toBeNull();
  });

  it('responde 400 si falta name', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-400-admin' });

    const res = await app.inject({
      method: 'POST',
      url: CUSTOMERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { email: uniqueCustomerEmail('no-name') },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('responde 400 si el email tiene formato inválido', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-bad-email-admin' });

    const res = await app.inject({
      method: 'POST',
      url: CUSTOMERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: uniqueName('bad-email'), email: 'not-an-email' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('responde 409 si el email ya existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-409-admin' });
    const email = uniqueCustomerEmail('duplicate');
    await createCustomer({ name: uniqueName('existing'), email });

    const res = await app.inject({
      method: 'POST',
      url: CUSTOMERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: uniqueName('new-dup'), email },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CUSTOMER_EMAIL_ALREADY_EXISTS');
  });
});

describe('PUT /customers/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${CUSTOMERS_PREFIX}/some-id`,
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'update-forbidden' });
    const customer = await createCustomer({ name: uniqueName('update-forbidden-target') });

    const res = await app.inject({
      method: 'PUT',
      url: `${CUSTOMERS_PREFIX}/${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { name: uniqueName('attempted-update') },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: reemplaza el customer completo', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-admin' });
    const customer = await createCustomer({
      name: uniqueName('before-update'),
      email: uniqueCustomerEmail('before-update'),
      phone: '555-0000',
    });

    const newName = uniqueName('after-update');
    const newEmail = uniqueCustomerEmail('after-update');

    const res = await app.inject({
      method: 'PUT',
      url: `${CUSTOMERS_PREFIX}/${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: newName, email: newEmail, phone: '555-9999' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: customer.id, name: newName, email: newEmail, phone: '555-9999' });

    const dbCustomer = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(dbCustomer?.name).toBe(newName);
  });

  it('reemplazo completo limpia campos ausentes (email/phone quedan null)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-clear-admin' });
    const customer = await createCustomer({
      name: uniqueName('has-email-phone'),
      email: uniqueCustomerEmail('has-email-phone'),
      phone: '555-0000',
    });

    const res = await app.inject({
      method: 'PUT',
      url: `${CUSTOMERS_PREFIX}/${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: uniqueName('cleared') },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.email).toBeNull();
    expect(body.phone).toBeNull();
  });

  it('responde 404 si el customer no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-404-admin' });

    const res = await app.inject({
      method: 'PUT',
      url: `${CUSTOMERS_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: uniqueName('irrelevant') },
    });

    expect(res.statusCode).toBe(404);
  });

  it('responde 409 si el nuevo email ya lo usa otro customer', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-409-admin' });
    const takenEmail = uniqueCustomerEmail('taken');
    await createCustomer({ name: uniqueName('email-owner'), email: takenEmail });
    const target = await createCustomer({
      name: uniqueName('update-target'),
      email: uniqueCustomerEmail('update-target'),
    });

    const res = await app.inject({
      method: 'PUT',
      url: `${CUSTOMERS_PREFIX}/${target.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: target.name, email: takenEmail },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('CUSTOMER_EMAIL_ALREADY_EXISTS');
  });

  it('permite conservar el mismo email propio sin disparar 409', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-same-email-admin' });
    const email = uniqueCustomerEmail('keep-mine');
    const customer = await createCustomer({ name: uniqueName('keep-mine-target'), email });

    const res = await app.inject({
      method: 'PUT',
      url: `${CUSTOMERS_PREFIX}/${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: uniqueName('keep-mine-renamed'), email },
    });

    expect(res.statusCode).toBe(200);
  });
});

describe('DELETE /customers/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'DELETE', url: `${CUSTOMERS_PREFIX}/some-id` });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'delete-forbidden' });
    const customer = await createCustomer({ name: uniqueName('delete-forbidden-target') });

    const res = await app.inject({
      method: 'DELETE',
      url: `${CUSTOMERS_PREFIX}/${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: elimina el customer', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'delete-admin' });
    const customer = await createCustomer({ name: uniqueName('delete-target') });

    const res = await app.inject({
      method: 'DELETE',
      url: `${CUSTOMERS_PREFIX}/${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(204);

    const dbCustomer = await prisma.customer.findUnique({ where: { id: customer.id } });
    expect(dbCustomer).toBeNull();
  });

  it('responde 404 si el customer no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'delete-404-admin' });

    const res = await app.inject({
      method: 'DELETE',
      url: `${CUSTOMERS_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
