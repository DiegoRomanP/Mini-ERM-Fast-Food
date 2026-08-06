import type { InventoryItem, ItemType, Unit } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export interface FindManyInventoryParams {
  skip: number;
  take: number;
  q?: string;
  category?: string;
  type?: ItemType;
  supplierId?: string;
  lowStock?: boolean;
}

export interface FindManyInventoryResult {
  items: InventoryItem[];
  total: number;
}

export interface InventoryWriteData {
  name: string;
  type: ItemType;
  category: string;
  stock: number;
  unit: Unit;
  minStock: number;
  pricePerUnit: number;
  supplierId: string | null;
}

interface CountRow {
  count: bigint;
}

/**
 * Filtros combinables que no dependen de comparar dos columnas entre sí
 * (`q`, `category`, `type`, `supplierId`). Se usan tanto en el camino normal
 * (Prisma query builder) como en el camino raw (`lowStock=true`), para no
 * duplicar la lógica de "qué condiciones aplican" en dos formatos distintos.
 */
function buildStandardWhere(params: {
  q?: string;
  category?: string;
  type?: ItemType;
  supplierId?: string;
}): Prisma.InventoryItemWhereInput {
  const where: Prisma.InventoryItemWhereInput = {};
  if (params.q) {
    where.name = { contains: params.q, mode: 'insensitive' };
  }
  if (params.category) {
    where.category = params.category;
  }
  if (params.type) {
    where.type = params.type;
  }
  if (params.supplierId) {
    where.supplierId = params.supplierId;
  }
  return where;
}

/**
 * Misma lógica que `buildStandardWhere`, pero como fragmentos SQL
 * parametrizados (`Prisma.sql`), para combinarlos con la condición de
 * `lowStock` (que sí requiere SQL raw). Los valores se interpolan vía
 * template tag de `Prisma.sql`, así que Prisma los parametriza — no hay
 * concatenación de strings ni riesgo de SQL injection.
 */
function buildRawConditions(params: {
  q?: string;
  category?: string;
  type?: ItemType;
  supplierId?: string;
}): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [Prisma.sql`"stock" <= "minStock"`];

  if (params.q) {
    conditions.push(Prisma.sql`"name" ILIKE ${`%${params.q}%`}`);
  }
  if (params.category) {
    conditions.push(Prisma.sql`"category" = ${params.category}`);
  }
  if (params.type) {
    conditions.push(Prisma.sql`"type" = ${params.type}::"ItemType"`);
  }
  if (params.supplierId) {
    conditions.push(Prisma.sql`"supplierId" = ${params.supplierId}`);
  }

  return conditions;
}

/**
 * `lowStock=true` filtra comparando dos columnas de la misma fila
 * (`stock <= minStock`), algo que el query builder de Prisma no soporta en
 * `where` (solo compara columna vs. valor literal). Las alternativas
 * consideradas:
 *   1. Traer todo y filtrar en memoria: rompe la paginación real (habría
 *      que traer todas las filas que matchean el resto de filtros para
 *      poder paginar el subconjunto low-stock, lo cual no escala).
 *   2. Un campo `isLowStock` desnormalizado mantenido por trigger/hook: más
 *      complejidad de la que amerita un CRUD, y se desincroniza si algo
 *      escribe la tabla fuera de la app.
 *   3. `$queryRaw` parametrizado combinando dinámicamente el resto de
 *      filtros vía `Prisma.sql`/`Prisma.join`: mantiene la paginación real
 *      (LIMIT/OFFSET en SQL) y compone con los demás filtros sin duplicar
 *      lógica de negocio. Se eligió esta opción.
 * Los nombres de columna coinciden 1:1 con los campos del modelo Prisma
 * (sin `@map`), así que las filas crudas encajan en el tipo `InventoryItem`
 * generado sin transformación adicional.
 */
async function findManyLowStock(params: FindManyInventoryParams): Promise<FindManyInventoryResult> {
  const whereSql = Prisma.join(buildRawConditions(params), ' AND ');

  const [items, countRows] = await Promise.all([
    prisma.$queryRaw<InventoryItem[]>(Prisma.sql`
      SELECT * FROM "InventoryItem"
      WHERE ${whereSql}
      ORDER BY "createdAt" DESC
      LIMIT ${params.take} OFFSET ${params.skip}
    `),
    prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "InventoryItem" WHERE ${whereSql}
    `),
  ]);

  return { items, total: Number(countRows[0]?.count ?? 0) };
}

/**
 * Acceso a datos del módulo inventory (capa repository). Envuelve las
 * llamadas a Prisma para que `service.ts` no dependa directamente del
 * cliente ni exponga los modelos de Prisma fuera de este módulo.
 */
export const inventoryRepository = {
  async findMany(params: FindManyInventoryParams): Promise<FindManyInventoryResult> {
    if (params.lowStock) {
      return findManyLowStock(params);
    }

    const where = buildStandardWhere(params);

    const [items, total] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryItem.count({ where }),
    ]);

    return { items, total };
  },

  findById(id: string): Promise<InventoryItem | null> {
    return prisma.inventoryItem.findUnique({ where: { id } });
  },

  create(data: InventoryWriteData): Promise<InventoryItem> {
    return prisma.inventoryItem.create({ data });
  },

  update(id: string, data: InventoryWriteData): Promise<InventoryItem> {
    return prisma.inventoryItem.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.inventoryItem.delete({ where: { id } });
  },

  /**
   * Reusable por el módulo de analytics (burn-rate, Fase 5): cuenta items
   * con `stock <= minStock` sin paginar. Misma condición SQL que
   * `findManyLowStock`, expuesta suelta para no forzar al caller a pasar
   * `skip`/`take`/filtros que no necesita.
   */
  async countLowStock(): Promise<number> {
    const rows = await prisma.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count FROM "InventoryItem" WHERE "stock" <= "minStock"
    `);
    return Number(rows[0]?.count ?? 0);
  },

  /**
   * Reusable por el módulo de analytics (burn-rate, Fase 5): lista completa
   * (sin paginar) de items con `stock <= minStock`, orden `createdAt desc`.
   */
  findLowStock(): Promise<InventoryItem[]> {
    return prisma.$queryRaw<InventoryItem[]>(Prisma.sql`
      SELECT * FROM "InventoryItem" WHERE "stock" <= "minStock" ORDER BY "createdAt" DESC
    `);
  },

  /**
   * Usado por el módulo de analytics (burn-rate, Fase 5): TODOS los items,
   * sin paginar y sin filtros — burn-rate necesita el universo completo de
   * `InventoryItem` para cruzarlo contra el mapa de consumo, no una página.
   */
  findAll(): Promise<InventoryItem[]> {
    return prisma.inventoryItem.findMany({ orderBy: { createdAt: 'desc' } });
  },
};

export type InventoryRepository = typeof inventoryRepository;
