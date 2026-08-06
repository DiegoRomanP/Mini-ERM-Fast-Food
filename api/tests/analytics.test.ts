import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';

const ANALYTICS_PREFIX = '/api/v1/inventory/analytics';
const TEST_RECIPE_PREFIX = 'AnalyticsTestRecipe-';
const TEST_ITEM_PREFIX = 'AnalyticsTestItem-';
const TEST_CUSTOMER_PREFIX = 'AnalyticsTestCustomer-';
const TEST_USER_EMAIL_DOMAIN = '@analytics-users.test';
const BCRYPT_SALT_ROUNDS = 4; // bajo a propósito: velocidad de tests, no seguridad real.

// Ventana de la query bajo prueba: `days=10`. Se usa un valor chico (en vez
// del default 30) para poder construir fixtures "dentro"/"fuera" de la
// ventana sin fechas absurdamente lejanas.
const BURN_RATE_DAYS = 10;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WITHIN_WINDOW = new Date(); // ahora: siempre >= cutoff.
const OUTSIDE_WINDOW = new Date(Date.now() - (BURN_RATE_DAYS + 30) * MS_PER_DAY); // muy fuera de la ventana.

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
  name: string;
  stock: number;
  minStock: number;
}

async function createInventoryItem(params: CreateItemParams) {
  return prisma.inventoryItem.create({
    data: {
      name: params.name,
      type: 'ALIMENTO',
      category: 'general',
      stock: params.stock,
      unit: 'KG',
      minStock: params.minStock,
      pricePerUnit: 1,
    },
  });
}

interface CreateRecipeParams {
  name: string;
  ingredients: Array<{ inventoryItemId: string; quantityNeeded: number }>;
}

async function createRecipe(params: CreateRecipeParams) {
  return prisma.recipe.create({
    data: { name: params.name, ingredients: params.ingredients },
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
  quantity: number;
  status?: 'PENDIENTE' | 'COMPLETADO' | 'CANCELADO';
  createdAt: Date;
}

/**
 * Crea una orden directamente vía Prisma (mismo patrón que
 * `tests/orders-query.test.ts#createOrder`): burn-rate necesita controlar
 * `createdAt` (para simular fechas dentro/fuera de la ventana) y `status`
 * (para probar la exclusión de `CANCELADO`), ninguno de los cuales acepta
 * `POST /orders` (siempre usa `now()`/`PENDIENTE`).
 */
async function createOrder(params: CreateOrderParams) {
  return prisma.order.create({
    data: {
      userId: params.userId,
      customerId: params.customerId,
      status: params.status ?? 'PENDIENTE',
      total: 1,
      createdAt: params.createdAt,
      items: {
        create: [{ recipeId: params.recipeId, recipeName: params.recipeName, quantity: params.quantity }],
      },
    },
    include: { items: true },
  });
}

async function cleanupTestData(): Promise<void> {
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

describe('GET /inventory/analytics/burn-rate', () => {
  it('responde 401 si no hay token', async () => {
    const res = await app.inject({ method: 'GET', url: `${ANALYTICS_PREFIX}/burn-rate` });
    expect(res.statusCode).toBe(401);
  });

  // SEC-06: el endpoint es admin-only. El cálculo del burn-rate sigue siendo
  // global (no se scopea por `userId`, ver `analytics/routes.ts`), y
  // justamente por eso expone volumen de negocio agregado que un `USER` no
  // debe ver. Los tests de la métrica usan token ADMIN porque prueban la
  // lógica del cálculo, no la autorización.
  it('responde 403 si el usuario autenticado no es ADMIN', async () => {
    const user = await createAuthUser({ role: 'USER', label: 'forbidden-user' });
    const res = await app.inject({
      method: 'GET',
      url: `${ANALYTICS_PREFIX}/burn-rate`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('responde 400 si `days` es inválido (no numérico)', async () => {
    const user = await createAuthUser({ role: 'ADMIN', label: 'invalid-days' });
    const res = await app.inject({
      method: 'GET',
      url: `${ANALYTICS_PREFIX}/burn-rate?days=not-a-number`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('responde 400 si `days` excede el máximo permitido (365)', async () => {
    const user = await createAuthUser({ role: 'ADMIN', label: 'days-too-big' });
    const res = await app.inject({
      method: 'GET',
      url: `${ANALYTICS_PREFIX}/burn-rate?days=9999`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('responde 400 si `days` es menor a 1', async () => {
    const user = await createAuthUser({ role: 'ADMIN', label: 'days-too-small' });
    const res = await app.inject({
      method: 'GET',
      url: `${ANALYTICS_PREFIX}/burn-rate?days=0`,
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it(
    'calcula dailyConsumption/daysUntilMinStock/riskFlag exactamente como se espera a mano, ' +
      'excluyendo órdenes CANCELADO y órdenes fuera de la ventana `days`',
    async () => {
      const user = await createAuthUser({ role: 'ADMIN', label: 'burn-rate-happy' });
      const customer = await createCustomer();

      // --- Item A: consumo normal, lejos del mínimo -> 'OK' ---
      // stock=100, minStock=20. Consumo real dentro de ventana: 5*3=15
      // (recipe1, order dentro de ventana, PENDIENTE). Se ignoran:
      //   - la misma recipe1 en una orden CANCELADO (qty=500)
      //   - la misma recipe1 en una orden fuera de ventana (qty=1000)
      const itemA = await createInventoryItem({ name: uniqueItemName('A'), stock: 100, minStock: 20 });

      // --- Item B: ya por debajo del mínimo AHORA -> 'CRITICO' pase lo que pase ---
      // stock=15, minStock=20. Consumo real: 2*3=6.
      const itemB = await createInventoryItem({ name: uniqueItemName('B'), stock: 15, minStock: 20 });

      // --- Item C: sin ninguna orden que lo consuma -> dailyConsumption=0, daysUntilMinStock=null, 'OK' ---
      const itemC = await createInventoryItem({ name: uniqueItemName('C'), stock: 50, minStock: 10 });

      // --- Item D: consumo alto relativo al margen -> 'RIESGO' (daysUntilMinStock <= 7) ---
      // stock=100, minStock=90 (margen=10). Consumo real: 1*20=20 -> dailyConsumption=2 -> daysUntilMinStock=5.
      const itemD = await createInventoryItem({ name: uniqueItemName('D'), stock: 100, minStock: 90 });

      const recipe1 = await createRecipe({
        name: uniqueRecipeName('recipe1'),
        ingredients: [
          { inventoryItemId: itemA.id, quantityNeeded: 5 },
          { inventoryItemId: itemB.id, quantityNeeded: 2 },
        ],
      });
      const recipe2 = await createRecipe({
        name: uniqueRecipeName('recipe2'),
        ingredients: [{ inventoryItemId: itemD.id, quantityNeeded: 1 }],
      });

      // Dentro de la ventana, cuenta: recipe1 x3 (A:15, B:6).
      await createOrder({
        userId: user.id,
        customerId: customer.id,
        recipeId: recipe1.id,
        recipeName: recipe1.name,
        quantity: 3,
        status: 'PENDIENTE',
        createdAt: WITHIN_WINDOW,
      });

      // Dentro de la ventana, cuenta: recipe2 x20 (D:20).
      await createOrder({
        userId: user.id,
        customerId: customer.id,
        recipeId: recipe2.id,
        recipeName: recipe2.name,
        quantity: 20,
        status: 'PENDIENTE',
        createdAt: WITHIN_WINDOW,
      });

      // Dentro de la ventana pero CANCELADO -> debe excluirse del consumo.
      await createOrder({
        userId: user.id,
        customerId: customer.id,
        recipeId: recipe1.id,
        recipeName: recipe1.name,
        quantity: 500,
        status: 'CANCELADO',
        createdAt: WITHIN_WINDOW,
      });

      // Fuera de la ventana (`days=10`) -> debe excluirse del consumo.
      await createOrder({
        userId: user.id,
        customerId: customer.id,
        recipeId: recipe2.id,
        recipeName: recipe2.name,
        quantity: 1000,
        status: 'PENDIENTE',
        createdAt: OUTSIDE_WINDOW,
      });

      const res = await app.inject({
        method: 'GET',
        url: `${ANALYTICS_PREFIX}/burn-rate?days=${BURN_RATE_DAYS}`,
        headers: { authorization: `Bearer ${tokenFor(user)}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.days).toBe(BURN_RATE_DAYS);
      expect(Array.isArray(body.items)).toBe(true);

      // El endpoint devuelve TODOS los InventoryItem (no filtrado por
      // fixture), así que se busca cada item propio por id en vez de asumir
      // longitud/orden exactos del array completo.
      interface BurnRateItemBody {
        inventoryItemId: string;
        name: string;
        stock: number;
        minStock: number;
        dailyConsumption: number;
        daysUntilMinStock: number | null;
        riskFlag: 'OK' | 'RIESGO' | 'CRITICO';
      }
      const items: BurnRateItemBody[] = body.items;
      const findItem = (id: string): BurnRateItemBody => {
        const found = items.find((i) => i.inventoryItemId === id);
        if (!found) {
          throw new Error(`Item ${id} no encontrado en la respuesta de burn-rate`);
        }
        return found;
      };

      const resultA = findItem(itemA.id);
      const expectedDailyA = 15 / BURN_RATE_DAYS; // solo la orden PENDIENTE dentro de ventana.
      expect(resultA.dailyConsumption).toBe(expectedDailyA);
      expect(resultA.daysUntilMinStock).toBe((itemA.stock - itemA.minStock) / expectedDailyA);
      expect(resultA.riskFlag).toBe('OK');

      const resultB = findItem(itemB.id);
      const expectedDailyB = 6 / BURN_RATE_DAYS;
      expect(resultB.dailyConsumption).toBe(expectedDailyB);
      expect(resultB.daysUntilMinStock).toBe((itemB.stock - itemB.minStock) / expectedDailyB);
      expect(resultB.riskFlag).toBe('CRITICO'); // stock(15) <= minStock(20) ya ahora.

      const resultC = findItem(itemC.id);
      expect(resultC.dailyConsumption).toBe(0);
      expect(resultC.daysUntilMinStock).toBeNull();
      expect(resultC.riskFlag).toBe('OK');

      const resultD = findItem(itemD.id);
      const expectedDailyD = 20 / BURN_RATE_DAYS; // solo la orden dentro de ventana (1000 fuera de ventana excluido).
      expect(resultD.dailyConsumption).toBe(expectedDailyD);
      expect(resultD.daysUntilMinStock).toBe((itemD.stock - itemD.minStock) / expectedDailyD);
      expect(resultD.daysUntilMinStock).toBe(5);
      expect(resultD.riskFlag).toBe('RIESGO'); // daysUntilMinStock(5) <= 7, stock aún no crítico.
    },
  );
});
