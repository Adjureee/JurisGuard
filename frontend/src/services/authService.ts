import { AxiosError } from "axios";
import { API_ORIGIN, apiClient, TOKEN_STORAGE_KEY } from "../api/client";
import type {
  AuthUser,
  LoginPayload,
  RegisterPayload,
  RegisterResponse,
  TokenResponse,
} from "../types/auth";

const MFA_TRUSTED_DEVICES_KEY = "jurisguard_mfa_trusted_devices";

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail;
    return typeof detail === "string" ? detail : fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function readTrustedDeviceMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(MFA_TRUSTED_DEVICES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function getTrustedDeviceToken(email: string): string | null {
  return readTrustedDeviceMap()[normalizeEmail(email)] ?? null;
}

export function saveTrustedDeviceToken(email: string, token: string | null | undefined) {
  if (!token) return;
  const trustedDevices = readTrustedDeviceMap();
  trustedDevices[normalizeEmail(email)] = token;
  localStorage.setItem(MFA_TRUSTED_DEVICES_KEY, JSON.stringify(trustedDevices));
}

export async function register(payload: RegisterPayload): Promise<RegisterResponse> {
  try {
    const response = await apiClient.post<RegisterResponse>("/auth/register", payload);
    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error, "Registration failed"));
  }
}

export async function login(payload: LoginPayload): Promise<TokenResponse> {
  const form = new URLSearchParams();
  form.set("username", payload.email);
  form.set("password", payload.password);
  const trustedDeviceToken =
    payload.trustedDeviceToken ?? getTrustedDeviceToken(payload.email);
  if (trustedDeviceToken) {
    form.set("trusted_device_token", trustedDeviceToken);
  }
  if (payload.rememberDevice) {
    form.set("remember_device", "true");
  }
  if (payload.otpCode) {
    form.set("otp_code", payload.otpCode);
  }

  try {
    const response = await apiClient.post<TokenResponse>("/auth/token", form, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error, "Login failed"));
  }
}

export async function getMe(): Promise<AuthUser> {
  try {
    const response = await apiClient.get<AuthUser>("/auth/me");
    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error, "Unable to load current user"));
  }
}

export async function uploadProfileImage(file: File): Promise<AuthUser> {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await apiClient.post<AuthUser>("/auth/me/profile-image", formData);
    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error, "Unable to upload profile image"));
  }
}

export async function removeProfileImage(): Promise<AuthUser> {
  try {
    const response = await apiClient.delete<AuthUser>("/auth/me/profile-image");
    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error, "Unable to remove profile image"));
  }
}

export async function setupMfa(): Promise<{ secret: string; otpauth_uri: string }> {
  try {
    const response = await apiClient.post<{ secret: string; otpauth_uri: string }>("/auth/me/mfa/setup");
    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error, "Unable to start MFA setup"));
  }
}

export async function enableMfa(code: string): Promise<{ message: string }> {
  try {
    const response = await apiClient.post<{ message: string }>("/auth/me/mfa/enable", { code });
    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error, "Unable to enable MFA"));
  }
}

export async function disableMfa(code: string): Promise<{ message: string }> {
  try {
    const response = await apiClient.post<{ message: string }>("/auth/me/mfa/disable", { code });
    return response.data;
  } catch (error) {
    throw new Error(getErrorMessage(error, "Unable to disable MFA"));
  }
}

export function resolveProfileImageUrl(path: string | null | undefined) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
}

export function logout() {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
}

export async function loginRequest(email: string, password: string): Promise<TokenResponse> {
  return login({ email, password });
}

