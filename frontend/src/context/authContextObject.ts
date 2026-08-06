import { createContext } from "react";
import type { UserDto, LoginPayload, RegisterPayload } from "../services/authApi";

/**
 * Objeto de contexto crudo, separado de `AuthContext.tsx` (que solo debe
 * exportar el componente `AuthProvider`) para cumplir con la regla de lint
 * `react-refresh/only-export-components`: un archivo con un componente
 * exportado no puede exportar además un valor no-componente (aquí, el
 * contexto) sin romper el fast refresh de Vite.
 */
export interface AuthContextValue {
  user: UserDto | null;
  accessToken: string | null;
  loading: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
