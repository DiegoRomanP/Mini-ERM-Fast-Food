import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createRecipesController } from './controller.js';
import { RecipesService } from './service.js';
import {
  CreateRecipeBodySchema,
  ListRecipesQuerySchema,
  ListRecipesResponseSchema,
  RecipeDetailDtoSchema,
  RecipeIdParamsSchema,
  UpdateRecipeBodySchema,
} from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;

/**
 * Rutas de recipes, registradas por `app.ts` con prefix `/api/v1/recipes`.
 * Mismo RBAC mixto que `modules/inventory/routes.ts`: cualquier usuario
 * autenticado puede leer (GET), solo ADMIN puede escribir (POST/PUT/DELETE).
 *
 * Ver `modules/customers/routes.ts` para el detalle completo de por qué
 * `onRequest`/`preHandler` por ruta rompen la inferencia del
 * `ZodTypeProvider` (TS2345) y por qué la solución es separar las rutas de
 * escritura en un sub-plugin (`app.register`) con su propio
 * `addHook('onRequest', requireRole('ADMIN'))`, en vez de agregar el hook a
 * las options de cada `.post()/.put()/.delete()`. Se copia esa misma
 * estructura de dos plugins acá tal cual.
 */
const recipesRoutes: FastifyPluginAsync = async (app) => {
  const recipesService = new RecipesService();
  const controller = createRecipesController(recipesService);

  app.addHook('onRequest', app.authenticate);

  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/',
    {
      schema: {
        tags: ['recipes'],
        querystring: ListRecipesQuerySchema,
        response: { [HTTP_OK]: ListRecipesResponseSchema },
      },
    },
    controller.list,
  );

  server.get(
    '/:id',
    {
      schema: {
        tags: ['recipes'],
        params: RecipeIdParamsSchema,
        response: { [HTTP_OK]: RecipeDetailDtoSchema },
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
          tags: ['recipes'],
          body: CreateRecipeBodySchema,
          response: { [HTTP_CREATED]: RecipeDetailDtoSchema },
        },
      },
      controller.create,
    );

    writeServer.put(
      '/:id',
      {
        schema: {
          tags: ['recipes'],
          params: RecipeIdParamsSchema,
          body: UpdateRecipeBodySchema,
          response: { [HTTP_OK]: RecipeDetailDtoSchema },
        },
      },
      controller.update,
    );

    writeServer.delete(
      '/:id',
      {
        schema: {
          tags: ['recipes'],
          params: RecipeIdParamsSchema,
        },
      },
      controller.remove,
    );
  });
};

export default recipesRoutes;
