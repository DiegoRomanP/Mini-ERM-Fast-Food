import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createOrdersController } from './controller.js';
import { OrdersService } from './service.js';
import {
  CreateOrderBodySchema,
  ListOrdersQuerySchema,
  ListOrdersResponseSchema,
  OrderDtoSchema,
  OrderIdParamsSchema,
  UpdateOrderStatusBodySchema,
} from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/**
 * Rutas de orders, registradas por `app.ts` con prefix `/api/v1/orders`.
 * A diferencia de `recipes`/`inventory`, acá la autorización NO es por
 * función (rol) sino **por objeto**: cualquier usuario autenticado puede
 * crear y consultar órdenes, pero solo ve/gestiona las suyas
 * (`Order.userId`), salvo que sea `ADMIN`. Esa regla vive en
 * `OrdersService` porque depende de la orden concreta, no de la ruta, así
 * que acá alcanza con un único `onRequest` a nivel de plugin y no se usa el
 * sub-plugin `requireRole('ADMIN')` de los módulos con escritura
 * restringida. Ver `service.ts` para el detalle del modelo dueño+admin
 * (hallazgos SEC-01/SEC-02, `PLAN.md` §12.8 Fase QA-1).
 */
const ordersRoutes: FastifyPluginAsync = async (app) => {
  const ordersService = new OrdersService();
  const controller = createOrdersController(ordersService);

  app.addHook('onRequest', app.authenticate);

  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/',
    {
      schema: {
        tags: ['orders'],
        body: CreateOrderBodySchema,
        response: { [HTTP_CREATED]: OrderDtoSchema },
      },
    },
    controller.create,
  );

  server.get(
    '/',
    {
      schema: {
        tags: ['orders'],
        querystring: ListOrdersQuerySchema,
        response: { [HTTP_OK]: ListOrdersResponseSchema },
      },
    },
    controller.list,
  );

  server.get(
    '/:id',
    {
      schema: {
        tags: ['orders'],
        params: OrderIdParamsSchema,
        response: { [HTTP_OK]: OrderDtoSchema },
      },
    },
    controller.getById,
  );

  server.patch(
    '/:id/status',
    {
      schema: {
        tags: ['orders'],
        params: OrderIdParamsSchema,
        body: UpdateOrderStatusBodySchema,
        response: { [HTTP_OK]: OrderDtoSchema },
      },
    },
    controller.updateStatus,
  );
};

export default ordersRoutes;
