import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAuthController } from './controller.js';
import { AuthService } from './service.js';
import { AuthResponseSchema, LoginBodySchema, RefreshResponseSchema, RegisterBodySchema } from './schema.js';

const HTTP_CREATED = 201;
const HTTP_OK = 200;

/**
 * Rate limit dedicado de `/auth/*` — SEC-03 (OWASP API4:2023 Unrestricted
 * Resource Consumption + API2:2023 Broken Authentication).
 *
 * `@fastify/rate-limit` ya está registrado globalmente en `app.ts` con un
 * límite laxo (100 req/min). Estas rutas lo endurecen con la opción por-ruta
 * `config.rateLimit`: el plugin mergea las opciones globales con las de la ruta
 * y le da a cada una su **propio contador independiente**, así que agotar
 * `/login` no consume el cupo de `/register` ni el global.
 *
 * Keying: el por defecto del plugin, la IP del cliente (`request.ip`; como la
 * app corre con `trustProxy: true`, detrás de un proxy resuelve la IP real del
 * `x-forwarded-for` en vez de la del balanceador).
 *
 * Refinamiento futuro: keyear por IP + email en lugar de solo IP. Solo-IP tiene
 * dos límites conocidos: (a) un atacante distribuido (botnet/proxies rotativos)
 * evade el umbral repartiendo los intentos entre muchas IPs, y (b) una NAT u
 * oficina compartida queda bloqueada para todos sus usuarios por el abuso de
 * uno solo. Un límite compuesto (por credencial además de por origen) mitiga
 * ambos; requiere leer el body, así que iría con `hook: 'preHandler'`.
 */
const AUTH_RATE_LIMIT_TIME_WINDOW = '1 minute';

/**
 * `login` es el único oráculo de credenciales de la API: cada request confirma
 * o descarta una password. Es el umbral más estricto — 5 intentos/min deja
 * margen de sobra para errores de tipeo de un humano y reduce la fuerza bruta
 * de ~144.000 a 7.200 intentos/día por IP.
 */
export const LOGIN_RATE_LIMIT_MAX = 5;

/**
 * `register` no filtra credenciales existentes, pero sí permite spam de altas y
 * quema recursos caros (bcrypt con 12 rondas por request). Umbral algo más
 * holgado que login, aun así 10x más estricto que el global.
 */
export const REGISTER_RATE_LIMIT_MAX = 10;

/**
 * `refresh` lo llama el cliente legítimo cada vez que rota el access token, así
 * que necesita más margen; sigue acotado porque adivinar la cookie de refresh
 * por fuerza bruta también es un vector (aunque el token tiene 48 bytes de
 * entropía, ver `AuthService.refresh`).
 */
export const REFRESH_RATE_LIMIT_MAX = 20;

/**
 * Rutas públicas de autenticación, registradas por `app.ts` con prefix
 * `/api/v1/auth`. `AuthService` se instancia una única vez al cargar el
 * plugin (no por request) inyectándole `app.jwt.sign`, que solo está
 * disponible una vez que el plugin `authPlugin` (fastify/jwt) terminó de
 * registrarse.
 */
const authRoutes: FastifyPluginAsync = async (app) => {
  const authService = new AuthService({
    signAccessToken: (payload) => app.jwt.sign(payload),
  });
  const controller = createAuthController(authService);

  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/register',
    {
      config: {
        rateLimit: { max: REGISTER_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_TIME_WINDOW },
      },
      schema: {
        tags: ['auth'],
        body: RegisterBodySchema,
        response: { [HTTP_CREATED]: AuthResponseSchema },
      },
    },
    controller.register,
  );

  server.post(
    '/login',
    {
      config: {
        rateLimit: { max: LOGIN_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_TIME_WINDOW },
      },
      schema: {
        tags: ['auth'],
        body: LoginBodySchema,
        response: { [HTTP_OK]: AuthResponseSchema },
      },
    },
    controller.login,
  );

  server.post(
    '/refresh',
    {
      config: {
        rateLimit: { max: REFRESH_RATE_LIMIT_MAX, timeWindow: AUTH_RATE_LIMIT_TIME_WINDOW },
      },
      schema: {
        tags: ['auth'],
        response: { [HTTP_OK]: RefreshResponseSchema },
      },
    },
    controller.refresh,
  );

  // `logout` se queda con el límite global (100/min) a propósito: es idempotente,
  // no es un oráculo de credenciales (revocar exige ya poseer la cookie de
  // refresh) y estrangularlo perjudicaría más al usuario legítimo —que debe poder
  // cerrar sesión siempre— que al atacante, para quien no aporta información.
  server.post('/logout', { schema: { tags: ['auth'] } }, controller.logout);
};

export default authRoutes;
