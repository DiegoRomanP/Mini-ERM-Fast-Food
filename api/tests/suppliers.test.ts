import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const SUPPLIERS_PREFIX = '/api/v1/suppliers';
const TEST_NAME_PREFIX = 'SuppliersTest-';
const TEST_USER_EMAIL_DOMAIN = '@suppliers-endpoints-users.test';
const BCRYPT_SALT_ROUNDS = 4; // bajo a propósito: velocidad de tests, no seguridad real.

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uniqueName(label: string): string {
  return `${TEST_NAME_PREFIX}${label}-${uniqueSuffix()}`;
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

async function createSupplier(params: { name?: string; contact?: string }) {
  return prisma.supplier.create({
    data: {
      name: params.name ?? uniqueName('seed'),
      contact: params.contact,
    },
  });
}

async function cleanupTestData(): Promise<void> {
  await prisma.supplier.deleteMany({ where: { name: { startsWith: TEST_NAME_PREFIX } } });
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

describe('GET /suppliers', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: SUPPLIERS_PREFIX });
    expect(res.statusCode).toBe(401);
  });

  it('permite listar a un usuario autenticado no admin (RBAC: lectura abierta)', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'list-reader' });
    await createSupplier({ name: uniqueName('reader-visible') });

    const res = await app.inject({
      method: 'GET',
      url: SUPPLIERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('lista paginada happy path: data + meta, orden createdAt desc', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'list-admin' });
    // Token compartido por los fixtures de este test: se filtra por él (`q`)
    // para que el orden y el total no dependan de los suppliers que otros
    // archivos de test dejen vivos en la DB compartida (corren en paralelo).
    const scope = uniqueSuffix();
    const older = await createSupplier({ name: uniqueName(`older-${scope}`) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createSupplier({ name: uniqueName(`newer-${scope}`) });

    const res = await app.inject({
      method: 'GET',
      url: `${SUPPLIERS_PREFIX}?page=1&limit=20&q=${encodeURIComponent(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
    expect(Array.isArray(body.data)).toBe(true);

    const ids: string[] = body.data.map((s: { id: string }) => s.id);
    expect(ids).toEqual([newer.id, older.id]);
  });

  it('pagina correctamente con page/limit', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'paginate-admin' });
    for (let i = 0; i < 3; i += 1) {
      await createSupplier({ name: uniqueName(`page-${i}`) });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const res = await app.inject({
      method: 'GET',
      url: `${SUPPLIERS_PREFIX}?page=1&limit=2`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({ page: 1, limit: 2 });
    expect(body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('filtra por q en name (insensitive contains)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'q-admin' });
    const target = await createSupplier({ name: uniqueName('FindMeSpecial') });
    await createSupplier({ name: uniqueName('unrelated') });

    const res = await app.inject({
      method: 'GET',
      url: `${SUPPLIERS_PREFIX}?q=findmespecial`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(target.id);
  });
});

describe('GET /suppliers/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: `${SUPPLIERS_PREFIX}/some-id` });
    expect(res.statusCode).toBe(401);
  });

  it('happy path: devuelve el supplier', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-one' });
    const supplier = await createSupplier({
      name: uniqueName('get-one-target'),
      contact: 'contacto-555-0001',
    });

    const res = await app.inject({
      method: 'GET',
      url: `${SUPPLIERS_PREFIX}/${supplier.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: supplier.id,
      name: supplier.name,
      contact: supplier.contact,
    });
  });

  it('responde 404 si no existe', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-404' });

    const res = await app.inject({
      method: 'GET',
      url: `${SUPPLIERS_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /suppliers', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: SUPPLIERS_PREFIX,
      payload: { name: uniqueName('no-token') },
    });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'create-forbidden' });

    const res = await app.inject({
      method: 'POST',
      url: SUPPLIERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { name: uniqueName('forbidden') },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: crea el supplier (name requerido, contact opcional)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-admin' });
    const name = uniqueName('created');

    const res = await app.inject({
      method: 'POST',
      url: SUPPLIERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name, contact: 'contacto-555-1234' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ name, contact: 'contacto-555-1234' });
    expect(typeof body.id).toBe('string');

    const dbSupplier = await prisma.supplier.findUnique({ where: { id: body.id } });
    expect(dbSupplier).not.toBeNull();
  });

  it('permite crear sin contact', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-minimal-admin' });
    const name = uniqueName('minimal');

    const res = await app.inject({
      method: 'POST',
      url: SUPPLIERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.contact).toBeNull();
  });

  it('responde 400 si falta name', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-400-admin' });

    const res = await app.inject({
      method: 'POST',
      url: SUPPLIERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { contact: 'contacto-no-name' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('permite crear dos suppliers con el mismo name (sin restricción de unicidad)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-dup-admin' });
    const name = uniqueName('duplicable');

    const first = await app.inject({
      method: 'POST',
      url: SUPPLIERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name },
    });
    const second = await app.inject({
      method: 'POST',
      url: SUPPLIERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().id).not.toBe(second.json().id);
  });
});

describe('PUT /suppliers/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${SUPPLIERS_PREFIX}/some-id`,
      payload: { name: 'X' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'update-forbidden' });
    const supplier = await createSupplier({ name: uniqueName('update-forbidden-target') });

    const res = await app.inject({
      method: 'PUT',
      url: `${SUPPLIERS_PREFIX}/${supplier.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { name: uniqueName('attempted-update') },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: reemplaza el supplier completo', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-admin' });
    const supplier = await createSupplier({
      name: uniqueName('before-update'),
      contact: 'contacto-555-0000',
    });

    const newName = uniqueName('after-update');

    const res = await app.inject({
      method: 'PUT',
      url: `${SUPPLIERS_PREFIX}/${supplier.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: newName, contact: 'contacto-555-9999' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: supplier.id, name: newName, contact: 'contacto-555-9999' });

    const dbSupplier = await prisma.supplier.findUnique({ where: { id: supplier.id } });
    expect(dbSupplier?.name).toBe(newName);
  });

  it('reemplazo completo limpia campos ausentes (contact queda null)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-clear-admin' });
    const supplier = await createSupplier({
      name: uniqueName('has-contact'),
      contact: 'contacto-555-0000',
    });

    const res = await app.inject({
      method: 'PUT',
      url: `${SUPPLIERS_PREFIX}/${supplier.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: uniqueName('cleared') },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.contact).toBeNull();
  });

  it('responde 404 si el supplier no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-404-admin' });

    const res = await app.inject({
      method: 'PUT',
      url: `${SUPPLIERS_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: uniqueName('irrelevant') },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /suppliers/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'DELETE', url: `${SUPPLIERS_PREFIX}/some-id` });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'delete-forbidden' });
    const supplier = await createSupplier({ name: uniqueName('delete-forbidden-target') });

    const res = await app.inject({
      method: 'DELETE',
      url: `${SUPPLIERS_PREFIX}/${supplier.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: elimina el supplier', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'delete-admin' });
    const supplier = await createSupplier({ name: uniqueName('delete-target') });

    const res = await app.inject({
      method: 'DELETE',
      url: `${SUPPLIERS_PREFIX}/${supplier.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(204);

    const dbSupplier = await prisma.supplier.findUnique({ where: { id: supplier.id } });
    expect(dbSupplier).toBeNull();
  });

  it('responde 404 si el supplier no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'delete-404-admin' });

    const res = await app.inject({
      method: 'DELETE',
      url: `${SUPPLIERS_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
