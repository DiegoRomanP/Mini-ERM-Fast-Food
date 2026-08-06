import type { Supplier, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export interface FindManySuppliersParams {
  skip: number;
  take: number;
  q?: string;
}

export interface FindManySuppliersResult {
  suppliers: Supplier[];
  total: number;
}

export interface SupplierWriteData {
  name: string;
  contact: string | null;
}

/**
 * Acceso a datos del módulo suppliers (capa repository). Envuelve las
 * llamadas a Prisma para que `service.ts` no dependa directamente del
 * cliente ni exponga los modelos de Prisma fuera de este módulo.
 */
export const suppliersRepository = {
  async findMany(params: FindManySuppliersParams): Promise<FindManySuppliersResult> {
    const where: Prisma.SupplierWhereInput = params.q ? { name: { contains: params.q, mode: 'insensitive' } } : {};

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.supplier.count({ where }),
    ]);

    return { suppliers, total };
  },

  findById(id: string): Promise<Supplier | null> {
    return prisma.supplier.findUnique({ where: { id } });
  },

  create(data: SupplierWriteData): Promise<Supplier> {
    return prisma.supplier.create({ data });
  },

  update(id: string, data: SupplierWriteData): Promise<Supplier> {
    return prisma.supplier.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.supplier.delete({ where: { id } });
  },
};

export type SuppliersRepository = typeof suppliersRepository;
