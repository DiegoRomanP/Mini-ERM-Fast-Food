# PENDING — Hallazgos abiertos (QA)

Pendientes detectados con la batería de pruebas QA en `api/tests/security.test.ts`, basada en los
checklists de las skills instaladas (`testing-jwt-token-security`,
`testing-api-for-broken-object-level-authorization`, `testing-api-security-with-owasp-top-10`)
mapeados a **OWASP API Security Top 10 (2023)**.

- **Alcance:** `api/` (backend Fastify/Prisma). No incluye `backend/` (Mongo, congelado).
- **Método:** tests de integración contra `buildApp()` + `app.inject()` (mismo patrón que la suite existente). Cada aserción expresa el comportamiento **seguro** esperado; un test que falla = hallazgo.
- **Cómo reproducir:** `cd api && npx vitest run tests/security.test.ts`
- **Estado de la suite:** `198 tests → 198 pasan` (14 archivos). `security.test.ts`: 20/20.
- **Ya resueltos** (SEC-01, SEC-02, SEC-06 — Fase QA-1; SEC-03 — Fase QA-2; SEC-04 y SEC-07 —
  Fase QA-3; QA-4 — Fase QA-4): archivados con su detalle completo en `PLAN.md` §12.4 y §12.8.

## Resumen

| ID | Severidad | OWASP API | Fase | Estado | Título |
|----|-----------|-----------|------|--------|--------|
| SEC-03 | 🟠 Media | API4 / API2:2023 | QA-2 | ✅ Resuelto | Sin protección de fuerza bruta dedicada en `/auth/login` |
| SEC-04 | 🟡 Baja | API8:2023 | QA-3 | ✅ Resuelto | `JWT_REFRESH_SECRET` declarada pero sin uso (config muerta) |
| SEC-05 | 🟡 Baja | API8:2023 | QA-6 | ⚠️ Verificar en deploy | El error handler expone `error.message` fuera de producción |
| SEC-07 | 🟡 Baja | API8:2023 | QA-3 | ✅ Resuelto | El fallback del error handler ignoraba `error.statusCode`: errores 4xx de Fastify degradaban a `500` |
| QA-4 | — (calidad) | — | QA-4 | ✅ Resuelto | Flakiness de `inventory.test.ts` bajo ejecución paralela |

---

## SEC-03 — Fuerza bruta en login sin límite dedicado ✅ (Fase QA-2 — Resuelto)

**OWASP API4:2023 (Unrestricted Resource Consumption) / API2 (Broken Authentication).**

Solo existía un rate-limit **global** de `100 req/min` (`app.ts`, `@fastify/rate-limit`). No había un límite más estricto ni bloqueo progresivo sobre `/auth/login` (ni `/auth/register` / `/auth/refresh`), así que se admitían ~100 intentos de contraseña por minuto por IP.

**Remediación aplicada:** límite por-ruta con `config.rateLimit` en `api/src/modules/auth/routes.ts` (el plugin ya estaba registrado global; las opciones por-ruta se mergean con las globales y cada ruta obtiene su **propio contador**, así que agotar `/login` no consume el cupo de `/register` ni el global). Umbrales como constantes nombradas y exportadas (las importan los tests, para que no puedan quedar desincronizados):

| Ruta | Constante | Límite | Motivo |
|---|---|---|---|
| `POST /auth/login` | `LOGIN_RATE_LIMIT_MAX` | 5/min | Único oráculo de credenciales: ~144.000 → 7.200 intentos/día por IP |
| `POST /auth/register` | `REGISTER_RATE_LIMIT_MAX` | 10/min | Spam de altas + costo de bcrypt (12 rondas por request) |
| `POST /auth/refresh` | `REFRESH_RATE_LIMIT_MAX` | 20/min | Rotación legítima frecuente, pero acotada |
| `POST /auth/logout` | — | global (100/min) | Idempotente, exige poseer ya la cookie y no es oráculo de credenciales: estrangularlo perjudica al usuario legítimo, no al atacante |

El keying es el por defecto del plugin (IP del cliente; con `trustProxy: true` resuelve el `x-forwarded-for` real detrás del proxy). **Refinamiento pendiente documentado inline:** keyear por IP + email, porque solo-IP no frena a un atacante distribuido y bloquea a toda una NAT por el abuso de un solo usuario.

**Efecto colateral corregido (`app.ts`):** el plugin lanza un `Error` plano con `statusCode: 429` que `appErrorHandler` no reconocía → la respuesta degradaba a **`500 INTERNAL_ERROR`** y cada exceso se logueaba como error no controlado. Afectaba también al límite global preexistente. Se añadió un `errorResponseBuilder` en el registro global que devuelve un `AppError`; ahora el 429 respeta el envelope estándar y lo heredan los límites por-ruta:

```json
{ "error": { "code": "RATE_LIMIT_EXCEEDED", "message": "Demasiadas solicitudes. Reintenta en 59 segundos." } }
```

**Tests:** `api/tests/auth-ratelimit.test.ts` (4 casos) — 429 al superar el umbral, aislamiento por IP (otra IP no se ve afectada), envelope del 429 sin internals, y contadores independientes por ruta. Cada caso usa una `x-forwarded-for` sintética propia (`10.0.0.<n>`) porque el store es in-memory y compartido en la instancia de app.

---

## SEC-04 — `JWT_REFRESH_SECRET` declarada pero sin uso ✅ (Fase QA-3 — Resuelto)

**OWASP API8:2023 — Security Misconfiguration (deuda/config muerta).**

`JWT_REFRESH_SECRET` se exigía como requerida en `config/env.ts`, `.env.example`, CI y docker-compose, pero **no se referenciaba en ningún punto de `src/`** (el refresh real son 48 bytes aleatorios hasheados con SHA-256 en la tabla `RefreshToken`, no un JWT firmado). No era explotable por sí sola; era higiene de configuración: obligaba a generar y custodiar un secreto que nadie consumía, y confundía a quien leyera `.env.example` esperando que se usara.

**Remediación aplicada:** eliminada la variable y **todas** sus referencias:

| Archivo | Cambio |
|---|---|
| `api/src/config/env.ts` | Fuera del `EnvSchema` (+ comentario explicando que solo el access token es JWT) |
| `api/.env.example` | Línea eliminada |
| `.github/workflows/ci.yml` | Fuera de las env vars del job de tests |
| `api/docker-compose.yml` | Fuera del servicio `api` (`docker compose config -q` sigue válido) |
| `api/README.md`, `docs/api-decisions.md` (ADR-004) | De "deuda conocida" a "deuda resuelta" |
| `.opencode/agent/Fase1-Agente-{Scaffold,Config}.md`, `Fase8-Agente-Deploy.md` | Sustituida por `COOKIE_SECRET`, que sí se usa (importante en el de deploy: evita setear un `fly secrets` muerto) |

Los únicos secretos de la capa de auth son `JWT_SECRET` (firma del access token) y `COOKIE_SECRET` (firma de la cookie de refresh por `@fastify/cookie`). Ningún test ni `tests/setup.ts` la seteaba o esperaba. Un `.env` local que todavía la traiga sigue funcionando: Zod ignora las claves extra del entorno.

---

## SEC-05 — Mensajes de error detallados fuera de producción 🟡 (Fase QA-6)

**OWASP API8:2023 — Security Misconfiguration.**

`shared/error-handler.ts` devuelve `error.message` cuando `NODE_ENV !== 'production'` y un mensaje genérico solo en producción. El comportamiento es correcto **siempre que el deploy fije `NODE_ENV=production`** (el `Dockerfile` y `docker-compose.yml` ya lo hacen).

**Remediación / verificación:** confirmar en el deploy real (Fase 8, Fly.io) que `NODE_ENV=production` está seteado, para no filtrar `message`/detalles internos en respuestas 500.

---

## SEC-07 — El error handler degradaba errores 4xx de Fastify a `500` ✅ (Fase QA-3 — Resuelto)

**OWASP API8:2023 — Security Misconfiguration (improper error handling).**

Detectado al verificar la Fase QA-2: el agente encontró que un `429` del rate-limit salía como
`500` y lo corrigió con un `errorResponseBuilder` en `app.ts`. Ese fix era correcto **para el
rate-limit**, pero la causa raíz seguía viva y afectaba a otros errores.

**Causa raíz:** la rama final de `api/src/shared/error-handler.ts` **hardcodeaba el status y no
miraba `error.statusCode`**:

```ts
request.log.error({ err: error }, 'Error no controlado');
const message = env.NODE_ENV === 'production' ? 'Error interno del servidor' : error.message;
return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message } });
```

Cualquier error de Fastify que no sea `AppError` / `ZodError` / Prisma / `error.validation` cae ahí
y se convierte en `500`, aunque traiga su propio `statusCode` 4xx.

**Reproducido** (contra `buildApp()`, POST a `/api/v1/auth/login`):

| Caso | Devuelve | Debería |
|---|---|---|
| Body con JSON malformado (`{"email": "roto",,,}`) | `500 INTERNAL_ERROR` — *"Body is not valid JSON but content-type is set to 'application/json'"* | `400` |
| `Content-Type: text/plain` | `400 VALIDATION_ERROR` ✅ | correcto (lo captura Zod) |

**Impacto:**
1. **Semántica errónea:** el cliente no puede distinguir "mandé mal la petición" (4xx, no reintentar
   igual) de "el servidor falló" (5xx, reintentable). Rompe el contrato de la API y confunde a
   cualquier cliente con lógica de reintento.
2. **Ruido de logs / enmascaramiento:** cada request malformada se loguea a nivel `error` como
   "Error no controlado". Un cliente roto —o alguien enviando basura a propósito— puede inundar los
   logs y tapar incidentes reales. Es el vector más relevante en producción.
3. **Fuga menor:** fuera de producción se devuelve el `error.message` interno (relacionado con
   SEC-05, que ya cubre la parte de `NODE_ENV`).

**Remediación aplicada** (`api/src/shared/error-handler.ts`): se añadió una rama previa al `500`
genérico que respeta el `statusCode` del error cuando existe y es 4xx.

| Caso | Status | Nivel de log | `code` del envelope | `message` |
|---|---|---|---|---|
| `error.statusCode` en `[400, 500)` | el propio `statusCode` | `warn` — *"Petición inválida del cliente"* | mapa `CLIENT_ERROR_CODE_BY_STATUS` (400→`BAD_REQUEST`, 401→`UNAUTHORIZED`, 403→`FORBIDDEN`, 404→`NOT_FOUND`, 405, 406, 409→`CONFLICT`, 413, 415, 422, 429→`RATE_LIMIT_EXCEEDED`), fallback `CLIENT_ERROR` | `error.message` tal cual |
| Sin `statusCode`, o `statusCode >= 500` | `500` | `error` — *"Error no controlado"* | `INTERNAL_ERROR` | enmascarado en producción (SEC-05 intacto) |

Los umbrales son constantes nombradas (`CLIENT_ERROR_MIN_STATUS`, `SERVER_ERROR_MIN_STATUS`), sin
magic numbers, y el mapa de códigos reutiliza el vocabulario que ya usaban `AppError` y el
`errorResponseBuilder` del rate-limit, para que un error nativo de Fastify salga indistinguible de
uno lanzado por nosotros.

**Decisión sobre el `message` en 4xx:** *no* se enmascara en producción, a diferencia de los 5xx.
Razonamiento (documentado inline): (a) el cliente necesita saber qué envió mal para corregirlo —
enmascararlo convierte un error accionable en uno mudo; (b) es exactamente el mismo criterio que ya
se aplicaba a los `AppError` 4xx, cuyo `message` viaja tal cual en producción, así que no introduce
una asimetría nueva; (c) un `statusCode` 4xx solo lo produce Fastify o sus plugins, y sus mensajes
son cadenas estáticas de protocolo (*"Body is not valid JSON..."*), nunca stacks ni rutas de
archivo. El stack se queda en el log, jamás en la respuesta. El enmascaramiento de SEC-05 sigue
aplicando íntegro a los 5xx, que es donde vive el riesgo real de information disclosure.

**Resultado verificado** (`POST /api/v1/auth/login`):

```
# JSON malformado + content-type: application/json  → antes 500, ahora 400
400 {"error":{"code":"BAD_REQUEST","message":"Body is not valid JSON but content-type is set to 'application/json'"}}

# Content-Type: text/plain → sin cambios, lo sigue capturando Zod
400 {"error":{"code":"VALIDATION_ERROR","message":"Datos de entrada inválidos","details":[...]}}
```

**Tests:** 3 casos nuevos en `api/tests/security.test.ts`, dentro del `describe` de **API8 Security
Misconfiguration** (solo se añadieron; ninguna aserción existente se tocó): JSON malformado → 400
con envelope estándar y `code !== INTERNAL_ERROR`; la respuesta no contiene `at Object.`,
`node_modules` ni `/src/`; y el caso `text/plain` sigue dando 400 por Zod (no regresión). Cada uno
usa una `x-forwarded-for` sintética propia (`10.1.0.x`) para no consumir el rate-limit de 5/min de
`/auth/login`.

---

## QA-4 — Flakiness de `inventory.test.ts` ✅ (Fase QA-4 — Resuelto)

No es un hallazgo de seguridad, sino de **calidad/estabilidad de la suite**. Se conserva aquí el
diagnóstico, que costó varias corridas identificar.

**Síntoma:** `tests/inventory.test.ts > "combina 2+ filtros a la vez (type + lowStock)"` falla de
forma intermitente (≈1 de cada 5-6 corridas), sobre todo contra un Postgres efímero/fresco en CI.
Ocasionalmente también se vio fallar `security.test.ts > "rechaza un token con firma manipulada"`.

**Causa raíz confirmada** (verificada restaurando el código previo y corriendo la suite 6 veces en
ese baseline — el fallo se reproduce igual, así que **no lo introdujo ningún cambio de las fases QA**):

> El test asserta `expect(body.data).toHaveLength(1)` sobre la tabla `InventoryItem` **completa**,
> sin acotar el resultado a los fixtures que él mismo creó. Vitest ejecuta los archivos de test en
> paralelo contra la **misma base de datos compartida**, así que cualquier otro archivo que cree un
> `InventoryItem` de tipo `ALIMENTO` con `stock < minStock` entra en el mismo resultado y rompe la
> aserción de longitud.

**Contaminador identificado:** `tests/analytics.test.ts` crea un item con `stock: 15, minStock: 20`
(item "B" de sus fixtures), que cumple exactamente `type=ALIMENTO` + `lowStock`. Ya lo hacía desde
antes; es coincidencia de timing que ambos archivos corran a la vez.

**Remediación aplicada (solo tests; `src/` sin tocar):** se acotó cada listado a los fixtures del
propio test, en vez de contar filas absolutas de la tabla. En `inventory.test.ts` mediante una
**categoría única por test** (`uniqueCategory()`) que se pasa a los fixtures y se añade a la query
como `?category=<scope>` — filtro exacto que compone con `q`/`type`/`supplierId` y también con el
camino `$queryRaw` de `lowStock`. Con el resultado ya acotado, las aserciones se volvieron exactas
(`total: 2`, `ids` en orden) en lugar de `>=` + `indexOf`.

Además del caso conocido se corrigieron **5 flakies latentes** del mismo patrón (aserciones que
dependían de que los fixtures cayeran dentro de las 20 filas más recientes de una tabla global):
`inventory`, `customers`, `suppliers`, `recipes` y `users` en su test "lista paginada happy path".
En los cuatro últimos el scope se hace con un token único compartido por los fixtures y filtrado
vía `?q=<token>`. No se tocó ningún caso ni se relajó ninguna aserción.

El **fallback** `fileParallelism: false` (determinista pero más lento, y esconde el problema de
fondo) **no hizo falta**: `api/vitest.config.ts` queda sin cambios y la suite sigue en paralelo.

**Verificación:** 10/10 corridas de `npm test` sin un solo fallo (198/198, 14 archivos), 8/8
corridas de `npx vitest run tests/inventory.test.ts tests/analytics.test.ts` (los dos archivos
implicados, juntos y en paralelo). Contra-prueba: con 30 filas contaminantes sembradas a mano en
`InventoryItem` (15 de ellas `ALIMENTO` + `stock <= minStock`, o sea 15 matches para la query sin
acotar que antes esperaba exactamente 1), `inventory.test.ts` pasa 33/33.

---

## Controles que YA pasan (defensa verificada) ✅

Estos tests pasan y confirman controles correctos — no requieren acción:

- **JWT (API2):** rechaza token con `alg=none`, firma manipulada, secreto incorrecto, token expirado, header malformado y ausencia de token. (`@fastify/jwt` con HS256.)
- **BOLA (API1):** un `USER` no puede leer, listar ni modificar órdenes de otros usuarios (modelo dueño+admin, Fase QA-1).
- **RBAC / BFLA (API5):** un `USER` no puede crear inventory/customers, ni listar usuarios, ni cambiar roles, ni consultar analytics → `403`.
- **Mass assignment (API3):** enviar `role: 'ADMIN'` en el body de `register` se ignora; el usuario nace como `USER`.
- **Exposición de datos (API3):** `passwordHash` nunca aparece en las respuestas de auth (DTO público).
- **Misconfiguration (API8):** cabeceras de `helmet` presentes (`X-Content-Type-Options: nosniff`); rutas inexistentes → `404` sin stack trace; los errores 4xx nativos de Fastify (p. ej. JSON malformado) conservan su status y se loguean como `warn`, no como `500`/`error` (Fase QA-3).
- **Rate limiting (API4/API2):** límite global (100/min) + límites por-ruta más estrictos en `/auth/login`, `/auth/register` y `/auth/refresh`, con `429` en el envelope estándar (Fase QA-2).

---

_Generado a partir de `api/tests/security.test.ts`. El plan de remediación por fases está en `PLAN.md` §12.8; los hallazgos ya cerrados quedan archivados en `PLAN.md` §12.4._
