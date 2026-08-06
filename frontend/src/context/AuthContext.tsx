import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  login as apiLogin,
  register as apiRegister,
  logout as apiLogout,
  refresh as apiRefresh,
  type UserDto,
  type LoginPayload,
  type RegisterPayload,
} from "../services/authApi";
import { onAuthLogout, clearAuth } from "../services/authStorage";
import { AuthContext, type AuthContextValue } from "./authContextObject";

/**
 * Persistencia del `user` autenticado (PLAN.md Fase 7).
 *
 * `POST /auth/refresh` solo devuelve `{ accessToken }` (ver
 * `api/src/modules/auth/schema.ts` -> `RefreshResponseSchema`); el backend
 * no expone un endpoint `/auth/me` y no corresponde inventarlo en este
 * alcance. Para poder rehidratar el nombre/rol del usuario tras un F5 sin
 * ese endpoint, se opta por la alternativa pragmática: el `UserDto` que
 * devuelven `login`/`register` se guarda en `sessionStorage` (mismo
 * trade-off ya documentado en `authStorage.ts` para el access token: se
 * pierde al cerrar la pestaña, acota la exposición ante XSS frente a
 * `localStorage`). Si `POST /auth/refresh` devuelve un access token válido,
 * se confía en que la sesión sigue siendo la misma que generó ese `user`
 * cacheado.
 *
 * Caso borde documentado: en una pestaña NUEVA, `sessionStorage` está vacío
 * aunque la cookie httpOnly de refresh (compartida a nivel de navegador)
 * siga viva. El refresh inicial puede entonces tener éxito sin `user`
 * cacheado en esa pestaña. En ese caso se descarta el access token
 * recién obtenido solo localmente (sin llamar a `/auth/logout`, para no
 * invalidar la sesión de la otra pestaña) y se pide iniciar sesión de nuevo
 * ahí. Rehidratar el usuario entre pestañas requeriría un `/auth/me` que
 * no existe en el alcance actual.
 */
const USER_STORAGE_KEY = "mini-erp.authUser";

function readStoredUser(): UserDto | null {
  try {
    const raw = sessionStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as UserDto) : null;
  } catch {
    return null;
  }
}

function writeStoredUser(user: UserDto | null): void {
  try {
    if (user) {
      sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      sessionStorage.removeItem(USER_STORAGE_KEY);
    }
  } catch {
    // Degrada con gracia: la sesión sigue funcionando en memoria durante
    // la vida de la pestaña, solo se pierde la rehidratación en F5.
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Rehidratación única al montar: intenta un refresh silencioso a partir
  // de la cookie httpOnly. Si no hay sesión previa, falla con gracia
  // (loading:false, user/accessToken:null) sin excepción no capturada.
  useEffect(() => {
    let cancelled = false;

    async function rehydrate() {
      try {
        const { accessToken: newAccessToken } = await apiRefresh();
        if (cancelled) return;

        const storedUser = readStoredUser();
        if (storedUser) {
          setUser(storedUser);
          setAccessTokenState(newAccessToken);
        } else {
          // Ver comentario de módulo: refresh válido pero sin `user`
          // cacheado en esta pestaña. Se descarta localmente.
          clearAuth();
          setUser(null);
          setAccessTokenState(null);
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          setAccessTokenState(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    rehydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sincroniza el contexto cuando el interceptor de `authClient` fuerza un
  // logout local (refresh fallido en un 401 de cualquier request).
  useEffect(() => {
    return onAuthLogout(() => {
      setUser(null);
      setAccessTokenState(null);
      writeStoredUser(null);
    });
  }, []);

  const login = useCallback(async (payload: LoginPayload) => {
    const response = await apiLogin(payload);
    setUser(response.user);
    setAccessTokenState(response.accessToken);
    writeStoredUser(response.user);
  }, []);

  const register = useCallback(async (payload: RegisterPayload) => {
    const response = await apiRegister(payload);
    setUser(response.user);
    setAccessTokenState(response.accessToken);
    writeStoredUser(response.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // `authApi.logout()` ya limpia el estado local (authStorage) en su
      // `finally` aunque el POST al backend falle; este catch solo evita
      // que el error de red se propague sin manejar hasta el botón.
    } finally {
      setUser(null);
      setAccessTokenState(null);
      writeStoredUser(null);
    }
  }, []);

  const value: AuthContextValue = { user, accessToken, loading, login, register, logout };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
