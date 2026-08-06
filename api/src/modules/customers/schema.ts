// Ver `modules/auth/schema.ts` para el detalle del workaround: hay que
// importar `zod/v4` (no `zod`) porque fastify-type-provider-zod@5 valida
// contra el engine interno de Zod v4 y el paquete `zod` instalado resuelve
// por defecto a la API v3 clásica.
import { z } from 'zod/v4';
import { PaginationQuerySchema, paginatedResponseSchema } from '../../shared/pagination.js';

/**
 * DTO público de customer. `email`/`phone` son `nullable` (no `optional`):
 * Prisma devuelve `null` explícito para las columnas opcionales sin valor
 * (`String?`), no `undefined`, así que el schema de respuesta debe aceptar
 * `null` para serializar correctamente.
 */
export const CustomerDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type CustomerDto = z.infer<typeof CustomerDtoSchema>;

/** `q` es opcional y filtra por `name` o `email` (contains, insensitive) en el service. */
export const ListCustomersQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
});
export type ListCustomersQuery = z.infer<typeof ListCustomersQuerySchema>;

export const ListCustomersResponseSchema = paginatedResponseSchema(CustomerDtoSchema);
export type ListCustomersResponse = z.infer<typeof ListCustomersResponseSchema>;

export const CustomerIdParamsSchema = z.object({
  id: z.string().min(1, 'El id es requerido'),
});
export type CustomerIdParams = z.infer<typeof CustomerIdParamsSchema>;

/**
 * Body de creación. Reutilizado también para `PUT /customers/:id`: el
 * endpoint hace reemplazo completo, así que exige el mismo shape (incluido
 * `name` requerido) — un campo ausente en el `PUT` se interpreta como "sin
 * valor" y limpia el campo (ver `service.ts`), no como "no tocar".
 */
export const CustomerBodySchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  email: z.string().email('Email inválido').optional(),
  phone: z.string().min(1).optional(),
});
export type CustomerBody = z.infer<typeof CustomerBodySchema>;

export const CreateCustomerBodySchema = CustomerBodySchema;
export type CreateCustomerBody = CustomerBody;

export const UpdateCustomerBodySchema = CustomerBodySchema;
export type UpdateCustomerBody = CustomerBody;
