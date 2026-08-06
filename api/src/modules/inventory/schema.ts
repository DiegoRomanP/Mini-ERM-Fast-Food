// Ver `modules/auth/schema.ts` para el detalle del workaround: hay que
// importar `zod/v4` (no `zod`) porque fastify-type-provider-zod@5 valida
// contra el engine interno de Zod v4 y el paquete `zod` instalado resuelve
// por defecto a la API v3 clásica.
import { z } from 'zod/v4';
import { PaginationQuerySchema, paginatedResponseSchema } from '../../shared/pagination.js';

/** Espejo de los enums Prisma `ItemType`/`Unit` (`prisma/schema.prisma`). */
export const ItemTypeSchema = z.enum(['ALIMENTO', 'SUMINISTRO']);
export type ItemTypeValue = z.infer<typeof ItemTypeSchema>;

export const UnitSchema = z.enum(['KG', 'LITROS', 'UNIDADES', 'PAQUETES']);
export type UnitValue = z.infer<typeof UnitSchema>;

/**
 * DTO público de item de inventario. `supplierId` es `nullable` (no
 * `optional`): Prisma devuelve `null` explícito para la FK opcional sin
 * valor, no `undefined` — mismo criterio que `contact` en `SupplierDtoSchema`.
 */
export const InventoryItemDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: ItemTypeSchema,
  category: z.string(),
  stock: z.number(),
  unit: UnitSchema,
  minStock: z.number(),
  pricePerUnit: z.number(),
  supplierId: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type InventoryItemDto = z.infer<typeof InventoryItemDtoSchema>;

/**
 * `lowStock` llega como string de querystring (`?lowStock=true`). Se evita
 * a propósito `z.coerce.boolean()`: coerciona con `Boolean(value)`, así que
 * `?lowStock=false` (string no vacío) se leería como `true` — un footgun
 * clásico. En su lugar se acepta solo el literal `'true'` y todo lo demás
 * (`'false'`, ausente) colapsa a `false`, que el repository interpreta como
 * "no aplicar el filtro" — mismo resultado que "ausente", así que no hace
 * falta distinguir `undefined` de `false` más abajo en la pila.
 */
export const ListInventoryQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  type: ItemTypeSchema.optional(),
  supplierId: z.string().trim().min(1).optional(),
  lowStock: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});
export type ListInventoryQuery = z.infer<typeof ListInventoryQuerySchema>;

export const ListInventoryResponseSchema = paginatedResponseSchema(InventoryItemDtoSchema);
export type ListInventoryResponse = z.infer<typeof ListInventoryResponseSchema>;

export const InventoryIdParamsSchema = z.object({
  id: z.string().min(1, 'El id es requerido'),
});
export type InventoryIdParams = z.infer<typeof InventoryIdParamsSchema>;

/**
 * Body de creación. Reutilizado también para `PUT /inventory/:id`: el
 * endpoint hace reemplazo completo (mismo criterio que `suppliers`), así que
 * exige el mismo shape. Un `supplierId` ausente en el `PUT` limpia la FK a
 * `null` (no se interpreta como "no tocar"); los campos numéricos ausentes
 * vuelven a su default (`stock` 0, `minStock` 5, `pricePerUnit` 0).
 */
export const InventoryBodySchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  type: ItemTypeSchema,
  category: z.string().min(1, 'La categoría es requerida'),
  stock: z.number().min(0).default(0),
  unit: UnitSchema,
  minStock: z.number().min(0).default(5),
  pricePerUnit: z.number().min(0).default(0),
  supplierId: z.string().min(1).optional(),
});
export type InventoryBody = z.infer<typeof InventoryBodySchema>;

export const CreateInventoryBodySchema = InventoryBodySchema;
export type CreateInventoryBody = InventoryBody;

export const UpdateInventoryBodySchema = InventoryBodySchema;
export type UpdateInventoryBody = InventoryBody;
