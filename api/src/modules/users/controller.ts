import type { FastifyReply, FastifyRequest } from 'fastify';
import type { UsersService } from './service.js';
import type { ListUsersQuery, UpdateRoleBody, UpdateRoleParams } from './schema.js';

const HTTP_OK = 200;

export interface UsersController {
  list(request: FastifyRequest<{ Querystring: ListUsersQuery }>, reply: FastifyReply): Promise<void>;
  updateRole(
    request: FastifyRequest<{ Params: UpdateRoleParams; Body: UpdateRoleBody }>,
    reply: FastifyReply,
  ): Promise<void>;
}

export function createUsersController(usersService: UsersService): UsersController {
  return {
    async list(request, reply) {
      const { page, limit, q } = request.query;
      const result = await usersService.list({ page, limit, q });
      await reply.code(HTTP_OK).send(result);
    },

    async updateRole(request, reply) {
      const updated = await usersService.updateRole(request.params.id, request.body.role);
      await reply.code(HTTP_OK).send(updated);
    },
  };
}
