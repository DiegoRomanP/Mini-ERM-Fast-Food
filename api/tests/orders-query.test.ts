import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const ORDERS_PREFIX = '/api/v1/orders';
const TEST_RECIPE_PREFIX = 'OrderQueryTestRecipe-';
const TEST_ITEM_PREFIX = 'OrderQueryTestItem-';
const TEST_CUSTOMER_PREFIX = 'OrderQueryTestCustomer-';
const TEST_USER_EMAIL_DOMAIN = '@orders-query-users.test';
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

async function createInventoryItem() {
  return prisma.inventoryItem.create({
    data: {
      name: uniqueItemName('seed'),
      type: 'ALIMENTO',
      category: 'general',
      stock: 100,
      unit: 'KG',
      minStock: 5,
      pricePerUnit: 1,
    },
  });
}

async function createRecipe(inventoryItemId: string) {
  return prisma.recipe.create({
    data: {
      name: uniqueRecipeName('seed'),
      ingredients: [{ inventoryItemId, quantityNeeded: 1 }],
    },
  });
}

async function createCustomer() {
  return prisma.customer.create({ data: { name: uniqueCustomerName('seed') } });
}

interface CreateOrderParams {
  userId: string;
  customerId: string;
  recipeId: string;
  recipeName: string;
  status?: 'PENDIENTE' | 'COMPLETADO' | 'CANCELADO';
  total?: number;
  createdAt?: Date;
}

/**
 * Crea una orden directamente vía Prisma (sin pasar por `POST /orders`):
 * estos tests ejercitan `GET`/`PATCH`, no el flujo de creación (ya cubierto
 * por `orders-create.test.ts`), así que no hace falta el descuento de stock
 * real ni la transacción — solo filas de `Order`/`OrderItem` con formas
 * válidas para poder consultarlas/filtrarlas.
 */
async function createOrder(params: CreateOrderParams) {
  return prisma.order.create({
    data: {
      userId: params.userId,
      customerId: params.customerId,
      status: params.status ?? 'PENDIENTE',
      total: params.total ?? 10,
      createdAt: params.createdAt,
      items: {
        create: [{ recipeId: params.recipeId, recipeName: params.recipeName, quantity: 1 }],
      },
    },
    include: { items: true },
  });
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

describe('GET /orders', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: ORDERS_PREFIX });
    expect(res.statusCode).toBe(401);
  });

  it('lista paginada happy path: data + meta, incluye items, orden createdAt desc', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'list-happy' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);

    const older = await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
    });

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}?page=1&limit=20`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.meta).toMatchObject({ page: 1, limit: 20 });
    expect(body.meta.total).toBeGreaterThanOrEqual(2);

    const ids: string[] = body.data.map((o: { id: string }) => o.id);
    const newerIdx = ids.indexOf(newer.id);
    const olderIdx = ids.indexOf(older.id);
    expect(newerIdx).toBeGreaterThanOrEqual(0);
    expect(olderIdx).toBeGreaterThanOrEqual(0);
    expect(newerIdx).toBeLessThan(olderIdx);

    const returnedNewer = body.data.find((o: { id: string }) => o.id === newer.id);
    expect(returnedNewer.items).toHaveLength(1);
    expect(returnedNewer.items[0]).toMatchObject({ recipeId: recipe.id, recipeName: recipe.name });
  });

  it('pagina correctamente con page/limit', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'list-paginate' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);

    for (let i = 0; i < 3; i += 1) {
      await createOrder({
        userId: user.id,
        customerId: customer.id,
        recipeId: recipe.id,
        recipeName: recipe.name,
      });
    }

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}?page=1&limit=2&customerId=${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(2);
    expect(body.meta).toMatchObject({ page: 1, limit: 2, total: 3 });
  });

  it('filtra por status exacto', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'status-filter' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);

    const pending = await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: 'PENDIENTE',
    });
    await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: 'COMPLETADO',
    });
    await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: 'CANCELADO',
    });

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}?status=PENDIENTE&customerId=${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(pending.id);
    expect(body.data[0].status).toBe('PENDIENTE');
  });

  it('filtra por customerId exacto', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'customer-filter' });
    const customerA = await createCustomer();
    const customerB = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);

    const orderA = await createOrder({
      userId: user.id,
      customerId: customerA.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
    });
    await createOrder({
      userId: user.id,
      customerId: customerB.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
    });

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}?customerId=${customerA.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(orderA.id);
  });

  it('filtra por rango from/to sobre createdAt', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'date-filter' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);

    const base = new Date('2024-06-15T12:00:00.000Z');
    const tooOld = new Date(base.getTime() - 10 * 24 * 60 * 60 * 1000);
    const inRange = new Date(base.getTime());
    const tooNew = new Date(base.getTime() + 10 * 24 * 60 * 60 * 1000);

    await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      createdAt: tooOld,
    });
    const inRangeOrder = await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      createdAt: inRange,
    });
    await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      createdAt: tooNew,
    });

    const from = new Date(base.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(base.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}?customerId=${customer.id}&from=${from}&to=${to}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(inRangeOrder.id);
  });

  it('combina 2+ filtros (status + customerId + from/to) con AND', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'combined-filter' });
    const customerA = await createCustomer();
    const customerB = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);

    const base = new Date('2024-07-01T00:00:00.000Z');
    const from = new Date(base.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date(base.getTime() + 24 * 60 * 60 * 1000).toISOString();

    // Coincide en todo: debe aparecer.
    const match = await createOrder({
      userId: user.id,
      customerId: customerA.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: 'COMPLETADO',
      createdAt: base,
    });
    // Mismo status/fecha, otro customer: no debe aparecer.
    await createOrder({
      userId: user.id,
      customerId: customerB.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: 'COMPLETADO',
      createdAt: base,
    });
    // Mismo customer/fecha, otro status: no debe aparecer.
    await createOrder({
      userId: user.id,
      customerId: customerA.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: 'PENDIENTE',
      createdAt: base,
    });

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}?status=COMPLETADO&customerId=${customerA.id}&from=${from}&to=${to}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(match.id);
  });

  /**
   * Alcance dueño+admin (SEC-01/SEC-02): el listado de un `USER` va scopeado
   * a sus propias órdenes — eso lo verifica `security.test.ts` desde el lado
   * del atacante. Acá se cubre el otro lado del modelo: el `ADMIN` sí ve las
   * órdenes ajenas. Se filtra por `customerId` para que la aserción no
   * dependa de las órdenes que otros archivos de test dejen en la DB.
   */
  it('un ADMIN ve en el listado las órdenes de otros usuarios', async () => {
    const owner = await createAuthUser({ role: 'USER', label: 'admin-list-owner' });
    const admin = await createAuthUser({ role: 'ADMIN', label: 'admin-list' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);

    const foreignOrder = await createOrder({
      userId: owner.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
    });

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}?customerId=${customer.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(foreignOrder.id);
    expect(body.meta.total).toBe(1);
  });
});

describe('GET /orders/:id', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: `${ORDERS_PREFIX}/some-id` });
    expect(res.statusCode).toBe(401);
  });

  it('happy path: devuelve el detalle completo con items', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-happy' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);
    const order = await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      total: 42,
    });

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}/${order.id}`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(order.id);
    expect(body.customerId).toBe(customer.id);
    expect(body.total).toBe(42);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ recipeId: recipe.id, recipeName: recipe.name, quantity: 1 });
  });

  it('responde 404 (ORDER_NOT_FOUND) si el id no existe', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'get-404' });

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}/non-existent-order-id`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ORDER_NOT_FOUND');
  });

  it('un ADMIN puede leer la orden de otro usuario', async () => {
    const owner = await createAuthUser({ role: 'USER', label: 'admin-get-owner' });
    const admin = await createAuthUser({ role: 'ADMIN', label: 'admin-get' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);
    const order = await createOrder({
      userId: owner.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
    });

    const res = await app.inject({
      method: 'GET',
      url: `${ORDERS_PREFIX}/${order.id}`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().userId).toBe(owner.id);
  });
});

describe('PATCH /orders/:id/status', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `${ORDERS_PREFIX}/some-id/status`,
      payload: { status: 'COMPLETADO' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('happy path: actualiza el status y lo persiste', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'patch-happy' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);
    const order = await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: 'PENDIENTE',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `${ORDERS_PREFIX}/${order.id}/status`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { status: 'COMPLETADO' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(order.id);
    expect(body.status).toBe('COMPLETADO');

    const dbOrder = await prisma.order.findUnique({ where: { id: order.id } });
    expect(dbOrder?.status).toBe('COMPLETADO');
  });

  it('responde 404 (ORDER_NOT_FOUND) si el id no existe', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'patch-404' });

    const res = await app.inject({
      method: 'PATCH',
      url: `${ORDERS_PREFIX}/non-existent-order-id/status`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { status: 'COMPLETADO' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('ORDER_NOT_FOUND');
  });

  it('un ADMIN puede cambiar el estado de la orden de otro usuario', async () => {
    const owner = await createAuthUser({ role: 'USER', label: 'admin-patch-owner' });
    const admin = await createAuthUser({ role: 'ADMIN', label: 'admin-patch' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);
    const order = await createOrder({
      userId: owner.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
      status: 'PENDIENTE',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `${ORDERS_PREFIX}/${order.id}/status`,
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { status: 'CANCELADO' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('CANCELADO');
  });

  it('responde 400 si status no es un valor válido del enum', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'patch-400' });
    const customer = await createCustomer();
    const item = await createInventoryItem();
    const recipe = await createRecipe(item.id);
    const order = await createOrder({
      userId: user.id,
      customerId: customer.id,
      recipeId: recipe.id,
      recipeName: recipe.name,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `${ORDERS_PREFIX}/${order.id}/status`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { status: 'NOT_A_REAL_STATUS' },
    });

    expect(res.statusCode).toBe(400);
  });
});
