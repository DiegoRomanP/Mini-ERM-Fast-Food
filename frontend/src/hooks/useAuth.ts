import { useContext } from "react";
import { AuthContext, type AuthContextValue } from "../context/authContextObject";

/**
 * Hook de acceso al contexto de autenticación (ver `AuthProvider` en
 * `context/AuthContext.tsx`). Lanza si se usa fuera del provider para
 * detectar errores de montaje en desarrollo en vez de fallar en silencio
 * con un contexto `undefined`.
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth debe usarse dentro de un <AuthProvider>");
  }
  return context;
}
