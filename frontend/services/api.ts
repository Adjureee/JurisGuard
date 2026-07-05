import type { ClientRecord } from "../types";
import { API_BASE_URL, TOKEN_STORAGE_KEY } from "../api/client";

interface ApiOptions extends RequestInit {
  auth?: boolean;
}

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { auth = true, headers, ...rest } = options;
  const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);

  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers: {
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await res.json() : null;

  if (!res.ok) {
    const message =
      data && typeof data.detail === "string" ? data.detail : "Request failed";
    throw new Error(message);
  }

  return data as T;
}

export async function getClients(): Promise<ClientRecord[]> {
  return apiRequest<ClientRecord[]>("/clients/");
}

