import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const USERS_PREFIX = '/api/v1/users';
const TEST_EMAIL_DOMAIN = '@users-endpoints.test';
const BCRYPT_SALT_ROUNDS = 4; // bajo a propósito: velocidad de tests, no seguridad real.

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uniqueEmail(label: string): string {
  return `${label}-${uniqueSuffix()}${TEST_EMAIL_DOMAIN}`;
}

let app: FastifyInstance;

async function createUser(params: { email: string; name: string; role: 'ADMIN' | 'USER' }) {
  const passwordHash = await bcrypt.hash('password123', BCRYPT_SALT_ROUNDS);
  return prisma.user.create({
    data: { email: params.email, name: params.name, role: params.role, passwordHash },
  });
}

function tokenFor(user: { id: string; role: 'ADMIN' | 'USER' }): string {
  return app.jwt.sign({ sub: user.id, role: user.role });
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  await app.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
});

describe('GET /users', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: USERS_PREFIX });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createUser({ email: uniqueEmail('list-forbidden'), name: 'No Admin', role: 'USER' });

    const res = await app.inject({
      method: 'GET',
      url: USERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('lista paginada happy path: data + meta, sin passwordHash, orden createdAt desc', async () => {
    // Token compartido por los fixtures de este test: se filtra por él (`q`)
    // para que el orden y el total no dependan de los usuarios que otros
    // archivos de test dejen vivos en la DB compartida (corren en paralelo);
    // la tabla `User` la escriben todos los archivos, no solo este.
    const scope = uniqueSuffix();
    const admin = await createUser({
      email: uniqueEmail('list-admin'),
      name: `Admin One ${scope}`,
      role: 'ADMIN',
    });
    const older = await createUser({
      email: uniqueEmail('list-older'),
      name: `Older User ${scope}`,
      role: 'USER',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createUser({
      email: uniqueEmail('list-newer'),
      name: `Newer User ${scope}`,
      role: 'USER',
    });

    const res = await app.inject({
      method: 'GET',
      url: `${USERS_PREFIX}?page=1&limit=20&q=${encodeURIComponent(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 3 });
    expect(Array.isArray(body.data)).toBe(true);

    // `admin` y `older` se crean sin pausa entre medio, así que su orden
    // relativo no se asserta; lo que verifica el orden `createdAt desc` es la
    // pareja `newer`/`older`, separada a propósito por unos milisegundos.
    const emails: string[] = body.data.map((u: { email: string }) => u.email);
    expect(emails).toHaveLength(3);
    expect(emails).toContain(admin.email);
    expect(emails.indexOf(newer.email)).toBeLessThan(emails.indexOf(older.email));

    for (const item of body.data) {
      expect(item.passwordHash).toBeUndefined();
    }
    const adminEntry = body.data.find((u: { id: string }) => u.id === admin.id);
    expect(adminEntry).toMatchObject({ id: admin.id, email: admin.email, name: admin.name, role: 'ADMIN' });
    expect(typeof adminEntry.createdAt).toBe('string');
    expect(typeof adminEntry.updatedAt).toBe('string');
  });

  it('filtra por q en name o email (insensitive contains)', async () => {
    const admin = await createUser({ email: uniqueEmail('q-admin'), name: 'Admin Q', role: 'ADMIN' });
    const target = await createUser({
      email: uniqueEmail('zzz-target'),
      name: 'FindMeSpecial',
      role: 'USER',
    });
    await createUser({ email: uniqueEmail('unrelated'), name: 'Someone Else', role: 'USER' });

    const res = await app.inject({
      method: 'GET',
      url: `${USERS_PREFIX}?q=findmespecial`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(target.id);
  });
});

describe('PATCH /users/:id/role', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'PATCH', url: `${USERS_PREFIX}/some-id/role`, payload: { role: 'ADMIN' } });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const caller = await createUser({ email: uniqueEmail('patch-forbidden'), name: 'Not Admin', role: 'USER' });
    const target = await createUser({ email: uniqueEmail('patch-target'), name: 'Target', role: 'USER' });

    const res = await app.inject({
      method: 'PATCH',
      url: `${USERS_PREFIX}/${target.id}/role`,
      headers: { authorization: `Bearer ${tokenFor(caller)}` },
      payload: { role: 'ADMIN' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: actualiza el rol y devuelve el UserDto actualizado', async () => {
    const admin = await createUser({ email: uniqueEmail('patch-admin'), name: 'Admin Patch', role: 'ADMIN' });
    const target = await createUser({ email: uniqueEmail('patch-ok'), name: 'Promote Me', role: 'USER' });

    const res = await app.inject({
      method: 'PATCH',
      url: `${USERS_PREFIX}/${target.id}/role`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { role: 'ADMIN' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: target.id, email: target.email, role: 'ADMIN' });
    expect(body.passwordHash).toBeUndefined();

    const dbUser = await prisma.user.findUnique({ where: { id: target.id } });
    expect(dbUser?.role).toBe('ADMIN');
  });

  it('responde 404 si el usuario no existe', async () => {
    const admin = await createUser({ email: uniqueEmail('patch-404-admin'), name: 'Admin 404', role: 'ADMIN' });

    const res = await app.inject({
      method: 'PATCH',
      url: `${USERS_PREFIX}/non-existent-id/role`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { role: 'ADMIN' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('responde 400 si role no es un valor válido', async () => {
    const admin = await createUser({ email: uniqueEmail('patch-400-admin'), name: 'Admin 400', role: 'ADMIN' });
    const target = await createUser({ email: uniqueEmail('patch-400-target'), name: 'Target 400', role: 'USER' });

    const res = await app.inject({
      method: 'PATCH',
      url: `${USERS_PREFIX}/${target.id}/role`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { role: 'SUPERADMIN' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
