import { create } from "zustand";

export type ReminderPriority = "High" | "Medium" | "Low";
export type ReminderStatus = "Open" | "Completed";

export interface DashboardReminder {
  id: string;
  userId: number;
  title: string;
  dueDate: string;
  priority: ReminderPriority;
  status: ReminderStatus;
}

interface DashboardReminderState {
  reminders: DashboardReminder[];
  loadReminders: (userId: number) => void;
  addReminder: (reminder: Omit<DashboardReminder, "id">) => void;
  updateReminderStatus: (id: string, status: ReminderStatus) => void;
  deleteReminder: (id: string) => void;
}

const STORAGE_KEY = "jurisguard_dashboard_reminders";

function readReminders() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed as DashboardReminder[] : [];
  } catch {
    return [];
  }
}

function writeReminders(reminders: DashboardReminder[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
}

export const useDashboardReminderStore = create<DashboardReminderState>((set) => ({
  reminders: [],
  loadReminders: (userId) => {
    set({ reminders: readReminders().filter((reminder) => reminder.userId === userId) });
  },
  addReminder: (reminder) => {
    const allReminders = readReminders();
    const created: DashboardReminder = {
      ...reminder,
      id: `reminder-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };
    const next = [created, ...allReminders];
    writeReminders(next);
    set({ reminders: next.filter((item) => item.userId === reminder.userId) });
  },
  updateReminderStatus: (id, status) => {
    const existing = readReminders();
    const target = existing.find((reminder) => reminder.id === id);
    const next = existing.map((reminder) => reminder.id === id ? { ...reminder, status } : reminder);
    writeReminders(next);
    set({ reminders: target ? next.filter((item) => item.userId === target.userId) : [] });
  },
  deleteReminder: (id) => {
    const existing = readReminders();
    const target = existing.find((reminder) => reminder.id === id);
    const next = existing.filter((reminder) => reminder.id !== id);
    writeReminders(next);
    set({ reminders: target ? next.filter((item) => item.userId === target.userId) : [] });
  },
}));
