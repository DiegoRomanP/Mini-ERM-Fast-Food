import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OrderActor, OrdersService } from './service.js';
import type { CreateOrderBody, ListOrdersQuery, OrderIdParams, UpdateOrderStatusBody } from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/**
 * Actor autenticado a partir del JWT ya verificado por `app.authenticate`
 * (hook `onRequest` del plugin de rutas). Es la única fuente de identidad
 * que llega al service: nunca se toma el `userId` del body ni de la query,
 * para que no se pueda suplantar a otro usuario.
 */
function actorFrom(request: FastifyRequest): OrderActor {
  return { userId: request.user.sub, role: request.user.role };
}

export interface OrdersController {
  create(request: FastifyRequest<{ Body: CreateOrderBody }>, reply: FastifyReply): Promise<void>;
  list(request: FastifyRequest<{ Querystring: ListOrdersQuery }>, reply: FastifyReply): Promise<void>;
  getById(request: FastifyRequest<{ Params: OrderIdParams }>, reply: FastifyReply): Promise<void>;
  updateStatus(
    request: FastifyRequest<{ Params: OrderIdParams; Body: UpdateOrderStatusBody }>,
    reply: FastifyReply,
  ): Promise<void>;
}

export function createOrdersController(ordersService: OrdersService): OrdersController {
  return {
    async create(request, reply) {
      const created = await ordersService.create(request.user.sub, request.body);
      await reply.code(HTTP_CREATED).send(created);
    },

    async list(request, reply) {
      const { page, limit, status, customerId, from, to } = request.query;
      const result = await ordersService.list(actorFrom(request), { page, limit, status, customerId, from, to });
      await reply.code(HTTP_OK).send(result);
    },

    async getById(request, reply) {
      const order = await ordersService.getById(actorFrom(request), request.params.id);
      await reply.code(HTTP_OK).send(order);
    },

    async updateStatus(request, reply) {
      const updated = await ordersService.updateStatus(actorFrom(request), request.params.id, request.body.status);
      await reply.code(HTTP_OK).send(updated);
    },
  };
}
