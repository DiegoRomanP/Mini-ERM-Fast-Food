import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { clearAuth, getAccessToken, setAccessToken } from "./authStorage";

/**
 * Cliente axios dedicado al NUEVO backend (Fastify, `api/`, montado bajo
 * `/api/v1`). Deliberadamente separado de `services/api.ts`, que sigue
 * apuntando al backend Mongo/Express viejo (`/api/inventory`) y está fuera
 * de este alcance (PLAN.md Fase 7: "No se migra la UI de inventory/recipes
 * /orders al nuevo API").
 */
const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000/api/v1";

/**
 * Rutas de auth que nunca deben disparar el flujo de refresh-and-retry, para
 * evitar loops infinitos:
 * - `/auth/refresh`: si el propio refresh devuelve 401, reintentarlo no tiene sentido.
 * - `/auth/login`: unas credenciales inválidas devuelven 401 por diseño, no por
 *   token expirado; no hay token que refrescar.
 */
const AUTH_ROUTES_EXCLUDED_FROM_REFRESH = ["/auth/refresh", "/auth/login"];

function isExcludedFromRefresh(url?: string): boolean {
  if (!url) return false;
  return AUTH_ROUTES_EXCLUDED_FROM_REFRESH.some((path) => url.includes(path));
}

interface RetriableRequestConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

export const authClient = axios.create({
  baseURL: BASE_URL,
  // Necesario para que la cookie httpOnly de refresh viaje en cada request
  // (tanto en la request original como en el POST /auth/refresh).
  withCredentials: true,
});

authClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
  }
  return config;
});

/**
 * Promesa compartida de refresh en curso: si varias requests reciben 401 al
 * mismo tiempo (p.ej. varias llamadas concurrentes al montar la UI), todas
 * esperan el mismo `POST /auth/refresh` en vez de disparar uno por request.
 */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = authClient
      .post<{ accessToken: string }>("/auth/refresh")
      .then((response) => {
        const newAccessToken = response.data.accessToken;
        setAccessToken(newAccessToken);
        return newAccessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

authClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;
    const isUnauthorized = error.response?.status === 401;
    const canAttemptRefresh =
      isUnauthorized &&
      originalRequest !== undefined &&
      !originalRequest._retry &&
      !isExcludedFromRefresh(originalRequest.url);

    if (!canAttemptRefresh) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      const newAccessToken = await refreshAccessToken();
      originalRequest.headers.set("Authorization", `Bearer ${newAccessToken}`);
      return await authClient(originalRequest);
    } catch {
      // El refresh también falló (refresh token vencido/inválido): limpia el
      // estado de auth local y propaga el 401 ORIGINAL, no el error del
      // refresh, para que la UI de auth reaccione mostrando el login.
      clearAuth();
      return Promise.reject(error);
    }
  }
);
