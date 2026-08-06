import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createInventoryController } from './controller.js';
import { InventoryService } from './service.js';
import {
  CreateInventoryBodySchema,
  InventoryItemDtoSchema,
  InventoryIdParamsSchema,
  ListInventoryQuerySchema,
  ListInventoryResponseSchema,
  UpdateInventoryBodySchema,
} from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/**
 * Rutas de inventory, registradas por `app.ts` con prefix
 * `/api/v1/inventory`. Mismo RBAC mixto que `modules/suppliers/routes.ts`:
 * cualquier usuario autenticado puede leer (GET), solo ADMIN puede escribir
 * (POST/PUT/DELETE).
 *
 * Ver `modules/customers/routes.ts` para el detalle completo de por qué
 * `onRequest`/`preHandler` por ruta rompen la inferencia del
 * `ZodTypeProvider` (TS2345) y por qué la solución es separar las rutas de
 * escritura en un sub-plugin (`app.register`) con su propio
 * `addHook('onRequest', requireRole('ADMIN'))`, en vez de agregar el hook a
 * las options de cada `.post()/.put()/.delete()`. Se copia esa misma
 * estructura de dos plugins acá tal cual.
 */
const inventoryRoutes: FastifyPluginAsync = async (app) => {
  const inventoryService = new InventoryService();
  const controller = createInventoryController(inventoryService);

  app.addHook('onRequest', app.authenticate);

  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/',
    {
      schema: {
        tags: ['inventory'],
        querystring: ListInventoryQuerySchema,
        response: { [HTTP_OK]: ListInventoryResponseSchema },
      },
    },
    controller.list,
  );

  server.get(
    '/:id',
    {
      schema: {
        tags: ['inventory'],
        params: InventoryIdParamsSchema,
        response: { [HTTP_OK]: InventoryItemDtoSchema },
      },
    },
    controller.getById,
  );

  await app.register(async (writeApp) => {
    writeApp.addHook('onRequest', writeApp.requireRole('ADMIN'));

    const writeServer = writeApp.withTypeProvider<ZodTypeProvider>();

    writeServer.post(
      '/',
      {
        schema: {
          tags: ['inventory'],
          body: CreateInventoryBodySchema,
          response: { [HTTP_CREATED]: InventoryItemDtoSchema },
        },
      },
      controller.create,
    );

    writeServer.put(
      '/:id',
      {
        schema: {
          tags: ['inventory'],
          params: InventoryIdParamsSchema,
          body: UpdateInventoryBodySchema,
          response: { [HTTP_OK]: InventoryItemDtoSchema },
        },
      },
      controller.update,
    );

    writeServer.delete(
      '/:id',
      {
        schema: {
          tags: ['inventory'],
          params: InventoryIdParamsSchema,
        },
      },
      controller.remove,
    );
  });
};

export default inventoryRoutes;
