import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const RECIPES_PREFIX = '/api/v1/recipes';
const TEST_NAME_PREFIX = 'RecipeTest-';
const TEST_ITEM_PREFIX = 'RecipeTestItem-';
const TEST_CUSTOMER_PREFIX = 'RecipeTestCustomer-';
const TEST_USER_EMAIL_DOMAIN = '@recipes-endpoints-users.test';
const BCRYPT_SALT_ROUNDS = 4; // bajo a propósito: velocidad de tests, no seguridad real.

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uniqueName(label: string): string {
  return `${TEST_NAME_PREFIX}${label}-${uniqueSuffix()}`;
}

function uniqueItemName(label: string): string {
  return `${TEST_ITEM_PREFIX}${label}-${uniqueSuffix()}`;
}

function uniqueCustomerName(label: string): string {
  return `${TEST_CUSTOMER_PREFIX}${label}-${uniqueSuffix()}`;
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

interface CreateItemParams {
  name?: string;
  unit?: 'KG' | 'LITROS' | 'UNIDADES' | 'PAQUETES';
}

async function createInventoryItem(params: CreateItemParams = {}) {
  return prisma.inventoryItem.create({
    data: {
      name: params.name ?? uniqueItemName('seed'),
      type: 'ALIMENTO',
      category: 'general',
      stock: 100,
      unit: params.unit ?? 'KG',
      minStock: 5,
      pricePerUnit: 1,
    },
  });
}

interface CreateRecipeParams {
  name?: string;
  ingredients?: Array<{ inventoryItemId: string; quantityNeeded: number }>;
}

async function createRecipe(params: CreateRecipeParams = {}) {
  const ingredients = params.ingredients ?? [{ inventoryItemId: (await createInventoryItem()).id, quantityNeeded: 1 }];
  return prisma.recipe.create({
    data: { name: params.name ?? uniqueName('seed'), ingredients },
  });
}

async function createCustomer() {
  return prisma.customer.create({ data: { name: uniqueCustomerName('seed') } });
}

async function cleanupTestData(): Promise<void> {
  // Orden importa por FKs: OrderItem -> Order primero (cascade desde Order
  // borraría el OrderItem, pero el Order también debe irse); luego Recipe
  // (referenciada por OrderItem.recipeId, sin cascade); luego el resto.
  await prisma.order.deleteMany({
    where: { customer: { name: { startsWith: TEST_CUSTOMER_PREFIX } } },
  });
  await prisma.recipe.deleteMany({ where: { name: { startsWith: TEST_NAME_PREFIX } } });
  await prisma.inventoryItem.deleteMany({ where: { name: { startsWith: TEST_ITEM_PREFIX } } });
  await prisma.customer.deleteMany({ where: { name: { startsWith: TEST_CUSTOMER_PREFIX } } });
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

describe('GET /recipes', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: RECIPES_PREFIX });
    expect(res.statusCode).toBe(401);
  });

  it('permite listar a un usuario autenticado no admin (RBAC: lectura abierta)', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'list-reader' });
    await createRecipe({ name: uniqueName('reader-visible') });

    const res = await app.inject({
      method: 'GET',
      url: RECIPES_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it('lista paginada happy path: data + meta, orden createdAt desc', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'list-admin' });
    // Token compartido por los fixtures de este test: se filtra por él (`q`)
    // para que el orden y el total no dependan de las recipes que otros
    // archivos de test dejen vivas en la DB compartida (corren en paralelo).
    const scope = uniqueSuffix();
    const older = await createRecipe({ name: uniqueName(`older-${scope}`) });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createRecipe({ name: uniqueName(`newer-${scope}`) });

    const res = await app.inject({
      method: 'GET',
      url: `${RECIPES_PREFIX}?page=1&limit=20&q=${encodeURIComponent(scope)}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ page: 1, limit: 20, total: 2 });
    expect(Array.isArray(body.data)).toBe(true);

    const ids: string[] = body.data.map((r: { id: string }) => r.id);
    expect(ids).toEqual([newer.id, older.id]);
  });

  it('pagina correctamente con page/limit', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'paginate-admin' });
    for (let i = 0; i < 3; i += 1) {
      await createRecipe({ name: uniqueName(`page-${i}`) });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const res = await app.inject({
      method: 'GET',
      url: `${RECIPES_PREFIX}?page=1&limit=2`,
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
    const target = await createRecipe({ name: uniqueName('FindMeSpecial') });
    await createRecipe({ name: uniqueName('unrelated') });

    const res = await app.inject({
      method: 'GET',
      url: `${RECIPES_PREFIX}?q=findmespecial`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(target.id);
  });

  it('el DTO de lista trae ingredients (sin populate) junto al resto de campos', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'list-shape-admin' });
    const item = await createInventoryItem();
    await createRecipe({
      name: uniqueName('list-shape'),
      ingredients: [{ inventoryItemId: item.id, quantityNeeded: 3 }],
    });

    const res = await app.inject({
      method: 'GET',
      url: `${RECIPES_PREFIX}?q=list-shape`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data[0].ingredients).toEqual([{ inventoryItemId: item.id, quantityNeeded: 3 }]);
  });
});

describe('GET /recipes/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: `${RECIPES_PREFIX}/some-id` });
    expect(res.statusCode).toBe(401);
  });

  it('happy path: devuelve la receta con ingredients enriquecidos (populate)', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-one' });
    const item = await createInventoryItem({ name: uniqueItemName('populate-target'), unit: 'LITROS' });
    const recipe = await createRecipe({
      name: uniqueName('get-one-target'),
      ingredients: [{ inventoryItemId: item.id, quantityNeeded: 2.5 }],
    });

    const res = await app.inject({
      method: 'GET',
      url: `${RECIPES_PREFIX}/${recipe.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: recipe.id, name: recipe.name });
    expect(body.ingredients).toEqual([
      {
        inventoryItemId: item.id,
        quantityNeeded: 2.5,
        name: item.name,
        unit: item.unit,
      },
    ]);
  });

  it('responde 404 si no existe', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-404' });

    const res = await app.inject({
      method: 'GET',
      url: `${RECIPES_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('POST /recipes', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: RECIPES_PREFIX,
      payload: { name: uniqueName('no-token'), ingredients: [{ inventoryItemId: 'x', quantityNeeded: 1 }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'create-forbidden' });
    const item = await createInventoryItem();

    const res = await app.inject({
      method: 'POST',
      url: RECIPES_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: {
        name: uniqueName('forbidden'),
        ingredients: [{ inventoryItemId: item.id, quantityNeeded: 1 }],
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: crea la receta y devuelve ingredients enriquecidos', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-admin' });
    const item = await createInventoryItem({ name: uniqueItemName('create-target'), unit: 'UNIDADES' });
    const name = uniqueName('created');

    const res = await app.inject({
      method: 'POST',
      url: RECIPES_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name, ingredients: [{ inventoryItemId: item.id, quantityNeeded: 4 }] },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe(name);
    expect(body.ingredients).toEqual([
      { inventoryItemId: item.id, quantityNeeded: 4, name: item.name, unit: item.unit },
    ]);
    expect(typeof body.id).toBe('string');

    const dbRecipe = await prisma.recipe.findUnique({ where: { id: body.id } });
    expect(dbRecipe).not.toBeNull();
    expect(dbRecipe?.ingredients).toEqual([{ inventoryItemId: item.id, quantityNeeded: 4 }]);
  });

  it('responde 400 si falta name', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-400-admin' });
    const item = await createInventoryItem();

    const res = await app.inject({
      method: 'POST',
      url: RECIPES_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { ingredients: [{ inventoryItemId: item.id, quantityNeeded: 1 }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('responde 400 si ingredients está vacío', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-empty-admin' });

    const res = await app.inject({
      method: 'POST',
      url: RECIPES_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { name: uniqueName('empty-ingredients'), ingredients: [] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('responde 400 si quantityNeeded no es positivo', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-negative-admin' });
    const item = await createInventoryItem();

    const res = await app.inject({
      method: 'POST',
      url: RECIPES_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('negative-qty'),
        ingredients: [{ inventoryItemId: item.id, quantityNeeded: 0 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('responde 400 (INVENTORY_ITEM_NOT_FOUND) si un inventoryItemId no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-bad-item-admin' });

    const res = await app.inject({
      method: 'POST',
      url: RECIPES_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('bad-item'),
        ingredients: [{ inventoryItemId: 'non-existent-item-id', quantityNeeded: 1 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVENTORY_ITEM_NOT_FOUND');
    expect(res.json().error.details.missingIds).toContain('non-existent-item-id');
  });

  it('responde 409 si el name ya existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'create-dup-admin' });
    const item = await createInventoryItem();
    const existing = await createRecipe({ name: uniqueName('duplicate') });

    const res = await app.inject({
      method: 'POST',
      url: RECIPES_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: existing.name,
        ingredients: [{ inventoryItemId: item.id, quantityNeeded: 1 }],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('RECIPE_NAME_ALREADY_EXISTS');
  });
});

describe('PUT /recipes/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `${RECIPES_PREFIX}/some-id`,
      payload: { name: 'X', ingredients: [{ inventoryItemId: 'x', quantityNeeded: 1 }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'update-forbidden' });
    const recipe = await createRecipe({ name: uniqueName('update-forbidden-target') });
    const item = await createInventoryItem();

    const res = await app.inject({
      method: 'PUT',
      url: `${RECIPES_PREFIX}/${recipe.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: {
        name: uniqueName('attempted-update'),
        ingredients: [{ inventoryItemId: item.id, quantityNeeded: 1 }],
      },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: reemplaza la receta completa (revalida ingredients)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-admin' });
    const originalItem = await createInventoryItem();
    const newItem = await createInventoryItem({ name: uniqueItemName('update-new'), unit: 'PAQUETES' });
    const recipe = await createRecipe({
      name: uniqueName('before-update'),
      ingredients: [{ inventoryItemId: originalItem.id, quantityNeeded: 1 }],
    });

    const newName = uniqueName('after-update');

    const res = await app.inject({
      method: 'PUT',
      url: `${RECIPES_PREFIX}/${recipe.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: newName,
        ingredients: [{ inventoryItemId: newItem.id, quantityNeeded: 9 }],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ id: recipe.id, name: newName });
    expect(body.ingredients).toEqual([
      { inventoryItemId: newItem.id, quantityNeeded: 9, name: newItem.name, unit: newItem.unit },
    ]);
  });

  it('responde 400 (INVENTORY_ITEM_NOT_FOUND) si el nuevo ingredient no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-bad-item-admin' });
    const recipe = await createRecipe({ name: uniqueName('update-bad-item-target') });

    const res = await app.inject({
      method: 'PUT',
      url: `${RECIPES_PREFIX}/${recipe.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('irrelevant'),
        ingredients: [{ inventoryItemId: 'non-existent-item-id', quantityNeeded: 1 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('INVENTORY_ITEM_NOT_FOUND');
  });

  it('responde 409 si el nuevo name choca con otra receta', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-dup-admin' });
    const item = await createInventoryItem();
    const other = await createRecipe({ name: uniqueName('taken') });
    const recipe = await createRecipe({
      name: uniqueName('update-dup-target'),
      ingredients: [{ inventoryItemId: item.id, quantityNeeded: 1 }],
    });

    const res = await app.inject({
      method: 'PUT',
      url: `${RECIPES_PREFIX}/${recipe.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: other.name,
        ingredients: [{ inventoryItemId: item.id, quantityNeeded: 1 }],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('RECIPE_NAME_ALREADY_EXISTS');
  });

  it('permite conservar el mismo name al actualizar (no choca consigo misma)', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-same-name-admin' });
    const item = await createInventoryItem();
    const recipe = await createRecipe({
      name: uniqueName('keep-name'),
      ingredients: [{ inventoryItemId: item.id, quantityNeeded: 1 }],
    });

    const res = await app.inject({
      method: 'PUT',
      url: `${RECIPES_PREFIX}/${recipe.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: recipe.name,
        ingredients: [{ inventoryItemId: item.id, quantityNeeded: 2 }],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe(recipe.name);
  });

  it('responde 404 si la receta no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'update-404-admin' });
    const item = await createInventoryItem();

    const res = await app.inject({
      method: 'PUT',
      url: `${RECIPES_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: {
        name: uniqueName('irrelevant'),
        ingredients: [{ inventoryItemId: item.id, quantityNeeded: 1 }],
      },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /recipes/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'DELETE', url: `${RECIPES_PREFIX}/some-id` });
    expect(res.statusCode).toBe(401);
  });

  it('responde 403 si el que llama no es admin', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'delete-forbidden' });
    const recipe = await createRecipe({ name: uniqueName('delete-forbidden-target') });

    const res = await app.inject({
      method: 'DELETE',
      url: `${RECIPES_PREFIX}/${recipe.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('happy path: elimina la receta', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'delete-admin' });
    const recipe = await createRecipe({ name: uniqueName('delete-target') });

    const res = await app.inject({
      method: 'DELETE',
      url: `${RECIPES_PREFIX}/${recipe.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(204);

    const dbRecipe = await prisma.recipe.findUnique({ where: { id: recipe.id } });
    expect(dbRecipe).toBeNull();
  });

  it('responde 404 si la receta no existe', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'delete-404-admin' });

    const res = await app.inject({
      method: 'DELETE',
      url: `${RECIPES_PREFIX}/non-existent-id`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('responde 409 (RECIPE_IN_USE) si hay OrderItems que referencian la receta', async () => {
    const admin = await createAuthUser({ role: 'ADMIN', label: 'delete-in-use-admin' });
    const orderUser = await createAuthUser({ role: 'ADMIN', label: 'delete-in-use-order-owner' });
    const customer = await createCustomer();
    const recipe = await createRecipe({ name: uniqueName('in-use-target') });

    await prisma.order.create({
      data: {
        userId: orderUser.id,
        customerId: customer.id,
        items: {
          create: [{ recipeId: recipe.id, recipeName: recipe.name, quantity: 2 }],
        },
      },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `${RECIPES_PREFIX}/${recipe.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('RECIPE_IN_USE');

    const dbRecipe = await prisma.recipe.findUnique({ where: { id: recipe.id } });
    expect(dbRecipe).not.toBeNull();
  });
});
