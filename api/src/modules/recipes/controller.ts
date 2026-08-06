import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RecipesService } from './service.js';
import type { ListRecipesQuery, RecipeBody, RecipeIdParams } from './schema.js';

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;

export interface RecipesController {
  list(request: FastifyRequest<{ Querystring: ListRecipesQuery }>, reply: FastifyReply): Promise<void>;
  getById(request: FastifyRequest<{ Params: RecipeIdParams }>, reply: FastifyReply): Promise<void>;
  create(request: FastifyRequest<{ Body: RecipeBody }>, reply: FastifyReply): Promise<void>;
  update(request: FastifyRequest<{ Params: RecipeIdParams; Body: RecipeBody }>, reply: FastifyReply): Promise<void>;
  remove(request: FastifyRequest<{ Params: RecipeIdParams }>, reply: FastifyReply): Promise<void>;
}

export function createRecipesController(recipesService: RecipesService): RecipesController {
  return {
    async list(request, reply) {
      const { page, limit, q } = request.query;
      const result = await recipesService.list({ page, limit, q });
      await reply.code(HTTP_OK).send(result);
    },

    async getById(request, reply) {
      const recipe = await recipesService.getById(request.params.id);
      await reply.code(HTTP_OK).send(recipe);
    },

    async create(request, reply) {
      const created = await recipesService.create(request.body);
      await reply.code(HTTP_CREATED).send(created);
    },

    async update(request, reply) {
      const updated = await recipesService.update(request.params.id, request.body);
      await reply.code(HTTP_OK).send(updated);
    },

    async remove(request, reply) {
      await recipesService.delete(request.params.id);
      await reply.code(HTTP_NO_CONTENT).send();
    },
  };
}
