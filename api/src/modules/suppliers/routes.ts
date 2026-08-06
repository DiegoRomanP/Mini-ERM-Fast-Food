import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createSuppliersController } from './controller.js';
import { SuppliersService } from './service.js';
import {
  CreateSupplierBodySchema,
  SupplierDtoSchema,
  SupplierIdParamsSchema,
  ListSuppliersQuerySchema,
  ListSuppliersResponseSchema,
  UpdateSupplierBodySchema,
} from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/**
 * Rutas de suppliers, registradas por `app.ts` con prefix
 * `/api/v1/suppliers`. Mismo RBAC mixto que `modules/customers/routes.ts`:
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
const suppliersRoutes: FastifyPluginAsync = async (app) => {
  const suppliersService = new SuppliersService();
  const controller = createSuppliersController(suppliersService);

  app.addHook('onRequest', app.authenticate);

  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/',
    {
      schema: {
        tags: ['suppliers'],
        querystring: ListSuppliersQuerySchema,
        response: { [HTTP_OK]: ListSuppliersResponseSchema },
      },
    },
    controller.list,
  );

  server.get(
    '/:id',
    {
      schema: {
        tags: ['suppliers'],
        params: SupplierIdParamsSchema,
        response: { [HTTP_OK]: SupplierDtoSchema },
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
          tags: ['suppliers'],
          body: CreateSupplierBodySchema,
          response: { [HTTP_CREATED]: SupplierDtoSchema },
        },
      },
      controller.create,
    );

    writeServer.put(
      '/:id',
      {
        schema: {
          tags: ['suppliers'],
          params: SupplierIdParamsSchema,
          body: UpdateSupplierBodySchema,
          response: { [HTTP_OK]: SupplierDtoSchema },
        },
      },
      controller.update,
    );

    writeServer.delete(
      '/:id',
      {
        schema: {
          tags: ['suppliers'],
          params: SupplierIdParamsSchema,
        },
      },
      controller.remove,
    );
  });
};

export default suppliersRoutes;
