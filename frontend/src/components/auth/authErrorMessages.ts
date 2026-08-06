import { isAxiosError } from "axios";

/**
 * Forma de error del backend Fastify (`api/src/shared/error-handler.ts`):
 * `{ error: { code, message, details? } }`, con `details` presente en 400
 * de validación Zod (`{ field, message }[]`).
 */
interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Array<{ field: string; message: string }>;
  };
}

const GENERIC_ERROR = "Ocurrió un error inesperado. Intenta de nuevo.";
const NETWORK_ERROR = "No se pudo conectar con el servidor.";

function extractBackendMessage(error: unknown): string | undefined {
  return isAxiosError<ApiErrorBody>(error) ? error.response?.data?.error?.message : undefined;
}

function extractValidationDetails(error: unknown): string | undefined {
  if (!isAxiosError<ApiErrorBody>(error)) return undefined;
  const details = error.response?.data?.error?.details;
  if (!details || details.length === 0) return undefined;
  return details.map((detail) => `${detail.field}: ${detail.message}`).join(" · ");
}

export function getLoginErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    if (!error.response) return NETWORK_ERROR;
    if (error.response.status === 401) return "Credenciales inválidas";
    if (error.response.status === 400) {
      return extractValidationDetails(error) ?? extractBackendMessage(error) ?? GENERIC_ERROR;
    }
  }
  return extractBackendMessage(error) ?? GENERIC_ERROR;
}

export function getRegisterErrorMessage(error: unknown): string {
  if (isAxiosError(error)) {
    if (!error.response) return NETWORK_ERROR;
    if (error.response.status === 409) return "Ese email ya está registrado";
    if (error.response.status === 400) {
      return extractValidationDetails(error) ?? extractBackendMessage(error) ?? GENERIC_ERROR;
    }
  }
  return extractBackendMessage(error) ?? GENERIC_ERROR;
}
