# ADR — Decisiones de arquitectura de `api/` (Proyecto A)

Registro breve de las decisiones de diseño del nuevo backend `api/`
(Fastify + Prisma + PostgreSQL), verificadas contra el código real en
`api/src/`, `api/prisma/schema.prisma`, `api/tests/`, `api/Dockerfile` y
`api/docker-compose.yml` — no solo contra `../PLAN.md`. Donde el plan
original y el código difieren, se documenta lo que el código realmente
hace y se marca la corrección explícitamente.

Formato por decisión: `id`, `estado`, `contexto`, `decisión`,
`consecuencias` (positivas / negativas).

---

## ADR-001 — Reescribir en `api/` en vez de reutilizar `backend/` (Mongo)

**Estado:** Aceptada

**Contexto:** `backend/` (Express 5 + Mongoose + MongoDB) ya resuelve el
dominio de inventario/recetas/órdenes/analytics de forma funcional, pero
sin tests, sin Docker/CI, sin auth, y sobre un modelo documental que no
demuestra integridad relacional (FKs, transacciones ACID reales con
locking) ni un ORM tipado con migraciones versionadas.

**Decisión:** Construir un servicio nuevo desde cero en `api/`
(Fastify + Prisma + PostgreSQL) en vez de incrementar `backend/`.
`backend/` queda **congelado** como referencia — no se modifica — y sigue
siendo el backend que consume `frontend/` para la demo de inventario
actual.

**Consecuencias:**
- Positivas: permite elegir el stack "serio" (relacional, tipado,
  testeado, dockerizado) sin arriesgar romper la demo funcional existente
  durante la transición; los dos proyectos son comparables lado a lado en
  el portafolio (NoSQL/rápido vs relacional/production-grade).
- Negativas: duplica temporalmente el dominio de negocio en dos bases de
  código distintas; el frontend queda apuntando a dos backends distintos
  (`backend/` para inventory/recipes/orders, `api/` solo para
  auth) hasta que se complete la migración de la UI, lo cual no ha
  ocurrido todavía (ver ADR-008).

---

## ADR-002 — Fastify 5 sobre Express 5

**Estado:** Aceptada

**Contexto:** Se necesitaba un framework HTTP para Node/TypeScript con
buen soporte de validación de esquemas, tipado end-to-end del
request/response, y un ecosistema de plugins maduro para JWT, cookies,
CORS, rate-limit y documentación OpenAPI.

**Decisión:** Fastify `^5.11.2` con `fastify-type-provider-zod` como
type provider (`src/app.ts`: `setValidatorCompiler`/`setSerializerCompiler`).
Un único schema Zod por ruta valida el request, tipa
`request.body`/`query`/`params` en TypeScript, serializa la respuesta y
genera el OpenAPI de Swagger (`transform: jsonSchemaTransform` en
`src/plugins/swagger.ts`) sin capas de mapeo manual. El ecosistema
oficial (`@fastify/jwt`, `@fastify/cookie`, `@fastify/helmet`,
`@fastify/cors`, `@fastify/rate-limit`, `@fastify/swagger(-ui)`) cubre
todo lo necesario sin dependencias de terceros no mantenidas. El motor de
serialización de Fastify (JSON Schema compilado) es además
sustancialmente más rápido que `res.json()` de Express para respuestas
paginadas grandes (`GET /orders`).

**Consecuencias:**
- Positivas: contrato único (schema Zod) para validación + tipado +
  serialización + docs; menos código de mapeo manual que en Express;
  mejor rendimiento en serialización.
- Negativas: ecosistema de plugins más pequeño que Express (menos
  middleware de terceros disponible "out of the box"); curva de
  aprendizaje del sistema de plugins/decorators de Fastify frente al
  modelo de middlewares más conocido de Express; acopla el proyecto a un
  workaround de versiones de Zod (ver ADR-009).

---

## ADR-003 — Prisma 6 sobre Drizzle

**Estado:** Aceptada

**Contexto:** Se necesitaba un ORM/query builder tipado para PostgreSQL
con migraciones versionadas y buena DX, priorizando velocidad de
iteración sobre control fino del SQL generado (proyecto de portafolio,
no un sistema con queries extremadamente complejas en el hot path).

**Decisión:** Prisma `^6.19.3`. Migraciones versionadas con historial
reproducible en `prisma/migrations/` (p. ej.
`20260804230715_init/migration.sql`), cliente completamente tipado
regenerado automáticamente en `postinstall` (`@prisma/client`). Donde
Prisma no alcanza (locking pesimista de filas), se cae puntualmente a
`$queryRaw`/`$transaction` interactivo — ver ADR-005.

**Consecuencias:**
- Positivas: DX superior (autocompletado, cliente tipado desde el
  schema), migraciones versionadas legibles y reproducibles, curva de
  aprendizaje baja.
- Negativas: menos control sobre el SQL generado que Drizzle (que es más
  "query builder" que ORM); requiere caer a `$queryRaw` para
  `SELECT ... FOR UPDATE`, lo que mezcla dos estilos (Prisma Client +
  SQL crudo) en el mismo módulo (`src/modules/orders/repository.ts`).

---

## ADR-004 — Auth: access JWT (15 min) + refresh token opaco (7 días)

**Estado:** Aceptada

**Contexto:** `PLAN.md` (sección 0 y 5) especificaba originalmente
"JWT access (15min) + refresh (7d httpOnly cookie)", dando a entender que
ambos tokens serían JWT firmados, y declaraba una variable
`JWT_REFRESH_SECRET` para firmar el refresh.

**Decisión (corrección respecto al PLAN — verificado contra el código
real):** Implementado en `src/plugins/auth.ts` y
`src/modules/auth/service.ts`. **Solo el access token es un JWT firmado**
(`@fastify/jwt`, `sign: { expiresIn: '15m' }`). El **refresh token NO es
un JWT**: es un valor aleatorio de 48 bytes (`crypto.randomBytes`), sin
estructura ni firma JWT propia. Se envía al cliente como cookie
`refresh_token` (`httpOnly`, `sameSite=strict`, `secure` en producción,
firmada por `@fastify/cookie` — no por JWT) y se persiste en la tabla
`RefreshToken` **hasheado con SHA-256** (nunca en texto plano), con
índice único en `tokenHash`. Cada `POST /auth/refresh` revoca el token
usado y emite uno nuevo (rotación) — `AuthService.refresh` — de modo que
un token robado y reutilizado después de una rotación legítima ya
aparece revocado. Este mecanismo evita depender de Redis o de una
blacklist en memoria: alcanza una tabla Postgres para el volumen de un
ERP interno.

**Deuda resuelta (Fase QA-3, SEC-04):** la variable de entorno
`JWT_REFRESH_SECRET` quedó declarada como requerida en
`src/config/env.ts`, `.env.example`, el workflow de CI y
`docker-compose.yml`, con **cero usos** en `src/` — config muerta,
remanente del diseño original de `PLAN.md` (refresh firmado como JWT)
que el mecanismo implementado (token opaco + hash) vuelve innecesaria.
**Se eliminó de los cuatro sitios**; el `EnvSchema` ya no la exige, así
que un despliegue nuevo no necesita generar un secreto que nadie usa
(y quien lea `.env.example` no espera que se use). Los únicos secretos
de la capa de auth son `JWT_SECRET` (firma del access token) y
`COOKIE_SECRET` (firma de la cookie de refresh por `@fastify/cookie`).
Zod ignora claves extra del entorno, así que un `.env` local que todavía
la traiga sigue funcionando sin cambios.

**Consecuencias:**
- Positivas: el access token de vida corta limita la ventana de daño si
  se filtra (XSS, logs); el refresh en tabla permite revocación real
  (logout efectivo) y rotación (detección de reuso de token robado) sin
  infraestructura adicional (Redis). La superficie de configuración
  queda mínima y sin secretos muertos.
- Negativas: el refresh depende de una tabla Postgres (una consulta
  extra por refresh) en vez de ser puramente stateless.

---

## ADR-005 — Transacciones ACID con `SELECT ... FOR UPDATE` en `POST /orders`

**Estado:** Aceptada

**Contexto:** Crear una orden descuenta stock de varios `InventoryItem` a
la vez; bajo concurrencia (dos pedidos simultáneos consumiendo el mismo
insumo), una lectura-luego-escritura sin locking puede sobrevender: ambos
pedidos leen el mismo `stock`, ambos validan que alcanza, ambos
descuentan.

**Decisión:** Implementado en `src/modules/orders/repository.ts`
(`lockInventoryItemById`, que ejecuta
`` SELECT * FROM "InventoryItem" WHERE id = ${id} FOR UPDATE `` dentro de
`prisma.$transaction`) y orquestado por `OrdersService.createWithinTx`
(`src/modules/orders/service.ts`). Flujo: resolver cada `recipeId` contra
`Recipe`, expandir y acumular ingredientes por `inventoryItemId`,
**bloquear cada `InventoryItem` en orden ascendente de id** (para que
transacciones concurrentes que compiten por los mismos insumos los
bloqueen siempre en el mismo orden global y Postgres nunca deadlockee
entre sí), validar que el stock bloqueado alcance, descontar, calcular el
total y persistir — todo dentro de una única transacción interactiva.
Si cualquier paso falla (receta inexistente, stock insuficiente), Prisma
hace rollback automático.

Validado por un test de concurrencia real (no solo unitario):
[`api/tests/orders-create.test.ts`](../api/tests/orders-create.test.ts),
caso *"concurrencia: bajo stock limitado, el FOR UPDATE serializa el
acceso y evita sobreventa"* (línea 260) — dispara 3 pedidos simultáneos
(`Promise.all`) contra un item con `stock=10` donde cada pedido consume 4
unidades (solo 2 de los 3 pueden completarse) y verifica que exactamente
2 se resuelven en éxito y 1 en 409 `INSUFFICIENT_STOCK`, sin sobreventa.

**Consecuencias:**
- Positivas: garantiza integridad de stock bajo concurrencia real
  (probado, no solo asumido); el orden ascendente de locking previene
  deadlocks entre transacciones concurrentes que tocan los mismos
  insumos en distinto orden de llegada.
- Negativas: `FOR UPDATE` serializa el acceso a las filas de
  `InventoryItem` involucradas — bajo alta concurrencia sobre el mismo
  insumo, las transacciones compiten y algunas terminan en 409 en vez de
  encolarse (comportamiento deseado para este dominio, pero es un
  trade-off de throughput vs. consistencia); requiere `$queryRaw` (Prisma
  no expone `FOR UPDATE` de forma nativa), ver ADR-003.

---

## ADR-006 — `Recipe.ingredients` como `Json` en vez de tabla intermedia

**Estado:** Aceptada

**Contexto:** Cada receta tiene una lista de ingredientes
(`{ inventoryItemId, quantityNeeded }`). Modelarlo como tabla `N:N`
(`RecipeIngredient`) sería lo "correcto" relacionalmente, pero los
ingredientes de una receta siempre se leen y escriben junto con la receta
completa — nunca se necesita, en este dominio, una consulta independiente
tipo "todas las recetas que usan el insumo X".

**Decisión:** `prisma/schema.prisma`: `Recipe.ingredients` es `Json`
(array de `{ inventoryItemId, quantityNeeded }`), no una tabla
intermedia. Se mitiga la falta de FK real con validación en la capa de
aplicación:
- `RecipesService.assertIngredientsExist`
  (`src/modules/recipes/service.ts`) valida, en `create`/`update`, que
  cada `inventoryItemId` exista en `InventoryItem`; si no, 400
  `INVENTORY_ITEM_NOT_FOUND`.
- Como un `InventoryItem` puede borrarse después de crear la receta (no
  hay `onDelete` que lo impida), `GET /recipes/:id` degrada con gracia:
  el DTO de detalle trae `name`/`unit` `nullable` en vez de romper con un
  500.
- Al leer, Prisma tipa el `Json` como `JsonValue`/`unknown`; tanto
  `RecipesService` como `OrdersService` revalidan ese valor contra el
  mismo `IngredientSchema` de Zod usado para escribir (nunca `as` sin
  validar).

**Consecuencias:**
- Positivas: evita joins innecesarios para el único patrón de acceso real
  (receta completa); simplifica el modelo y las queries.
- Negativas: sin integridad referencial a nivel de base de datos —
  depende enteramente de la validación en el service para no dejar
  referencias huérfanas al crear/actualizar; un `inventoryItemId`
  referenciado puede quedar "colgado" si el insumo se borra después
  (mitigado con degradación a `null`, no con prevención).

---

## ADR-007 — Migraciones orquestadas en el arranque del contenedor (no en CI)

**Estado:** Aceptada

**Contexto:** Había que decidir cuándo aplicar `prisma migrate deploy`:
como paso de CI/CD antes de desplegar la imagen, o como parte del propio
arranque del contenedor.

**Decisión:** El `CMD` del `Dockerfile` de `api/` ejecuta
`npx prisma migrate deploy && node dist/server.js` — las migraciones se
aplican automáticamente cada vez que arranca el contenedor, no como paso
separado en CI. Confirmado en el código real
(`api/Dockerfile`, comentario explícito: *"Migraciones se orquestan en el
arranque del contenedor (no en CI), según PLAN.md Fase 6"*). Ya validado
end-to-end con `docker compose up --build`
(`api/docker-compose.yml`): levanta `postgres:16-alpine` con healthcheck
(`pg_isready`) y la API (imagen multi-stage, runtime non-root `node`), y
el contenedor aplica las migraciones sin pasos manuales previos.

**Consecuencias:**
- Positivas: `docker compose up` (o el futuro `fly deploy`) funciona
  "out of the box" sin un paso de CI/CD adicional que orqueste
  migraciones contra la base de producción; simplifica el pipeline para
  un proyecto de portafolio de un solo servicio.
- Negativas: si dos instancias del contenedor arrancan en paralelo (p.
  ej. un despliegue con más de una réplica), ambas intentarían correr
  `migrate deploy` simultáneamente — no es un problema con una sola
  instancia (el caso actual, incluido el plan de Fly.io free tier), pero
  sería una deuda a resolver antes de escalar horizontalmente; acopla el
  tiempo de arranque del contenedor a la duración de la migración.

---

## ADR-008 — Despliegue en Fly.io, región `scl` (free tier)

**Estado:** Aceptada, pendiente de ejecución

**Contexto:** El plan original (`PLAN.md`, Fase 8) contempla desplegar
`api/` en Fly.io con Postgres gestionado en la región `scl` (Santiago),
aprovechando el free tier.

**Decisión:** Se mantiene Fly.io como plataforma de destino, pero
**la Fase 8 no se ha ejecutado todavía**. Verificado contra el estado
real del repo: no existe `fly.toml` en `api/`, no hay URL pública
desplegada, y `api/README.md` lo confirma explícitamente en su sección
"Estado del deploy": *"Pendiente. El proyecto no está desplegado en
Fly.io todavía... no existe un `fly.toml` en este directorio ni una URL
pública."* `docker compose up --build` es, por ahora, la única forma
verificada de correr la API completa fuera de `npm run dev`.

**Consecuencias:**
- Positivas: la decisión de plataforma ya está tomada y justificada
  (free tier generoso, Postgres incluido, Dockerfile ya compatible), lo
  que reduce el trabajo restante a ejecución pura sin rediseño.
- Negativas: mientras la Fase 8 esté pendiente, no hay demo pública de
  `api/` — solo verificable localmente (`npm run dev` o
  `docker compose up`); el README raíz y este ADR deben marcar esto con
  claridad para no sobre-representar el estado del proyecto ante
  quien revise el portafolio.

---

## ADR-009 — RBAC vía decorator `requireRole` + workaround `zod/v4` (adicional)

**Estado:** Aceptada

**Contexto:** Dos hallazgos adicionales del código real, no cubiertos
explícitamente en `PLAN.md`, relevantes para entender el proyecto:

**Decisión:**
1. **RBAC**: no se usa un patrón de sub-plugins Fastify separados para
   rutas admin/user. En su lugar, `src/plugins/auth.ts` decora la
   instancia con `app.authenticate` (verifica JWT válido) y
   `app.requireRole(roles: Role | Role[])` (verifica JWT + rol
   permitido), ambos usados como `onRequest` hook por ruta dentro del
   mismo módulo (`routes.ts` de cada dominio). La tabla de permisos real
   (`api/README.md`, sección "Seguridad y RBAC"): `users` solo ADMIN
   lee/escribe; `customers`/`suppliers`/`inventory`/`recipes` cualquier
   autenticado lee, solo ADMIN escribe; `orders` cualquier autenticado
   lee y escribe (sin restricción de rol, así lo especifica el PLAN).
2. **`zod/v4` en vez de `zod`**: el paquete instalado es
   `zod@3.25.76`, una versión de transición que empaqueta ambas APIs (v3
   clásica y el engine interno v4). Como `fastify-type-provider-zod@5`
   valida contra el engine v4 (`zod/v4/core`), todos los `schema.ts` del
   proyecto importan explícitamente `from 'zod/v4'` — importar el
   default `from 'zod'` rompe la validación en runtime. Las únicas
   excepciones son `src/config/env.ts` (fuera del ciclo Fastify) y
   `src/shared/error-handler.ts` (`instanceof ZodError` como red de
   seguridad), que sí importan el default.

**Consecuencias:**
- Positivas: RBAC simple y explícito por ruta (visible en cada
  `routes.ts`, sin indirección de sub-plugins); el workaround de
  `zod/v4` está documentado con el mismo comentario repetido en cada
  `schema.ts`, reduciendo el riesgo de que alguien lo rompa sin saber
  por qué.
- Negativas: el `onRequest` por ruta es fácil de olvidar en una ruta
  nueva (no hay un plugin que agrupe automáticamente todas las rutas
  admin bajo un mismo prefijo protegido); el workaround de `zod/v4` es
  frágil ante un upgrade futuro de `zod` a v4 estable (habría que
  revisar todos los `schema.ts` a la vez).

---

## Referencias

- Fuente original de las decisiones de diseño: [`../PLAN.md`](../PLAN.md)
  (secciones 0, 3, 5, 6, 11).
- Estado real del código y decisiones detalladas:
  [`../api/README.md`](../api/README.md) (este ADR resume y referencia
  esa fuente; ante cualquier discrepancia futura, `api/README.md` y el
  código en `api/src/` son la fuente de verdad, no `PLAN.md`).
