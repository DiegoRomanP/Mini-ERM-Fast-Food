import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SuppliersService } from './service.js';
import type { SupplierBody, SupplierIdParams, ListSuppliersQuery } from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

export interface SuppliersController {
  list(request: FastifyRequest<{ Querystring: ListSuppliersQuery }>, reply: FastifyReply): Promise<void>;
  getById(request: FastifyRequest<{ Params: SupplierIdParams }>, reply: FastifyReply): Promise<void>;
  create(request: FastifyRequest<{ Body: SupplierBody }>, reply: FastifyReply): Promise<void>;
  update(request: FastifyRequest<{ Params: SupplierIdParams; Body: SupplierBody }>, reply: FastifyReply): Promise<void>;
  remove(request: FastifyRequest<{ Params: SupplierIdParams }>, reply: FastifyReply): Promise<void>;
}

export function createSuppliersController(suppliersService: SuppliersService): SuppliersController {
  return {
    async list(request, reply) {
      const { page, limit, q } = request.query;
      const result = await suppliersService.list({ page, limit, q });
      await reply.code(HTTP_OK).send(result);
    },

    async getById(request, reply) {
      const supplier = await suppliersService.getById(request.params.id);
      await reply.code(HTTP_OK).send(supplier);
    },

    async create(request, reply) {
      const created = await suppliersService.create(request.body);
      await reply.code(HTTP_CREATED).send(created);
    },

    async update(request, reply) {
      const updated = await suppliersService.update(request.params.id, request.body);
      await reply.code(HTTP_OK).send(updated);
    },

    async remove(request, reply) {
      await suppliersService.delete(request.params.id);
      await reply.code(HTTP_NO_CONTENT).send();
    },
  };
}
