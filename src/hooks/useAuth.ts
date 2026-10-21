import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { createElement } from "react";
import type { AuthUser, User, UserRole } from "@/lib/types";
import { gql } from "@/lib/utils";
import { AUTH_STORAGE_KEY } from "@/lib/constants";

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (dni: string, password: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: UserRole[]) => boolean;
} // Interfaz de contexto de autenticacion

const AuthContext = createContext<AuthContextType | null>(null); // Creacion de contexto de auth

// Texto plano sin interpolar: api/scripts/check-frontend-docs.ts valida estas
// consultas contra el schema del backend leyendo el codigo fuente
const LOGIN_QUERY = `
  query Login($dni: String!, $password: String!) {
    login(dni: $dni, password: $password) {
      id name dni email role isActive createdAt updatedAt token
    }
  }
`; // Login query para comprobacion de datos

const ME_QUERY = `
  query GetMe { me { id name dni email role isActive createdAt updatedAt } }
`; // Datos vigentes del usuario de la sesion

const LOGOUT_MUTATION = `
  mutation Logout { logout }
`; // Revoca el token de la sesion

interface LoginData {
  login: AuthUser;
}

function loadStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
} // Carga de usuarios almacenados - LocalStorage (provisional)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadStoredUser);
  const [isLoading, setIsLoading] = useState(false);

  const login = useCallback(async (dni: string, password: string) => {
    setIsLoading(true);
    try {
      const data = await gql<LoginData>(LOGIN_QUERY, { dni, password });
      const authUser = data.login;
      setUser(authUser);
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authUser));
    } finally {
      setIsLoading(false);
    }
  }, []); // Comprobacion de login y logica

  const logout = useCallback(() => {
    // Revoca el token en la API (si no responde, igual se cierra la sesion local)
    if (loadStoredUser()?.token) void gql(LOGOUT_MUTATION).catch(() => {});
    setUser(null);
    localStorage.removeItem(AUTH_STORAGE_KEY);
  }, []); // Logica de logout

  // La sesion se comparte entre pestañas: si en otra se entra con otro usuario o
  // se cierra la sesion, esta lo refleja (si no, mostraria a uno y pediria como otro)
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_STORAGE_KEY) setUser(loadStoredUser());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Lo guardado en el navegador es una copia: el rol o el estado pudieron cambiar
  // desde que se inicio sesion. Al cargar se le pregunta a la API y, si la cuenta
  // ya no esta activa, se cierra la sesion en vez de dejar que todo falle.
  const token = user?.token;
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const refresh = () =>
      gql<{ me: User | null }>(ME_QUERY)
        .then(({ me }) => {
          if (cancelled) return;
          if (!me) {
            logout();
            return;
          }
          const fresh: AuthUser = { ...me, token };
          setUser(fresh);
          localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(fresh));
        })
        .catch(() => {
          // Sin conexion con la API no se sabe nada nuevo: se mantiene la sesion
        });
    // Al volver a la pestaña tambien: en otra pudieron desactivar o cambiar al usuario
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [token, logout]);

  const hasRole = useCallback(
    (...roles: UserRole[]) => {
      if (!user) return false;
      return roles.includes(user.role);
    },
    [user],
  ); // Comprobacion de rol

  return createElement(
    AuthContext.Provider,
    { value: { user, isAuthenticated: user !== null, isLoading, login, logout, hasRole } },
    children,
  ); // Creacion de elemento de Auth
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx; // Si no hay context Provider no funciona y devuelve el context provider
}
