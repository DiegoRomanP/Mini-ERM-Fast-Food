import type { Recipe } from '@prisma/client';
import { AppError } from '../../shared/http-errors.js';
import { buildPaginationMeta, paginationSkipTake } from '../../shared/pagination.js';
import type { PaginatedResult } from '../../shared/pagination.js';
import { recipesRepository, type RecipesRepository } from './repository.js';
import { inventoryRepository, type InventoryRepository } from '../inventory/repository.js';
import { IngredientSchema } from './schema.js';
import type {
  Ingredient,
  Ingredients,
  RecipeBody,
  RecipeDetailDto,
  RecipeDto,
  RecipeIngredientDetail,
} from './schema.js';

export interface ListRecipesInput {
  page: number;
  limit: number;
  q?: string;
}

export interface RecipesServiceDeps {
  repository?: RecipesRepository;
  inventoryRepository?: InventoryRepository;
}

/**
 * Prisma tipa el campo `Json` como `JsonValue`/`unknown` al leer, así que
 * hay que revalidar con el mismo schema Zod usado para escribir en vez de
 * confiar en un `as`. Reusa `IngredientSchema` (no un array literal nuevo)
 * para no duplicar las reglas (`quantityNeeded` positivo, etc.).
 */
const IngredientsParser = IngredientSchema.array();

function parseIngredients(raw: unknown): Ingredients {
  return IngredientsParser.parse(raw);
}

function toRecipeDto(recipe: Recipe): RecipeDto {
  return {
    id: recipe.id,
    name: recipe.name,
    ingredients: parseIngredients(recipe.ingredients),
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

export class RecipesService {
  private readonly repository: RecipesRepository;
  private readonly inventoryRepository: InventoryRepository;

  constructor(deps: RecipesServiceDeps = {}) {
    this.repository = deps.repository ?? recipesRepository;
    this.inventoryRepository = deps.inventoryRepository ?? inventoryRepository;
  }

  async list(input: ListRecipesInput): Promise<PaginatedResult<RecipeDto>> {
    const { skip, take } = paginationSkipTake({ page: input.page, limit: input.limit });
    const { items, total } = await this.repository.findMany({ skip, take, q: input.q });

    return {
      data: items.map(toRecipeDto),
      meta: buildPaginationMeta({ page: input.page, limit: input.limit, total }),
    };
  }

  async getById(id: string): Promise<RecipeDetailDto> {
    const recipe = await this.repository.findById(id);
    if (!recipe) {
      throw AppError.notFound('Receta no encontrada', 'RECIPE_NOT_FOUND');
    }
    return this.toDetailDto(recipe);
  }

  async create(input: RecipeBody): Promise<RecipeDetailDto> {
    await this.assertNameAvailable(input.name);
    await this.assertIngredientsExist(input.ingredients);

    const created = await this.repository.create({
      name: input.name,
      ingredients: input.ingredients,
    });
    return this.toDetailDto(created);
  }

  async update(id: string, input: RecipeBody): Promise<RecipeDetailDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw AppError.notFound('Receta no encontrada', 'RECIPE_NOT_FOUND');
    }

    if (input.name !== existing.name) {
      await this.assertNameAvailable(input.name);
    }
    await this.assertIngredientsExist(input.ingredients);

    const updated = await this.repository.update(id, {
      name: input.name,
      ingredients: input.ingredients,
    });
    return this.toDetailDto(updated);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw AppError.notFound('Receta no encontrada', 'RECIPE_NOT_FOUND');
    }

    const usageCount = await this.repository.countOrderItemsByRecipeId(id);
    if (usageCount > 0) {
      throw AppError.conflict(
        'La receta está referenciada por al menos un pedido y no se puede eliminar',
        'RECIPE_IN_USE',
      );
    }

    await this.repository.delete(id);
  }

  /** Populate: enriquece cada ingrediente con `name`/`unit` del InventoryItem referenciado. */
  private async toDetailDto(recipe: Recipe): Promise<RecipeDetailDto> {
    const ingredients = parseIngredients(recipe.ingredients);
    const enriched = await Promise.all(
      ingredients.map((ingredient): Promise<RecipeIngredientDetail> => this.enrichIngredient(ingredient)),
    );

    return {
      id: recipe.id,
      name: recipe.name,
      ingredients: enriched,
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    };
  }

  private async enrichIngredient(ingredient: Ingredient): Promise<RecipeIngredientDetail> {
    const item = await this.inventoryRepository.findById(ingredient.inventoryItemId);
    return {
      inventoryItemId: ingredient.inventoryItemId,
      quantityNeeded: ingredient.quantityNeeded,
      name: item?.name ?? null,
      unit: item?.unit ?? null,
    };
  }

  private async assertNameAvailable(name: string): Promise<void> {
    const existing = await this.repository.findByName(name);
    if (existing) {
      throw AppError.conflict('Ya existe una receta con ese nombre', 'RECIPE_NAME_ALREADY_EXISTS');
    }
  }

  /**
   * Valida que cada `inventoryItemId` referenciado exista en `InventoryItem`.
   * `ingredients` se guarda como Json suelto (sin FK real en la base), así
   * que esta validación de aplicación es la única barrera contra ids
   * inventados. Mismo criterio que `InventoryService.assertSupplierExists`:
   * 400 `BAD_REQUEST` (no 404) porque el recurso faltante no es el de la
   * URL, es una referencia inválida dentro del body — y el mismo código,
   * `INVENTORY_ITEM_NOT_FOUND`, para que el consumidor (incluido el futuro
   * `OrdersCreate` de Fase 4-siguiente, que también valida `recipeId` /
   * stock contra `inventory`) tenga un contrato consistente.
   */
  private async assertIngredientsExist(ingredients: Ingredients): Promise<void> {
    const uniqueIds = [...new Set(ingredients.map((ingredient) => ingredient.inventoryItemId))];
    const results = await Promise.all(
      uniqueIds.map(async (id) => ({ id, item: await this.inventoryRepository.findById(id) })),
    );
    const missingIds = results.filter((result) => !result.item).map((result) => result.id);

    if (missingIds.length > 0) {
      throw AppError.badRequest(
        'Uno o más ingredientes referencian un item de inventario inexistente',
        'INVENTORY_ITEM_NOT_FOUND',
        { missingIds },
      );
    }
  }
}
