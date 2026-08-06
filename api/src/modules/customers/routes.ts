import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createCustomersController } from './controller.js';
import { CustomersService } from './service.js';
import {
  CreateCustomerBodySchema,
  CustomerDtoSchema,
  CustomerIdParamsSchema,
  ListCustomersQuerySchema,
  ListCustomersResponseSchema,
  UpdateCustomerBodySchema,
} from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/**
 * Rutas de customers, registradas por `app.ts` con prefix
 * `/api/v1/customers`. A diferencia de `modules/users/routes.ts` (todo el
 * plugin exige ADMIN), acá el RBAC es mixto: cualquier usuario autenticado
 * puede leer (GET), pero solo ADMIN puede escribir (POST/PUT/DELETE).
 *
 * Se probaron, en orden, las dos alternativas sugeridas para esto y ambas
 * rompen la inferencia de tipos del `ZodTypeProvider` igual que `onRequest`
 * (confirmado compilando con `tsc --noEmit`, ver detalle abajo):
 *
 *   1. `onRequest: [app.requireRole('ADMIN')]` dentro de las options de cada
 *      ruta individual junto a `schema` — mismo problema documentado en
 *      `users/routes.ts` para `authenticate`.
 *   2. `preHandler: [app.requireRole('ADMIN')]` dentro de las options de
 *      cada ruta individual: también rompe la inferencia (TS2345 en
 *      `request.body`/`request.params`, que caen a `unknown`) porque
 *      Fastify resuelve el tipo de la request contra el *shape completo* de
 *      las options de la ruta antes de aplicar el type provider, y agregar
 *      cualquier propiedad de hook adicional (`preHandler` incluido) ahí
 *      hace perder el overload correcto — no es un problema exclusivo de
 *      `onRequest`.
 *
 * La solución que sí compila limpio: separar las rutas de escritura en un
 * sub-plugin encapsulado (`customersWriteRoutes`), registrado con el mismo
 * prefix (`app.register` anida contexto, no rutas — registrar dos plugins
 * bajo el mismo prefix es válido en Fastify), con su propio
 * `addHook('onRequest', app.requireRole('ADMIN'))` a nivel de *ese* plugin.
 * Así el hook nunca convive con `schema` en las options de una misma
 * llamada a `.post()/.put()/.delete()`, que es lo que preserva la
 * inferencia. El plugin principal solo exige `authenticate` (sesión válida)
 * y por lo tanto el GET queda abierto a cualquier user autenticado.
 *
 * `suppliers` e `inventory` (que vienen después y combinan el mismo patrón
 * de lectura abierta + escritura admin) deberían copiar esta estructura de
 * dos plugins en vez de intentar `onRequest`/`preHandler` por ruta.
 */
const customersRoutes: FastifyPluginAsync = async (app) => {
  const customersService = new CustomersService();
  const controller = createCustomersController(customersService);

  app.addHook('onRequest', app.authenticate);

  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/',
    {
      schema: {
        tags: ['customers'],
        querystring: ListCustomersQuerySchema,
        response: { [HTTP_OK]: ListCustomersResponseSchema },
      },
    },
    controller.list,
  );

  server.get(
    '/:id',
    {
      schema: {
        tags: ['customers'],
        params: CustomerIdParamsSchema,
        response: { [HTTP_OK]: CustomerDtoSchema },
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
          tags: ['customers'],
          body: CreateCustomerBodySchema,
          response: { [HTTP_CREATED]: CustomerDtoSchema },
        },
      },
      controller.create,
    );

    writeServer.put(
      '/:id',
      {
        schema: {
          tags: ['customers'],
          params: CustomerIdParamsSchema,
          body: UpdateCustomerBodySchema,
          response: { [HTTP_OK]: CustomerDtoSchema },
        },
      },
      controller.update,
    );

    writeServer.delete(
      '/:id',
      {
        schema: {
          tags: ['customers'],
          params: CustomerIdParamsSchema,
        },
      },
      controller.remove,
    );
  });
};

export default customersRoutes;
