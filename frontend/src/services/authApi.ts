import { authClient } from "./authClient";
import { clearAuth, setAccessToken } from "./authStorage";

/**
 * Tipos replicados a mano desde el contrato real del backend:
 * `api/src/modules/auth/schema.ts` (`UserDtoSchema`, `AuthResponseSchema`,
 * `RegisterBodySchema`, `LoginBodySchema`). No existe un paquete de tipos
 * compartido entre `api/` y `frontend/` en este monorepo, así que se
 * duplican deliberadamente aquí; si el contrato del backend cambia, hay que
 * actualizar este archivo a mano.
 */
export type UserRole = "ADMIN" | "USER";

/** Espeja `UserDtoSchema`: DTO público de usuario, nunca incluye `passwordHash`. */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

/** Espeja `AuthResponseSchema`. */
export interface AuthResponse {
  user: UserDto;
  accessToken: string;
}

/** Espeja `RegisterBodySchema`. */
export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

/** Espeja `LoginBodySchema`. */
export interface LoginPayload {
  email: string;
  password: string;
}

/** Espeja `RefreshResponseSchema`: el refresh solo devuelve el access token nuevo. */
export interface RefreshResponse {
  accessToken: string;
}

export const register = async (payload: RegisterPayload): Promise<AuthResponse> => {
  const response = await authClient.post<AuthResponse>("/auth/register", payload);
  setAccessToken(response.data.accessToken);
  return response.data;
};

export const login = async (payload: LoginPayload): Promise<AuthResponse> => {
  const response = await authClient.post<AuthResponse>("/auth/login", payload);
  setAccessToken(response.data.accessToken);
  return response.data;
};

/**
 * Rehidrata la sesión a partir de la cookie httpOnly de refresh (sin
 * credenciales). Pensado para llamarse una vez al montar la app (ver
 * `AuthProvider`, Fase 7). Distinto del refresh interno de `authClient`
 * (privado al módulo, usado solo por el interceptor de 401/retry): este es
 * el punto de entrada público para un refresh explícito.
 */
export const refresh = async (): Promise<RefreshResponse> => {
  const response = await authClient.post<RefreshResponse>("/auth/refresh");
  setAccessToken(response.data.accessToken);
  return response.data;
};

export const logout = async (): Promise<void> => {
  try {
    await authClient.post("/auth/logout");
  } finally {
    // Limpia el estado local incluso si la request de logout falla
    // (p.ej. refresh token ya vencido): la sesión local debe cerrarse igual.
    clearAuth();
  }
};
