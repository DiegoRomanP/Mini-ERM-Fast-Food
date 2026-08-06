import { Prisma } from '@prisma/client';
// Ver `modules/inventory/schema.ts` para el detalle del workaround de
// `zod/v4`. Acá no se valida un DTO público, sino la forma cruda de las
// filas devueltas por `$queryRaw` (nunca hay que confiar en el tipo
// genérico `unknown[]`/el tipo declarado en el template tag sin validar).
import { z } from 'zod/v4';
import { prisma } from '../../config/prisma.js';

const ConsumptionRowSchema = z.object({
  inventoryItemId: z.string(),
  totalConsumption: z.number(),
});

/**
 * Acceso a datos del módulo analytics (capa repository). Envuelve el
 * `$queryRaw` de burn-rate para que `service.ts` no dependa directamente
 * del cliente Prisma ni del SQL crudo.
 */
export const analyticsRepository = {
  /**
   * Consumo TOTAL (no promedio diario todavía — eso lo calcula
   * `service.ts` dividiendo entre `days`) de cada `InventoryItem` en la
   * ventana `[cutoff, ahora]`, mapeado por `inventoryItemId`.
   *
   * Decisión de implementación (Opción A del PLAN, "SQL crudo"): una sola
   * query con `jsonb_array_elements(r."ingredients")` para expandir el
   * array de ingredientes de cada `Recipe` en filas, unido con
   * `OrderItem`/`Order`, filtrado por fecha y `status`, y agregado con
   * `SUM(...)` en la propia base de datos. `Recipe.ingredients` es `JSONB`
   * en la migración (`prisma/migrations/20260804230715_init`), así que
   * `jsonb_array_elements` aplica directo sin cast adicional.
   *
   * Se descartó la Opción B (traer `OrderItem` + `Recipe` con Prisma normal
   * y sumar en TS validando cada `ingredients` con `IngredientSchema`)
   * porque acá el join en SQL compiló limpio a la primera y evita traer a
   * memoria de la aplicación potencialmente miles de filas de `OrderItem`
   * con su `Recipe` completa solo para sumarlas — el filtro de fecha/status
   * y el `GROUP BY` quedan en la base de datos, que es para lo que está.
   *
   * `status != 'CANCELADO'`: una orden cancelada no representa consumo real
   * de negocio, aunque el stock ya se haya descontado al crearla (el
   * proyecto no implementa restock al cancelar) — se excluye a propósito de
   * esta métrica, es una decisión de negocio, no un bug.
   *
   * Los operadores `->>'quantityNeeded'`/`->>'inventoryItemId'` extraen
   * campos de cada elemento del array Json como texto; `quantityNeeded` se
   * castea a `float8` para poder sumarlo. `float8` (double precision) es lo
   * que Postgres devuelve como `number` de JS sin pasar por `numeric`
   * (que `node-postgres` devolvería como `string`), así que no hace falta
   * `Number(...)` adicional — igual se valida con Zod antes de confiar en
   * el shape (nunca en el tipo inferido de `$queryRaw`).
   */
  async findConsumptionSince(cutoff: Date): Promise<Map<string, number>> {
    const rows = await prisma.$queryRaw<unknown[]>(Prisma.sql`
      SELECT
        (ing->>'inventoryItemId') AS "inventoryItemId",
        SUM((ing->>'quantityNeeded')::float8 * oi."quantity"::float8) AS "totalConsumption"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      JOIN "Recipe" r ON r."id" = oi."recipeId"
      CROSS JOIN LATERAL jsonb_array_elements(r."ingredients") AS ing
      WHERE o."createdAt" >= ${cutoff}
        AND o."status" != 'CANCELADO'::"OrderStatus"
      GROUP BY (ing->>'inventoryItemId')
    `);

    const parsed = z.array(ConsumptionRowSchema).parse(rows);
    return new Map(parsed.map((row) => [row.inventoryItemId, row.totalConsumption]));
  },
};

export type AnalyticsRepository = typeof analyticsRepository;
