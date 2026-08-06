import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyServerOptions } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import authPlugin from './plugins/auth.js';
import swaggerPlugin from './plugins/swagger.js';
import authRoutes from './modules/auth/routes.js';
import usersRoutes from './modules/users/routes.js';
import customersRoutes from './modules/customers/routes.js';
import suppliersRoutes from './modules/suppliers/routes.js';
import inventoryRoutes from './modules/inventory/routes.js';
import recipesRoutes from './modules/recipes/routes.js';
import ordersRoutes from './modules/orders/routes.js';
import analyticsRoutes from './modules/analytics/routes.js';
import { env } from './config/env.js';
import { loggerOptions } from './config/logger.js';
import { appErrorHandler } from './shared/error-handler.js';
import { AppError } from './shared/http-errors.js';

const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_TIME_WINDOW = '1 minute';
const HTTP_TOO_MANY_REQUESTS = 429;
const MS_PER_SECOND = 1000;

/**
 * `@fastify/rate-limit` lanza por defecto un `Error` plano con `statusCode: 429`
 * que `appErrorHandler` no reconoce: caía en la rama de "error no controlado" y
 * la respuesta degradaba a `500 INTERNAL_ERROR` (además de loguear cada exceso
 * con nivel `error`). Devolviendo un `AppError` reutilizamos el envelope estándar
 * `{ error: { code, message } }` con el status correcto, sin tocar el handler.
 *
 * Se define en el registro global a propósito: `@fastify/rate-limit` mergea las
 * opciones globales con las de cada ruta (`config.rateLimit`), así que los
 * límites por-ruta de `modules/auth/routes.ts` heredan este builder sin repetirlo.
 */
function rateLimitErrorResponse(_req: FastifyRequest, context: { ttl: number }): AppError {
  // Se usa `context.ttl` (ms restantes) en vez de `context.after`, que el plugin
  // ya viene formateado en inglés ("59 seconds") y rompería el idioma de la API.
  const retryAfterSeconds = Math.ceil(context.ttl / MS_PER_SECOND);
  return new AppError(
    'RATE_LIMIT_EXCEEDED',
    `Demasiadas solicitudes. Reintenta en ${retryAfterSeconds} segundos.`,
    HTTP_TOO_MANY_REQUESTS,
  );
}

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
}

export function buildApp(opts: BuildAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: opts.logger ?? loggerOptions,
    trustProxy: true,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(appErrorHandler);

  app.register(cookie, { secret: env.COOKIE_SECRET });
  app.register(authPlugin);
  app.register(helmet);
  app.register(cors, { origin: env.CORS_ORIGIN, credentials: true });
  // Límite global de referencia. Las rutas sensibles a abuso lo endurecen con
  // `config.rateLimit` por-ruta (ver `modules/auth/routes.ts`, SEC-03).
  app.register(rateLimit, {
    max: RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_TIME_WINDOW,
    errorResponseBuilder: rateLimitErrorResponse,
  });

  // Swagger/OpenAPI + UI (`GET /docs`): debe registrarse ANTES que las
  // rutas de los módulos para que su `transform` capture los schemas Zod
  // de todas ellas (auth, users, customers, suppliers, inventory, recipes).
  app.register(swaggerPlugin);

  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(usersRoutes, { prefix: '/api/v1/users' });
  app.register(customersRoutes, { prefix: '/api/v1/customers' });
  app.register(suppliersRoutes, { prefix: '/api/v1/suppliers' });
  app.register(inventoryRoutes, { prefix: '/api/v1/inventory' });
  // Mismo prefix que `inventoryRoutes`: módulo aparte (capas propias), no
  // un CRUD de InventoryItem — ver `modules/analytics/routes.ts`.
  app.register(analyticsRoutes, { prefix: '/api/v1/inventory' });
  app.register(recipesRoutes, { prefix: '/api/v1/recipes' });
  app.register(ordersRoutes, { prefix: '/api/v1/orders' });

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));

  return app;
}
