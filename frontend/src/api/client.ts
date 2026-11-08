import axios from "axios";

const configuredApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
const isSecurePage = typeof window !== "undefined" && window.location.protocol === "https:";
const insecureConfiguredApi = configuredApiBase?.toLowerCase().startsWith("http://") ?? false;

// Keep HTTPS deployments on the same-origin TLS reverse proxy. The loopback
// HTTP default remains useful for local Vite development on http://localhost.
export const API_BASE_URL = isSecurePage && insecureConfiguredApi
  ? "/api"
  : configuredApiBase || (isSecurePage ? "/api" : "http://127.0.0.1:8000/api");

export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, "");
export const TOKEN_STORAGE_KEY = "jurisguard_token";

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    Accept: "application/json",
  },
});

apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      if (
        typeof window !== "undefined" &&
        !window.location.pathname.includes("/login")
      ) {
        window.dispatchEvent(new Event("jurisguard:unauthorized"));
      }
    }
    return Promise.reject(error);
  },
);
