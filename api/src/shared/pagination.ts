// fastify-type-provider-zod v5 valida contra el motor interno de Zod v4
// (`zod/v4/core`). El paquete `zod` instalado (3.25.x) empaqueta ambas APIs;
// hay que importar explícitamente el subpath `zod/v4` para los schemas — ver
// `modules/auth/schema.ts` para el detalle completo de este workaround.
import { z } from 'zod/v4';
import type { ZodTypeAny } from 'zod/v4';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
/** Límite máximo de `limit` aceptado por querystring, para evitar abuso (`?limit=999999`). */
export const MAX_LIMIT = 100;

/**
 * Schema Zod reutilizable para querystrings paginadas. Pensado para
 * extenderse con `.extend({...})` en cada módulo (p. ej. agregando `q`,
 * `category`, `status`, etc. — ver `modules/users/schema.ts`).
 *
 * `z.coerce.number()` es necesario porque los querystrings HTTP llegan
 * siempre como string (`?page=2`); sin coerción, Zod rechazaría `"2"` por no
 * ser `number`.
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const PaginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;

/**
 * Envuelve un schema Zod de item en el sobre de respuesta paginada
 * contractual del proyecto: `{ data: T[], meta: PaginationMeta }`.
 * Cada módulo la usa así: `paginatedResponseSchema(UserDtoSchema)`.
 */
export function paginatedResponseSchema<T extends ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    meta: PaginationMetaSchema,
  });
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

/** Arma el objeto `meta` a partir de la página/límite pedidos y el total real de filas. */
export function buildPaginationMeta(params: { page: number; limit: number; total: number }): PaginationMeta {
  const { page, limit, total } = params;
  return {
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
  };
}

/** Traduce `{page, limit}` (1-indexado) a `{skip, take}` de Prisma. */
export function paginationSkipTake(params: { page: number; limit: number }): {
  skip: number;
  take: number;
} {
  return { skip: (params.page - 1) * params.limit, take: params.limit };
}
