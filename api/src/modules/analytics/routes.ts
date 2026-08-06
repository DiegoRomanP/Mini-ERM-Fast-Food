import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAnalyticsController } from './controller.js';
import { AnalyticsService } from './service.js';
import { BurnRateQuerySchema, BurnRateResponseSchema } from './schema.js';

const HTTP_OK = 200;

/**
 * Rutas de analytics (Fase 5 del PLAN). Se registran en `app.ts` bajo el
 * mismo prefix `/api/v1/inventory` que `modules/inventory/routes.ts` —
 * Fastify permite registrar varios plugins bajo el mismo prefix, patrón ya
 * usado en el proyecto para separar lectura/escritura RBAC en
 * `customers`/`suppliers`/`inventory`/`recipes`. Acá el criterio de split
 * es distinto: no es RBAC, es responsabilidad — `burn-rate` es una métrica
 * derivada sobre `Order`/`OrderItem`/`Recipe` (no un CRUD de
 * `InventoryItem`), así que vive en su propio módulo con su propia capa
 * repository/service, aunque comparta ruta base con `inventory`.
 *
 * Acceso: **admin-only** (SEC-06, OWASP API5:2023). La decisión tiene dos
 * mitades que conviene no confundir:
 *
 * 1. **El cálculo sigue siendo global**, sin scoping por `userId` — a
 *    diferencia de `orders`, que sí aplica el modelo dueño+admin. El stock
 *    físico del local es uno solo y compartido, así que el consumo que lo
 *    agota es el de TODAS las órdenes. Si se filtrara el burn-rate por el
 *    usuario autenticado, `daysUntilMinStock` ignoraría el consumo de los
 *    demás y daría una proyección sistemáticamente optimista, es decir
 *    incorrecta. La métrica es una propiedad del negocio, no del usuario.
 * 2. **Por eso mismo el endpoint se restringe a `ADMIN`**: al ser global,
 *    revela volumen de negocio agregado (qué tan rápido rota el inventario
 *    del local), información de gestión que el stock crudo de
 *    `GET /inventory` no expone. Coherente con el criterio restrictivo
 *    adoptado para orders.
 *
 * Como el plugin entero es admin-only (una sola ruta), se encadenan ambos
 * hooks a nivel de plugin — mismo patrón que `modules/users/routes.ts`.
 * El orden importa: `app.authenticate` primero (traduce token
 * ausente/inválido a un `AppError` 401) y `app.requireRole('ADMIN')`
 * después (403 si el rol no coincide). `requireRole` por sí solo también
 * llama a `jwtVerify()`, pero sin capturar su error, que el error handler
 * central no mapea y terminaría como un 500 en vez de un 401.
 *
 * Van como `addHook` y no dentro de las options de la ruta porque mezclar
 * `onRequest` con el `ZodTypeProvider` en la misma llamada a `.get()` rompe
 * la inferencia de tipos de Fastify (`request.query` cae a `unknown` y el
 * controller deja de ser asignable).
 */
const analyticsRoutes: FastifyPluginAsync = async (app) => {
  const analyticsService = new AnalyticsService();
  const controller = createAnalyticsController(analyticsService);

  app.addHook('onRequest', app.authenticate);
  app.addHook('onRequest', app.requireRole('ADMIN'));

  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/analytics/burn-rate',
    {
      schema: {
        tags: ['analytics'],
        querystring: BurnRateQuerySchema,
        response: { [HTTP_OK]: BurnRateResponseSchema },
      },
    },
    controller.burnRate,
  );
};

export default analyticsRoutes;
