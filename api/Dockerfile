# syntax=docker/dockerfile:1

# ---------- Stage 1: builder ----------
FROM node:20-alpine AS builder
WORKDIR /app

# Prisma en Alpine (musl) necesita openssl para generar/ejecutar el motor de query nativo
# (linux-musl-openssl-3.0.x). Sin esto, `prisma generate` igual corre, pero el motor
# generado puede fallar al cargar librerías compartidas en runtime.
RUN apk add --no-cache openssl

# Copiamos manifiestos y el schema de Prisma ANTES de `npm ci`: el hook `postinstall`
# ejecuta `prisma generate`, que necesita `prisma/schema.prisma` disponible en este punto.
# `prisma generate` NO requiere conexión a base de datos (solo lee el schema), así que
# no hace falta DATABASE_URL en build time.
COPY package*.json ./
COPY prisma ./prisma

RUN npm ci

# Resto del código fuente
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache openssl

# Decisión: copiamos node_modules COMPLETO del builder (incluye devDependencies) en vez
# de correr un segundo `npm ci --omit=dev` en este stage.
#
# Motivo: el CMD de este contenedor ejecuta `npx prisma migrate deploy` en el arranque,
# y el CLI `prisma` es una devDependency (no está en "dependencies" de package.json).
# `npm ci --omit=dev` lo excluiría, dejando dos malas opciones: reinstalar `prisma` aparte
# en runtime (riesgo de desincronizar versión con el client ya generado) o reescribir el
# CMD para no depender del CLI. Para un proyecto de portafolio se prioriza simplicidad y
# correctitud sobre el tamaño final de la imagen (node_modules completo ronda ~400MB).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY package*.json ./

# Usuario non-root: la imagen node:20-alpine ya incluye el usuario/grupo "node" (uid/gid 1000).
RUN chown -R node:node /app
USER node

# Coincide con el PORT default de src/config/env.ts
EXPOSE 3000

# Migraciones se orquestan en el arranque del contenedor (no en CI), según PLAN.md Fase 6.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
