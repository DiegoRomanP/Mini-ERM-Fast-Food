# PLAN — Proyecto A: API Node/TypeScript seria

> **Objetivo:** Convertir Mini-ERM en un servicio de backend production-grade que cubra de un golpe: Node.js, Fastify, autenticación JWT, validación con Zod, testing, despliegue en cloud y documentación.

---

## 0. Decisiones de diseño (ya validadas con el user)

| Decisión | Elección | Justificación |
|---|---|---|
| Estrategia | **Arrancar nuevo** en `api/` | Mantiene `backend/` Mongo como referencia; reescribe el modelo a relacional sin romper el frontend durante la transición |
| Framework | **Fastify 5** | Schema-first, plugin ecosystem, mejor performance que Express, integración nativa con Zod (`fastify-type-provider-zod`) |
| ORM | **Prisma** | Migraciones versionadas, Cliente tipado, DX superior |
| Cloud | **Fly.io** | Free tier generoso, PostgreSQL incluido, Dockerfile nativo, CLI simple |
| Auth | **JWT access (15min) + refresh (7d httpOnly cookie)** + roles `admin`/`user` | Patrón estándar industria, demuestra refresh rotation y cookies seguras |
| Entidades | **User, Customer, Supplier, InventoryItem, Recipe, Order** | Cubre auth + dominio actual + cierre de "Order anónima" + cadena Item↔Supplier |
| Order FKs | `userId` (quien registra) + `customerId` (a quién se vende) | Caso de uso relacional completo |
| Supplier-Item | `1 Supplier → N InventoryItem` (FK simple) | Expresivo sin caer en N:N |
| Frontend | **Adaptar** `frontend/src/services/api.ts` + login mínima | Cierra la demo end-to-end |
| Migración datos | **No migrar** Mongo → Postgres. Seeders limpios | Portafolio: lo valioso es la arquitectura |

---

## 1. Estado actual del repo (baseline)

- **Backend actual** (`backend/`): Express 5 + Mongoose + MongoDB. 9 endpoints CRUD sobre `InventoryItem`, `Recipe`, `Order`, con transacción ACID en `POST /api/orders` y endpoint de analytics.
- **Frontend** (`frontend/`): React 19 + Vite 8 + Tailwind. Solo consume `inventory` + `analytics`.
- **Cobertura de tests**: 0. **Docker / CI / `.env.example`**: ausentes.

El backend Mongo actual se **congela** — no se toca. El nuevo servicio vive en `api/`.

---

## 2. Arquitectura objetivo

```
mini-erp-project/
├── api/                          ← NUEVO (Fastify + Postgres + Prisma)
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/
│   │   └── seed.ts
│   ├── src/
│   │   ├── config/               (env, prisma client, logger)
│   │   ├── plugins/              (auth/jwt, cookie, helmet, cors, swagger)
│   │   ├── modules/
│   │   │   ├── users/   auth/   customers/   suppliers/
│   │   │   ├── inventory/  recipes/  orders/
│   │   ├── shared/               (httpErrors, pagination, middleware)
│   │   ├── app.ts                (instancia Fastify + registros)
│   │   └── server.ts             (bootstrap)
│   ├── tests/                    (unit + integration con Vitest + Supertest)
│   ├── Dockerfile
│   ├── .dockerignore
│   ├── .env.example
│   ├── fly.toml
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── README.md
├── backend/                      ← congelado (referencia Mongo)
├── frontend/                     ← adaptar services/api.ts + login UI
└── PLAN.md                       ← este archivo
```

**Principios respetados (SOLID / DRY / KISS):**

- **Separación de capas** por módulo: `routes → controller → service → repository → prisma`. Las entidades Prisma **no se exponen**; los DTOs viven en `schema.ts` (Zod) y sirven para validar body, tipar service, y documentar Swagger.
- **Inyección por constructor**: cada service recibe su repositorio. Fastify decorate via `decorate`. Sin singletons globales salvo Prisma client.
- **Errores centralizados**: un handler `setErrorHandler` que mapea `PrismaClientKnownRequestError`, `ZodError`, http errors custom, y errores no esperados — siempre JSON `{ error: { code, message, details? } }`.

---

## 3. Modelo de datos (Prisma schema)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum Role { ADMIN USER }
enum OrderStatus { PENDIENTE COMPLETADO CANCELADO }
enum ItemType { ALIMENTO SUMINISTRO }
enum Unit { KG LITROS UNIDADES PAQUETES }

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  role         Role     @default(USER)
  name         String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  orders       Order[]
  refreshTokens RefreshToken[]
}

model RefreshToken {
  id         String   @id @default(cuid())
  userId     String
  tokenHash  String   @unique
  expiresAt  DateTime
  revokedAt  DateTime?
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model Customer {
  id        String   @id @default(cuid())
  name      String
  email     String?  @unique
  phone     String?
  orders    Order[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Supplier {
  id        String   @id @default(cuid())
  name      String
  contact   String?
  items     InventoryItem[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model InventoryItem {
  id            String   @id @default(cuid())
  name          String
  type          ItemType
  category      String
  stock         Float    @default(0)
  unit          Unit
  minStock      Float    @default(5)
  pricePerUnit  Float    @default(0)
  supplierId    String?
  supplier      Supplier? @relation(fields: [supplierId], references: [id])
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([supplierId])
}

model Recipe {
  id          String   @id @default(cuid())
  name        String   @unique
  ingredients Json     // [{ inventoryItemId, quantityNeeded }]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  orderItems  OrderItem[]
}

model Order {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id])
  customerId String
  customer   Customer @relation(fields: [customerId], references: [id])
  status     OrderStatus @default(PENDIENTE)
  total      Float    @default(0)
  items      OrderItem[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  @@index([userId])
  @@index([customerId])
}

model OrderItem {
  id        String  @id @default(cuid())
  orderId   String
  order     Order   @relation(fields: [orderId], references: [id], onDelete: Cascade)
  recipeId  String
  recipe    Recipe  @relation(fields: [recipeId], references: [id])
  recipeName String
  quantity  Int
  @@index([orderId])
}
```

**Decisión:** `Recipe.ingredients` como `Json` (array de pares `inventoryItemId/quantityNeeded`) accedido siempre junto a la receta; `OrderItem` sí es tabla porque se consulta por orden y se elimina en cascada. `RefreshToken` como tabla para soportar revocación y rotación sin Redis.

---

## 4. Endpoints (contrato `/api/v1`)

### Auth (públicas)
- `POST /auth/register` `{email,password,name}` → `{user, accessToken}` + cookie refresh
- `POST /auth/login` `{email,password}` → `{user, accessToken}` + cookie refresh
- `POST /auth/refresh` (cookie `refresh_token`) → `{accessToken}`
- `POST /auth/logout` → 204 + Clear-Cookie

### Users (admin)
- `GET /users?page&limit&q` paginado
- `PATCH /users/:id/role` `{role}`

### Customers, Suppliers: CRUD estándar paginado.

### Inventory (`admin` escribe; `user` lee)
- `GET /inventory?page&limit&q&category&type&supplierId&lowStock`
- `GET /inventory/:id`
- `POST /inventory` (admin)
- `PATCH /inventory/:id` (admin)
- `DELETE /inventory/:id` (admin)

### Recipes
- `GET /recipes?page&limit&q`
- `POST /recipes` (admin) `{name, ingredients:[{inventoryItemId,quantityNeeded}]}`
- `GET /recipes/:id` (con ingredients populate)

### Orders
- `GET /orders?page&limit&status&customerId&from&to`
- `POST /orders` `{customerId, items:[{recipeId,quantity}]}` → **transacción ACID** (valida recetas e inventory stock, descuenta stock, calcula total, rollback si falla)
- `PATCH /orders/:id/status` (admin)

### Analytics
- `GET /inventory/analytics/burn-rate` (admin) reimplementado con SQL. Admin-only por
  SEC-06 (§12.4): el cálculo es global sobre todas las órdenes —así debe ser, si no la
  proyección sería incorrecta—, y por eso mismo expone volumen de negocio agregado.

**Errores:**
- 400 — validación Zod
- 401 — no autenticado
- 403 — sin permisos
- 404 — recurso no encontrado
- 409 — conflicto (email duplicado, stock insuficiente, receta inexistente)
- 500 — log completo y mensaje genérico

**Paginación contractual:**
```json
{ "data": [...], "meta": { "page": 1, "limit": 20, "total": 137, "totalPages": 7 } }
```

---

## 5. Stack técnico

| Capa | Elección |
|---|---|
| Runtime | Node 20 LTS |
| Framework HTTP | Fastify ^5 |
| Validación | Zod ^3 + `fastify-type-provider-zod` |
| ORM | Prisma ^6 |
| DB | PostgreSQL 16 |
| Auth | `@fastify/jwt`, `@fastify/cookie`, `bcryptjs`, refresh en tabla `RefreshToken` |
| Sec | `@fastify/helmet`, `@fastify/cors` (origen explícito + credentials), `@fastify/rate-limit` |
| Docs | `@fastify/swagger`, `@fastify/swagger-ui` |
| Logging | `pino` (built-in) |
| Tests | Vitest + Supertest + `@vitest/coverage-v8` |
| Lint/Format | ESLint + Prettier + `@typescript-eslint` |
| Container | Docker multi-stage `node:20-alpine` |
| CI | GitHub Actions |
| Cloud | Fly.io + Fly Postgres (región `scl`) |

---

## 6. Fases de implementación (~15 días)

### Fase 1 — Fundamentos (1-2d)
- [ ] Scaffold `api/` + tsconfig + ESM
- [ ] Prisma schema completo → `prisma migrate dev --name init`
- [ ] `prisma/seed.ts` (1 admin, 2 users, 5 customers, 3 suppliers, 15 items, 6 recipes, 2 orders)
- [ ] `src/config/{env,prisma,logger}.ts` (envs validadas con Zod)
- [ ] `src/app.ts` factory + `src/server.ts` bootstrap con graceful shutdown
- [ ] Endpoint `/health` + primer test
- [ ] `.env.example` versionado

### Fase 2 — Auth (2d)
- [ ] Plugin JWT + cookies (`httpOnly`, `secure`, `sameSite=strict`, `signed`)
- [ ] Tabla `RefreshToken`, decorators `authenticate` y `requireRole`
- [ ] register/login/refresh/logout con Zod
- [ ] Módulo users: list + update role
- [ ] Tests: register happy/409 duplicado/400 débil, login 401, refresh rotation, logout revoca

### Fase 3 — Customers/Suppliers/Inventory (2d)
- [ ] CRUD con paginación; filtros inventory (`q`,`category`,`type`,`supplierId`,`lowStock`)
- [ ] Regla `admin` escribe / `user` lee
- [ ] Swagger UI en `/docs`
- [ ] Tests CRUD + filtros + 403/404

### Fase 4 — Recipes/Orders (2d)
- [ ] Recetas con `ingredients` validados contra DB
- [ ] `POST /orders` con `prisma.$transaction` + `SELECT ... FOR UPDATE` raw, descuento, total, rollback
- [ ] Tests: happy path, 409 stock insuficiente, 409 receta inexistente, consistencia tras rollback

### Fase 5 — Analytics (1d)
- [ ] `burn-rate` con SQL: stock, items bajo mín, 消耗 30d, días hasta agotar
- [ ] Tests con fixtures conocidos

### Fase 6 — Docker/CI (2d)
- [ ] ESLint + Prettier
- [ ] Dockerfile multi-stage (`prisma generate`, CMD ejecuta `migrate deploy`)
- [ ] `docker-compose.yml` (Postgres + API)
- [ ] GHA: lint/typecheck + tests contra Postgres service + build Docker

### Fase 7 — Frontend (2d, mejora demo)
- [ ] `services/api.ts`: base URL env, interceptor Axios con reintento en 401 refresh
- [ ] `useAuth` hook + provider, login/register UI mínima, logout
- [ ] No se migra la UI de inventory/recipes/orders al nuevo API en este alcance

### Fase 8 — Deploy Fly.io (1d)
- [ ] `fly launch`, `fly postgres create`, attach DB
- [ ] `fly secrets set JWT_*`
- [ ] `fly deploy`, seed inicial, verificar `/health` y `/docs`

### Fase 9 — Documentación (1d)
- [ ] `api/README.md` con decisiones (Fastify vs Express, Prisma vs Drizzle, JWT access+refresh vs solo access)
- [ ] `docs/api-decisions.md` ADR-style
- [ ] Actualizar README raíz

---

## 7. Testing strategy

- **Cobertura objetivo**: 70% ramas, 80% líneas.
- **Unit**: services con repositorio mockeado (`vi.mock`).
- **Integration**: Supertest contra Postgres test dedicado (`DATABASE_URL_TEST`); limpia tablas en `beforeEach` o schema dedicado.
- **ACID**: `orders.create.test.ts` con happy path, 409 stock insuficiente, 409 receta inexistente, rollback deja DB consistente.
- **Factories**: `tests/fixtures/{users,inventory}.ts`, `tests/setup.ts`.

---

## 8. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| `secure:true` cookies rompen dev local | `secure: process.env.NODE_ENV === 'production'` |
| Prisma `Json` no tipa | TTS explícitos + Zod `z.array(z.object({...}))` |
| Prisma no soporta `SELECT FOR UPDATE` directo | `prisma.$queryRaw` dentro del interceptor `$transaction` |
| Fly.io Postgres pausa por inactividad | `auto-min-scale` o tier bebé |
| CORS preflight + cookies | `@fastify/cors` con `credentials:true` + `origin:[FRONTEND_URL]` |
| Tests paralelos comparten datos | Schema o truncate en `beforeEach` |

---

## 9. Commits atómicos sugeridos

1. `chore: scaffold api/ con fastify + prisma`
2. `feat(db): schema completo + migración init + seeders`
3. `feat(config): envs validadas + prisma client + logger`
4. `feat(health): endpoint /health + primer test`
5. `feat(auth): register/login/refresh/logout con JWT`
6. `feat(users): CRUD + roles`
7. `feat(customers): CRUD con paginación`
8. `feat(suppliers): CRUD con paginación`
9. `feat(inventory): CRUD + filtros + lowStock`
10. `feat(recipes): CRUD con ingredients como Json`
11. `feat(orders): transacción ACID con rollback`
12. `feat(analytics): burn-rate reimpl con SQL`
13. `test: suite completa + fixtures`
14. `chore: eslint + prettier`
15. `chore(docker): Dockerfile multi-stage + compose`
16. `ci: GitHub Actions`
17. `feat(frontend): axios interceptor + login UI`
18. `docs: README + ADR`
19. `ci(cd): workflow deploy a fly.io`
20. `chore(deploy): fly.toml + secrets + primer deploy`

---

## 10. Definición de Hecho (DoD)

- [ ] `docker-compose up` levanta DB + API localmente
- [ ] `https://mini-erp-api.fly.dev/health` → 200
- [ ] `https://mini-erp-api.fly.dev/docs` → Swagger interactivo
- [ ] `npm test` pasa con cobertura ≥70%
- [ ] `npm run lint && npm run typecheck` limpios
- [ ] Pipeline CI verde en cada push a `main`
- [ ] Flujo demo: registrar → login → crear supplier → item → receta → orden (descuenta stock) → analytics
- [ ] Frontend login/logout contra el nuevo API
- [ ] `api/README.md` explica Fastify vs Express, Prisma vs Drizzle, JWT access+refresh vs solo access
- [ ] `.env.example` versionado; secretos Fly por `fly secrets`

---

## 11. Huecos que cierra

| Hueco | Cerrado |
|---|---|
| Node.js producción | ✅ Fastify 5 + capas |
| Express/Fastify | ✅ Fastify |
| Auth JWT | ✅ Access + refresh + cookies httpOnly |
| Validación | ✅ Zod + type provider |
| Testing JS/TS | ✅ Vitest + Supertest, 70%+ |
| Despliegue cloud | ✅ Fly.io |
| Docker | ✅ Multi-stage + compose |
| CI/CD | ✅ GitHub Actions |
| ORM con migraciones | ✅ Prisma |
| Documentación | ✅ README + ADR + Swagger |

---

## 12. QA-test information

Registro de lo descubierto durante la implementación (Fases 1-7) y la QA de seguridad. Complementa a `PENDING.md` (raíz, hallazgos de seguridad accionables), `api/README.md` y `docs/api-decisions.md`.

### 12.1 Estado de implementación

| Fase | Estado | Notas |
|---|---|---|
| 1 — Fundamentos | ✅ | scaffold, schema Prisma + migración init + seed, config, `/health`, Vitest |
| 2 — Auth | ✅ | register/login/refresh/logout + módulo users (admin) |
| 3 — Customers/Suppliers/Inventory | ✅ | CRUD paginado + filtros + Swagger `/docs` |
| 4 — Recipes/Orders | ✅ | recipes (ingredients Json) + orders (transacción ACID) |
| 5 — Analytics | ✅ | burn-rate con SQL crudo (`$queryRaw`) |
| 6 — Docker/CI | ✅ | ESLint+Prettier, Dockerfile multi-stage, compose y CI probados end-to-end |
| 7 — Frontend | ✅ | cliente API + auth UI (login/register/logout) sin migrar la demo vieja |
| 8 — Deploy Fly.io | ⬜ Pendiente | `flyctl` no instalado/autenticado en el entorno; sin `fly.toml` ni URL pública |
| 9 — Documentación | ✅ | `api/README.md`, `docs/api-decisions.md`, README raíz |

### 12.2 Cobertura de tests

- **Suite total: 198 tests** — `198 pasan, 0 fallan` (tras la Fase QA-3, que cerró **SEC-04** y **SEC-07**; QA-2 había cerrado **SEC-03** y QA-1 **SEC-01**/**SEC-02**/**SEC-06**; ver 12.4).
- 174 tests funcionales de dominio (auth, users, customers, suppliers, inventory, recipes, orders, analytics, swagger, health) — todos verdes, incluidos los 3 añadidos en QA-1 para el lado `ADMIN` del modelo dueño+admin en orders y el de 403 en analytics (SEC-06).
- 20 tests de seguridad en `api/tests/security.test.ts` — todos verdes (los 3 de BOLA pasaron a verde con el fix de QA-1, sin modificar el archivo; los 3 añadidos en QA-3 cubren el manejo de errores 4xx nativos de Fastify, SEC-07).
- 4 tests de rate limiting en `api/tests/auth-ratelimit.test.ts` (Fase QA-2), aislados por `x-forwarded-for` sintética para no contaminar el store in-memory del rate-limit.
- Incluye un test de **concurrencia real** en `orders-create.test.ts` (3 pedidos simultáneos contra stock limitado → exactamente 2 exitosos, 1 con 409, sin sobreventa) que valida el `SELECT ... FOR UPDATE`.
- Reproducir: `cd api && npm test` (todo) o `npx vitest run tests/security.test.ts` (solo seguridad).

### 12.3 QA de seguridad (OWASP API Top 10 2023)

Pruebas basadas en skills instaladas (`testing-jwt-token-security`, `testing-api-for-broken-object-level-authorization`, `testing-api-security-with-owasp-top-10`), codificadas como tests de integración contra `buildApp()`.

**Controles ya verificados (verdes):**
- **JWT (API2):** rechaza `alg=none`, firma manipulada, secreto incorrecto, token expirado, header malformado y ausencia de token.
- **RBAC / BFLA (API5):** un `USER` no puede escribir en inventory/customers, ni listar usuarios, ni cambiar roles (403).
- **Mass assignment (API3):** enviar `role: ADMIN` en el body de `register` se ignora; nace como `USER`.
- **Exposición de datos (API3):** `passwordHash` nunca en respuestas de auth.
- **Misconfiguration (API8):** cabeceras de `helmet` presentes; rutas inexistentes → 404 sin stack trace.
- **BOLA (API1):** un `USER` no puede leer, listar ni modificar el estado de la orden de otro usuario (404 `ORDER_NOT_FOUND`, que no filtra la existencia del recurso ajeno) — verde desde la Fase QA-1.
- **Rate limiting (API4/API2):** límite global (100/min) más límites por-ruta en `/auth/login` (5/min), `/auth/register` (10/min) y `/auth/refresh` (20/min), con `429` en el envelope estándar de la API — verde desde la Fase QA-2.

### 12.4 Hallazgos de seguridad pendientes (detalle en `PENDING.md`)

| ID | Severidad | OWASP | Estado | Resumen |
|----|-----------|-------|--------|---------|
| SEC-01 | 🔴 Alta | API1 (BOLA) | ✅ Resuelto (QA-1) | `GET /orders`, `GET /orders/:id` y `PATCH /orders/:id/status` no filtraban/validaban por `userId`: cualquier usuario leía/listaba/modificaba órdenes ajenas → resuelto con el modelo dueño+admin (scoping por `userId` en el `where` y 404 `ORDER_NOT_FOUND` en accesos ajenos) |
| SEC-02 | 🟠 Media | API5 (BFLA) | ✅ Resuelto (QA-1) | `PATCH /orders/:id/status` no exigía rol admin → resuelto por autorización por objeto: el dueño cambia el estado de su orden, el `ADMIN` el de cualquiera (supersede el `(admin)` de la sección 4) |
| SEC-03 | 🟠 Media | API4/API2 | ✅ Resuelto (QA-2) | Login sin rate-limit dedicado (solo global 100/min) → fuerza bruta. Resuelto con `config.rateLimit` por-ruta en `auth/routes.ts` (login 5/min, register 10/min, refresh 20/min por IP, contadores independientes), más un `errorResponseBuilder` global que devuelve el 429 con el envelope estándar (antes degradaba a `500 INTERNAL_ERROR` porque `appErrorHandler` no reconocía el error del plugin) |
| SEC-04 | 🟡 Baja | API8 | ✅ Resuelto (QA-3) | `JWT_REFRESH_SECRET` declarada pero sin uso real (config muerta) → eliminada del `EnvSchema`, `.env.example`, CI, `docker-compose.yml` y de las specs de agente; docs (README/ADR-004) pasadas de "deuda conocida" a "deuda resuelta". Los únicos secretos de auth son `JWT_SECRET` y `COOKIE_SECRET` |
| SEC-05 | 🟡 Baja | API8 | ⚠️ Verificar en deploy | Verificar `NODE_ENV=production` en el deploy para no filtrar `error.message`. El enmascaramiento sigue aplicando íntegro a los 5xx tras la Fase QA-3 (los 4xx devuelven el mensaje a propósito, ver SEC-07) |
| SEC-06 | 🟠 Media | API5 (BFLA) | ✅ Resuelto (QA-1) | `GET /inventory/analytics/burn-rate` agregaba consumo global (`$queryRaw` sobre `OrderItem JOIN Order`, sin `userId`) y estaba abierto a cualquier autenticado → un `USER` veía el volumen de negocio derivado de las órdenes de todos. Resuelto restringiendo el endpoint a `ADMIN` (`requireRole` a nivel de plugin). El cálculo **sigue siendo global a propósito**: el stock físico es compartido, así que scopearlo por `userId` daría una proyección optimista, o sea incorrecta |
| SEC-07 | 🟡 Baja | API8 | ✅ Resuelto (QA-3) | La rama final de `shared/error-handler.ts` hardcodeaba `reply.code(500)` e ignoraba `error.statusCode`, así que todo error nativo de Fastify (JSON malformado, content-type no soportado, `jwtVerify` sin cabecera…) degradaba a `500` y se logueaba a nivel `error` como "Error no controlado" — ruido de logs que permite enmascarar incidentes reales, más la semántica 4xx/5xx rota para clientes con reintentos. Resuelto respetando el `statusCode` cuando es 4xx (mapa status→`code` alineado con el vocabulario de `AppError`) y logueando esos casos como `warn`; el `500` + `log.error` + enmascaramiento en producción quedan reservados a errores sin `statusCode` o 5xx |

### 12.5 Discrepancias entre este PLAN y el código real

Detectadas al documentar/verificar contra el código (la fuente de verdad final es el código):

- **Refresh token NO es un JWT.** El PLAN describe "JWT access + refresh" como si ambos fueran JWT. El refresh real son 48 bytes aleatorios hasheados con SHA-256 en la tabla `RefreshToken` (permite revocación/rotación sin Redis). Solo el access token es JWT. → ver ADR-004.
- ~~**`JWT_REFRESH_SECRET` es config muerta** (SEC-04): requerida en `env.ts`/`.env.example`/CI/compose pero sin referencias en `src/`. Vestigio del diseño original donde el refresh iba firmado.~~ → **Discrepancia resuelta en la Fase QA-3:** la variable se eliminó de los cuatro sitios, así que el PLAN y el código ya no divergen. Los únicos secretos de auth son `JWT_SECRET` (access token) y `COOKIE_SECRET` (cookie de refresh).
- **`PATCH /orders/:id/status` no es admin-only** (SEC-02), aunque la sección 4 lo marcaba `(admin)`. Resuelto en la Fase QA-1 con el modelo dueño+admin, que **supersede** ese texto: el dueño de la orden puede cambiar su estado y el `ADMIN` el de cualquiera. La autorización vive en `OrdersService` (por objeto), no en la ruta.
- **Cookie de refresh, no doble token en cookie httpOnly + JWT:** el mecanismo real usa cookie firmada `refresh_token` (path `/api/v1/auth`) + tabla de rotación.

### 12.6 Otros hallazgos técnicos (no de seguridad)

- **Zod v4 vs v3:** `fastify-type-provider-zod@5` valida contra el engine interno de Zod v4; hay que importar `import { z } from 'zod/v4'` en cada `schema.ts` (el import clásico `'zod'` rompe toda validación de ruta con un 500). Documentado inline en los módulos.
- **RBAC + rutas tipadas Zod:** meter `onRequest`/`preHandler` en las options de una ruta con `schema` Zod rompe la inferencia de tipos del `ZodTypeProvider` (TS2345). Patrón adoptado: doble sub-plugin por prefijo (externo con `authenticate` para GET; anidado con `requireRole('ADMIN')` para escritura).
- **Filtro `lowStock`:** Prisma no compara columna-vs-columna (`stock <= minStock`) en `where`; se resolvió con `$queryRaw` parametrizado (`Prisma.sql`/`Prisma.join`) manteniendo paginación real en SQL.
- ~~**Flakiness potencial en CI:** `inventory.test.ts` ("type + lowStock") falló 1 de 5 corridas contra un Postgres efímero (posible contaminación entre archivos de test bajo ejecución paralela de vitest sobre DB compartida). No reproducido en local (5/5 verdes). Posible fix: `fileParallelism: false` o aislamiento por schema.~~ → **Resuelto en la Fase QA-4.** La contaminación entre archivos era real (vitest paraleliza archivos contra la misma DB) y el fix fue en los tests, no en la config: cada listado se acota a sus propios fixtures (`?category=<scope>` único en `inventory.test.ts`, `?q=<token>` en los demás), así que ninguna aserción cuenta ya filas absolutas de una tabla compartida. No hizo falta `fileParallelism: false` ni aislamiento por schema — la suite sigue corriendo en paralelo.
- ~~**`npm run dev` del frontend roto (preexistente):** Vite 8 + `recharts`/`es-toolkit` lanza `require_isUnsafeProperty is not a function` al montar en modo dev; `npm run build` (producción) no se ve afectado.~~ → **Resuelto en la Fase QA-5.** Dos correcciones al diagnóstico original: (1) el pre-bundler culpable es **Rolldown**, no esbuild — Vite 8 sustituyó esbuild por Rolldown para el pre-bundleo de dependencias; (2) la causa raíz no estaba en `recharts` sino en el campo `exports` de **es-toolkit 1.47.0**, cuyo `./compat/*` carecía de condición `import` y resolvía a un shim CJS. Rolldown, al transformar ese CJS→ESM, colisiona con las constantes `require_*` que el propio archivo declara, generando `var require_isUnsafeProperty = require_isUnsafeProperty()` (se sombrea a sí misma). **Fix:** `"overrides": { "es-toolkit": "^1.50.0" }` en `frontend/package.json` — 1.50.0 añadió la condición `import` → `.mjs`, así que se resuelve ESM real y el transform defectuoso no se ejecuta. `vite.config.ts` sin cambios. Justificación completa y condiciones para retirar el override documentadas en `frontend/README.md` § "Dependencias: `overrides` de `es-toolkit`".

### 12.7 Cabos sueltos antes de "hecho"

- [x] Resolver **SEC-01** (BOLA en orders) → los 3 tests rojos de `security.test.ts` están en verde (Fase QA-1).
- [x] Decidir política de **SEC-02** (admin-only vs dueño) para `PATCH /orders/:id/status` → **dueño + admin**, aplicada en la Fase QA-1.
- [x] Decidir el alcance de **SEC-06** (burn-rate) → cálculo **global** (scopearlo por `userId` daría una proyección incorrecta) + endpoint **admin-only**, aplicado en la Fase QA-1.
- [x] Añadir rate-limit dedicado a `/auth/*` (**SEC-03**) → login 5/min, register 10/min, refresh 20/min por IP (Fase QA-2).
- [x] Eliminar la config muerta `JWT_REFRESH_SECRET` (**SEC-04**) → fuera del `EnvSchema`, `.env.example`, CI, compose y specs de agente; `grep` sin referencias funcionales (Fase QA-3).
- [x] Respetar el `statusCode` 4xx en el fallback del error handler (**SEC-07**) → 4xx con su status + log `warn`; `500` + log `error` solo para lo inesperado (Fase QA-3).
- [x] Eliminar la flakiness de la suite (**QA-4**) → listados acotados a los fixtures del propio test (`?category=`/`?q=` únicos); 10/10 corridas verdes, sin recurrir a `fileParallelism: false` (Fase QA-4).
- [x] Arreglar `npm run dev` del frontend → `"overrides": { "es-toolkit": "^1.50.0" }` en `frontend/package.json`; recharts renderiza verificado con Playwright (Fase QA-5). El override es temporal: ver condiciones para retirarlo en `frontend/README.md`.
- [ ] Ejecutar **Fase 8** (deploy Fly.io) cuando `flyctl` esté disponible.
- [ ] Nada del trabajo de las Fases 1-7 + QA está commiteado todavía (working tree en `feature/plan-implementacion`).

### 12.8 Plan de remediación por fases

Plan fase por fase para resolver cada hallazgo de §12.4/§12.6, ordenado por severidad y
dependencia. Cada fase se completa y se verifica (`npm test` + `npm run lint` + `npm run
typecheck` en verde en `api/`) antes de pasar a la siguiente; se recomienda un commit atómico
por fase.

**Decisiones tomadas:**
- **Modelo de órdenes: dueño + admin.** Un `USER` solo ve/gestiona las órdenes que registró
  (`Order.userId`); un `ADMIN` ve/gestiona todas. Resuelve SEC-01 y SEC-02 con el mismo
  mecanismo (chequeo de propiedad con bypass para admin) — supersede el texto literal
  `PATCH /orders/:id/status (admin)` de la sección 4.
- **Alcance:** todo lo de §12 — SEC-01..05 + flakiness de CI + bug de frontend dev + Fase 8 (deploy).

#### Fase QA-1 — SEC-01 + SEC-02: autorización a nivel de objeto en orders 🔴 Alta — ✅ COMPLETADA

**Problema:** `GET /orders`, `GET /orders/:id` y `PATCH /orders/:id/status` no filtran ni validan
por `userId` → cualquier usuario lee/lista/modifica órdenes ajenas (OWASP API1 BOLA); `PATCH
status` tampoco respeta ninguna política de rol (SEC-02).

**Solución:** propagar el actor autenticado `{ userId: request.user.sub, role: request.user.role
}` del controller al service:
- `list`: si `role !== 'ADMIN'`, filtrar por `userId`.
- `getById` / `updateStatus`: tras `findById`, si `role !== 'ADMIN'` y `order.userId !== userId`
  → `AppError.notFound('ORDER_NOT_FOUND')` (404, no filtra existencia). El dueño (o admin)
  procede normalmente.

**Archivos:** `api/src/modules/orders/{controller,service,repository}.ts` (repository: `userId?`
opcional en `FindManyOrdersParams`/`buildWhere`); `api/tests/security.test.ts` (los 3 BOLA pasan
a verde); `api/tests/orders-query.test.ts` (ajustar fixtures/token para reflejar acceso legítimo).

**Verificación:** `npm test` → **190/190 verde** (187 previos + 3 nuevos que cubren el lado
`ADMIN` del modelo); `security.test.ts` 17/17 sin modificar el archivo; `orders-create.test.ts`
(incl. concurrencia ACID) sigue verde; `npm run typecheck` y `npm run lint` limpios.

**Resultado:** `orders-query.test.ts` no necesitó realinear fixtures — ya sembraba cada orden con
el `userId` del usuario del token, así que sus tests de filtros/paginación/404 siguen ejerciendo
el mismo camino (ahora como acceso legítimo del dueño).

#### Fase QA-2 — SEC-03: rate-limit dedicado en `/auth/*` 🟠 Media — ✅ COMPLETADA

**Problema:** solo había rate-limit global (100/min); login admitía ~100 intentos de contraseña por
minuto (fuerza bruta, OWASP API4/API2).

**Solución aplicada:** `config.rateLimit` por-ruta en `login`/`register`/`refresh`, con umbrales
como constantes nombradas y **exportadas** (los tests las importan, así no se desincronizan).
`@fastify/rate-limit` ya estaba registrado global, así que no hubo que re-registrarlo: el plugin
mergea las opciones globales con las de cada ruta y crea un **store hijo por ruta**, o sea un
contador independiente por endpoint.

| Ruta | Límite | Motivo del umbral |
|---|---|---|
| `POST /auth/login` | 5/min | Único oráculo de credenciales de la API; el más estricto |
| `POST /auth/register` | 10/min | Spam de altas + costo de bcrypt (12 rondas por request) |
| `POST /auth/refresh` | 20/min | Rotación legítima frecuente; acotado igual |
| `POST /auth/logout` | global (100/min) | Idempotente, exige ya poseer la cookie, no es oráculo: limitarlo castiga al usuario legítimo, no al atacante |

Keying: el por defecto del plugin (`request.ip`, que con `trustProxy: true` resuelve el
`x-forwarded-for` real). **Refinamiento futuro documentado inline en `auth/routes.ts`:** keyear por
IP + email, porque solo-IP no frena a un atacante distribuido y bloquea a toda una NAT por el abuso
de un solo usuario (requiere leer el body → `hook: 'preHandler'`).

**Hallazgo colateral corregido:** `@fastify/rate-limit` lanza un `Error` plano con
`statusCode: 429` que `appErrorHandler` no reconocía (no es `AppError`), así que caía en la rama de
"error no controlado" y **la respuesta degradaba a `500 INTERNAL_ERROR`**, logueando además cada
exceso con nivel `error` (amplificación de logs). Afectaba también al límite global preexistente. Se
añadió un `errorResponseBuilder` en el registro global de `app.ts` que devuelve un `AppError`
(`RATE_LIMIT_EXCEEDED`, 429): el handler ya existente lo serializa con el envelope estándar y los
límites por-ruta lo heredan sin repetirlo. Es el único cambio en `app.ts`; los valores del límite
global (100/min) no se tocaron.

**Archivos:** `api/src/modules/auth/routes.ts` (límites por-ruta + constantes exportadas);
`api/src/app.ts` (`errorResponseBuilder`); `api/tests/auth-ratelimit.test.ts` (nuevo, 4 tests);
`api/tests/auth-endpoints.test.ts` (solo un comentario de aviso sobre el presupuesto de registros
del archivo — 9 de 10 —, sin tocar aserciones); `api/README.md` (sección "Rate limiting").

**Verificación:** `npm test` → **195/195 verde** (191 previos + 4 nuevos), **3 corridas seguidas sin
un solo fallo** (tampoco apareció la flakiness preexistente de QA-4). `security.test.ts` 17/17 sin
modificarlo. `npm run typecheck` y `npm run lint` limpios: añadir `config` a las options de una ruta
con `schema` Zod **no** rompe la inferencia del `ZodTypeProvider` (a diferencia de los hooks
`onRequest`/`preHandler`, que sí la rompen con TS2345 — ver §12.6), así que no hizo falta workaround.

**Respuesta 429 resultante** (con cabeceras `x-ratelimit-limit`, `x-ratelimit-remaining`,
`x-ratelimit-reset` y `retry-after`):

```json
{ "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "Demasiadas solicitudes. Reintenta en 59 segundos." } }
```

#### Fase QA-3 — SEC-04 + SEC-07: higiene de configuración y de manejo de errores 🟡 Baja — ✅ COMPLETADA

Se agruparon porque ambos son higiene transversal (config muerta + semántica de errores) y ninguno
toca lógica de negocio.

**SEC-04 — Problema:** `JWT_REFRESH_SECRET` requerida en varios sitios pero sin uso real en `src/`.

**SEC-04 — Solución aplicada:** eliminada la variable y todas sus referencias. Fuera del `EnvSchema`
(`api/src/config/env.ts`, con un comentario que explica que solo el access token es JWT y que el
refresh es un token opaco hasheado — ADR-004), de `api/.env.example`, de las env vars del job de
tests de `.github/workflows/ci.yml` y del servicio `api` de `api/docker-compose.yml`. También de las
specs de agente `.opencode/agent/Fase1-Agente-{Scaffold,Config}.md` y `Fase8-Agente-Deploy.md`,
sustituida por `COOKIE_SECRET` (que sí se usa) — relevante sobre todo en la de deploy, que si no
haría `fly secrets set` de un secreto muerto. `api/README.md` y `docs/api-decisions.md` (ADR-004)
pasaron de "deuda conocida" a "deuda resuelta". Ningún test ni `tests/setup.ts` la seteaba, y un
`.env` local que todavía la traiga sigue funcionando porque Zod ignora las claves extra.

**SEC-07 — Problema (reproducido):** la rama final de `api/src/shared/error-handler.ts` hardcodeaba
`reply.code(500)` e **ignoraba `error.statusCode`**, así que cualquier error de Fastify que no fuera
`AppError`/`ZodError`/Prisma/`error.validation` degradaba a 500. Comprobado: `POST /api/v1/auth/login`
con JSON malformado devolvía `500 INTERNAL_ERROR` en vez de `400`. El impacto principal era **ruido
de logs** — cada request malformada se registraba a nivel `error` como "Error no controlado", lo que
permite inundar los logs y enmascarar incidentes reales; además rompía la semántica 4xx/5xx para
clientes con reintentos. (La Fase QA-2 ya mitigó el caso concreto del `429` con un
`errorResponseBuilder` en `app.ts`; esto ataca la causa raíz.)

**SEC-07 — Solución aplicada:** rama nueva **antes** del 500 genérico que respeta el `statusCode`
cuando existe y cae en `[400, 500)`:

| Caso | Status | Log | `code` | `message` |
|---|---|---|---|---|
| `statusCode` 4xx | el suyo | `warn` — *"Petición inválida del cliente"* | mapa `CLIENT_ERROR_CODE_BY_STATUS` (400→`BAD_REQUEST`, 401→`UNAUTHORIZED`, 403→`FORBIDDEN`, 404→`NOT_FOUND`, 405, 406, 409→`CONFLICT`, 413, 415, 422, 429→`RATE_LIMIT_EXCEEDED`), fallback `CLIENT_ERROR` | `error.message` tal cual |
| Sin `statusCode` o 5xx | `500` | `error` — *"Error no controlado"* | `INTERNAL_ERROR` | enmascarado en producción (SEC-05) |

Umbrales como constantes nombradas (`CLIENT_ERROR_MIN_STATUS`, `SERVER_ERROR_MIN_STATUS`), sin magic
numbers. El mapa reutiliza el vocabulario de `AppError` y del `errorResponseBuilder` del rate-limit,
así que un error nativo de Fastify sale indistinguible de uno propio. **Decisión sobre el `message`
en 4xx:** no se enmascara en producción (sí en 5xx), porque el cliente necesita saber qué envió mal,
porque es el mismo criterio que ya se aplicaba a los `AppError` 4xx, y porque los mensajes 4xx de
Fastify son cadenas estáticas de protocolo sin stacks ni rutas de archivo. Razonamiento documentado
inline en el handler. SEC-05 no se debilita: el enmascaramiento sigue íntegro donde está el riesgo
real de information disclosure (los 5xx).

**Archivos:** `api/src/shared/error-handler.ts`; `api/src/config/env.ts`; `api/.env.example`;
`api/docker-compose.yml`; `.github/workflows/ci.yml`; `api/tests/security.test.ts` (**solo se
añadieron** 3 casos al `describe` de API8; ninguna aserción existente se tocó);
`api/README.md`, `docs/api-decisions.md`, `.opencode/agent/*.md`.

**Verificación:** `npm test` → **198/198 verde** (195 previos + 3 nuevos), **3 corridas seguidas sin
un solo fallo** (tampoco apareció la flakiness preexistente de QA-4). `npm run typecheck` y
`npm run lint` limpios. `docker compose config -q` válido. `grep -rn JWT_REFRESH_SECRET`
(excluyendo `node_modules`) → sin referencias funcionales; solo quedan las menciones históricas de
`PLAN.md`/`PENDING.md`/ADR-004 que documentan el propio hallazgo y su cierre.

**Resultado (antes → después), `POST /api/v1/auth/login`:**

```
# JSON malformado + content-type: application/json
antes:  500 {"error":{"code":"INTERNAL_ERROR","message":"Body is not valid JSON but content-type is set to 'application/json'"}}
ahora:  400 {"error":{"code":"BAD_REQUEST","message":"Body is not valid JSON but content-type is set to 'application/json'"}}

# Content-Type: text/plain — sin cambios, lo sigue capturando Zod
400 {"error":{"code":"VALIDATION_ERROR","message":"Datos de entrada inválidos","details":[...]}}
```

**Ningún test existente cambió de comportamiento.** El handler lo usan todos los módulos, pero las
rutas que ya devolvían 4xx lo hacían vía `AppError` / `ZodError` / `error.validation` / Prisma
`P2002`, ramas que se evalúan **antes** que la nueva y quedaron intactas; el 404 de ruta inexistente
tampoco pasa por aquí (lo sirve el `notFoundHandler` por defecto de Fastify). La nueva rama solo
captura lo que antes caía en el 500. **Red de seguridad añadida:** `requireRole` llama a
`request.jwtVerify()` sin `try/catch`, así que por sí solo dejaría escapar un `FST_JWT_*` con
`statusCode` 401 que antes habría degradado a 500; hoy es inalcanzable porque **todos** los módulos
encadenan `app.authenticate` antes (y ese sí traduce a `AppError.unauthorized`), pero si alguien
montara una ruta solo con `requireRole` ahora respondería `401 UNAUTHORIZED` en vez de `500`.

#### Fase QA-4 — Estabilidad de tests: flakiness de `inventory.test.ts` en CI — ✅ COMPLETADA

**Problema:** el test "combina 2+ filtros (type + lowStock)" falla de forma intermitente (≈1 de
cada 5-6 corridas), sobre todo contra Postgres efímero/fresco en CI. Ocasionalmente también se vio
fallar `security.test.ts > "rechaza un token con firma manipulada"`.

**🔍 Causa raíz — YA DIAGNOSTICADA** (durante la Fase SEC-06; verificada restaurando el código
previo y corriendo la suite 6 veces en ese baseline, donde el fallo se reproduce igual → **no lo
introdujo ningún cambio de las fases QA**, es preexistente):

> El test asserta `expect(body.data).toHaveLength(1)` sobre la tabla `InventoryItem` **completa**,
> sin acotar el resultado a los fixtures que él mismo creó. Vitest ejecuta los archivos de test en
> paralelo contra la **misma base de datos compartida**, así que cualquier otro archivo que cree un
> `InventoryItem` de tipo `ALIMENTO` con `stock < minStock` entra en el mismo resultado y rompe la
> aserción de longitud.

**Contaminador identificado:** `tests/analytics.test.ts` crea un item con `stock: 15, minStock: 20`
(item "B" de sus fixtures), que cumple exactamente `type=ALIMENTO` + `lowStock`. Ya lo hacía desde
antes; es coincidencia de timing que ambos archivos corran a la vez.

**Solución aplicada (la preferida; el fallback no hizo falta):** se acotó cada listado a los
fixtures del propio test en vez de contar filas absolutas de la tabla. **Ningún cambio en
`api/src/`** — el bug estaba en las aserciones, no en el endpoint.

- **`inventory.test.ts`:** helper `uniqueCategory(label)` que genera una **categoría única por
  test**, usada como namespace de sus fixtures y añadida a la query como `?category=<scope>`. Se
  eligió `category` porque es un filtro **exacto** que compone con todos los demás (`q`, `type`,
  `supplierId`) y, clave para este caso, también con el camino `$queryRaw` de `lowStock`
  (`buildRawConditions` ya lo contempla). Al quedar el resultado acotado, las aserciones pasaron de
  `>=` + `indexOf` a exactas: `total: 2`, `ids` comparados en orden, `toHaveLength` real.
- **Flakies latentes del mismo patrón** encontrados con `grep -n "toHaveLength\|meta.total"`: el
  test "lista paginada happy path" de `customers`, `suppliers`, `recipes` y `users` asertaba
  `indexOf(...) >= 0` sobre `?page=1&limit=20` **sin filtro**, o sea dependía de que sus fixtures
  cayeran dentro de las 20 filas más recientes de una tabla que otros archivos también escriben
  (el caso de `User` es el más expuesto: la escriben los 14 archivos). Se acotaron con un token
  único compartido por los fixtures + `?q=<token>`.
- **Se dejaron intactos** los `toHaveLength` que ya estaban acotados por un filtro único del propio
  test: `?category=` y `?supplierId=` en inventory, todo `orders-query.test.ts` (ya filtraba por
  `customerId` justamente por este motivo, con el comentario que lo explica), los `q=findmespecial`
  (literal exclusivo de cada archivo, y el `beforeEach` limpia sus propias filas) y los
  `limit=2 → toHaveLength(2)`, imposibles de romper por contaminación.

**Ninguna aserción se relajó ni se borró ningún caso:** los tests verifican exactamente lo mismo
(que el filtro combinado `type` + `lowStock` funciona), pero sin depender de qué otros archivos
estén corriendo en paralelo. La suite sigue en **198 tests**.

**Archivos:** `api/tests/{inventory,customers,suppliers,recipes,users}.test.ts`.
`api/vitest.config.ts` **sin cambios** — el fallback `fileParallelism: false` habría sido
determinista pero más lento y habría escondido el problema de fondo.

**Verificación:**
- `npm test` **10 corridas seguidas → 10/10 verdes** (198/198 tests, 14 archivos, 0 fallos).
- `npx vitest run tests/inventory.test.ts tests/analytics.test.ts` (los dos archivos implicados,
  juntos y en paralelo, para forzar la carrera) **8 corridas → 8/8 verdes** (39/39).
- **Contra-prueba de que el fix ataca la causa raíz:** se sembraron a mano 30 filas contaminantes
  en `InventoryItem`, 15 de ellas `ALIMENTO` con `stock <= minStock`. La query sin acotar
  (`type=ALIMENTO&lowStock=true`) devolvía **15 filas** — la vieja aserción `toHaveLength(1)`
  habría fallado —, y con el fix `inventory.test.ts` pasa **33/33** con esas filas presentes.
- `npm run typecheck` y `npm run lint` limpios; `prettier --check` de los 5 archivos tocados OK.

#### Fase QA-5 — Frontend `npm run dev` roto (recharts/Vite, preexistente) — ✅ COMPLETADA

**Problema:** `npm run dev` crasheaba **antes de montar React** con `TypeError:
require_isUnsafeProperty is not a function`, por la cadena `recharts` → `es-toolkit`. Solo
afectaba a `dev`; `npm run build` (producción) nunca se vio afectado.

**Causa raíz real** (corrige el diagnóstico inicial, que atribuía el fallo a **esbuild**: Vite 8
usa **Rolldown** para pre-bundlear dependencias):

1. `recharts` importa subpaths profundos: `import ... from 'es-toolkit/compat/get'`.
2. En **es-toolkit 1.47.0** el `exports` de `./compat/*` **no tenía condición `import`** — solo
   `default` → `./compat/*.js`, un **shim CommonJS**
   (`module.exports = require('../dist/compat/object/get.js').get`).
3. Al resolverse a CJS, **Rolldown** aplica su transform CommonJS→ESM sobre
   `dist/compat/object/get.js`.
4. Ese archivo declara constantes propias con prefijo `require_`
   (`const require_isUnsafeProperty = require(...)`), **el mismo prefijo** que Rolldown usa para
   sus funciones factory → colisión de nombres. El bundle generado quedaba
   `var require_isUnsafeProperty = require_isUnsafeProperty();`: el `var` hoistea el binding local
   como `undefined`, la llamada resuelve a la variable local en vez de a la factory → `is not a
   function`.

**Solución aplicada** (reemplaza la propuesta original `optimizeDeps.exclude`, que **no
funcionó**): override de la versión en `frontend/package.json`:

```json
"overrides": { "es-toolkit": "^1.50.0" }
```

**es-toolkit 1.50.0** añadió la condición `import` a `exports["./compat/*"]` → `./compat/*.mjs`,
así que `recharts` resuelve a ESM real y el transform CJS defectuoso nunca se ejecuta. `recharts`
declara `es-toolkit: ^1.39.3`, luego 1.50.0 cae dentro de su rango semver. `vite.config.ts` **no
necesitó cambios** y queda en su estado original.

**Alternativas probadas y descartadas:**

| Intento | Resultado |
|---|---|
| `optimizeDeps.exclude: ['es-toolkit']` (propuesta original) | Falla distinta: `does not provide an export named 'default'` |
| `optimizeDeps.include: ['es-toolkit/compat']` | Mismo error `require_isUnsafeProperty` |

**Archivos:** `frontend/package.json` (bloque `overrides`), `frontend/package-lock.json`,
`frontend/README.md` (documentación del porqué del override y condiciones para retirarlo).

**Verificación realizada:**
- `npm run dev` arranca y la app monta: se renderiza el formulario de login; en consola solo
  `ERR_CONNECTION_REFUSED` contra el backend apagado (esperable), **sin errores de módulos**.
- **recharts dibuja de verdad** (comprobado con Playwright sobre una página de prueba temporal —
  ya eliminada — que replica los imports exactos de `AnalyticsDashboard` con datos fijos, dado que
  ese componente está detrás del login y consume el backend viejo): 2 `svg.recharts-surface` de
  600x250, 6 `path` de barras con geometría real (`M 82.6667,145 h 68 v 70 h -68 Z`) y fills
  `#ef4444`/`#3b82f6`, 3 sectores de tarta con arcos, ejes con labels (`Harina`, `Azucar`, `Sal`)
  y ticks (`0,3,6,9,12`), y leyenda renderizada.
- **Mecanismo del fix confirmado en el bundle:** `node_modules/.vite/deps/recharts.js` ahora inlinea
  `es-toolkit/dist/compat/**/*.mjs` (ESM) y define `function isUnsafeProperty(key)`; **no queda
  ninguna ocurrencia** de `require_isUnsafeProperty` ni del patrón auto-sombreante `var X = X()`.
- `npm run build` OK y `npm run lint` limpio.

**Nota de mantenimiento:** el override es temporal. Podrá retirarse cuando `recharts` suba su rango
mínimo de `es-toolkit` a ≥1.50.0, o cuando Rolldown corrija la colisión de nombres. Al retirarlo,
verificar **con `npm run dev`** (el bug no se manifiesta en `build`) y usar `npm run dev -- --force`
para invalidar la caché de `node_modules/.vite`.

#### Fase QA-6 — SEC-05 + Deploy Fly.io (Fase 8, task #17)

**Problema:** SEC-05 es una verificación de deploy (`NODE_ENV=production` para no filtrar
`error.message`); la Fase 8 sigue pendiente por falta de `flyctl` autenticado.

**Solución:** requiere que el usuario instale y autentique `flyctl` (`fly auth login`, acción
interactiva suya). Luego: `fly launch` en `api/` con el Dockerfile existente (región `scl`);
`fly postgres create` + attach; `fly secrets set JWT_SECRET COOKIE_SECRET CORS_ORIGIN CLIENT_URL
NODE_ENV=production`; `fly deploy`; verificar `/health` (200) y `/docs`. Confirmar SEC-05: en
prod el 500 devuelve mensaje genérico (ya implementado en `shared/error-handler.ts`, depende solo
de `NODE_ENV`).

**Archivos:** `api/fly.toml` (nuevo, generado por `fly launch`). Sin cambios de código de app.

**Verificación:** URL pública responde `/health` 200 y `/docs`; un 500 provocado no filtra internals.

#### Orden de ejecución

QA-1 (crítica) → QA-2 → QA-3 → QA-4 (deja CI 100% determinista) → QA-5 → QA-6 (gated en que el
usuario tenga `flyctl` listo). QA-1..QA-4 son independientes de infraestructura y pueden
completarse y commitearse de a una. Al cerrar cada hallazgo, actualizar su estado en
`PENDING.md` y en §12.4/§12.7 de este documento.

**Verificación global al terminar todas las fases:** `cd api && npm test` → 190+/190+ verde
(incluye los 3 BOLA + nuevos tests de rate-limit); `npm run lint`/`npm run typecheck` limpios;
`PENDING.md` con SEC-01..05 marcados como resueltos (o SEC-05 verificado en deploy);
`docker compose up --build` sigue levantando api+postgres con `/health` en 200.