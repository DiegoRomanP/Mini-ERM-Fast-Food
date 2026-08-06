import type { InventoryItem, ItemType } from '@prisma/client';
import { AppError } from '../../shared/http-errors.js';
import { buildPaginationMeta, paginationSkipTake } from '../../shared/pagination.js';
import type { PaginatedResult } from '../../shared/pagination.js';
import { inventoryRepository, type InventoryRepository } from './repository.js';
import { suppliersRepository, type SuppliersRepository } from '../suppliers/repository.js';
import type { InventoryBody, InventoryItemDto } from './schema.js';

export interface ListInventoryInput {
  page: number;
  limit: number;
  q?: string;
  category?: string;
  type?: ItemType;
  supplierId?: string;
  lowStock?: boolean;
}

export interface InventoryServiceDeps {
  repository?: InventoryRepository;
  suppliersRepository?: SuppliersRepository;
}

function toInventoryItemDto(item: InventoryItem): InventoryItemDto {
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    category: item.category,
    stock: item.stock,
    unit: item.unit,
    minStock: item.minStock,
    pricePerUnit: item.pricePerUnit,
    supplierId: item.supplierId,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

/** Traduce el body Zod (`supplierId` `optional`) a los datos de escritura de Prisma (`null` explícito si no viene). */
function toWriteData(input: InventoryBody): {
  name: string;
  type: ItemType;
  category: string;
  stock: number;
  unit: InventoryBody['unit'];
  minStock: number;
  pricePerUnit: number;
  supplierId: string | null;
} {
  return {
    name: input.name,
    type: input.type,
    category: input.category,
    stock: input.stock,
    unit: input.unit,
    minStock: input.minStock,
    pricePerUnit: input.pricePerUnit,
    supplierId: input.supplierId ?? null,
  };
}

export class InventoryService {
  private readonly repository: InventoryRepository;
  private readonly suppliersRepository: SuppliersRepository;

  constructor(deps: InventoryServiceDeps = {}) {
    this.repository = deps.repository ?? inventoryRepository;
    this.suppliersRepository = deps.suppliersRepository ?? suppliersRepository;
  }

  async list(input: ListInventoryInput): Promise<PaginatedResult<InventoryItemDto>> {
    const { skip, take } = paginationSkipTake({ page: input.page, limit: input.limit });
    const { items, total } = await this.repository.findMany({
      skip,
      take,
      q: input.q,
      category: input.category,
      type: input.type,
      supplierId: input.supplierId,
      lowStock: input.lowStock,
    });

    return {
      data: items.map(toInventoryItemDto),
      meta: buildPaginationMeta({ page: input.page, limit: input.limit, total }),
    };
  }

  async getById(id: string): Promise<InventoryItemDto> {
    const item = await this.repository.findById(id);
    if (!item) {
      throw AppError.notFound('Item de inventario no encontrado', 'INVENTORY_ITEM_NOT_FOUND');
    }
    return toInventoryItemDto(item);
  }

  async create(input: InventoryBody): Promise<InventoryItemDto> {
    await this.assertSupplierExists(input.supplierId);
    const created = await this.repository.create(toWriteData(input));
    return toInventoryItemDto(created);
  }

  async update(id: string, input: InventoryBody): Promise<InventoryItemDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw AppError.notFound('Item de inventario no encontrado', 'INVENTORY_ITEM_NOT_FOUND');
    }

    await this.assertSupplierExists(input.supplierId);

    const updated = await this.repository.update(id, toWriteData(input));
    return toInventoryItemDto(updated);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw AppError.notFound('Item de inventario no encontrado', 'INVENTORY_ITEM_NOT_FOUND');
    }
    await this.repository.delete(id);
  }

  /**
   * Valida la FK opcional `supplierId` contra `suppliers`. Se usa 400 (no
   * 404): el recurso que falta no es el que pide el cliente en la URL —
   * es una referencia inválida dentro del body, así que se trata como error
   * de validación del request, consistente con cómo Zod reporta el resto de
   * problemas de body en este endpoint.
   */
  private async assertSupplierExists(supplierId: string | undefined): Promise<void> {
    if (!supplierId) {
      return;
    }
    const supplier = await this.suppliersRepository.findById(supplierId);
    if (!supplier) {
      throw AppError.badRequest('El proveedor indicado no existe', 'SUPPLIER_NOT_FOUND');
    }
  }
}
