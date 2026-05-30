import { create } from "zustand";

export type AuditModule = "Authentication" | "Clients" | "Cases" | "Admin" | "Export";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: number | null;
  createdBy: number | null;
  user_id: number | null;
  user: string;
  action: string;
  module: AuditModule;
  description: string;
  entity_type?: string;
  entity_id?: string;
  ip_address?: string | null;
  extraction_mode?: string | null;
  fallback_reason?: string | null;
  previous_hash?: string | null;
  current_hash?: string | null;
}

interface AddAuditLogInput {
  userId?: number | null;
  user?: string | null;
  action: string;
  module: AuditModule;
  description: string;
  entityType?: string;
  entityId?: string;
  extractionMode?: string | null;
  fallbackReason?: string | null;
}

interface AuditLogState {
  logs: AuditLogEntry[];
  setLogs: (logs: AuditLogEntry[]) => void;
  addLog: (entry: AddAuditLogInput) => AuditLogEntry;
  clearLogs: () => void;
}

const STORAGE_KEY = "jurisguard_audit_logs";
const IMPORTANT_ACTIONS = new Set([
  "Login",
  "Logout",
  "Create Client",
  "Create Case",
  "Edit Case",
  "Export CSV",
  "Approve User",
  "Reject User",
]);

function normalizeLog(raw: AuditLogEntry) {
  const userId = raw.userId ?? raw.user_id ?? null;
  return {
    ...raw,
    userId,
    createdBy: raw.createdBy ?? userId,
    user_id: userId,
  };
}

function readStoredLogs() {
  if (typeof window === "undefined") return [];

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored
      ? (JSON.parse(stored) as AuditLogEntry[])
          .map(normalizeLog)
          .filter((log) => IMPORTANT_ACTIONS.has(log.action))
      : [];
  } catch {
    return [];
  }
}

function persistLogs(logs: AuditLogEntry[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, 100)));
}

export const useAuditLogStore = create<AuditLogState>((set, get) => ({
  logs: readStoredLogs(),
  setLogs: (logs) => {
    const normalized = logs.map(normalizeLog);
    persistLogs(normalized);
    set({ logs: normalized });
  },
  addLog: (entry) => {
    if (!IMPORTANT_ACTIONS.has(entry.action)) {
      return {
        id: "",
        timestamp: new Date().toISOString(),
        userId: entry.userId ?? null,
        createdBy: entry.userId ?? null,
        user_id: entry.userId ?? null,
        user: entry.user || "System",
        action: entry.action,
        module: entry.module,
        description: entry.description,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        extraction_mode: entry.extractionMode,
        fallback_reason: entry.fallbackReason,
      };
    }
    const log: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      userId: entry.userId ?? null,
      createdBy: entry.userId ?? null,
      user_id: entry.userId ?? null,
      user: entry.user || "System",
      action: entry.action,
      module: entry.module,
      description: entry.description,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      extraction_mode: entry.extractionMode,
      fallback_reason: entry.fallbackReason,
    };
    const logs = [log, ...get().logs].slice(0, 100);
    persistLogs(logs);
    set({ logs });
    return log;
  },
  clearLogs: () => {
    persistLogs([]);
    set({ logs: [] });
  },
}));
