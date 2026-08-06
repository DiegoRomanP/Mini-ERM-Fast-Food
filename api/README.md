# Mini-ERP API (Proyecto A)

API REST para un mini-ERP de comida rápida: gestión de inventario, recetas,
proveedores, clientes y órdenes con descuento de stock transaccional, más un
endpoint de analytics (burn-rate de insumos). Construida como el "Proyecto A"
del monorepo — un servicio Node/TypeScript production-grade que reescribe
sobre PostgreSQL/Prisma el dominio que `backend/` (Express + MongoDB, que
queda congelado como referencia) ya resolvía de forma más simple.

Fuente de verdad de las decisiones de diseño originales: [`../PLAN.md`](../PLAN.md).
Este README documenta el estado real del código, no el plan.

---

## Stack y versiones

Versiones tal como están fijadas en [`package.json`](./package.json) (rango npm; `^` = compatible con la mayor instalada):

| Capa | Paquete | Versión |
|---|---|---|
| Runtime | Node.js (`engines.node`) | `>=20` |
| Framework HTTP | `fastify` | `^5.11.2` |
| Type provider Zod | `fastify-type-provider-zod` | `^5.1.0` |
| Validación | `zod` | `^3.25.76` (ver nota abajo) |
| ORM | `prisma` / `@prisma/client` | `^6.19.3` |
| Base de datos | PostgreSQL | `16` (imagen `postgres:16-alpine` en compose / `postgres:16` en CI) |
| Auth | `@fastify/jwt`, `@fastify/cookie`, `bcryptjs` | `^10.2.1`, `^11.1.2`, `^3.0.3` |
| Seguridad HTTP | `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` | `^13.1.0`, `^11.3.0`, `^11.2.0` |
| Docs | `@fastify/swagger`, `@fastify/swagger-ui` | `^9.8.1`, `^6.1.1` |
| Logging | `pino` (vía logger de Fastify) | `^10.3.1` |
| Tests | `vitest`, `supertest`, `@vitest/coverage-v8` | `^4.1.10`, `^7.2.2`, `^4.1.10` |
| Lint/Format | `eslint`, `typescript-eslint`, `prettier` | `^10.8.0`, `^8.66.0`, `^3.9.6` |
| Lenguaje | `typescript` | `^5.9.3` |

**Nota sobre Zod:** el paquete instalado es `zod@3.25.76` — una versión de
transición que empaqueta **ambas** APIs (v3 clásica y el motor interno de
v4). Como `fastify-type-provider-zod@5` valida contra el engine v4
(`zod/v4/core`), todos los `schema.ts` del proyecto importan explícitamente
`from 'zod/v4'` (no el default `from 'zod'`) — importar el default rompe la
validación en runtime. El único lugar que importa el default `zod` es
`src/config/env.ts` (validación de variables de entorno, fuera del ciclo de
request/response de Fastify) y `src/shared/error-handler.ts` (para
`instanceof ZodError` como red de seguridad). Este workaround está
documentado con el mismo comentario repetido en cada `schema.ts` del
proyecto.

---

## Decisiones de diseño

### Fastify sobre Express

Fastify 5 se eligió por tres razones concretas, no solo "es más rápido":
- **Schema-first real**: `app.setValidatorCompiler`/`setSerializerCompiler`
  (`src/app.ts`) más `fastify-type-provider-zod` permiten declarar un único
  schema Zod por ruta que sirve simultáneameante para validar el
  request, tipar `request.body`/`query`/`params` en TypeScript, serializar la
  respuesta y generar el OpenAPI de Swagger (`transform: jsonSchemaTransform`
  en `src/plugins/swagger.ts`) — sin capas de mapeo manual.
- **Plugin ecosystem oficial**: `@fastify/jwt`, `@fastify/cookie`,
  `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`,
  `@fastify/swagger(-ui)` cubren todo lo necesario sin dependencias de
  terceros no mantenidas.
- **Performance**: el engine de serialización de Fastify (basado en JSON
  Schema compilado) es sustancialmente más rápido que `res.json()` de
  Express, relevante para un endpoint como `GET /orders` que puede paginar
  cientos de filas.

### Prisma sobre Drizzle

Prisma gana en migraciones versionadas con historial reproducible
(`prisma/migrations/20260804230715_init/migration.sql`), un cliente
totalmente tipado generado desde el schema (`@prisma/client`, regenerado en
`postinstall`), y una DX superior para un proyecto de portafolio donde la
velocidad de iteración importa más que el control fino sobre el SQL
generado. El trade-off (menos control sobre queries complejas) se resuelve
puntualmente con `$queryRaw`/`$transaction` donde Prisma no alcanza (ver
Orders más abajo).

### JWT access (15 min) + refresh (7 días, cookie httpOnly firmada)

Implementado en `src/plugins/auth.ts` y `src/modules/auth/service.ts`.
Precisión importante sobre el código real: **solo el access token es un JWT
firmado** (`@fastify/jwt`, `sign: { expiresIn: '15m' }`). El *refresh token*
no es un JWT — es un valor aleatorio de 48 bytes (`crypto.randomBytes`) sin
estructura ni firma propia, que se envía al cliente como cookie
`httpOnly + sameSite=strict + signed` (firma la aplica `@fastify/cookie`, no
JWT) y se persiste en la tabla `RefreshToken` **hasheado con SHA-256** (no en
texto plano). Por eso **no existe ninguna variable `JWT_REFRESH_SECRET`**: el
diseño original en `PLAN.md` contemplaba un refresh también firmado como JWT,
pero el mecanismo implementado (token opaco + hash) la vuelve innecesaria. La
variable llegó a declararse como requerida en `src/config/env.ts`,
`.env.example`, CI y `docker-compose.yml` sin usarse en ningún punto del
código (config muerta, SEC-04); **se eliminó de todos esos sitios** en la Fase
QA-3. El único secreto de firma de tokens es `JWT_SECRET` (access token), más
`COOKIE_SECRET` para la firma de la cookie de refresh.

Por qué access + refresh en vez de un solo access token de vida larga:
- Un access token de 15 minutos limita la ventana de daño si se filtra
  (XSS, log, etc.), sin forzar re-login constante gracias al refresh.
- El refresh vive en tabla (`RefreshToken`) en vez de ser puramente stateless
  para poder **revocarlo** (logout real, no solo "dejar de usar el token") y
  **rotarlo**: cada `POST /auth/refresh` revoca el token usado y emite uno
  nuevo (`AuthService.refresh`), de forma que un token robado y reutilizado
  después de una rotación legítima ya aparece revocado. Todo esto sin
  depender de Redis ni de una blacklist en memoria — una tabla Postgres con
  índice único en `tokenHash` alcanza para el volumen de un ERP interno.

### Transacciones ACID con `SELECT ... FOR UPDATE` en `POST /orders`

Implementado en `src/modules/orders/repository.ts` (`lockInventoryItemById`,
que ejecuta `SELECT * FROM "InventoryItem" WHERE id = ${id} FOR UPDATE`
dentro de `prisma.$transaction`) y orquestado por
`OrdersService.createWithinTx` (`src/modules/orders/service.ts`). El flujo
completo: resolver cada `recipeId` del body contra `Recipe`, expandir y
acumular ingredientes por `inventoryItemId`, **bloquear** cada
`InventoryItem` involucrado en orden ascendente de id (para que transacciones
concurrentes que compiten por los mismos insumos los bloqueen siempre en el
mismo orden global y Postgres nunca las deadlockee entre sí), validar que el
stock bloqueado alcance, descontar, calcular el total y persistir la orden —
todo dentro de una única transacción interactiva de Prisma. Si cualquier paso
falla (receta inexistente, stock insuficiente), Prisma hace rollback
automático al propagar la excepción.

Sin el `FOR UPDATE`, dos pedidos concurrentes podrían leer el mismo `stock`,
ambos validar que alcanza, y ambos descontar — sobrevendiendo el insumo. Esto
está validado por un test de concurrencia real, no solo unitario:
[`tests/orders-create.test.ts`](./tests/orders-create.test.ts), caso
*"concurrencia: bajo stock limitado, el FOR UPDATE serializa el acceso y
evita sobreventa"* — dispara 3 pedidos simultáneos (`Promise.all`) contra un
item con `stock=10` donde cada pedido consume 4 unidades (solo 2 de los 3
pueden completarse) y verifica que exactamente 2 se resuelven en éxito y 1 en
409 `INSUFFICIENT_STOCK`, sin sobreventa.

### `Recipe.ingredients` como campo `Json` (no tabla intermedia)

`prisma/schema.prisma`: `Recipe.ingredients` es `Json` (array de
`{ inventoryItemId, quantityNeeded }`), no una tabla `RecipeIngredient`
N:N. Se eligió así porque los ingredientes de una receta siempre se leen y
escriben *junto con* la receta completa (nunca se consulta "todas las recetas
que usan el insumo X" como acceso independiente) — una tabla intermedia solo
agregaría joins sin beneficio de consulta real en este dominio.

**Trade-off asumido**: al no ser una FK real, la base de datos no impide
guardar un `inventoryItemId` que no existe (o que se borre después). Se
mitiga en dos puntos de aplicación:
- `RecipesService.assertIngredientsExist` (`src/modules/recipes/service.ts`)
  valida, en `create`/`update`, que cada `inventoryItemId` referenciado
  exista en `InventoryItem` — si no, 400 `INVENTORY_ITEM_NOT_FOUND`.
- Como el `InventoryItem` puede borrarse *después* de crear la receta (no hay
  `onDelete` que lo impida), `GET /recipes/:id` degrada con gracia: el DTO de
  detalle (`RecipeIngredientDetailSchema`) trae `name`/`unit` `nullable` —
  si el insumo referenciado ya no existe, esos campos vienen `null` en vez de
  romper la lectura con un 500.
- Al leer, Prisma tipa el `Json` como `JsonValue`/`unknown`; tanto
  `RecipesService` como `OrdersService` revalidan ese valor contra el mismo
  `IngredientSchema` de Zod usado para escribir (nunca un `as` sin
  validar), así que un dato corrupto en la columna falla explícito en vez de
  propagarse silenciosamente.

### Arquitectura por capas y DTOs

Cada módulo en `src/modules/<nombre>/` sigue el mismo patrón de 4 archivos:
`routes.ts → controller.ts → service.ts → repository.ts`, con
`schema.ts` aparte definiendo los DTOs Zod. Las entidades de Prisma
(`User`, `Order`, `InventoryItem`, etc.) **nunca se exponen** directamente en
una respuesta HTTP: cada service mapea explícitamente la entidad a su DTO
(p. ej. `toOrderDto` en `orders/service.ts`, `toRecipeDto` en
`recipes/service.ts`) antes de devolverla al controller, y el controller
tipa su retorno contra el schema Zod declarado en la ruta
(`response: { 200: OrderDtoSchema }`). Esto evita filtrar columnas internas
(`passwordHash`, por ejemplo, jamás llega a `UserDtoSchema`) y desacopla el
contrato HTTP del modelo de datos.

Inyección: cada `Service` recibe su `Repository` por constructor con un
default al singleton real (`deps.repository ?? xRepository`), lo que permite
mockear el repositorio en tests unitarios sin tocar la base de datos. No hay
singletons globales salvo el cliente Prisma (`src/config/prisma.ts`).

### Errores centralizados y paginación

Un único `setErrorHandler` (`src/shared/error-handler.ts`,
`appErrorHandler`) mapea:
- Errores de validación de Fastify (`error.validation`, generados por el
  `validatorCompiler` de Zod) → 400.
- `AppError` (clase propia en `src/shared/http-errors.ts`, con factories
  `badRequest`/`unauthorized`/`forbidden`/`notFound`/`conflict`) → el
  `statusCode` que trae cada instancia.
- `Prisma.PrismaClientKnownRequestError` con código `P2002` (constraint único
  violado, red de seguridad para condiciones de carrera no capturadas
  explícitamente en un service) → 409.
- `ZodError` no capturado en ruta → 400.
- Cualquier otro error → 500, con el mensaje real solo en `NODE_ENV` distinto
  de `production` (en producción, mensaje genérico + log completo vía
  `pino`).

Todos los casos devuelven el mismo sobre:
```json
{ "error": { "code": "STRING_CODE", "message": "texto legible", "details": [] } }
```
(`details` es opcional y solo aparece en validación/conflictos con
contexto adicional, p. ej. `shortages` en `INSUFFICIENT_STOCK`).

La paginación (`src/shared/pagination.ts`) sigue el mismo contrato en todos
los `GET` de listado (`users`, `customers`, `suppliers`, `inventory`,
`recipes`, `orders`):
```json
{ "data": [ /* items */ ], "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 } }
```

---

## Cómo correr en local

### Desarrollo

```bash
cp .env.example .env        # completar JWT_SECRET / COOKIE_SECRET
npm install                 # postinstall corre `prisma generate` automáticamente
npm run db:migrate          # prisma migrate dev (requiere Postgres corriendo, ver DATABASE_URL)
npm run db:seed             # prisma/seed.ts: 3 usuarios, 5 customers, 3 suppliers, items, recetas, 2 orders
npm run dev                 # tsx watch src/index.ts
```

El servidor levanta en `http://localhost:3000` (o el `PORT` del `.env`).
`GET /health` responde `{ status, uptime, timestamp }`.

### Tests

```bash
npm test               # vitest run
npm run test:coverage  # vitest run --coverage (@vitest/coverage-v8)
```

`tests/setup.ts` sobreescribe `process.env.DATABASE_URL` con
`DATABASE_URL_TEST` en runtime **si esa variable está seteada** — así los
tests de integración (Supertest contra la app real) corren contra una base
de datos separada de la de desarrollo sin tocar sus datos. Si
`DATABASE_URL_TEST` no está seteada, los tests usan `DATABASE_URL` tal cual.
170 tests actualmente (`grep -rn "it(" tests/*.test.ts` cuenta 170 casos
entre unit e integración).

### Con Docker Compose

```bash
docker compose up --build
```

Ya probado end-to-end: levanta `postgres:16-alpine` con healthcheck
(`pg_isready`) y la API (`Dockerfile` multi-stage, build en `node:20-alpine`
+ runtime non-root con usuario `node`). El `CMD` del contenedor
(`npx prisma migrate deploy && node dist/server.js`) aplica las migraciones
automáticamente al arrancar — no hace falta correr `db:migrate` a mano
contra el contenedor. La API queda expuesta en `http://localhost:3000`, con
healthcheck propio contra `GET /health`. Las credenciales de Postgres y los
secretos JWT/cookie en `docker-compose.yml` están hardcodeados a propósito
como valores de desarrollo (no secretos reales) para que `docker compose up`
funcione sin pasos previos.

---

## Contrato de la API (`/api/v1`)

Documentación interactiva completa (todos los schemas de request/response,
generados desde los mismos DTOs Zod): **`GET /docs`** (Swagger UI), una vez
el servidor está corriendo.

### Auth (`/api/v1/auth`) — público

| Método | Ruta | Body | Respuesta |
|---|---|---|---|
| POST | `/register` | `{ email, password (min 8), name }` | 201 `{ user, accessToken }` + cookie `refresh_token` |
| POST | `/login` | `{ email, password }` | 200 `{ user, accessToken }` + cookie `refresh_token` |
| POST | `/refresh` | — (cookie `refresh_token`) | 200 `{ accessToken }` + cookie `refresh_token` rotada |
| POST | `/logout` | — (cookie `refresh_token`) | 200, revoca el refresh token y limpia la cookie |

Ejemplo `POST /auth/register`:
```json
// request
{ "email": "chef@mini-erp.dev", "password": "MiniErp2026!", "name": "Chef Principal" }
// response 201
{
  "user": { "id": "cl...", "email": "chef@mini-erp.dev", "name": "Chef Principal", "role": "USER" },
  "accessToken": "eyJhbGciOi..."
}
```

### Users (`/api/v1/users`) — requiere rol `ADMIN`

- `GET /?page&limit&q` — paginado, filtra por nombre/email.
- `PATCH /:id/role` `{ role: "ADMIN" | "USER" }` → `UserDto` actualizado.

### Customers / Suppliers (`/api/v1/customers`, `/api/v1/suppliers`)

CRUD estándar paginado (`GET /`, `GET /:id`, `POST /`, `PUT /:id`,
`DELETE /:id`). Lectura para cualquier autenticado, escritura solo `ADMIN`.

### Inventory (`/api/v1/inventory`)

- `GET /?page&limit&q&category&type&supplierId&lowStock` — lectura para
  cualquier autenticado.
- `GET /:id`
- `POST /`, `PUT /:id`, `DELETE /:id` — solo `ADMIN`.

Ejemplo `GET /inventory?lowStock=true&limit=2`:
```json
{
  "data": [
    { "id": "cl...", "name": "Harina", "type": "ALIMENTO", "category": "Secos",
      "stock": 4, "unit": "KG", "minStock": 10, "pricePerUnit": 1200,
      "supplierId": "cl...", "createdAt": "2026-08-04T...", "updatedAt": "2026-08-04T..." }
  ],
  "meta": { "page": 1, "limit": 2, "total": 6, "totalPages": 3 }
}
```

### Recipes (`/api/v1/recipes`)

- `GET /?page&limit&q` — lectura para cualquier autenticado; DTO liviano sin
  populate de ingredientes.
- `GET /:id` — detalle con `ingredients` enriquecidos (`name`/`unit`
  poblados desde `InventoryItem`, `null` si el insumo ya no existe).
- `POST /`, `PUT /:id`, `DELETE /:id` — solo `ADMIN`.
  `DELETE` falla con 409 `RECIPE_IN_USE` si la receta está referenciada por
  al menos un `OrderItem`.

Body de creación:
```json
{ "name": "Hamburguesa Clásica", "ingredients": [ { "inventoryItemId": "cl...", "quantityNeeded": 0.2 } ] }
```

### Orders (`/api/v1/orders`) — sin restricción de rol, solo autenticado

- `POST /` `{ customerId, items: [{ recipeId, quantity }] }` → 201, crea la
  orden en la transacción ACID descrita arriba.
- `GET /?page&limit&status&customerId&from&to`
- `GET /:id`
- `PATCH /:id/status` `{ status: "PENDIENTE" | "COMPLETADO" | "CANCELADO" }`
  — sin máquina de estados: cualquier transición del enum es válida.

Ejemplo `POST /orders` con stock insuficiente:
```json
// response 409
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Stock insuficiente para completar el pedido",
    "details": { "shortages": [ { "inventoryItemId": "cl...", "name": "Harina", "required": 12, "available": 4 } ] }
  }
}
```

### Analytics (`/api/v1/inventory/analytics/burn-rate`) — requiere rol `ADMIN`

- `GET /analytics/burn-rate?days=30` (registrado bajo el mismo prefix que
  `inventory`, pero es un módulo propio con su propia capa
  repository/service — no es un CRUD de `InventoryItem`). Devuelve, por
  item, `dailyConsumption`, `daysUntilMinStock` (`null` si no hay consumo
  reciente) y `riskFlag` (`OK` / `RIESGO` / `CRITICO`).
- **Admin-only** (SEC-06 en `PENDING.md`). El consumo se agrega sobre
  **todas** las órdenes, sin scoping por `userId`: el stock físico es uno
  solo y compartido, así que filtrar por usuario daría una proyección
  optimista, es decir incorrecta. Como el agregado es global, revela
  volumen de negocio (qué tan rápido rota el inventario), y por eso el
  control se aplica en el acceso y no en el cálculo.

---

## Seguridad y RBAC

Dos roles (`enum Role { ADMIN USER }`, `prisma/schema.prisma`). Regla
aplicada de forma consistente vía el decorator `app.requireRole('ADMIN')`
(`src/plugins/auth.ts`), verificada en cada módulo:

| Módulo | Lectura | Escritura |
|---|---|---|
| `users` | ADMIN | ADMIN |
| `customers` | cualquier autenticado | ADMIN |
| `suppliers` | cualquier autenticado | ADMIN |
| `inventory` | cualquier autenticado | ADMIN |
| `recipes` | cualquier autenticado | ADMIN |
| `orders` | cualquier autenticado | cualquier autenticado (sin restricción de rol; así lo especifica el PLAN) |
| `analytics` | ADMIN | — (solo lectura) |

Además: `@fastify/helmet` (headers de seguridad), `@fastify/cors` con
`origin` explícito (`CORS_ORIGIN`) + `credentials: true` (necesario para que
el navegador adjunte la cookie de refresh en cross-origin), y
`@fastify/rate-limit`.

### Rate limiting

Límite global de **100 requests/minuto por IP** (`src/app.ts`). Los endpoints
de autenticación lo endurecen con la opción por-ruta `config.rateLimit`
(`src/modules/auth/routes.ts`), porque son los sensibles a fuerza bruta y abuso
(OWASP API4:2023 + API2:2023):

| Ruta | Límite | Motivo |
|---|---|---|
| `POST /auth/login` | 5/min | Único oráculo de credenciales de la API |
| `POST /auth/register` | 10/min | Spam de altas + costo de bcrypt (12 rondas) |
| `POST /auth/refresh` | 20/min | Rotación legítima frecuente, pero acotada |
| `POST /auth/logout` | global (100/min) | Idempotente y sin valor para un atacante |
| resto de la API | global (100/min) | — |

Cada ruta con límite propio lleva su **contador independiente**: agotar `/login`
no consume el cupo de `/register` ni el global.

La clave del contador es la IP del cliente. Como la app corre con
`trustProxy: true`, detrás de un proxy/balanceador se resuelve la IP real desde
`x-forwarded-for` en vez de la del proxy. Refinamiento pendiente: keyear por
IP + email para resistir ataques distribuidos y no penalizar a una NAT completa.

Al superarse el límite la respuesta es `429` con el mismo envelope de error del
resto de la API (`errorResponseBuilder` en `src/app.ts` devuelve un `AppError`,
que `shared/error-handler.ts` ya sabe serializar), más las cabeceras
`x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` y `retry-after`:

```json
{ "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "Demasiadas solicitudes. Reintenta en 59 segundos." } }
```

---

## CI

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) corre en cada push
a `main` y en cada PR, con tres jobs:
1. **Lint & Typecheck** — `npm run lint` + `npm run typecheck`, en paralelo
   con el job de tests (no hay `needs`, para feedback más rápido).
2. **Tests** — contra un servicio real `postgres:16` (no mocks): aplica
   `prisma migrate deploy` y corre `npm test` + `npm run test:coverage`,
   subiendo el reporte de cobertura como artifact.
3. **Docker build (validation)** — construye la imagen (`push: false`) tras
   los dos jobs anteriores, solo para validar que el `Dockerfile` compila.

---

## Estado del deploy

**Pendiente.** El proyecto no está desplegado en Fly.io todavía (Fase 8 del
`PLAN.md`): no existe un `fly.toml` en este directorio ni una URL pública.
`docker compose up --build` es, por ahora, la única forma verificada de
correr la API completa (Postgres + servicio) fuera de desarrollo local con
`npm run dev`.
