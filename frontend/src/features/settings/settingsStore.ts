import { create } from "zustand";

export type ReminderLeadMinutes = 0 | 5 | 15 | 30 | 60 | 1440 | null;

interface UserSettings {
  defaultReminderLeadMinutes: ReminderLeadMinutes;
}

interface SettingsState {
  byUser: Record<number, UserSettings>;
  loadForUser: (userId: number) => void;
  saveDefaultReminderLeadMinutes: (userId: number, value: ReminderLeadMinutes) => void;
}

const DEFAULT_SETTINGS: UserSettings = { defaultReminderLeadMinutes: 15 };
const STORAGE_PREFIX = "jurisguard_settings_v2";
const VALID_LEADS = new Set<number | null>([null, 0, 5, 15, 30, 60, 1440]);

function storageKey(userId: number) {
  return `${STORAGE_PREFIX}:${userId}`;
}

function readSettings(userId: number): UserSettings {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey(userId)) || "null");
    if (parsed && typeof parsed === "object" && "defaultReminderLeadMinutes" in parsed) {
      const value = (parsed as { defaultReminderLeadMinutes: unknown }).defaultReminderLeadMinutes;
      if (value === null || (typeof value === "number" && VALID_LEADS.has(value))) {
        return { defaultReminderLeadMinutes: value as ReminderLeadMinutes };
      }
    }
  } catch {
    // Ignore stale or unavailable browser storage and use the safe default.
  }
  return DEFAULT_SETTINGS;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  byUser: {},
  loadForUser: (userId) => {
    if (get().byUser[userId]) return;
    set((state) => ({ byUser: { ...state.byUser, [userId]: readSettings(userId) } }));
  },
  saveDefaultReminderLeadMinutes: (userId, value) => {
    if (!VALID_LEADS.has(value)) throw new Error("Choose a supported reminder notification time.");
    localStorage.setItem(storageKey(userId), JSON.stringify({ defaultReminderLeadMinutes: value }));
    set((state) => ({
      byUser: {
        ...state.byUser,
        [userId]: { ...(state.byUser[userId] ?? DEFAULT_SETTINGS), defaultReminderLeadMinutes: value },
      },
    }));
  },
}));

export function defaultReminderLeadFor(userId: number | undefined, byUser: Record<number, UserSettings>) {
  return userId === undefined ? DEFAULT_SETTINGS.defaultReminderLeadMinutes : byUser[userId]?.defaultReminderLeadMinutes ?? DEFAULT_SETTINGS.defaultReminderLeadMinutes;
}
