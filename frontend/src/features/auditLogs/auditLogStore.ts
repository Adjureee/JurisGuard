import { create } from "zustand";

export type AuditModule = "Authentication" | "Clients" | "Cases" | "Admin" | "Export";

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userId: number | null;
  createdBy: number | null;
  user_id: number | null;
  user: string;
  userRole?: "admin" | "staff" | string | null;
  user_role?: "admin" | "staff" | string | null;
  action: string;
  module: AuditModule;
  description: string;
  entity_type?: string;
  entity_id?: string;
}

interface AddAuditLogInput {
  userId?: number | null;
  user?: string | null;
  action: string;
  module: AuditModule;
  description: string;
  entityType?: string;
  entityId?: string;
}

interface AuditLogState {
  logs: AuditLogEntry[];
  setLogs: (logs: AuditLogEntry[]) => void;
  setLogsForViewer: (logs: AuditLogEntry[], viewer: AuditLogViewer) => void;
  scopeToViewer: (viewer: AuditLogViewer) => void;
  addLog: (entry: AddAuditLogInput) => AuditLogEntry;
  clearLogs: () => void;
}

const STORAGE_KEY = "jurisguard_audit_logs";
export interface AuditLogViewer {
  user_id: number;
  role: "admin" | "staff";
}
const IMPORTANT_ACTIONS = new Set([
  "Login",
  "Logout",
  "Create Client",
  "Update Client",
  "Create Case",
  "Update Case",
  "Terminate Case",
  "OCR Scan",
  "Edit Case",
  "Export CSV",
  "Export Excel",
  "Export PDF",
  "Approve User",
  "Reject User",
  "Approved Registration",
  "Rejected Registration",
]);

function normalizeLog(raw: AuditLogEntry) {
  const userId = raw.userId ?? raw.user_id ?? null;
  const userRole = raw.userRole ?? raw.user_role ?? null;
  return {
    ...raw,
    userId,
    createdBy: raw.createdBy ?? userId,
    user_id: userId,
    userRole,
    user_role: userRole,
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

function scopedLogsForViewer(logs: AuditLogEntry[], viewer: AuditLogViewer) {
  const normalized = logs.map(normalizeLog);
  if (viewer.role === "admin") return normalized;
  return normalized.filter((log) => log.userId === viewer.user_id);
}

export const useAuditLogStore = create<AuditLogState>((set, get) => ({
  logs: readStoredLogs(),
  setLogs: (logs) => {
    const normalized = logs.map(normalizeLog);
    persistLogs(normalized);
    set({ logs: normalized });
  },
  setLogsForViewer: (logs, viewer) => {
    const scoped = scopedLogsForViewer(logs, viewer);
    persistLogs(scoped);
    set({ logs: scoped });
  },
  scopeToViewer: (viewer) => {
    const scoped = scopedLogsForViewer(get().logs, viewer);
    persistLogs(scoped);
    set({ logs: scoped });
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
        userRole: null,
        user_role: null,
        action: entry.action,
        module: entry.module,
        description: entry.description,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
      };
    }
    const log: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      userId: entry.userId ?? null,
      createdBy: entry.userId ?? null,
      user_id: entry.userId ?? null,
      user: entry.user || "System",
      userRole: null,
      user_role: null,
      action: entry.action,
      module: entry.module,
      description: entry.description,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
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
