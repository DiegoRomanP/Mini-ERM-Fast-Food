import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const ORDERS_PREFIX = '/api/v1/orders';
const TEST_RECIPE_PREFIX = 'OrderTestRecipe-';
const TEST_ITEM_PREFIX = 'OrderTestItem-';
const TEST_CUSTOMER_PREFIX = 'OrderTestCustomer-';
const TEST_USER_EMAIL_DOMAIN = '@orders-create-users.test';
const BCRYPT_SALT_ROUNDS = 4; // bajo a propósito: velocidad de tests, no seguridad real.

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function uniqueRecipeName(label: string): string {
  return `${TEST_RECIPE_PREFIX}${label}-${uniqueSuffix()}`;
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
  stock?: number;
  pricePerUnit?: number;
}

async function createInventoryItem(params: CreateItemParams = {}) {
  return prisma.inventoryItem.create({
    data: {
      name: params.name ?? uniqueItemName('seed'),
      type: 'ALIMENTO',
      category: 'general',
      stock: params.stock ?? 100,
      unit: 'KG',
      minStock: 5,
      pricePerUnit: params.pricePerUnit ?? 1,
    },
  });
}

interface CreateRecipeParams {
  name?: string;
  ingredients: Array<{ inventoryItemId: string; quantityNeeded: number }>;
}

async function createRecipe(params: CreateRecipeParams) {
  return prisma.recipe.create({
    data: { name: params.name ?? uniqueRecipeName('seed'), ingredients: params.ingredients },
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
  await prisma.recipe.deleteMany({ where: { name: { startsWith: TEST_RECIPE_PREFIX } } });
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

describe('POST /orders', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: ORDERS_PREFIX,
      payload: { customerId: 'some-id', items: [{ recipeId: 'some-recipe', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('happy path: crea la orden, calcula el total correctamente (acumulando insumos compartidos entre recetas) y descuenta el stock exacto', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'happy-path' });
    const customer = await createCustomer();

    const itemA = await createInventoryItem({ name: uniqueItemName('A'), stock: 100, pricePerUnit: 2 });
    const itemB = await createInventoryItem({ name: uniqueItemName('B'), stock: 50, pricePerUnit: 5 });

    // recipe1 y recipe2 comparten itemA para verificar que el requerimiento
    // se acumula entre líneas (paso 3 del PLAN), no se sobreescribe.
    const recipe1 = await createRecipe({
      name: uniqueRecipeName('recipe1'),
      ingredients: [
        { inventoryItemId: itemA.id, quantityNeeded: 3 },
        { inventoryItemId: itemB.id, quantityNeeded: 1 },
      ],
    });
    const recipe2 = await createRecipe({
      name: uniqueRecipeName('recipe2'),
      ingredients: [{ inventoryItemId: itemA.id, quantityNeeded: 2 }],
    });

    const res = await app.inject({
      method: 'POST',
      url: ORDERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: {
        customerId: customer.id,
        items: [
          { recipeId: recipe1.id, quantity: 2 },
          { recipeId: recipe2.id, quantity: 3 },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    expect(body.userId).toBe(user.id);
    expect(body.customerId).toBe(customer.id);
    expect(body.status).toBe('PENDIENTE');
    // recipe1Cost = 3*2 + 1*5 = 11; *2 = 22
    // recipe2Cost = 2*2 = 4; *3 = 12
    // total = 34
    expect(body.total).toBe(34);
    expect(body.items).toHaveLength(2);
    expect(body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ recipeId: recipe1.id, recipeName: recipe1.name, quantity: 2 }),
        expect.objectContaining({ recipeId: recipe2.id, recipeName: recipe2.name, quantity: 3 }),
      ]),
    );

    // itemA requerido: (3*2) + (2*3) = 12 -> 100 - 12 = 88
    // itemB requerido: (1*2) = 2 -> 50 - 2 = 48
    const dbItemA = await prisma.inventoryItem.findUnique({ where: { id: itemA.id } });
    const dbItemB = await prisma.inventoryItem.findUnique({ where: { id: itemB.id } });
    expect(dbItemA?.stock).toBe(88);
    expect(dbItemB?.stock).toBe(48);

    const dbOrder = await prisma.order.findUnique({ where: { id: body.id }, include: { items: true } });
    expect(dbOrder).not.toBeNull();
    expect(dbOrder?.total).toBe(34);
    expect(dbOrder?.items).toHaveLength(2);
  });

  it('responde 404 (CUSTOMER_NOT_FOUND) si customerId no existe', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'customer-404' });
    const item = await createInventoryItem();
    const recipe = await createRecipe({
      ingredients: [{ inventoryItemId: item.id, quantityNeeded: 1 }],
    });

    const res = await app.inject({
      method: 'POST',
      url: ORDERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: {
        customerId: 'non-existent-customer-id',
        items: [{ recipeId: recipe.id, quantity: 1 }],
      },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('responde 400 (RECIPE_NOT_FOUND) si algún recipeId no existe', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'recipe-400' });
    const customer = await createCustomer();

    const res = await app.inject({
      method: 'POST',
      url: ORDERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: {
        customerId: customer.id,
        items: [{ recipeId: 'non-existent-recipe-id', quantity: 1 }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('RECIPE_NOT_FOUND');
    expect(res.json().error.details.missingIds).toContain('non-existent-recipe-id');
  });

  it('responde 409 (INSUFFICIENT_STOCK) si el stock no alcanza, y NO modifica el stock (rollback real)', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'insufficient-stock' });
    const customer = await createCustomer();
    const item = await createInventoryItem({ name: uniqueItemName('scarce'), stock: 5 });
    const recipe = await createRecipe({
      ingredients: [{ inventoryItemId: item.id, quantityNeeded: 10 }],
    });

    const res = await app.inject({
      method: 'POST',
      url: ORDERS_PREFIX,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { customerId: customer.id, items: [{ recipeId: recipe.id, quantity: 1 }] },
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.error.code).toBe('INSUFFICIENT_STOCK');
    expect(body.error.details.shortages).toEqual([
      { inventoryItemId: item.id, name: item.name, required: 10, available: 5 },
    ]);

    // El stock no debió cambiar: la transacción hizo rollback completo.
    const dbItem = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    expect(dbItem?.stock).toBe(5);

    const orderCount = await prisma.order.count({ where: { customerId: customer.id } });
    expect(orderCount).toBe(0);
  });

  it('concurrencia: bajo stock limitado, el FOR UPDATE serializa el acceso y evita sobreventa', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'concurrency' });
    const customer = await createCustomer();
    // stock=10, cada pedido consume 4 -> solo 2 de 3 pedidos concurrentes caben.
    const item = await createInventoryItem({ name: uniqueItemName('concurrency'), stock: 10 });
    const recipe = await createRecipe({
      name: uniqueRecipeName('concurrency'),
      ingredients: [{ inventoryItemId: item.id, quantityNeeded: 4 }],
    });

    const requests = Array.from({ length: 3 }, () =>
      app.inject({
        method: 'POST',
        url: ORDERS_PREFIX,
        headers: { authorization: `Bearer ${tokenFor(user)}` },
        payload: { customerId: customer.id, items: [{ recipeId: recipe.id, quantity: 1 }] },
      }),
    );

    const responses = await Promise.all(requests);
    const statusCodes = responses.map((res) => res.statusCode).sort();

    const successCount = statusCodes.filter((code) => code === 201).length;
    const conflictCount = statusCodes.filter((code) => code === 409).length;

    expect(successCount).toBe(2);
    expect(conflictCount).toBe(1);
    expect(successCount + conflictCount).toBe(3);

    const dbItem = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    expect(dbItem?.stock).toBe(10 - successCount * 4);
    expect(dbItem?.stock).toBeGreaterThanOrEqual(0);

    const successfulOrders = await prisma.order.count({ where: { customerId: customer.id } });
    expect(successfulOrders).toBe(successCount);
  });
});
