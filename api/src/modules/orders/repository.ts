import type { Customer, InventoryItem, Order, OrderItem, OrderStatus, Recipe } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

/**
 * Cliente Prisma "de transacción" (`prisma.$transaction(async (tx) => ...)`).
 * Todas las lecturas/escrituras del flujo de creación de una orden pasan por
 * este tipo (no por el `prisma` singleton importado arriba) para que la
 * transacción interactiva vea sus propios cambios (p. ej. el `FOR UPDATE`
 * seguido del `decrement` del mismo insumo) y para que un fallo en cualquier
 * paso haga rollback de todo el bloque.
 */
export type OrderTx = Prisma.TransactionClient;

export type OrderWithItems = Order & { items: OrderItem[] };

export interface CreateOrderItemData {
  recipeId: string;
  recipeName: string;
  quantity: number;
}

export interface CreateOrderData {
  userId: string;
  customerId: string;
  total: number;
  items: CreateOrderItemData[];
}

export interface FindManyOrdersParams {
  skip: number;
  take: number;
  status?: OrderStatus;
  customerId?: string;
  from?: Date;
  to?: Date;
  /**
   * Scoping por dueño (OWASP API1:2023 — BOLA). Lo decide el service según el
   * rol del actor: un `USER` lo recibe siempre con su propio id; un `ADMIN`
   * lo recibe `undefined` (ve todas las órdenes). Ver `OrdersService.list`.
   */
  userId?: string;
}

export interface FindManyOrdersResult {
  orders: OrderWithItems[];
  total: number;
}

/**
 * Filtros combinables de `GET /orders` (todos AND entre sí). Se comparte
 * entre el `findMany` (paginado) y su `count` para que ambas queries vean
 * exactamente el mismo subconjunto de filas — incluido el scoping por
 * `userId`, que así se aplica también al total de la paginación.
 */
function buildWhere(params: {
  status?: OrderStatus;
  customerId?: string;
  from?: Date;
  to?: Date;
  userId?: string;
}): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (params.userId) {
    where.userId = params.userId;
  }
  if (params.status) {
    where.status = params.status;
  }
  if (params.customerId) {
    where.customerId = params.customerId;
  }
  if (params.from || params.to) {
    where.createdAt = {
      ...(params.from ? { gte: params.from } : {}),
      ...(params.to ? { lte: params.to } : {}),
    };
  }
  return where;
}

/**
 * Acceso a datos del módulo orders (capa repository). Envuelve las llamadas
 * a Prisma para que `service.ts` no dependa directamente del cliente ni
 * exponga los modelos de Prisma fuera de este módulo.
 *
 * Cubre tanto la creación (`POST /orders`, transacción ACID con locking
 * pesimista, sobre `OrderTx`) como la consulta/actualización de estado
 * (`GET /orders`, `GET /orders/:id`, `PATCH /orders/:id/status`), estas
 * últimas sobre el `prisma` singleton (fuera de transacción) porque no
 * necesitan ver cambios "en vuelo" de otra operación.
 */
export const ordersRepository = {
  /**
   * Ejecuta `fn` dentro de una transacción interactiva de Prisma. Cualquier
   * excepción lanzada dentro de `fn` (incluidas las `AppError` del service)
   * hace rollback automático — no hace falta un `try/catch` explícito acá.
   */
  runInTransaction<T>(fn: (tx: OrderTx) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  },

  findCustomerById(tx: OrderTx, id: string): Promise<Customer | null> {
    return tx.customer.findUnique({ where: { id } });
  },

  findRecipesByIds(tx: OrderTx, ids: string[]): Promise<Recipe[]> {
    return tx.recipe.findMany({ where: { id: { in: ids } } });
  },

  /**
   * Bloquea la fila de `InventoryItem` con `SELECT ... FOR UPDATE` dentro de
   * la transacción activa. El caller (service) es responsable de invocar
   * esto una vez por cada `inventoryItemId` único, en orden ascendente de
   * id, para que transacciones concurrentes que necesiten los mismos
   * insumos siempre los bloqueen en el mismo orden global y no puedan
   * deadlockearse entre sí. Devuelve `null` si el id no existe (insumo
   * borrado después de crear la receta que lo referencia).
   */
  async lockInventoryItemById(tx: OrderTx, id: string): Promise<InventoryItem | null> {
    const rows = await tx.$queryRaw<InventoryItem[]>`
      SELECT * FROM "InventoryItem" WHERE id = ${id} FOR UPDATE
    `;
    return rows[0] ?? null;
  },

  decrementInventoryStock(tx: OrderTx, id: string, amount: number): Promise<InventoryItem> {
    return tx.inventoryItem.update({ where: { id }, data: { stock: { decrement: amount } } });
  },

  createOrder(tx: OrderTx, data: CreateOrderData): Promise<OrderWithItems> {
    return tx.order.create({
      data: {
        userId: data.userId,
        customerId: data.customerId,
        status: 'PENDIENTE',
        total: data.total,
        items: { create: data.items },
      },
      include: { items: true },
    });
  },

  async findMany(params: FindManyOrdersParams): Promise<FindManyOrdersResult> {
    const where = buildWhere(params);

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
        include: { items: true },
      }),
      prisma.order.count({ where }),
    ]);

    return { orders, total };
  },

  findById(id: string): Promise<OrderWithItems | null> {
    return prisma.order.findUnique({ where: { id }, include: { items: true } });
  },

  updateStatus(id: string, status: OrderStatus): Promise<OrderWithItems> {
    return prisma.order.update({ where: { id }, data: { status }, include: { items: true } });
  },
};

export type OrdersRepository = typeof ordersRepository;
