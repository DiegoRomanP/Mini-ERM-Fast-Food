import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import type { ItemType, Unit } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_PASSWORD = 'MiniErp2026!';
const BCRYPT_ROUNDS = 10;
const LOW_STOCK_HINT = { itemsBelowMinStock: 6 };

type SeedUser = {
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
};

const SEED_USERS: SeedUser[] = [
  { email: 'admin@mini-erp.dev', name: 'Admin Sistema', role: 'ADMIN' },
  { email: 'chef@mini-erp.dev', name: 'Chef Principal', role: 'USER' },
  { email: 'cajero@mini-erp.dev', name: 'Cajero Recepción', role: 'USER' },
];

type SeedCustomer = {
  name: string;
  email: string;
  phone: string | null;
};

const SEED_CUSTOMERS: SeedCustomer[] = [
  { name: 'La Esquina Café', email: 'laesquina@example.com', phone: '+56 9 1111 1111' },
  { name: 'Bazar Central', email: 'bazarcentral@example.com', phone: '+56 9 2222 2222' },
  { name: 'Donde Pedro', email: 'donpedro@example.com', phone: '+56 9 3333 3333' },
  { name: 'Panadería La Espiga', email: 'laespiga@example.com', phone: '+56 9 4444 4444' },
  { name: 'Marisquería Puerto', email: 'marisqueria@example.com', phone: '+56 9 5555 5555' },
];

type SeedSupplier = {
  name: string;
  contact: string;
};

const SEED_SUPPLIERS: SeedSupplier[] = [
  { name: 'Distribuidora Andes', contact: 'contacto@andes.cl' },
  { name: 'Carnes del Sur', contact: 'ventas@carnesdelsur.cl' },
  { name: 'Empaques Santiago', contact: 'info@empaquesstgo.cl' },
];

type SeedItem = {
  name: string;
  type: ItemType;
  category: string;
  stock: number;
  unit: Unit;
  minStock: number;
  pricePerUnit: number;
  supplierName: string;
};

const SEED_ITEMS: SeedItem[] = [
  {
    name: 'Harina de trigo',
    type: 'ALIMENTO',
    category: 'Harinas',
    stock: 25,
    unit: 'KG',
    minStock: 10,
    pricePerUnit: 890,
    supplierName: 'Distribuidora Andes',
  },
  {
    name: 'Azúcar refinada',
    type: 'ALIMENTO',
    category: 'Endulzantes',
    stock: 15,
    unit: 'KG',
    minStock: 8,
    pricePerUnit: 750,
    supplierName: 'Distribuidora Andes',
  },
  {
    name: 'Aceite vegetal',
    type: 'ALIMENTO',
    category: 'Aceites',
    stock: 12,
    unit: 'LITROS',
    minStock: 6,
    pricePerUnit: 1290,
    supplierName: 'Distribuidora Andes',
  },
  {
    name: 'Arroz grano largo',
    type: 'ALIMENTO',
    category: 'Granos',
    stock: 4,
    unit: 'KG',
    minStock: 10,
    pricePerUnit: 920,
    supplierName: 'Distribuidora Andes',
  },
  {
    name: 'Sal fina',
    type: 'ALIMENTO',
    category: 'Condimentos',
    stock: 20,
    unit: 'KG',
    minStock: 5,
    pricePerUnit: 430,
    supplierName: 'Distribuidora Andes',
  },
  {
    name: 'Pechuga de pollo',
    type: 'ALIMENTO',
    category: 'Carnes',
    stock: 3,
    unit: 'KG',
    minStock: 8,
    pricePerUnit: 3490,
    supplierName: 'Carnes del Sur',
  },
  {
    name: 'Carne molida',
    type: 'ALIMENTO',
    category: 'Carnes',
    stock: 10,
    unit: 'KG',
    minStock: 8,
    pricePerUnit: 4290,
    supplierName: 'Carnes del Sur',
  },
  {
    name: 'Salmón fresco',
    type: 'ALIMENTO',
    category: 'Pescados',
    stock: 6,
    unit: 'KG',
    minStock: 4,
    pricePerUnit: 8990,
    supplierName: 'Carnes del Sur',
  },
  {
    name: 'Papas',
    type: 'ALIMENTO',
    category: 'Verduras',
    stock: 30,
    unit: 'KG',
    minStock: 12,
    pricePerUnit: 690,
    supplierName: 'Carnes del Sur',
  },
  {
    name: 'Cebollas',
    type: 'ALIMENTO',
    category: 'Verduras',
    stock: 18,
    unit: 'KG',
    minStock: 10,
    pricePerUnit: 540,
    supplierName: 'Carnes del Sur',
  },
  {
    name: 'Cajas de cartón',
    type: 'SUMINISTRO',
    category: 'Empaques',
    stock: 20,
    unit: 'UNIDADES',
    minStock: 50,
    pricePerUnit: 320,
    supplierName: 'Empaques Santiago',
  },
  {
    name: 'Bolsas de papel',
    type: 'SUMINISTRO',
    category: 'Empaques',
    stock: 60,
    unit: 'UNIDADES',
    minStock: 100,
    pricePerUnit: 45,
    supplierName: 'Empaques Santiago',
  },
  {
    name: 'Servilletas',
    type: 'SUMINISTRO',
    category: 'Descartables',
    stock: 45,
    unit: 'PAQUETES',
    minStock: 30,
    pricePerUnit: 890,
    supplierName: 'Empaques Santiago',
  },
  {
    name: 'Guantes desechables',
    type: 'SUMINISTRO',
    category: 'Higiene',
    stock: 2,
    unit: 'PAQUETES',
    minStock: 20,
    pricePerUnit: 1250,
    supplierName: 'Empaques Santiago',
  },
  {
    name: 'Detergente industrial',
    type: 'SUMINISTRO',
    category: 'Limpieza',
    stock: 6,
    unit: 'LITROS',
    minStock: 10,
    pricePerUnit: 2890,
    supplierName: 'Empaques Santiago',
  },
];

type RecipeIngredient = {
  itemName: string;
  quantityNeeded: number;
};

type SeedRecipe = {
  name: string;
  ingredients: RecipeIngredient[];
};

const SEED_RECIPES: SeedRecipe[] = [
  {
    name: 'Hamburguesa Clásica',
    ingredients: [
      { itemName: 'Carne molida', quantityNeeded: 0.15 },
      { itemName: 'Cebollas', quantityNeeded: 0.04 },
      { itemName: 'Papas', quantityNeeded: 0.12 },
    ],
  },
  {
    name: 'Pechuga a la Plancha',
    ingredients: [
      { itemName: 'Pechuga de pollo', quantityNeeded: 0.25 },
      { itemName: 'Aceite vegetal', quantityNeeded: 0.04 },
      { itemName: 'Sal fina', quantityNeeded: 0.005 },
    ],
  },
  {
    name: 'Arroz con Salmón',
    ingredients: [
      { itemName: 'Salmón fresco', quantityNeeded: 0.2 },
      { itemName: 'Arroz grano largo', quantityNeeded: 0.12 },
      { itemName: 'Sal fina', quantityNeeded: 0.004 },
    ],
  },
  {
    name: 'Puré de Papas',
    ingredients: [
      { itemName: 'Papas', quantityNeeded: 0.3 },
      { itemName: 'Aceite vegetal', quantityNeeded: 0.03 },
      { itemName: 'Sal fina', quantityNeeded: 0.006 },
    ],
  },
  {
    name: 'Crepas Dulces',
    ingredients: [
      { itemName: 'Harina de trigo', quantityNeeded: 0.15 },
      { itemName: 'Azúcar refinada', quantityNeeded: 0.08 },
      { itemName: 'Aceite vegetal', quantityNeeded: 0.05 },
    ],
  },
  {
    name: 'Caldo de Pollo',
    ingredients: [
      { itemName: 'Pechuga de pollo', quantityNeeded: 0.15 },
      { itemName: 'Cebollas', quantityNeeded: 0.08 },
      { itemName: 'Papas', quantityNeeded: 0.2 },
      { itemName: 'Sal fina', quantityNeeded: 0.01 },
      { itemName: 'Arroz grano largo', quantityNeeded: 0.05 },
    ],
  },
];

type SeedOrderItem = {
  recipeName: string;
  quantity: number;
};

type SeedOrder = {
  userEmail: string;
  customerEmail: string;
  status: 'PENDIENTE' | 'COMPLETADO' | 'CANCELADO';
  items: SeedOrderItem[];
};

const SEED_ORDERS: SeedOrder[] = [
  {
    userEmail: 'cajero@mini-erp.dev',
    customerEmail: 'laesquina@example.com',
    status: 'COMPLETADO',
    items: [
      { recipeName: 'Hamburguesa Clásica', quantity: 2 },
      { recipeName: 'Pechuga a la Plancha', quantity: 1 },
    ],
  },
  {
    userEmail: 'chef@mini-erp.dev',
    customerEmail: 'bazarcentral@example.com',
    status: 'PENDIENTE',
    items: [
      { recipeName: 'Arroz con Salmón', quantity: 1 },
      { recipeName: 'Puré de Papas', quantity: 3 },
      { recipeName: 'Crepas Dulces', quantity: 2 },
    ],
  },
];

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

async function upsertItemByName(data: SeedItem, supplierId: string): Promise<{ id: string; pricePerUnit: number }> {
  const existing = await prisma.inventoryItem.findFirst({
    where: { name: data.name },
    select: { id: true, pricePerUnit: true },
  });

  if (existing) {
    return prisma.inventoryItem.update({
      where: { id: existing.id },
      data: {
        type: data.type,
        category: data.category,
        stock: data.stock,
        unit: data.unit,
        minStock: data.minStock,
        pricePerUnit: data.pricePerUnit,
        supplierId,
      },
      select: { id: true, pricePerUnit: true },
    });
  }

  const { supplierName: _supplierName, ...createData } = data;

  return prisma.inventoryItem.create({
    data: { ...createData, supplierId },
    select: { id: true, pricePerUnit: true },
  });
}

async function seedUsers(): Promise<Record<string, string>> {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);
  const ids: Record<string, string> = {};

  for (const user of SEED_USERS) {
    const record = await prisma.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, passwordHash },
      create: { email: user.email, name: user.name, role: user.role, passwordHash },
    });
    ids[user.email] = record.id;
  }

  return ids;
}

async function seedCustomers(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  for (const customer of SEED_CUSTOMERS) {
    const record = await prisma.customer.upsert({
      where: { email: customer.email },
      update: { name: customer.name, phone: customer.phone },
      create: { ...customer },
    });
    ids[customer.email] = record.id;
  }

  return ids;
}

async function seedSuppliers(): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  for (const supplier of SEED_SUPPLIERS) {
    const existing = await prisma.supplier.findFirst({
      where: { name: supplier.name },
      select: { id: true },
    });

    const record = existing
      ? await prisma.supplier.update({
          where: { id: existing.id },
          data: { contact: supplier.contact },
        })
      : await prisma.supplier.create({ data: { ...supplier } });

    ids[supplier.name] = record.id;
  }

  return ids;
}

async function seedItems(
  supplierIds: Record<string, string>,
): Promise<Record<string, { id: string; pricePerUnit: number }>> {
  const ids: Record<string, { id: string; pricePerUnit: number }> = {};

  for (const item of SEED_ITEMS) {
    const record = await upsertItemByName(item, supplierIds[item.supplierName]);
    ids[item.name] = record;
  }

  return ids;
}

async function seedRecipes(
  itemIds: Record<string, { id: string; pricePerUnit: number }>,
): Promise<Record<string, string>> {
  const ids: Record<string, string> = {};

  for (const recipe of SEED_RECIPES) {
    const ingredients = recipe.ingredients.map((ingredient) => ({
      inventoryItemId: itemIds[ingredient.itemName].id,
      quantityNeeded: ingredient.quantityNeeded,
    }));

    const record = await prisma.recipe.upsert({
      where: { name: recipe.name },
      update: { ingredients },
      create: { name: recipe.name, ingredients },
    });
    ids[recipe.name] = record.id;
  }

  return ids;
}

function recipeUnitCost(recipeName: string, itemIds: Record<string, { id: string; pricePerUnit: number }>): number {
  const recipe = SEED_RECIPES.find((r) => r.name === recipeName);
  if (!recipe) {
    throw new Error(`Receta desconocida en seed: ${recipeName}`);
  }

  return roundCurrency(
    recipe.ingredients.reduce(
      (acc, ingredient) => acc + ingredient.quantityNeeded * itemIds[ingredient.itemName].pricePerUnit,
      0,
    ),
  );
}

async function seedOrders(
  userIds: Record<string, string>,
  customerIds: Record<string, string>,
  recipeIds: Record<string, string>,
  itemIds: Record<string, { id: string; pricePerUnit: number }>,
): Promise<void> {
  for (const order of SEED_ORDERS) {
    const orderItems = order.items.map((item) => ({
      recipeId: recipeIds[item.recipeName],
      recipeName: item.recipeName,
      quantity: item.quantity,
    }));

    const total = roundCurrency(
      orderItems.reduce((acc, item) => acc + recipeUnitCost(item.recipeName, itemIds) * item.quantity, 0),
    );

    const existing = await prisma.order.findFirst({
      where: {
        userId: userIds[order.userEmail],
        customerId: customerIds[order.customerEmail],
        status: order.status,
        total,
      },
    });

    if (existing) {
      continue;
    }

    await prisma.order.create({
      data: {
        userId: userIds[order.userEmail],
        customerId: customerIds[order.customerEmail],
        status: order.status,
        total,
        items: { create: orderItems },
      },
    });
  }
}

async function main(): Promise<void> {
  const userIds = await seedUsers();
  const customerIds = await seedCustomers();
  const supplierIds = await seedSuppliers();
  const itemIds = await seedItems(supplierIds);
  const recipeIds = await seedRecipes(itemIds);
  await seedOrders(userIds, customerIds, recipeIds, itemIds);

  const counts = await prisma.$transaction([
    prisma.user.count(),
    prisma.customer.count(),
    prisma.supplier.count(),
    prisma.inventoryItem.count(),
    prisma.recipe.count(),
    prisma.order.count(),
  ]);

  const lowStock = await prisma.inventoryItem.count({
    where: { stock: { lt: prisma.inventoryItem.fields.minStock } },
  });

  console.log('Seed completado');
  console.log(`  users: ${counts[0]} | customers: ${counts[1]} | suppliers: ${counts[2]}`);
  console.log(`  items: ${counts[3]} | recipes: ${counts[4]} | orders: ${counts[5]}`);
  console.log(`  items bajo minStock: ${lowStock} (esperado ${LOW_STOCK_HINT.itemsBelowMinStock})`);
  console.log(`  credenciales: ${SEED_USERS.map((u) => `${u.email} / ${SEED_PASSWORD}`).join(' | ')}`);
}

main()
  .catch((error: unknown) => {
    console.error('Error en seed:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
