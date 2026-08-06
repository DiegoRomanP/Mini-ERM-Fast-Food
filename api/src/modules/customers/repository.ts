import type { Customer, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export interface FindManyCustomersParams {
  skip: number;
  take: number;
  q?: string;
}

export interface FindManyCustomersResult {
  customers: Customer[];
  total: number;
}

export interface CustomerWriteData {
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Acceso a datos del módulo customers (capa repository). Envuelve las
 * llamadas a Prisma para que `service.ts` no dependa directamente del
 * cliente ni exponga los modelos de Prisma fuera de este módulo.
 */
export const customersRepository = {
  async findMany(params: FindManyCustomersParams): Promise<FindManyCustomersResult> {
    const where: Prisma.CustomerWhereInput = params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: 'insensitive' } },
            { email: { contains: params.q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    return { customers, total };
  },

  findById(id: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { id } });
  },

  findByEmail(email: string): Promise<Customer | null> {
    return prisma.customer.findUnique({ where: { email } });
  },

  create(data: CustomerWriteData): Promise<Customer> {
    return prisma.customer.create({ data });
  },

  update(id: string, data: CustomerWriteData): Promise<Customer> {
    return prisma.customer.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.customer.delete({ where: { id } });
  },
};

export type CustomersRepository = typeof customersRepository;
