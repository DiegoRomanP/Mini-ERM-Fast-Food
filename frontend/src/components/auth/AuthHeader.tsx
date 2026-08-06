import { useAuth } from "../../hooks/useAuth";

/**
 * Barra superior mostrada cuando hay sesión activa (Fase 7): identifica al
 * usuario y permite cerrar sesión. Se monta ARRIBA del contenido existente
 * de inventario en `App.tsx`, sin reemplazarlo.
 */
export function AuthHeader() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <div className="bg-white border-b border-gray-200 px-8 py-3 flex items-center justify-between">
      <p className="text-sm text-gray-700">
        Sesión iniciada como <span className="font-semibold">{user.name}</span>{" "}
        <span className="inline-block px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium align-middle">
          {user.role}
        </span>
      </p>
      <button
        onClick={() => void logout()}
        className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
