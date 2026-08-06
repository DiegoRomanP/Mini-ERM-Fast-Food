/**
 * Almacenamiento del access token JWT usado por `authClient`.
 *
 * Trade-off de persistencia (ver PLAN.md Fase 7): se eligió
 * "memoria + sessionStorage opcional" en vez de `localStorage`.
 *
 * - Fuente de verdad en runtime: una variable de módulo (memoria). El token
 *   nunca se lee desde storage dentro del interceptor de axios; siempre pasa
 *   por `getAccessToken()`, así que cambiar la estrategia de persistencia no
 *   afecta a `authClient`.
 * - Espejo en `sessionStorage`: solo para "rehidratar" la variable de módulo
 *   al cargar la página (sobrevive un F5, se pierde al cerrar la pestaña).
 *   Sin esto, cualquier recarga durante la demo forzaría un login manual.
 *
 * Por qué no `localStorage`: sobrevive entre pestañas/reinicios del
 * navegador, lo que amplía la ventana de exposición ante un XSS que consiga
 * ejecutar JS en la página (cualquier script leería el token indefinidamente).
 * `sessionStorage` acota esa ventana a la pestaña activa; memoria pura la
 * acotaría aún más (a la vida del módulo, se pierde en cada F5) pero degrada
 * la UX de la demo. El refresh token real (rotación de sesión) nunca pasa por
 * aquí: vive en una cookie httpOnly que el backend gestiona directamente.
 */

const STORAGE_KEY = "mini-erp.accessToken";

function readFromSessionStorage(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // sessionStorage puede no estar disponible (modo privado estricto, SSR, etc.)
    return null;
  }
}

function writeToSessionStorage(token: string | null): void {
  try {
    if (token) {
      sessionStorage.setItem(STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Si sessionStorage falla, la sesión sigue funcionando en memoria
    // durante la vida de la pestaña; solo se pierde la rehidratación en F5.
  }
}

let accessToken: string | null = readFromSessionStorage();

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  writeToSessionStorage(token);
}

type LogoutListener = () => void;

const logoutListeners = new Set<LogoutListener>();

/**
 * Suscribe a un listener que se dispara cuando el estado de auth local se
 * limpia (logout explícito o refresh fallido en `authClient`). Pensado para
 * que la UI de auth (hook `useAuth`, fase posterior) pueda reaccionar
 * mostrando el login sin acoplarse al interceptor de axios.
 */
export function onAuthLogout(listener: LogoutListener): () => void {
  logoutListeners.add(listener);
  return () => {
    logoutListeners.delete(listener);
  };
}

/** Limpia el access token local y notifica a los suscriptores de logout. */
export function clearAuth(): void {
  setAccessToken(null);
  for (const listener of logoutListeners) {
    listener();
  }
}
