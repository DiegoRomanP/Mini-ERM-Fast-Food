// Ver `modules/auth/schema.ts` para el detalle del workaround: hay que
// importar `zod/v4` (no `zod`) porque fastify-type-provider-zod@5 valida
// contra el engine interno de Zod v4 y el paquete `zod` instalado resuelve
// por defecto a la API v3 clásica.
import { z } from 'zod/v4';
import { PaginationQuerySchema, paginatedResponseSchema } from '../../shared/pagination.js';

export const OrderStatusSchema = z.enum(['PENDIENTE', 'COMPLETADO', 'CANCELADO']);
export type OrderStatusValue = z.infer<typeof OrderStatusSchema>;

/**
 * Un item pedido dentro del body de `POST /orders`: referencia una receta
 * (`recipeId`) y cuántas unidades de esa receta se piden (`quantity`, entero
 * positivo — no tiene sentido pedir media receta). El mismo `recipeId` puede
 * repetirse en el array (dos líneas separadas para la misma receta); no se
 * deduplica a nivel de schema, cada entrada se traduce 1:1 a un `OrderItem`.
 */
export const CreateOrderItemSchema = z.object({
  recipeId: z.string().min(1, 'recipeId es requerido'),
  quantity: z.number().int('quantity debe ser un entero').positive('quantity debe ser mayor a 0'),
});
export type CreateOrderItemBody = z.infer<typeof CreateOrderItemSchema>;

export const CreateOrderBodySchema = z.object({
  customerId: z.string().min(1, 'customerId es requerido'),
  items: z.array(CreateOrderItemSchema).min(1, 'El pedido requiere al menos un item'),
});
export type CreateOrderBody = z.infer<typeof CreateOrderBodySchema>;

/** DTO de un `OrderItem` ya persistido (incluye el snapshot `recipeName`). */
export const OrderItemDtoSchema = z.object({
  id: z.string(),
  recipeId: z.string(),
  recipeName: z.string(),
  quantity: z.number().int(),
});
export type OrderItemDto = z.infer<typeof OrderItemDtoSchema>;

/**
 * DTO de una orden completa. Reusado tal cual por el módulo de query/status
 * (Fase 4 siguiente) para `GET /orders` y `GET /orders/:id` — de ahí que
 * incluya ya `status`/`total`/`items` completos en vez de un DTO "liviano"
 * de creación aparte.
 */
export const OrderDtoSchema = z.object({
  id: z.string(),
  userId: z.string(),
  customerId: z.string(),
  status: OrderStatusSchema,
  total: z.number(),
  items: z.array(OrderItemDtoSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type OrderDto = z.infer<typeof OrderDtoSchema>;

export const OrderIdParamsSchema = z.object({
  id: z.string().min(1, 'El id es requerido'),
});
export type OrderIdParams = z.infer<typeof OrderIdParamsSchema>;

/**
 * Querystring de `GET /orders`. `from`/`to` acotan `createdAt` (ISO 8601 con
 * offset/`Z`, validado con `z.string().datetime()` — mismo formato que
 * produce `Date#toISOString()`); el service los convierte a `Date` antes de
 * pasarlos al repository. Todos los filtros son opcionales y combinables
 * (AND) — ver `ordersRepository.findMany`/`buildWhere`.
 */
export const ListOrdersQuerySchema = PaginationQuerySchema.extend({
  status: OrderStatusSchema.optional(),
  customerId: z.string().trim().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ListOrdersQuery = z.infer<typeof ListOrdersQuerySchema>;

export const ListOrdersResponseSchema = paginatedResponseSchema(OrderDtoSchema);
export type ListOrdersResponse = z.infer<typeof ListOrdersResponseSchema>;

/** Body de `PATCH /orders/:id/status`. Cualquier transición es válida (ver `service.ts`). */
export const UpdateOrderStatusBodySchema = z.object({
  status: OrderStatusSchema,
});
export type UpdateOrderStatusBody = z.infer<typeof UpdateOrderStatusBodySchema>;
