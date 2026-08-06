// Ver `modules/auth/schema.ts` para el detalle del workaround: hay que
// importar `zod/v4` (no `zod`) porque fastify-type-provider-zod@5 valida
// contra el engine interno de Zod v4 y el paquete `zod` instalado resuelve
// por defecto a la API v3 clásica.
import { z } from 'zod/v4';
import { PaginationQuerySchema, paginatedResponseSchema } from '../../shared/pagination.js';

/**
 * DTO público de supplier. `contact` es `nullable` (no `optional`): Prisma
 * devuelve `null` explícito para la columna opcional sin valor (`String?`),
 * no `undefined`, así que el schema de respuesta debe aceptar `null` para
 * serializar correctamente. A diferencia de `Customer`, `Supplier` no tiene
 * `email` único, así que no hay chequeo de duplicados en el service.
 */
export const SupplierDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  contact: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type SupplierDto = z.infer<typeof SupplierDtoSchema>;

/** `q` es opcional y filtra por `name` (contains, insensitive) en el service. */
export const ListSuppliersQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
});
export type ListSuppliersQuery = z.infer<typeof ListSuppliersQuerySchema>;

export const ListSuppliersResponseSchema = paginatedResponseSchema(SupplierDtoSchema);
export type ListSuppliersResponse = z.infer<typeof ListSuppliersResponseSchema>;

export const SupplierIdParamsSchema = z.object({
  id: z.string().min(1, 'El id es requerido'),
});
export type SupplierIdParams = z.infer<typeof SupplierIdParamsSchema>;

/**
 * Body de creación. Reutilizado también para `PUT /suppliers/:id`: el
 * endpoint hace reemplazo completo, así que exige el mismo shape (incluido
 * `name` requerido) — un campo ausente en el `PUT` se interpreta como "sin
 * valor" y limpia el campo (ver `service.ts`), no como "no tocar".
 */
export const SupplierBodySchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  contact: z.string().min(1).optional(),
});
export type SupplierBody = z.infer<typeof SupplierBodySchema>;

export const CreateSupplierBodySchema = SupplierBodySchema;
export type CreateSupplierBody = SupplierBody;

export const UpdateSupplierBodySchema = SupplierBodySchema;
export type UpdateSupplierBody = SupplierBody;
