import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const INVENTORY_PREFIX = '/api/v1/inventory';
const TEST_NAME_PREFIX = 'InventoryTest-';
const TEST_SUPPLIER_PREFIX = 'InventoryTestSupplier-';
const TEST_USER_EMAIL_DOMAIN = '@inventory-endpoints-users.test';
const BCRYPT_SALT_ROUNDS = 4; // bajo a propósito: velocidad de tests, no seguridad real.

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uniqueName(label: string): string {
  return `${TEST_NAME_PREFIX}${label}-${uniqueSuffix()}`;
}

function uniqueSupplierName(label: string): string {
  return `${TEST_SUPPLIER_PREFIX}${label}-${uniqueSuffix()}`;
}

function uniqueUserEmail(label: string): string {
  return `${label}-${uniqueSuffix()}${TEST_USER_EMAIL_DOMAIN}`;
}

/**
 * Categoría única por test, usada como "namespace" de sus propios fixtures.
 * Vitest corre los archivos de test en paralelo contra la misma base de datos,
 * así que un listado sin acotar devuelve también los `InventoryItem` que otros
 * archivos tengan vivos en ese instante (p. ej. `analytics.test.ts` crea uno
 * con `stock < minStock` de tipo `ALIMENTO`). Los tests de `GET /inventory`
 * añaden `?category=<scope>` a la query — filtro exacto que compone con el
 * resto, incluido el camino raw de `lowStock` — para que sus aserciones de
 * longitud/orden dependan solo de lo que ellos mismos crearon.
 */
function uniqueCategory(label: string): string {
  return `${TEST_NAME_PREFIX}cat-${label}-${uniqueSuffix()}`;
}

function categoryParam(scope: string): string {
  return `category=${encodeURIComponent(scope)}`;
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

async function createSupplier(params: { name?: string } = {}) {
  return prisma.supplier.create({
    data: { name: params.name ?? uniqueSupplierName('seed') },
  });
}

interface CreateItemParams {
  name?: string;
  type?: 'ALIMENTO' | 'SUMINISTRO';
  category?: string;
  stock?: number;
  unit?: 'KG' | 'LITROS' | 'UNIDADES' | 'PAQUETES';
  minStock?: number;
  pricePerUnit?: number;
  supplierId?: string;
}

async function createItem(params: CreateItemParams = {}) {
  return prisma.inventoryItem.create({
    data: {
      name: params.name ?? uniqueName('seed'),
      type: params.type ?? 'ALIMENTO',
      category: params.category ?? 'general',
      stock: params.stock ?? 10,
      unit: params.unit ?? 'KG',
      minStock: params.minStock ?? 5,
      pricePerUnit: params.pricePerUnit ?? 1,
      supplierId: params.supplierId,
    },
  });
}

async function cleanupTestData(): Promise<void> {
  await prisma.inventoryItem.deleteMany({ where: { name: { startsWith: TEST_NAME_PREFIX } } });
  await prisma.supplier.deleteMany({ where: { name: { startsWith: TEST_SUPPLIER_PREFIX } } });
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

describe('GET /inventory', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: INVENTORY_PREFIX });
    expect(res.statusCode).toBe(401);
  });

  it('permite listar a un usuario autenticado no admin (RBAC: lectura abierta)', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'list-reader' });
    await createItem({ name: uniqueName('reader-visible') });

    const res = await app.inject({
      method: 'GET',
      url: INVENTORY_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('lista paginada happy path: data + meta, orden createdAt desc', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'list-admin' });
    const scope = uniqueCategory('list');
    const older = await createItem({ name: uniqueName('older'), category: scope });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createItem({ name: uniqueName('newer'), category: scope });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?page=1&limit=20&${categoryParam(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
    expect(Array.isArray(body.data)).toBe(true);

    const ids: string[] = body.data.map((i: { id: string }) => i.id);
    expect(ids).toEqual([newer.id, older.id]);
  });

  it('pagina correctamente con page/limit', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'paginate-admin' });
    const scope = uniqueCategory('paginate');
    for (let i = 0; i < 3; i += 1) {
      await createItem({ name: uniqueName(`page-${i}`), category: scope });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?page=1&limit=2&${categoryParam(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({ page: 1, limit: 2, total: 3 });
  });

  it('filtra por q en name (insensitive contains)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'q-admin' });
    const scope = uniqueCategory('q');
    const target = await createItem({ name: uniqueName('FindMeSpecial'), category: scope });
    await createItem({ name: uniqueName('unrelated'), category: scope });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?q=findmespecial&${categoryParam(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(target.id);
  });

  it('filtra por category exacto', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'category-admin' });
    const categoryTag = uniqueSuffix();
    const target = await createItem({ name: uniqueName('cat-match'), category: `lacteos-${categoryTag}` });
    await createItem({ name: uniqueName('cat-miss'), category: `carnes-${categoryTag}` });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?category=${encodeURIComponent(`lacteos-${categoryTag}`)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(target.id);
  });

  it('filtra por type exacto', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'type-admin' });
    const scope = uniqueCategory('type');
    const target = await createItem({ name: uniqueName('type-match'), type: 'SUMINISTRO', category: scope });
    await createItem({ name: uniqueName('type-miss'), type: 'ALIMENTO', category: scope });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?type=SUMINISTRO&${categoryParam(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: target.id, type: 'SUMINISTRO' });
  });

  it('responde 400 con type inválido', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'type-invalid-admin' });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?type=NOPE`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it('filtra por supplierId exacto', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'supplier-admin' });
    const supplier = await createSupplier();
    const otherSupplier = await createSupplier();
    const target = await createItem({ name: uniqueName('supplier-match'), supplierId: supplier.id });
    await createItem({ name: uniqueName('supplier-miss'), supplierId: otherSupplier.id });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?supplierId=${supplier.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(target.id);
  });

  it('filtra por lowStock=true: solo items con stock <= minStock', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'lowstock-admin' });
    const scope = uniqueCategory('lowstock');
    const low = await createItem({ name: uniqueName('low'), stock: 2, minStock: 5, category: scope });
    const exact = await createItem({ name: uniqueName('exact'), stock: 5, minStock: 5, category: scope });
    const healthy = await createItem({ name: uniqueName('healthy'), stock: 20, minStock: 5, category: scope });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?lowStock=true&${categoryParam(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    const ids: string[] = body.data.map((i: { id: string }) => i.id);
    expect(ids).toContain(low.id);
    expect(ids).toContain(exact.id);
    expect(ids).not.toContain(healthy.id);
  });

  it('lowStock=false (o ausente) no aplica el filtro', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'lowstock-false-admin' });
    const scope = uniqueCategory('lowstock-false');
    const healthy = await createItem({
      name: uniqueName('healthy-visible'),
      stock: 20,
      minStock: 5,
      category: scope,
    });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?lowStock=false&${categoryParam(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids: string[] = body.data.map((i: { id: string }) => i.id);
    expect(ids).toContain(healthy.id);
  });

  it('combina 2+ filtros a la vez (type + lowStock)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'combo-admin' });
    const scope = uniqueCategory('combo');
    const matchLowAlimento = await createItem({
      name: uniqueName('combo-match'),
      type: 'ALIMENTO',
      stock: 1,
      minStock: 5,
      category: scope,
    });
    // mismo type pero stock sano: no debe matchear lowStock
    await createItem({
      name: uniqueName('combo-miss-healthy'),
      type: 'ALIMENTO',
      stock: 20,
      minStock: 5,
      category: scope,
    });
    // low stock pero otro type: no debe matchear el filtro de type
    await createItem({
      name: uniqueName('combo-miss-type'),
      type: 'SUMINISTRO',
      stock: 1,
      minStock: 5,
      category: scope,
    });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}?type=ALIMENTO&lowStock=true&${categoryParam(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(matchLowAlimento.id);
  });
});

describe('GET /inventory/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: `${INVENTORY_PREFIX}/some-id` });
    expect(res.statusCode).toBe(401);
  });

  it('happy path: devuelve el item', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-one' });
    const item = await createItem({ name: uniqueName('get-one-target') });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}/${item.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: item.id, name: item.name, category: item.category });
  });

  it('responde 404 si no existe', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-404' });

    const res = await app.inject({
      method: 'GET',
      url: `${INVENTORY_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /inventory', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: INVENTORY_PREFIX,
      payload: { name: uniqueName('no-token'), type: 'ALIMENTO', category: 'general', unit: 'KG' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'create-forbidden' });

    const res = await app.inject({
      method: 'POST',
      url: INVENTORY_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { name: uniqueName('forbidden'), type: 'ALIMENTO', category: 'general', unit: 'KG' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: crea el item con defaults (stock 0, minStock 5, pricePerUnit 0)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-admin' });
    const name = uniqueName('created');

    const res = await app.inject({
      method: 'POST',
      url: INVENTORY_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name, type: 'ALIMENTO', category: 'general', unit: 'KG' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      name,
      type: 'ALIMENTO',
      category: 'general',
      unit: 'KG',
      stock: 0,
      minStock: 5,
      pricePerUnit: 0,
      supplierId: null,
    });
    expect(typeof body.id).toBe('string');

    const dbItem = await prisma.inventoryItem.findUnique({ where: { id: body.id } });
    expect(dbItem).not.toBeNull();
  });

  it('crea el item con supplierId válido', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-supplier-admin' });
    const supplier = await createSupplier();

    const res = await app.inject({
      method: 'POST',
      url: INVENTORY_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('with-supplier'),
        type: 'SUMINISTRO',
        category: 'limpieza',
        unit: 'UNIDADES',
        supplierId: supplier.id,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().supplierId).toBe(supplier.id);
  });

  it('responde 400 si supplierId no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-bad-supplier-admin' });

    const res = await app.inject({
      method: 'POST',
      url: INVENTORY_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('bad-supplier'),
        type: 'ALIMENTO',
        category: 'general',
        unit: 'KG',
        supplierId: 'non-existent-supplier-id',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('responde 400 si falta name', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-400-admin' });

    const res = await app.inject({
      method: 'POST',
      url: INVENTORY_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { type: 'ALIMENTO', category: 'general', unit: 'KG' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('responde 400 si type es inválido', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-badtype-admin' });

    const res = await app.inject({
      method: 'POST',
      url: INVENTORY_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: uniqueName('bad-type'), type: 'NOPE', category: 'general', unit: 'KG' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('responde 400 si stock es negativo', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-negative-admin' });

    const res = await app.inject({
      method: 'POST',
      url: INVENTORY_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('negative-stock'),
        type: 'ALIMENTO',
        category: 'general',
        unit: 'KG',
        stock: -1,
      },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /inventory/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${INVENTORY_PREFIX}/some-id`,
      payload: { name: 'X', type: 'ALIMENTO', category: 'general', unit: 'KG' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'update-forbidden' });
    const item = await createItem({ name: uniqueName('update-forbidden-target') });

    const res = await app.inject({
      method: 'PUT',
      url: `${INVENTORY_PREFIX}/${item.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: {
        name: uniqueName('attempted-update'),
        type: 'ALIMENTO',
        category: 'general',
        unit: 'KG',
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: reemplaza el item completo', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-admin' });
    const supplier = await createSupplier();
    const item = await createItem({
      name: uniqueName('before-update'),
      type: 'ALIMENTO',
      category: 'general',
      stock: 5,
      unit: 'KG',
    });

    const newName = uniqueName('after-update');

    const res = await app.inject({
      method: 'PUT',
      url: `${INVENTORY_PREFIX}/${item.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: newName,
        type: 'SUMINISTRO',
        category: 'limpieza',
        stock: 42,
        unit: 'LITROS',
        minStock: 10,
        pricePerUnit: 3.5,
        supplierId: supplier.id,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      id: item.id,
      name: newName,
      type: 'SUMINISTRO',
      category: 'limpieza',
      stock: 42,
      unit: 'LITROS',
      minStock: 10,
      pricePerUnit: 3.5,
      supplierId: supplier.id,
    });
  });

  it('reemplazo completo limpia supplierId ausente (queda null)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-clear-admin' });
    const supplier = await createSupplier();
    const item = await createItem({
      name: uniqueName('has-supplier'),
      supplierId: supplier.id,
    });

    const res = await app.inject({
      method: 'PUT',
      url: `${INVENTORY_PREFIX}/${item.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('cleared'),
        type: 'ALIMENTO',
        category: 'general',
        unit: 'KG',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().supplierId).toBeNull();
  });

  it('responde 400 si supplierId no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-bad-supplier-admin' });
    const item = await createItem({ name: uniqueName('update-bad-supplier-target') });

    const res = await app.inject({
      method: 'PUT',
      url: `${INVENTORY_PREFIX}/${item.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('irrelevant'),
        type: 'ALIMENTO',
        category: 'general',
        unit: 'KG',
        supplierId: 'non-existent-supplier-id',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('responde 404 si el item no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-404-admin' });

    const res = await app.inject({
      method: 'PUT',
      url: `${INVENTORY_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('irrelevant'),
        type: 'ALIMENTO',
        category: 'general',
        unit: 'KG',
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /inventory/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'DELETE', url: `${INVENTORY_PREFIX}/some-id` });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'delete-forbidden' });
    const item = await createItem({ name: uniqueName('delete-forbidden-target') });

    const res = await app.inject({
      method: 'DELETE',
      url: `${INVENTORY_PREFIX}/${item.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: elimina el item', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'delete-admin' });
    const item = await createItem({ name: uniqueName('delete-target') });

    const res = await app.inject({
      method: 'DELETE',
      url: `${INVENTORY_PREFIX}/${item.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(204);

    const dbItem = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    expect(dbItem).toBeNull();
  });

  it('responde 404 si el item no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'delete-404-admin' });

    const res = await app.inject({
      method: 'DELETE',
      url: `${INVENTORY_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
