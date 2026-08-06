// Ver `modules/auth/schema.ts` para el detalle del workaround: hay que
// importar `zod/v4` (no `zod`) porque fastify-type-provider-zod@5 valida
// contra el engine interno de Zod v4 y el paquete `zod` instalado resuelve
// por defecto a la API v3 clásica.
import { z } from 'zod/v4';
import { PaginationQuerySchema, paginatedResponseSchema } from '../../shared/pagination.js';

/**
 * DTO público de usuario para el módulo admin: a diferencia del `UserDto` de
 * `auth` (pensado para la respuesta de login/register), este incluye
 * `createdAt`/`updatedAt` porque el listado admin los necesita para mostrar
 * antigüedad de cuenta. Nunca incluye `passwordHash` — se mapea
 * explícitamente en `service.ts`.
 */
export const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: z.enum(['ADMIN', 'USER']),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

/** `q` es opcional y filtra por `name` o `email` (contains, insensitive) en el service. */
export const ListUsersQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
});
export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;

export const ListUsersResponseSchema = paginatedResponseSchema(UserDtoSchema);
export type ListUsersResponse = z.infer<typeof ListUsersResponseSchema>;

export const UpdateRoleParamsSchema = z.object({
  id: z.string().min(1, 'El id es requerido'),
});
export type UpdateRoleParams = z.infer<typeof UpdateRoleParamsSchema>;

export const UpdateRoleBodySchema = z.object({
  role: z.enum(['ADMIN', 'USER']),
});
export type UpdateRoleBody = z.infer<typeof UpdateRoleBodySchema>;
