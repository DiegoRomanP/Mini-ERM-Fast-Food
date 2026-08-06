// Ver `modules/auth/schema.ts` para el detalle del workaround: hay que
// importar `zod/v4` (no `zod`) porque fastify-type-provider-zod@5 valida
// contra el engine interno de Zod v4 y el paquete `zod` instalado resuelve
// por defecto a la API v3 clásica.
import { z } from 'zod/v4';
import { PaginationQuerySchema, paginatedResponseSchema } from '../../shared/pagination.js';
import { UnitSchema } from '../inventory/schema.js';

/**
 * Un ingrediente de receta, tal como se guarda dentro del campo `Json`
 * `Recipe.ingredients` (no hay tabla intermedia). `inventoryItemId` se
 * valida de forma async contra `InventoryItem` en el service (Zod no puede
 * hacer async) — ver `RecipesService.assertIngredientsExist`.
 */
export const IngredientSchema = z.object({
  inventoryItemId: z.string().min(1, 'inventoryItemId es requerido'),
  quantityNeeded: z.number().positive('quantityNeeded debe ser mayor a 0'),
});
export type Ingredient = z.infer<typeof IngredientSchema>;

export const IngredientsSchema = z.array(IngredientSchema).min(1, 'La receta requiere al menos un ingrediente');
export type Ingredients = z.infer<typeof IngredientsSchema>;

/**
 * Ingrediente enriquecido (populate) para el detalle de receta
 * (`GET /recipes/:id`). `name`/`unit` son `nullable`: `ingredients` es Json
 * suelto sin FK real en la base de datos, así que el `InventoryItem`
 * referenciado puede haber sido borrado después de crear la receta. En ese
 * caso se degrada a `null` en vez de romper la lectura con un 500.
 */
export const RecipeIngredientDetailSchema = z.object({
  inventoryItemId: z.string(),
  quantityNeeded: z.number(),
  name: z.string().nullable(),
  unit: UnitSchema.nullable(),
});
export type RecipeIngredientDetail = z.infer<typeof RecipeIngredientDetailSchema>;

/**
 * DTO de lista: liviano, ingredients sin populate (evita N+1 hacia
 * `inventory` por cada fila de una página). El PLAN solo pide populate en
 * el detalle (`GET /:id`).
 */
export const RecipeDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  ingredients: IngredientsSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type RecipeDto = z.infer<typeof RecipeDtoSchema>;

/** DTO de detalle: ingredients enriquecidos con `name`/`unit` del InventoryItem referenciado. */
export const RecipeDetailDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  ingredients: z.array(RecipeIngredientDetailSchema),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type RecipeDetailDto = z.infer<typeof RecipeDetailDtoSchema>;

export const ListRecipesQuerySchema = PaginationQuerySchema.extend({
  q: z.string().trim().min(1).optional(),
});
export type ListRecipesQuery = z.infer<typeof ListRecipesQuerySchema>;

export const ListRecipesResponseSchema = paginatedResponseSchema(RecipeDtoSchema);
export type ListRecipesResponse = z.infer<typeof ListRecipesResponseSchema>;

export const RecipeIdParamsSchema = z.object({
  id: z.string().min(1, 'El id es requerido'),
});
export type RecipeIdParams = z.infer<typeof RecipeIdParamsSchema>;

/**
 * Body de creación. Reutilizado también para `PUT /recipes/:id`: el
 * endpoint hace reemplazo completo (mismo criterio que `inventory` y
 * `suppliers`), así que exige el mismo shape completo, incluidos
 * `ingredients` (se revalida entero en cada `PUT`).
 */
export const RecipeBodySchema = z.object({
  name: z.string().min(1, 'El nombre es requerido'),
  ingredients: IngredientsSchema,
});
export type RecipeBody = z.infer<typeof RecipeBodySchema>;

export const CreateRecipeBodySchema = RecipeBodySchema;
export type CreateRecipeBody = RecipeBody;

export const UpdateRecipeBodySchema = RecipeBodySchema;
export type UpdateRecipeBody = RecipeBody;
