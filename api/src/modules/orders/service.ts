import type { InventoryItem, OrderStatus, Recipe, Role } from '@prisma/client';
import { AppError } from '../../shared/http-errors.js';
import { buildPaginationMeta, paginationSkipTake } from '../../shared/pagination.js';
import type { PaginatedResult } from '../../shared/pagination.js';
import { IngredientSchema } from '../recipes/schema.js';
import type { Ingredients } from '../recipes/schema.js';
import { ordersRepository, type OrderTx, type OrderWithItems, type OrdersRepository } from './repository.js';
import type { CreateOrderBody, OrderDto, OrderItemDto } from './schema.js';

/**
 * Prisma tipa el campo `Json` (`Recipe.ingredients`) como `JsonValue` al
 * leer, así que hay que revalidarlo con el mismo schema Zod usado por el
 * módulo recipes para escribirlo, en vez de confiar en un `as`. Mismo
 * patrón que `RecipesService` (`recipes/service.ts`).
 */
const IngredientsParser = IngredientSchema.array();

function parseIngredients(raw: unknown): Ingredients {
  return IngredientsParser.parse(raw);
}

/** Una línea del pedido ya resuelta contra su receta (nombre + ingredientes). */
interface OrderLine {
  recipeId: string;
  recipeName: string;
  quantity: number;
  ingredients: Ingredients;
}

/** Insumo faltante para completar el pedido — detalle devuelto en el 409. */
interface StockShortage {
  inventoryItemId: string;
  name: string;
  required: number;
  available: number;
}

export interface OrdersServiceDeps {
  repository?: OrdersRepository;
}

/** Rol con acceso irrestricto a las órdenes de todos los usuarios. */
const ADMIN_ROLE: Role = 'ADMIN';

/**
 * Actor autenticado que ejecuta la operación, tal como lo arma el controller
 * a partir del JWT (`request.user`). El service lo usa para autorizar a nivel
 * de objeto: nunca lee la identidad de otro lado (ni de query ni de body), así
 * que un id de orden manipulado en la URL no puede saltarse el chequeo.
 */
export interface OrderActor {
  userId: string;
  role: Role;
}

/**
 * `true` si el actor puede ver/gestionar `order`: el dueño que la registró
 * (`Order.userId`) o cualquier `ADMIN`.
 */
function canAccessOrder(actor: OrderActor, order: { userId: string }): boolean {
  return actor.role === ADMIN_ROLE || order.userId === actor.userId;
}

export interface ListOrdersInput {
  page: number;
  limit: number;
  status?: OrderStatus;
  customerId?: string;
  /** ISO 8601 (ya validado por Zod en `schema.ts`); se convierte a `Date` acá antes de llegar al repository. */
  from?: string;
  to?: string;
}

/**
 * Service del módulo orders. `create` implementa el flujo de creación:
 * valida `customerId`/`recipeId`, expande ingredientes, bloquea y descuenta
 * stock, y persiste la orden — todo dentro de una única transacción ACID
 * (`prisma.$transaction`). Ver `PLAN.md` sección 4 (Orders) y sección 8
 * (Riesgos) para el detalle de por qué se necesita locking pesimista
 * (`SELECT ... FOR UPDATE`) en vez de confiar en el aislamiento por defecto
 * de Postgres: sin el lock, dos pedidos concurrentes podrían leer el mismo
 * `stock`, ambos validar que alcanza, y ambos descontar — sobrevendiendo el
 * insumo.
 *
 * `list`/`getById`/`updateStatus` son consulta/actualización simples fuera
 * de transacción (sobre el `prisma` singleton, vía `ordersRepository`) — no
 * hay condición de carrera que proteger en esos casos. `updateStatus` no
 * restringe ninguna transición: el PLAN no especifica una máquina de
 * estados para `PATCH /orders/:id/status`, así que se acepta cualquier
 * valor válido del enum (incluida una transición "para atrás", p. ej.
 * `COMPLETADO` -> `PENDIENTE`); si en el futuro se necesita restringir
 * transiciones, es un cambio aislado a este método.
 *
 * **Autorización a nivel de objeto (OWASP API1:2023 — BOLA).** Modelo
 * "dueño + admin": un `USER` solo ve/gestiona las órdenes que él registró
 * (`Order.userId`), un `ADMIN` ve/gestiona todas. Esto vive acá (y no en
 * `routes.ts` como un `requireRole`) porque el permiso depende del objeto
 * concreto, no de la función invocada: `list` filtra por `userId` en el
 * `where` (autorización en la capa de datos, no post-filtrado en memoria) y
 * `getById`/`updateStatus` comprueban propiedad tras leer la fila.
 *
 * Una orden ajena responde **404 `ORDER_NOT_FOUND`, no 403**: un 403
 * confirmaría al atacante que ese id existe, permitiéndole enumerar órdenes
 * de otros usuarios; el 404 hace indistinguible "no existe" de "no es tuya".
 *
 * Esto supersede el `PATCH /orders/:id/status (admin)` de la sección 4 del
 * PLAN (hallazgo SEC-02): con el modelo dueño+admin, el dueño puede cambiar
 * el estado de SU orden y el `ADMIN` el de cualquiera, así que no hace falta
 * restringir la ruta a admin-only. Ver `PLAN.md` §12.8 (Fase QA-1).
 */
export class OrdersService {
  private readonly repository: OrdersRepository;

  constructor(deps: OrdersServiceDeps = {}) {
    this.repository = deps.repository ?? ordersRepository;
  }

  async create(userId: string, input: CreateOrderBody): Promise<OrderDto> {
    const created = await this.repository.runInTransaction((tx) => this.createWithinTx(tx, userId, input));
    return toOrderDto(created);
  }

  async list(actor: OrderActor, input: ListOrdersInput): Promise<PaginatedResult<OrderDto>> {
    const { skip, take } = paginationSkipTake({ page: input.page, limit: input.limit });
    const { orders, total } = await this.repository.findMany({
      skip,
      take,
      status: input.status,
      customerId: input.customerId,
      from: input.from ? new Date(input.from) : undefined,
      to: input.to ? new Date(input.to) : undefined,
      // Se combina en AND con el resto de filtros; `undefined` para ADMIN.
      userId: actor.role === ADMIN_ROLE ? undefined : actor.userId,
    });

    return {
      data: orders.map(toOrderDto),
      meta: buildPaginationMeta({ page: input.page, limit: input.limit, total }),
    };
  }

  async getById(actor: OrderActor, id: string): Promise<OrderDto> {
    const order = await this.findAccessibleOrThrow(actor, id);
    return toOrderDto(order);
  }

  async updateStatus(actor: OrderActor, id: string, status: OrderStatus): Promise<OrderDto> {
    await this.findAccessibleOrThrow(actor, id);
    const updated = await this.repository.updateStatus(id, status);
    return toOrderDto(updated);
  }

  /**
   * Lee la orden y aplica el chequeo de propiedad. Devuelve el mismo 404
   * `ORDER_NOT_FOUND` para "no existe" y para "existe pero es de otro", así
   * que la respuesta no filtra la existencia de recursos ajenos.
   */
  private async findAccessibleOrThrow(actor: OrderActor, id: string): Promise<OrderWithItems> {
    const order = await this.repository.findById(id);
    if (!order || !canAccessOrder(actor, order)) {
      throw AppError.notFound('Orden no encontrada', 'ORDER_NOT_FOUND');
    }
    return order;
  }

  private async createWithinTx(tx: OrderTx, userId: string, input: CreateOrderBody) {
    const customer = await this.repository.findCustomerById(tx, input.customerId);
    if (!customer) {
      throw AppError.notFound('Cliente no encontrado', 'CUSTOMER_NOT_FOUND');
    }

    const lines = await this.resolveOrderLines(tx, input);
    const requiredByItemId = accumulateRequiredStock(lines);
    const lockedItems = await this.lockRequiredInventory(tx, requiredByItemId);

    assertStockAvailable(requiredByItemId, lockedItems);

    for (const [inventoryItemId, requiredQuantity] of requiredByItemId) {
      await this.repository.decrementInventoryStock(tx, inventoryItemId, requiredQuantity);
    }

    const total = calculateOrderTotal(lines, lockedItems);

    return this.repository.createOrder(tx, {
      userId,
      customerId: input.customerId,
      total,
      items: lines.map((line) => ({
        recipeId: line.recipeId,
        recipeName: line.recipeName,
        quantity: line.quantity,
      })),
    });
  }

  /**
   * Resuelve cada item del body contra su `Recipe` (una sola query
   * `findMany` por los ids únicos, no N+1). Si algún `recipeId` no existe,
   * 400 `RECIPE_NOT_FOUND` con el detalle de qué ids faltan — mismo
   * contrato que `INVENTORY_ITEM_NOT_FOUND` en `recipes/service.ts`
   * (referencia inválida dentro del body, no el recurso de la URL).
   */
  private async resolveOrderLines(tx: OrderTx, input: CreateOrderBody): Promise<OrderLine[]> {
    const uniqueRecipeIds = [...new Set(input.items.map((item) => item.recipeId))];
    const recipes = await this.repository.findRecipesByIds(tx, uniqueRecipeIds);
    const recipeById = new Map<string, Recipe>(recipes.map((recipe) => [recipe.id, recipe]));

    const missingIds = uniqueRecipeIds.filter((id) => !recipeById.has(id));
    if (missingIds.length > 0) {
      throw AppError.badRequest('Uno o más items referencian una receta inexistente', 'RECIPE_NOT_FOUND', {
        missingIds,
      });
    }

    return input.items.map((item) => {
      const recipe = recipeById.get(item.recipeId);
      if (!recipe) {
        // Inalcanzable: ya se validó arriba que no falta ningún recipeId.
        throw AppError.badRequest('Receta no encontrada', 'RECIPE_NOT_FOUND', {
          missingIds: [item.recipeId],
        });
      }
      return {
        recipeId: recipe.id,
        recipeName: recipe.name,
        quantity: item.quantity,
        ingredients: parseIngredients(recipe.ingredients),
      };
    });
  }

  /**
   * Bloquea con `FOR UPDATE`, dentro de la transacción, cada `InventoryItem`
   * único requerido por el pedido — en orden ascendente de id (`Map` ya
   * viene ordenado así, ver `accumulateRequiredStock`) para que dos
   * transacciones concurrentes que compitan por los mismos insumos los
   * bloqueen siempre en el mismo orden global y Postgres nunca las
   * deadlockee entre sí (una espera a la otra en vez de que ambas se
   * bloqueen mutuamente).
   */
  private async lockRequiredInventory(
    tx: OrderTx,
    requiredByItemId: Map<string, number>,
  ): Promise<Map<string, InventoryItem>> {
    const lockedItems = new Map<string, InventoryItem>();
    const missingIds: string[] = [];

    for (const inventoryItemId of requiredByItemId.keys()) {
      const locked = await this.repository.lockInventoryItemById(tx, inventoryItemId);
      if (!locked) {
        missingIds.push(inventoryItemId);
        continue;
      }
      lockedItems.set(inventoryItemId, locked);
    }

    if (missingIds.length > 0) {
      throw AppError.badRequest(
        'Uno o más ingredientes referencian un item de inventario inexistente',
        'INVENTORY_ITEM_NOT_FOUND',
        { missingIds },
      );
    }

    return lockedItems;
  }
}

/**
 * Expande los ingredientes de cada línea del pedido (multiplicados por su
 * `quantity`) y acumula la cantidad total requerida por `inventoryItemId`,
 * sumando entre líneas si varias recetas del pedido comparten el mismo
 * insumo. Las claves quedan en el orden de primera aparición; se ordenan acá
 * (`.sort()` sobre los ids) antes de devolver el `Map`, así que iterar sus
 * entradas ya recorre los insumos en orden ascendente de id.
 */
function accumulateRequiredStock(lines: OrderLine[]): Map<string, number> {
  const required = new Map<string, number>();

  for (const line of lines) {
    for (const ingredient of line.ingredients) {
      const neededForLine = ingredient.quantityNeeded * line.quantity;
      const previous = required.get(ingredient.inventoryItemId) ?? 0;
      required.set(ingredient.inventoryItemId, previous + neededForLine);
    }
  }

  const sortedEntries = [...required.entries()].sort(([a], [b]) => a.localeCompare(b));
  return new Map(sortedEntries);
}

/**
 * Valida que el `stock` bloqueado alcance para cada insumo requerido. Si
 * alguno no alcanza, junta el detalle de todos los faltantes (no solo el
 * primero) y aborta con 409 — Prisma hace rollback automático de la
 * transacción al propagar la excepción fuera del callback.
 */
function assertStockAvailable(requiredByItemId: Map<string, number>, lockedItems: Map<string, InventoryItem>): void {
  const shortages: StockShortage[] = [];

  for (const [inventoryItemId, required] of requiredByItemId) {
    const item = lockedItems.get(inventoryItemId);
    if (!item) {
      // Inalcanzable: `lockRequiredInventory` ya garantizó una entrada acá
      // por cada key de `requiredByItemId` (o abortó antes con 400).
      continue;
    }
    if (item.stock < required) {
      shortages.push({ inventoryItemId, name: item.name, required, available: item.stock });
    }
  }

  if (shortages.length > 0) {
    throw AppError.conflict('Stock insuficiente para completar el pedido', 'INSUFFICIENT_STOCK', {
      shortages,
    });
  }
}

/**
 * `total` = suma, por cada línea pedida, de `costoReceta * quantity`, donde
 * `costoReceta` es la suma de `ingredient.quantityNeeded * pricePerUnit` de
 * cada ingrediente de esa receta. No existe un precio propio en `Recipe`
 * (el schema no tiene ese campo) — el costo se deriva enteramente de los
 * ingredientes y sus `InventoryItem.pricePerUnit`.
 */
function calculateOrderTotal(lines: OrderLine[], lockedItems: Map<string, InventoryItem>): number {
  return lines.reduce((orderTotal, line) => {
    const recipeCost = line.ingredients.reduce((cost, ingredient) => {
      const item = lockedItems.get(ingredient.inventoryItemId);
      const pricePerUnit = item?.pricePerUnit ?? 0;
      return cost + ingredient.quantityNeeded * pricePerUnit;
    }, 0);
    return orderTotal + recipeCost * line.quantity;
  }, 0);
}

function toOrderDto(order: {
  id: string;
  userId: string;
  customerId: string;
  status: string;
  total: number;
  items: Array<{ id: string; recipeId: string; recipeName: string; quantity: number }>;
  createdAt: Date;
  updatedAt: Date;
}): OrderDto {
  return {
    id: order.id,
    userId: order.userId,
    customerId: order.customerId,
    status: order.status as OrderDto['status'],
    total: order.total,
    items: order.items.map((item): OrderItemDto => ({
      id: item.id,
      recipeId: item.recipeId,
      recipeName: item.recipeName,
      quantity: item.quantity,
    })),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}
