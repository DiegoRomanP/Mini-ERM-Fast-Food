import type { RefreshToken, User } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  name: string;
}

export interface CreateRefreshTokenInput {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Acceso a datos del módulo auth (capa repository). Envuelve las llamadas a
 * Prisma para que `service.ts` no dependa directamente del cliente ni exponga
 * los modelos de Prisma fuera de este módulo.
 */
export const authRepository = {
  findUserByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  findUserById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  createUser(input: CreateUserInput): Promise<User> {
    return prisma.user.create({ data: input });
  },

  createRefreshToken(input: CreateRefreshTokenInput): Promise<RefreshToken> {
    return prisma.refreshToken.create({ data: input });
  },

  findRefreshTokenByHash(tokenHash: string): Promise<RefreshToken | null> {
    return prisma.refreshToken.findUnique({ where: { tokenHash } });
  },

  revokeRefreshToken(id: string): Promise<RefreshToken> {
    return prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  },
};

export type AuthRepository = typeof authRepository;
