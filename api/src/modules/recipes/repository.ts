import type { Recipe } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import type { Ingredients } from './schema.js';

export interface FindManyRecipesParams {
  skip: number;
  take: number;
  q?: string;
}

export interface FindManyRecipesResult {
  items: Recipe[];
  total: number;
}

export interface RecipeWriteData {
  name: string;
  ingredients: Ingredients;
}

/**
 * Acceso a datos del módulo recipes (capa repository). Envuelve las
 * llamadas a Prisma para que `service.ts` no dependa directamente del
 * cliente ni exponga los modelos de Prisma fuera de este módulo.
 */
export const recipesRepository = {
  async findMany(params: FindManyRecipesParams): Promise<FindManyRecipesResult> {
    const where: Prisma.RecipeWhereInput = params.q ? { name: { contains: params.q, mode: 'insensitive' } } : {};

    const [items, total] = await Promise.all([
      prisma.recipe.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.recipe.count({ where }),
    ]);

    return { items, total };
  },

  findById(id: string): Promise<Recipe | null> {
    return prisma.recipe.findUnique({ where: { id } });
  },

  findByName(name: string): Promise<Recipe | null> {
    return prisma.recipe.findUnique({ where: { name } });
  },

  create(data: RecipeWriteData): Promise<Recipe> {
    return prisma.recipe.create({
      data: { name: data.name, ingredients: data.ingredients },
    });
  },

  update(id: string, data: RecipeWriteData): Promise<Recipe> {
    return prisma.recipe.update({
      where: { id },
      data: { name: data.name, ingredients: data.ingredients },
    });
  },

  async delete(id: string): Promise<void> {
    await prisma.recipe.delete({ where: { id } });
  },

  /**
   * Cuenta `OrderItem`s que referencian esta receta. Usado por el service
   * para bloquear el `DELETE` con 409 (`RECIPE_IN_USE`) en vez de dejar que
   * el error de FK constraint de Postgres burbujee como 500: la relación
   * `Recipe -> OrderItem` no tiene `onCascade` (solo `Order -> OrderItem` lo
   * tiene), así que un delete directo de una receta referenciada fallaría en
   * la base de datos.
   */
  countOrderItemsByRecipeId(recipeId: string): Promise<number> {
    return prisma.orderItem.count({ where: { recipeId } });
  },
};

export type RecipesRepository = typeof recipesRepository;
