import type { FastifyReply, FastifyRequest } from 'fastify';
import type { InventoryService } from './service.js';
import type { InventoryBody, InventoryIdParams, ListInventoryQuery } from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

export interface InventoryController {
  list(request: FastifyRequest<{ Querystring: ListInventoryQuery }>, reply: FastifyReply): Promise<void>;
  getById(request: FastifyRequest<{ Params: InventoryIdParams }>, reply: FastifyReply): Promise<void>;
  create(request: FastifyRequest<{ Body: InventoryBody }>, reply: FastifyReply): Promise<void>;
  update(
    request: FastifyRequest<{ Params: InventoryIdParams; Body: InventoryBody }>,
    reply: FastifyReply,
  ): Promise<void>;
  remove(request: FastifyRequest<{ Params: InventoryIdParams }>, reply: FastifyReply): Promise<void>;
}

export function createInventoryController(inventoryService: InventoryService): InventoryController {
  return {
    async list(request, reply) {
      const { page, limit, q, category, type, supplierId, lowStock } = request.query;
      const result = await inventoryService.list({
        page,
        limit,
        q,
        category,
        type,
        supplierId,
        lowStock,
      });
      await reply.code(HTTP_OK).send(result);
    },

    async getById(request, reply) {
      const item = await inventoryService.getById(request.params.id);
      await reply.code(HTTP_OK).send(item);
    },

    async create(request, reply) {
      const created = await inventoryService.create(request.body);
      await reply.code(HTTP_CREATED).send(created);
    },

    async update(request, reply) {
      const updated = await inventoryService.update(request.params.id, request.body);
      await reply.code(HTTP_OK).send(updated);
    },

    async remove(request, reply) {
      await inventoryService.delete(request.params.id);
      await reply.code(HTTP_NO_CONTENT).send();
    },
  };
}
