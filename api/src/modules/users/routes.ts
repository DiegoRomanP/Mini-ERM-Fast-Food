import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createUsersController } from './controller.js';
import { UsersService } from './service.js';
import {
  ListUsersQuerySchema,
  ListUsersResponseSchema,
  UpdateRoleBodySchema,
  UpdateRoleParamsSchema,
  UserDtoSchema,
} from './schema.js';

const HTTP_OK = 200;

/**
 * Rutas de administración de usuarios, registradas por `app.ts` con prefix
 * `/api/v1/users`. Todas las rutas requieren rol ADMIN: se encadenan
 * `app.authenticate` (401 si falta/expiró el token, vía `AppError`) y
 * `app.requireRole('ADMIN')` (403 si el rol no coincide). `requireRole` por
 * sí solo también verifica el JWT, pero lo hace sin capturar el error de
 * `jwtVerify`, así que encadenar `authenticate` primero asegura que un
 * token ausente/ inválido responda 401 estructurado en vez de un 500
 * genérico del error handler.
 */
const usersRoutes: FastifyPluginAsync = async (app) => {
  const usersService = new UsersService();
  const controller = createUsersController(usersService);

  // Se registran como hooks a nivel de plugin (no dentro de cada `schema`
  // de ruta) porque combinar `onRequest` con el `ZodTypeProvider` en las
  // opciones de una misma llamada a `.get()/.patch()` rompe la inferencia
  // de tipos de Fastify: TS deja de resolver el overload que tipa
  // `request.query`/`request.body` contra el schema Zod y cae a un
  // `RouteGenericInterface` genérico (`unknown`), lo que hace que
  // `controller.list`/`controller.updateRole` (tipados con los DTOs
  // concretos) dejen de ser asignables. Encapsulado en este plugin, el hook
  // solo aplica a las rutas de `/api/v1/users`.
  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.requireRole('ADMIN'));

  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/',
    {
      schema: {
        tags: ['users'],
        querystring: ListUsersQuerySchema,
        response: { [HTTP_OK]: ListUsersResponseSchema },
      },
    },
    controller.list,
  );

  server.patch(
    '/:id/role',
    {
      schema: {
        tags: ['users'],
        params: UpdateRoleParamsSchema,
        body: UpdateRoleBodySchema,
        response: { [HTTP_OK]: UserDtoSchema },
      },
    },
    controller.updateRole,
  );
};

export default usersRoutes;
