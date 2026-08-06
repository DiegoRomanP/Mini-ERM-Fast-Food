import type { Customer } from '@prisma/client';
import { AppError } from '../../shared/http-errors.js';
import { buildPaginationMeta, paginationSkipTake } from '../../shared/pagination.js';
import type { PaginatedResult } from '../../shared/pagination.js';
import { customersRepository, type CustomersRepository } from './repository.js';
import type { CustomerBody, CustomerDto } from './schema.js';

export interface ListCustomersInput {
  page: number;
  limit: number;
  q?: string;
}

export interface CustomersServiceDeps {
  repository?: CustomersRepository;
}

function toCustomerDto(customer: Customer): CustomerDto {
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

/** Traduce el body Zod (email/phone `optional`) a los datos de escritura de Prisma (`null` explícito si no viene). */
function toWriteData(input: CustomerBody): { name: string; email: string | null; phone: string | null } {
  return {
    name: input.name,
    email: input.email ?? null,
    phone: input.phone ?? null,
  };
}

export class CustomersService {
  private readonly repository: CustomersRepository;

  constructor(deps: CustomersServiceDeps = {}) {
    this.repository = deps.repository ?? customersRepository;
  }

  async list(input: ListCustomersInput): Promise<PaginatedResult<CustomerDto>> {
    const { skip, take } = paginationSkipTake({ page: input.page, limit: input.limit });
    const { customers, total } = await this.repository.findMany({ skip, take, q: input.q });

    return {
      data: customers.map(toCustomerDto),
      meta: buildPaginationMeta({ page: input.page, limit: input.limit, total }),
    };
  }

  async getById(id: string): Promise<CustomerDto> {
    const customer = await this.repository.findById(id);
    if (!customer) {
      throw AppError.notFound('Cliente no encontrado', 'CUSTOMER_NOT_FOUND');
    }
    return toCustomerDto(customer);
  }

  async create(input: CustomerBody): Promise<CustomerDto> {
    if (input.email) {
      const existing = await this.repository.findByEmail(input.email);
      if (existing) {
        throw AppError.conflict('Ya existe un cliente con ese email', 'CUSTOMER_EMAIL_ALREADY_EXISTS');
      }
    }

    const created = await this.repository.create(toWriteData(input));
    return toCustomerDto(created);
  }

  async update(id: string, input: CustomerBody): Promise<CustomerDto> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw AppError.notFound('Cliente no encontrado', 'CUSTOMER_NOT_FOUND');
    }

    if (input.email && input.email !== existing.email) {
      const emailOwner = await this.repository.findByEmail(input.email);
      if (emailOwner && emailOwner.id !== id) {
        throw AppError.conflict('Ya existe un cliente con ese email', 'CUSTOMER_EMAIL_ALREADY_EXISTS');
      }
    }

    const updated = await this.repository.update(id, toWriteData(input));
    return toCustomerDto(updated);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      throw AppError.notFound('Cliente no encontrado', 'CUSTOMER_NOT_FOUND');
    }
    await this.repository.delete(id);
  }
}
