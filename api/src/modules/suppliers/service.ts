import type { Supplier } from '@prisma/client';
import { AppError } from '../../shared/http-errors.js';
import { buildPaginationMeta, paginationSkipTake } from '../../shared/pagination.js';
import type { PaginatedResult } from '../../shared/pagination.js';
import { suppliersRepository, type SuppliersRepository } from './repository.js';
import type { SupplierBody, SupplierDto } from './schema.js';

export interface ListSuppliersInput {
  page: number;
  limit: number;
  q?: string;
}

export interface SuppliersServiceDeps {
  repository?: SuppliersRepository;
}

function toSupplierDto(supplier: Supplier): SupplierDto {
  return {
    id: supplier.id,
    name: supplier.name,
    contact: supplier.contact,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

/** Traduce el body Zod (`contact` `optional`) a los datos de escritura de Prisma (`null` explícito si no viene). */
function toWriteData(input: SupplierBody): { name: string; contact: string | null } {
  return {
    name: input.name,
    contact: input.contact ?? null,
  };
}

export class SuppliersService {
  private readonly repository: SuppliersRepository;

  constructor(deps: SuppliersServiceDeps = {}) {
    this.repository = deps.repository ?? suppliersRepository;
  }

  async list(input: ListSuppliersInput): Promise<PaginatedResult<SupplierDto>> {
    const { skip, take } = paginationSkipTake({ page: input.page, limit: input.limit });
    const { suppliers, total } = await this.repository.findMany({ skip, take, q: input.q });

    return {
      data: suppliers.map(toSupplierDto),
      meta: buildPaginationMeta({ page: input.page, limit: input.limit, total }),
    };
  }

  async getById(id: string): Promise<SupplierDto> {
    const supplier = await this.repository.findById(id);
    if (!supplier) {
      throw AppError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');
    }
    return toSupplierDto(supplier);
  }

  async create(input: SupplierBody): Promise<SupplierDto> {
    const created = await this.repository.create(toWriteData(input));
    return toSupplierDto(created);
  }

  async update(id: string, input: SupplierBody): Promise<SupplierDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw AppError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');
    }

    const updated = await this.repository.update(id, toWriteData(input));
    return toSupplierDto(updated);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw AppError.notFound('Proveedor no encontrado', 'SUPPLIER_NOT_FOUND');
    }
    await this.repository.delete(id);
  }
}
