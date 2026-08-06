import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CustomersService } from './service.js';
import type { CustomerBody, CustomerIdParams, ListCustomersQuery } from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

export interface CustomersController {
  list(request: FastifyRequest<{ Querystring: ListCustomersQuery }>, reply: FastifyReply): Promise<void>;
  getById(request: FastifyRequest<{ Params: CustomerIdParams }>, reply: FastifyReply): Promise<void>;
  create(request: FastifyRequest<{ Body: CustomerBody }>, reply: FastifyReply): Promise<void>;
  update(request: FastifyRequest<{ Params: CustomerIdParams; Body: CustomerBody }>, reply: FastifyReply): Promise<void>;
  remove(request: FastifyRequest<{ Params: CustomerIdParams }>, reply: FastifyReply): Promise<void>;
}

export function createCustomersController(customersService: CustomersService): CustomersController {
  return {
    async list(request, reply) {
      const { page, limit, q } = request.query;
      const result = await customersService.list({ page, limit, q });
      await reply.code(HTTP_OK).send(result);
    },

    async getById(request, reply) {
      const customer = await customersService.getById(request.params.id);
      await reply.code(HTTP_OK).send(customer);
    },

    async create(request, reply) {
      const created = await customersService.create(request.body);
      await reply.code(HTTP_CREATED).send(created);
    },

    async update(request, reply) {
      const updated = await customersService.update(request.params.id, request.body);
      await reply.code(HTTP_OK).send(updated);
    },

    async remove(request, reply) {
      await customersService.delete(request.params.id);
      await reply.code(HTTP_NO_CONTENT).send();
    },
  };
}
