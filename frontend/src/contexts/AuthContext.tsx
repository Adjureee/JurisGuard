import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { TOKEN_STORAGE_KEY } from "../api/client";
import * as authService from "../services/authService";
import type { AuthUser, LoginPayload, RegisterPayload, RegisterResponse } from "../types/auth";

interface AuthContextValue {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (payload: LoginPayload) => Promise<AuthUser>;
  register: (payload: RegisterPayload) => Promise<RegisterResponse>;
  logout: () => void;
  getCurrentUser: () => Promise<AuthUser | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [token, setToken] = useState<string | null>(() =>
    sessionStorage.getItem(TOKEN_STORAGE_KEY)
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(token));

  const logout = useCallback(() => {
    authService.logout();
    setToken(null);
    setUser(null);
  }, []);

  const getCurrentUser = useCallback(async () => {
    if (!sessionStorage.getItem(TOKEN_STORAGE_KEY)) {
      setUser(null);
      return null;
    }

    try {
      const currentUser = await authService.getMe();
      setUser(currentUser);
      return currentUser;
    } catch {
      logout();
      return null;
    }
  }, [logout]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateUser() {
      if (!token) {
        setIsLoading(false);
        return;
      }

      const currentUser = await getCurrentUser();

      if (!cancelled) {
        setUser(currentUser);
        setIsLoading(false);
      }
    }

    void hydrateUser();

    return () => {
      cancelled = true;
    };
  }, [getCurrentUser, token]);

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token && user),
      isLoading,
      login: async (payload) => {
        const response = await authService.login(payload);
        sessionStorage.setItem(TOKEN_STORAGE_KEY, response.access_token);
        setToken(response.access_token);

        const currentUser = await authService.getMe();
        setUser(currentUser);
        return currentUser;
      },
      register: authService.register,
      logout,
      getCurrentUser,
    }),
    [getCurrentUser, isLoading, logout, token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
