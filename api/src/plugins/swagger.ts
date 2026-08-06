import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { REFRESH_COOKIE_NAME } from './auth.js';
import { env } from '../config/env.js';

export const DOCS_ROUTE_PREFIX = '/docs';

const BEARER_AUTH_SCHEME = 'bearerAuth';
const REFRESH_COOKIE_SCHEME = 'refreshTokenCookie';

/** Lee `version` de `package.json` sin recurrir a un import con assertion
 * JSON (frágil entre versiones de Node bajo ESM/NodeNext: `assert` está
 * deprecado desde Node 22 a favor de `with`, y el proyecto solo exige
 * Node >=20). `readFileSync` + `JSON.parse` funciona igual en cualquier
 * versión soportada. */
function readPackageVersion(): string {
  const packageJsonPath = fileURLToPath(new URL('../../package.json', import.meta.url));
  const raw = readFileSync(packageJsonPath, 'utf-8');
  const { version } = JSON.parse(raw) as { version: string };
  return version;
}

/**
 * Documentación OpenAPI (`@fastify/swagger`) + UI interactiva
 * (`@fastify/swagger-ui`, servida en `GET /docs`). Se registra como plugin
 * `fastify-plugin` (mismo patrón que `plugins/auth.ts`) para que sus
 * decoradores (`fastify.swagger()`) queden disponibles en el `app`
 * principal en vez de quedar encapsulados.
 *
 * Debe registrarse ANTES que las rutas de los módulos (`app.ts`): el
 * `transform` de `@fastify/swagger` solo captura los schemas Zod de las
 * rutas que se registran *después* de que este plugin termina de
 * inicializarse.
 */
function isSwaggerEnabled(): boolean {
  if (env.NODE_ENV === 'production') {
    return env.ENABLE_SWAGGER;
  }
  return true;
}

export default fp(
  async function swaggerPlugin(app) {
    if (!isSwaggerEnabled()) {
      return;
    }

    await app.register(swagger, {
      openapi: {
        info: {
          title: 'mini-erp-api',
          version: readPackageVersion(),
          description:
            'API REST del Mini-ERP (Proyecto A): autenticación, usuarios, clientes, ' +
            'proveedores e inventario. `POST /api/v1/auth/register` y ' +
            '`POST /api/v1/auth/login` devuelven el access token (JWT) en el body ' +
            'de la respuesta y, además, setean automáticamente una cookie httpOnly ' +
            `'${REFRESH_COOKIE_NAME}' con el refresh token — esa cookie nunca se ` +
            'expone en el body y el cliente no debe manipularla manualmente, solo ' +
            'reenviarla (p. ej. `credentials: "include"`) al llamar ' +
            '`POST /api/v1/auth/refresh`.',
        },
        components: {
          securitySchemes: {
            [BEARER_AUTH_SCHEME]: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description:
                'Access token JWT de vida corta, devuelto en el body de ' +
                '`/auth/register` y `/auth/login`. Enviar como ' +
                '`Authorization: Bearer <accessToken>`.',
            },
            [REFRESH_COOKIE_SCHEME]: {
              type: 'apiKey',
              in: 'cookie',
              name: REFRESH_COOKIE_NAME,
              description:
                'Refresh token de larga duración, seteado automáticamente como ' +
                'cookie httpOnly + firmada por `/auth/login` y `/auth/register`. ' +
                'No es accesible desde JavaScript ni se envía en el body; el ' +
                'navegador la adjunta solo a `/api/v1/auth/*`.',
            },
          },
        },
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, {
      routePrefix: DOCS_ROUTE_PREFIX,
    });
  },
  { name: 'swagger-plugin' },
);
