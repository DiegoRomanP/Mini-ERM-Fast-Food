import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { AppError } from './http-errors.js';

const PRISMA_UNIQUE_CONSTRAINT_CODE = 'P2002';

// Límites de la familia 4xx (fallo atribuible al cliente). Sin magic numbers en
// la comparación de `error.statusCode`.
const CLIENT_ERROR_MIN_STATUS = 400;
const SERVER_ERROR_MIN_STATUS = 500;

const INTERNAL_ERROR_CODE = 'INTERNAL_ERROR';
const INTERNAL_ERROR_MESSAGE = 'Error interno del servidor';
const DEFAULT_CLIENT_ERROR_CODE = 'CLIENT_ERROR';

/**
 * Traduce un status 4xx al vocabulario de códigos ya usado por la API
 * (`AppError` en `http-errors.ts` y el `errorResponseBuilder` del rate-limit),
 * para que un error nativo de Fastify salga con el mismo envelope y los mismos
 * códigos que uno lanzado por nosotros.
 */
const CLIENT_ERROR_CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMIT_EXCEEDED',
};

function isClientError(statusCode: number | undefined): statusCode is number {
  return (
    statusCode !== undefined && statusCode >= CLIENT_ERROR_MIN_STATUS && statusCode < SERVER_ERROR_MIN_STATUS
  );
}

export async function appErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  if (error.validation) {
    const details = error.validation.map((issue) => {
      const params = issue.params as { missingProperty?: string } | undefined;
      const field = issue.instancePath
        ? issue.instancePath.slice(1).replace(/\//g, '.')
        : (params?.missingProperty ?? 'body');
      return { field, message: issue.message };
    });
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: 'Datos de entrada inválidos', details },
    });
  }

  if (error instanceof AppError) {
    const body: { error: { code: string; message: string; details?: unknown } } = {
      error: { code: error.code, message: error.message },
    };
    if (error.details !== undefined) {
      body.error.details = error.details;
    }
    return reply.code(error.statusCode).send(body);
  }

  // Red de seguridad para violaciones de constraint único no detectadas
  // explícitamente en el service (p. ej. condición de carrera entre el
  // `findUnique` y el `create`). La mayoría de los services ya validan el
  // duplicado antes de escribir para dar un mensaje específico; esto cubre
  // el resto sin tener que repetir el mapeo en cada uno.
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_UNIQUE_CONSTRAINT_CODE) {
    const target = error.meta?.target;
    const field = Array.isArray(target) ? target.join(', ') : 'recurso';
    return reply.code(409).send({
      error: { code: 'CONFLICT', message: `Ya existe un registro con ese ${field}` },
    });
  }

  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    return reply.code(400).send({
      error: { code: 'VALIDATION_ERROR', message: 'Datos de entrada inválidos', details },
    });
  }

  // Errores nativos de Fastify o de sus plugins que ya traen su propio
  // `statusCode` 4xx (JSON malformado -> `FST_ERR_CTP_INVALID_JSON`,
  // content-type no soportado, payload demasiado grande, `jwtVerify` sin
  // cabecera de autorización...). Antes caían en el 500 genérico de abajo, lo
  // que (a) rompía la semántica 4xx/5xx para clientes con lógica de reintento y
  // (b) —lo más grave en producción— logueaba cada request malformada a nivel
  // `error` como "Error no controlado", permitiendo inundar los logs y
  // enmascarar incidentes reales. Un 4xx es un fallo del cliente: se loguea a
  // nivel `warn` y el `error` queda reservado para lo realmente inesperado.
  if (isClientError(error.statusCode)) {
    request.log.warn({ err: error, statusCode: error.statusCode }, 'Petición inválida del cliente');
    // El `message` NO se enmascara en producción para los 4xx (a diferencia de
    // los 5xx, ver SEC-05): el cliente necesita saber qué envió mal para poder
    // corregirlo, y es exactamente el mismo criterio que ya se aplica a los
    // `AppError` 4xx, cuyo mensaje también viaja tal cual en producción. Los
    // mensajes 4xx de Fastify son cadenas estáticas que describen el error de
    // protocolo (p. ej. "Body is not valid JSON..."), nunca stacks ni rutas de
    // archivo — el stack se queda en el log, jamás en la respuesta.
    const code = CLIENT_ERROR_CODE_BY_STATUS[error.statusCode] ?? DEFAULT_CLIENT_ERROR_CODE;
    return reply.code(error.statusCode).send({ error: { code, message: error.message } });
  }

  // Todo lo demás (sin `statusCode`, o 5xx) es un fallo del servidor: 500,
  // log a nivel `error` y mensaje enmascarado en producción (SEC-05).
  request.log.error({ err: error }, 'Error no controlado');
  const message = env.NODE_ENV === 'production' ? INTERNAL_ERROR_MESSAGE : error.message;
  return reply.code(SERVER_ERROR_MIN_STATUS).send({ error: { code: INTERNAL_ERROR_CODE, message } });
}
