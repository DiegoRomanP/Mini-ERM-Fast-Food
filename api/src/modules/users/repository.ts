import type { Prisma, Role, User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export interface FindManyUsersParams {
  skip: number;
  take: number;
  q?: string;
}

export interface FindManyUsersResult {
  users: User[];
  total: number;
}

/**
 * Acceso a datos del módulo users (capa repository). Envuelve las llamadas a
 * Prisma para que `service.ts` no dependa directamente del cliente ni
 * exponga los modelos de Prisma fuera de este módulo.
 */
export const usersRepository = {
  async findMany(params: FindManyUsersParams): Promise<FindManyUsersResult> {
    const where: Prisma.UserWhereInput = params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: 'insensitive' } },
            { email: { contains: params.q, mode: 'insensitive' } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: params.skip,
        take: params.take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    return { users, total };
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  updateRole(id: string, role: Role): Promise<User> {
    return prisma.user.update({ where: { id }, data: { role } });
  },
};

export type UsersRepository = typeof usersRepository;
