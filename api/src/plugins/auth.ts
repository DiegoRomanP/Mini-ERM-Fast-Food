import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import type { FastifyReply } from 'fastify';
import type { Role } from '@prisma/client';
import { env } from '../config/env.js';
import { AppError } from '../shared/http-errors.js';

export const ACCESS_TOKEN_TTL = '15m';
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

export interface AuthUserPayload {
  sub: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AuthUserPayload;
    user: AuthUserPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (roles: Role | Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    user: AuthUserPayload;
  }
}

export function setRefreshCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_MS,
    signed: true,
  });
}

export function clearRefreshCookie(reply: FastifyReply): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

export default fp(
  async function authPlugin(app) {
    await app.register(jwt, {
      secret: env.JWT_SECRET,
      sign: { expiresIn: ACCESS_TOKEN_TTL },
    });

    app.decorate('authenticate', async function authenticate(request, _reply) {
      try {
        await request.jwtVerify();
      } catch {
        throw AppError.unauthorized('Token de acceso inválido o expirado');
      }
    });

    app.decorate('requireRole', (roles: Role | Role[]) => {
      const allowed = Array.isArray(roles) ? roles : [roles];
      return async function requireRole(request, _reply) {
        await request.jwtVerify();
        if (!allowed.includes(request.user.role)) {
          throw AppError.forbidden('No tienes permisos para esta acción');
        }
      };
    });
  },
  { name: 'auth-plugin' },
);
