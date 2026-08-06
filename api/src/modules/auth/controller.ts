import type { FastifyReply, FastifyRequest } from 'fastify';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../../plugins/auth.js';
import type { AuthService } from './service.js';
import type { LoginBody, RegisterBody } from './schema.js';

const HTTP_CREATED = 201;
const HTTP_OK = 200;
const HTTP_NO_CONTENT = 204;

/**
 * Lee la cookie firmada de refresh token y devuelve su valor sin firma.
 * Si falta, no está firmada correctamente, o fue alterada, devuelve
 * `undefined` en vez de lanzar: el llamador (service) decide qué error
 * lanzar según el caso de uso (refresh vs logout).
 */
function readRefreshCookie(request: FastifyRequest): string | undefined {
  const raw = request.cookies[REFRESH_COOKIE_NAME];
  if (!raw) {
    return undefined;
  }
  const unsigned = request.unsignCookie(raw);
  return unsigned.valid ? unsigned.value : undefined;
}

export interface AuthController {
  register(request: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply): Promise<void>;
  login(request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply): Promise<void>;
  refresh(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  logout(request: FastifyRequest, reply: FastifyReply): Promise<void>;
}

export function createAuthController(authService: AuthService): AuthController {
  return {
    async register(request, reply) {
      const { user, accessToken, refreshToken } = await authService.register(request.body);
      setRefreshCookie(reply, refreshToken);
      await reply.code(HTTP_CREATED).send({ user, accessToken });
    },

    async login(request, reply) {
      const { user, accessToken, refreshToken } = await authService.login(request.body);
      setRefreshCookie(reply, refreshToken);
      await reply.code(HTTP_OK).send({ user, accessToken });
    },

    async refresh(request, reply) {
      const refreshTokenPlain = readRefreshCookie(request);
      const { accessToken, refreshToken } = await authService.refresh(refreshTokenPlain);
      setRefreshCookie(reply, refreshToken);
      await reply.code(HTTP_OK).send({ accessToken });
    },

    async logout(request, reply) {
      const refreshTokenPlain = readRefreshCookie(request);
      await authService.logout(refreshTokenPlain);
      clearRefreshCookie(reply);
      await reply.code(HTTP_NO_CONTENT).send();
    },
  };
}
