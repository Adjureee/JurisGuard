import { apiClient } from "../api/client";

export type ReminderCategory =
  | "Client Meeting"
  | "Court Hearing"
  | "Document Deadline"
  | "Follow-up"
  | "Office Meeting"
  | "Personal"
  | "Other";
export type ReminderPriority = "Normal" | "Important" | "Urgent";
export type ReminderVisibility = "personal" | "shared";
export type ReminderStatus = "Upcoming" | "Overdue" | "Done";

export interface Reminder {
  reminder_id: number;
  created_by_user_id: number;
  title: string;
  description: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  category: ReminderCategory;
  priority: ReminderPriority;
  visibility: ReminderVisibility;
  notification_minutes_before: number | null;
  status: ReminderStatus;
  created_at: string | null;
  updated_at: string | null;
}

export type ReminderInput = Omit<Reminder, "reminder_id" | "created_by_user_id" | "status" | "created_at" | "updated_at">;

export interface ReminderListResponse {
  items: Reminder[];
  can_manage_shared: boolean;
}

export type HolidayCoverage = "National" | "Provincial" | "City";

export interface CalendarHoliday {
  holiday_id: number;
  source_key: string;
  name: string;
  date: string;
  classification: string;
  coverage: HolidayCoverage;
  geographic_scope: string;
  reference: string;
  source_url: string;
  year: number;
  updated_at: string | null;
}

export async function listReminders() {
  const response = await apiClient.get<ReminderListResponse>("/reminders");
  return response.data;
}

export async function listCalendarHolidays(year: number) {
  const response = await apiClient.get<CalendarHoliday[]>("/holidays", { params: { year } });
  return response.data;
}

export async function createReminder(payload: ReminderInput) {
  const response = await apiClient.post<Reminder>("/reminders", payload);
  return response.data;
}

export async function updateReminder(reminderId: number, payload: ReminderInput) {
  const response = await apiClient.put<Reminder>(`/reminders/${reminderId}`, payload);
  return response.data;
}

export async function completeReminder(reminderId: number) {
  const response = await apiClient.patch<Reminder>(`/reminders/${reminderId}/complete`);
  return response.data;
}

export async function deleteReminder(reminderId: number) {
  await apiClient.delete(`/reminders/${reminderId}`);
}
