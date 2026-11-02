import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import ModalPortal from "../../components/modals/ModalPortal";
import { useAuth } from "../../contexts/AuthContext";
import {
  completeReminder,
  createReminder,
  deleteReminder,
  listCalendarHolidays,
  listReminders,
  updateReminder,
  type Reminder,
  type CalendarHoliday,
  type ReminderCategory,
  type ReminderInput,
  type ReminderPriority,
} from "../../services/reminderService";

type CalendarView = "day" | "week" | "month";
type ReminderFormState = ReminderInput;

const CATEGORIES: ReminderCategory[] = [
  "Client Meeting", "Court Hearing", "Document Deadline", "Follow-up",
  "Office Meeting", "Personal", "Other",
];
const PRIORITIES: ReminderPriority[] = ["Normal", "Important", "Urgent"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const NOTIFICATION_CHOICES = [
  { value: "none", label: "No notification" },
  { value: "0", label: "At event time" },
  { value: "5", label: "5 minutes before" },
  { value: "15", label: "15 minutes before" },
  { value: "30", label: "30 minutes before" },
  { value: "60", label: "1 hour before" },
  { value: "1440", label: "1 day before" },
];
const CATEGORY_TONES: Record<ReminderCategory, string> = {
  "Client Meeting": "bg-[#704389]",
  "Court Hearing": "bg-[#2563EB]",
  "Document Deadline": "bg-[#D97706]",
  "Follow-up": "bg-[#0F766E]",
  "Office Meeting": "bg-[#4F46E5]",
  Personal: "bg-[#6B7280]",
  Other: "bg-[#9CA3AF]",
};

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, amount: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date: Date) {
  return addDays(date, -date.getDay());
}

function formatDate(date: Date, options: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function formatTime(value: string | null) {
  if (!value) return "All day";
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .format(new Date(2000, 0, 1, hour, minute));
}

function reminderCompletionTime(reminder: Reminder) {
  const [year, month, day] = reminder.date.split("-").map(Number);
  const [hour = 0, minute = 0] = reminder.start_time?.split(":").map(Number) ?? [];
  return Date.UTC(year, month - 1, day, hour - 8, minute);
}

function isReminderCompletionEligible(reminder: Reminder, now: number) {
  return reminder.status !== "Done" && now >= reminderCompletionTime(reminder);
}

function reminderTimeLabel(reminder: Reminder) {
  if (!reminder.start_time) return "All day";
  return reminder.end_time
    ? `${formatTime(reminder.start_time)} - ${formatTime(reminder.end_time)}`
    : formatTime(reminder.start_time);
}

function newReminderForm(date: string): ReminderFormState {
  return {
    title: "",
    description: "",
    date,
    start_time: "",
    end_time: "",
    category: "Other",
    priority: "Normal",
    visibility: "personal",
    notification_minutes_before: 15,
  };
}

function toFormState(reminder: Reminder): ReminderFormState {
  return {
    title: reminder.title,
    description: reminder.description,
    date: reminder.date,
    start_time: reminder.start_time ?? "",
    end_time: reminder.end_time ?? "",
    category: reminder.category,
    priority: reminder.priority,
    visibility: reminder.visibility,
    notification_minutes_before: reminder.notification_minutes_before,
  };
}

function toneForPriority(priority: ReminderPriority) {
  if (priority === "Urgent") return "border-[#FECACA] bg-[#FFF1F2] text-[#9F1239]";
  if (priority === "Important") return "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]";
  return "border-[#E5E7EB] bg-[#F8FAFC] text-[#4B5563]";
}

export default function CalendarReminders() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [completionClock, setCompletionClock] = useState(() => Date.now());
  const [holidays, setHolidays] = useState<CalendarHoliday[]>([]);
  const [canManageShared, setCanManageShared] = useState(false);
  const [loading, setLoading] = useState(true);
  const [calendarView, setCalendarView] = useState<CalendarView>("month");
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [filterDate, setFilterDate] = useState<string | null>(null);
  const [activeReminder, setActiveReminder] = useState<Reminder | null>(null);
  const [activeHoliday, setActiveHoliday] = useState<CalendarHoliday | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [form, setForm] = useState<ReminderFormState>(() => newReminderForm(dateKey(new Date())));
  const [saving, setSaving] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const monthPickerRef = useRef<HTMLDivElement>(null);
  const monthHeadingRef = useRef<HTMLButtonElement>(null);

  const refreshReminders = useCallback(async () => {
    const result = await listReminders();
    setReminders(result.items);
    setCanManageShared(result.can_manage_shared);
  }, []);

  useEffect(() => {
    const nextEligibleAt = reminders
      .filter((reminder) => reminder.status !== "Done")
      .map(reminderCompletionTime)
      .filter((timestamp) => timestamp > completionClock)
      .reduce<number | null>((earliest, timestamp) => earliest === null || timestamp < earliest ? timestamp : earliest, null);
    if (nextEligibleAt === null) return;

    const timer = window.setTimeout(
      () => setCompletionClock(Date.now()),
      Math.min(2_147_000_000, Math.max(0, nextEligibleAt - completionClock)),
    );
    return () => window.clearTimeout(timer);
  }, [completionClock, reminders]);
  const anchorYear = anchorDate.getFullYear();

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const result = await listReminders();
        if (!cancelled) {
          setReminders(result.items);
          setCanManageShared(result.can_manage_shared);
        }
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to load reminders");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [user?.user_id]);

  useEffect(() => {
    let cancelled = false;
    listCalendarHolidays(anchorYear).then((items) => {
      if (!cancelled) setHolidays(items);
    }).catch(() => {
      if (!cancelled) toast.error("Unable to load official holiday records");
    });
    return () => { cancelled = true; };
  }, [anchorYear, user?.user_id]);

  const todayKey = dateKey(new Date());
  const remindersByDate = useMemo(() => {
    const grouped = new Map<string, Reminder[]>();
    reminders.forEach((reminder) => {
      const current = grouped.get(reminder.date) ?? [];
      current.push(reminder);
      grouped.set(reminder.date, current);
    });
    grouped.forEach((items) => items.sort((left, right) =>
      (left.start_time ?? "").localeCompare(right.start_time ?? "") || left.title.localeCompare(right.title)
    ));
    return grouped;
  }, [reminders]);

  const holidaysByDate = useMemo(() => {
    const grouped = new Map<string, CalendarHoliday[]>();
    holidays.forEach((holiday) => {
      const current = grouped.get(holiday.date) ?? [];
      current.push(holiday);
      grouped.set(holiday.date, current);
    });
    return grouped;
  }, [holidays]);

  const upcomingReminders = useMemo(() => {
    const incomplete = reminders.filter((reminder) => reminder.status !== "Done");
    const filtered = filterDate
      ? incomplete.filter((reminder) => reminder.date === filterDate)
      : incomplete;
    return filtered.sort((left, right) =>
      left.date.localeCompare(right.date)
      || (left.start_time ?? "").localeCompare(right.start_time ?? "")
      || left.title.localeCompare(right.title)
    );
  }, [filterDate, reminders]);

  const monthDates = useMemo(() => {
    const firstOfMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);
    const leadingBlanks = firstOfMonth.getDay();
    const daysInMonth = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + 1, 0).getDate();
    const rowCount = Math.ceil((leadingBlanks + daysInMonth) / 7);
    const trailingBlanks = rowCount * 7 - leadingBlanks - daysInMonth;

    return [
      ...Array.from({ length: leadingBlanks }, () => null),
      ...Array.from({ length: daysInMonth }, (_, index) =>
        new Date(anchorDate.getFullYear(), anchorDate.getMonth(), index + 1)
      ),
      ...Array.from({ length: trailingBlanks }, () => null),
    ];
  }, [anchorDate]);
  const weekDates = useMemo(() => {
    const first = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, index) => addDays(first, index));
  }, [anchorDate]);

  const calendarHeading = calendarView === "month"
    ? new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(anchorDate)
    : calendarView === "week"
      ? `${formatDate(weekDates[0], { month: "short", day: "numeric" })} - ${formatDate(weekDates[6], { month: "short", day: "numeric", year: "numeric" })}`
      : formatDate(selectedDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const chooseDate = (date: Date) => {
    setAnchorDate(date);
    setSelectedDate(date);
    setFilterDate(dateKey(date));
  };

  const goToday = () => {
    const today = new Date();
    setAnchorDate(today);
    setSelectedDate(today);
    setFilterDate(dateKey(today));
  };

  const moveCalendar = (direction: -1 | 1) => {
    if (calendarView === "month") {
      const next = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + direction, 1);
      setAnchorDate(next);
      chooseDate(next);
      return;
    }
    const next = addDays(anchorDate, direction * (calendarView === "week" ? 7 : 1));
    setAnchorDate(next);
    chooseDate(next);
  };

  const selectPickerMonth = (year: number, month: number) => {
    const day = Math.min(selectedDate.getDate(), new Date(year, month + 1, 0).getDate());
    chooseDate(new Date(year, month, day));
    setMonthPickerOpen(false);
    monthHeadingRef.current?.focus();
  };

  const shiftPickerYear = (direction: -1 | 1) => {
    const year = anchorDate.getFullYear() + direction;
    const month = anchorDate.getMonth();
    const day = Math.min(selectedDate.getDate(), new Date(year, month + 1, 0).getDate());
    chooseDate(new Date(year, month, day));
  };

  useEffect(() => {
    if (!monthPickerOpen) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !monthPickerRef.current?.contains(event.target)) {
        setMonthPickerOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMonthPickerOpen(false);
        monthHeadingRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [monthPickerOpen]);

  const openCreate = () => {
    setEditingReminder(null);
    setForm(newReminderForm(dateKey(selectedDate)));
    setActiveReminder(null);
    setActiveHoliday(null);
    setFormOpen(true);
  };

  const openEdit = (reminder: Reminder) => {
    setEditingReminder(reminder);
    setForm(toFormState(reminder));
    setActiveReminder(null);
    setActiveHoliday(null);
    setFormOpen(true);
    setOpenMenuId(null);
  };

  const saveReminder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    const payload: ReminderInput = {
      ...form,
      title: form.title.trim(),
      description: form.description.trim(),
      start_time: form.start_time || null,
      end_time: form.start_time ? form.end_time || null : null,
    };
    try {
      if (editingReminder) await updateReminder(editingReminder.reminder_id, payload);
      else await createReminder(payload);
      await refreshReminders();
      setFormOpen(false);
      toast.success(editingReminder ? "Reminder updated" : "Reminder added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save reminder");
    } finally {
      setSaving(false);
    }
  };

  const markComplete = async (reminder: Reminder) => {
    try {
      await completeReminder(reminder.reminder_id);
      await refreshReminders();
      setActiveReminder(null);
      setOpenMenuId(null);
      toast.success("Reminder completed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to complete reminder");
    }
  };

  const removeReminder = async (reminder: Reminder) => {
    if (!window.confirm(`Delete “${reminder.title}”? This cannot be undone.`)) return;
    try {
      await deleteReminder(reminder.reminder_id);
      await refreshReminders();
      setActiveReminder(null);
      setOpenMenuId(null);
      toast.success("Reminder deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete reminder");
    }
  };

  useEffect(() => {
    const reminderParam = searchParams.get("reminder");
    if (!reminderParam || loading) return;
    const id = Number(reminderParam);
    const match = reminders.find((reminder) => reminder.reminder_id === id);
    if (match) {
      window.setTimeout(() => setActiveReminder(match), 0);
    } else if (Number.isInteger(id)) {
      toast.error("This reminder is no longer available to your account.");
    }
    setSearchParams((params) => {
      params.delete("reminder");
      return params;
    }, { replace: true });
  }, [loading, reminders, searchParams, setSearchParams]);

  const dateForCell = (date: Date, compact = false) => {
    const key = dateKey(date);
    const events = remindersByDate.get(key) ?? [];
    const holidayEvents = holidaysByDate.get(key) ?? [];
    return (
      <div key={key} className={`flex min-w-0 flex-col border-r border-b border-[#E5E7EB] ${compact ? "min-h-[84px] p-1" : "min-h-[118px] p-2"}`}>
        <button
          type="button"
          onClick={() => chooseDate(date)}
          className={`mb-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            key === todayKey ? "bg-[#704389] text-white" : key === dateKey(selectedDate) ? "bg-[#F7F0FA] text-[#704389]" : "text-[#4B5563] hover:bg-[#F3F4F6]"
          }`}
          aria-label={`Show reminders for ${formatDate(date)}`}
        >
          {date.getDate()}
        </button>
        <div className="min-w-0 space-y-1 overflow-hidden">
          {compact && holidayEvents.length > 1 ? (
            <button type="button" onClick={() => { chooseDate(date); setCalendarView("day"); }} title={holidayEvents.map((holiday) => `${holiday.name} - ${holiday.classification}`).join(", ")} className={`flex w-full min-w-0 items-center gap-1 rounded-sm border px-1 py-0.5 text-left text-[10px] leading-4 ${holidayEvents.every((holiday) => holiday.coverage === "National") ? "border-red-200 bg-red-50 text-[#DC2626] hover:bg-red-100" : holidayEvents.every((holiday) => holiday.coverage !== "National") ? "border-green-200 bg-green-50 text-[#16A34A] hover:bg-green-100" : "border-[#E5E7EB] bg-white text-[#2B3642] hover:bg-[#F9FAFB]"}`}>
              {holidayEvents.some((holiday) => holiday.coverage === "National") && <span aria-label="National holiday" className="h-2 w-2 shrink-0 rounded-full bg-[#DC2626]" />}{holidayEvents.some((holiday) => holiday.coverage !== "National") && <span aria-label="Local holiday" className="h-2 w-2 shrink-0 rounded-full bg-[#16A34A]" />}<span className="truncate">{holidayEvents.length} holidays</span>
            </button>
          ) : holidayEvents.slice(0, compact ? 1 : holidayEvents.length).map((holiday) => (
            <button key={holiday.holiday_id} type="button" onClick={() => { setActiveReminder(null); setActiveHoliday(holiday); }} title={`${holiday.name} - ${holiday.classification} (${holiday.geographic_scope})`} className={`flex w-full min-w-0 items-center gap-1 rounded-sm border px-1 py-0.5 text-left text-[10px] leading-4 ${holiday.coverage === "National" ? "border-red-200 bg-red-50 text-[#DC2626] hover:bg-red-100" : "border-green-200 bg-green-50 text-[#16A34A] hover:bg-green-100"}`}>
              <span className="truncate">{holiday.name}</span>
            </button>
          ))}
          {events.slice(0, compact ? 1 : 2).map((reminder) => (
            <button
              key={reminder.reminder_id}
              type="button"
              onClick={() => setActiveReminder(reminder)}
              title={reminder.title}
              className={`flex w-full min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-left text-[10px] leading-4 ${reminder.status === "Done" ? "opacity-50" : reminder.status === "Overdue" ? "bg-[#FFF1F2] text-[#9F1239]" : "bg-[#F8FAFC] text-[#374151]"} hover:bg-[#F7F0FA]`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_TONES[reminder.category]}`} />
              <span className="truncate">{reminder.status === "Overdue" ? "Overdue · " : ""}{reminder.title}</span>
            </button>
          ))}
          {events.length > (compact ? 1 : 2) && (
            <button type="button" onClick={() => chooseDate(date)} className="px-1 text-[10px] font-semibold text-[#704389]">
              +{events.length - (compact ? 1 : 2)} more
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderMonthCalendar = () => (
    <div className="overflow-x-auto">
      <div className="min-w-[620px]">
        <div className="grid grid-cols-7 border-t border-l border-[#E5E7EB] bg-[#F8FAFC]">
          {(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]).map((day) => (
            <div key={day} className="border-r border-b border-[#E5E7EB] px-2 py-2 text-center text-[11px] font-semibold text-[#6B7280]">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l border-[#E5E7EB]">
          {monthDates.map((date, index) => (
            date ? (
              <div key={dateKey(date)}>{dateForCell(date, true)}</div>
            ) : (
              <div key={`blank-${index}`} aria-hidden="true" className="min-h-[84px] border-r border-b border-[#E5E7EB]" />
            )
          ))}
        </div>
      </div>
    </div>
  );

  const renderWeekCalendar = () => (
    <div className="overflow-x-auto">
      <div className="grid min-w-[700px] grid-cols-7 border-l border-t border-[#E5E7EB]">
        {weekDates.map((date) => (
          <div key={dateKey(date)} className="min-h-[390px] border-r border-b border-[#E5E7EB]">
            <button type="button" onClick={() => chooseDate(date)} className={`w-full border-b border-[#E5E7EB] px-2 py-3 text-center ${dateKey(date) === dateKey(selectedDate) ? "bg-[#F7F0FA]" : "bg-[#F8FAFC]"}`}>
              <span className="block text-[10px] font-semibold uppercase text-[#6B7280]">{formatDate(date, { weekday: "short" })}</span>
              <span className={`mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${dateKey(date) === todayKey ? "bg-[#704389] text-white" : "text-[#2B3642]"}`}>{date.getDate()}</span>
            </button>
            <div className="space-y-1.5 p-1.5">
              {(holidaysByDate.get(dateKey(date)) ?? []).map((holiday) => (
                <button key={holiday.holiday_id} type="button" onClick={() => { setActiveReminder(null); setActiveHoliday(holiday); }} className={`flex w-full items-center gap-1.5 rounded-sm border p-1.5 text-left text-[10px] leading-4 ${holiday.coverage === "National" ? "border-red-200 bg-red-50 text-[#DC2626]" : "border-green-200 bg-green-50 text-[#16A34A]"}`}>
                  <span className="min-w-0"><span className="block truncate font-semibold">{holiday.name}</span><span className="block truncate">{holiday.classification}</span></span>
                </button>
              ))}
              {(remindersByDate.get(dateKey(date)) ?? []).map((reminder) => (
                <button key={reminder.reminder_id} type="button" onClick={() => setActiveReminder(reminder)} className={`flex w-full items-start gap-1.5 rounded-sm border border-[#E5E7EB] bg-white p-1.5 text-left text-[10px] leading-4 text-[#374151] hover:bg-[#F7F0FA] ${reminder.status === "Done" ? "opacity-50" : reminder.status === "Overdue" ? "border-[#FECACA] bg-[#FFF1F2] text-[#9F1239]" : ""}`}>
                  <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_TONES[reminder.category]}`} />
                  <span className="min-w-0"><span className="block truncate font-semibold">{reminder.title}</span><span className="block truncate text-[#6B7280]">{reminder.status === "Overdue" ? "Overdue · " : ""}{reminder.start_time ? formatTime(reminder.start_time) : "All day"}</span></span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderDayCalendar = () => {
    const events = remindersByDate.get(dateKey(selectedDate)) ?? [];
    const selectedHolidays = holidaysByDate.get(dateKey(selectedDate)) ?? [];
    return (
      <div className="max-h-[430px] overflow-y-auto border-t border-[#E5E7EB]">
        <div className="grid grid-cols-[72px_minmax(0,1fr)] border-l border-[#E5E7EB]">
          <div className="border-b border-r border-[#E5E7EB] bg-[#F8FAFC] px-2 py-2 text-xs font-semibold text-[#6B7280]">All day</div>
          <div className="min-h-10 space-y-1 border-b border-r border-[#E5E7EB] p-1.5">
            {selectedHolidays.map((holiday) => (
              <button key={holiday.holiday_id} type="button" onClick={() => { setActiveReminder(null); setActiveHoliday(holiday); }} className={`mr-1 inline-flex max-w-full items-center gap-1 rounded-sm border px-2 py-1 text-xs font-semibold ${holiday.coverage === "National" ? "border-red-200 bg-red-50 text-[#DC2626]" : "border-green-200 bg-green-50 text-[#16A34A]"}`}>
                <span className="truncate">{holiday.name}</span>
              </button>
            ))}
            {events.filter((event) => !event.start_time).map((event) => (
              <button key={event.reminder_id} type="button" onClick={() => setActiveReminder(event)} className={`mr-1 inline-flex max-w-full items-center gap-1 rounded-sm px-2 py-1 text-xs font-semibold ${event.status === "Overdue" ? "bg-[#FFF1F2] text-[#9F1239]" : "bg-[#F7F0FA] text-[#704389]"}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_TONES[event.category]}`} /><span className="truncate">{event.status === "Overdue" ? "Overdue · " : ""}{event.title}</span></button>
            ))}
          </div>
          {Array.from({ length: 24 }, (_, hour) => {
            const timed = events.filter((event) => Number(event.start_time?.slice(0, 2)) === hour);
            const label = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(new Date(2000, 0, 1, hour));
            return (
              <div key={hour} className="contents">
                <div className="min-h-[48px] border-b border-r border-[#E5E7EB] bg-[#F8FAFC] px-2 py-2 text-xs text-[#6B7280]">{label}</div>
                <div className="min-h-[48px] space-y-1 border-b border-r border-[#E5E7EB] p-1.5">
                  {timed.map((event) => (
                    <button key={event.reminder_id} type="button" onClick={() => { setActiveHoliday(null); setActiveReminder(event); }} className={`flex w-full items-center gap-2 rounded-sm px-2 py-1 text-left text-xs font-semibold ${event.status === "Overdue" ? "bg-[#FFF1F2] text-[#9F1239]" : "bg-[#F7F0FA] text-[#704389]"}`}><span className={`h-2 w-2 shrink-0 rounded-full ${CATEGORY_TONES[event.category]}`} /><span className="truncate">{event.status === "Overdue" ? "Overdue · " : ""}{formatTime(event.start_time)} · {event.title}</span></button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const canManage = (reminder: Reminder) => reminder.visibility === "personal"
    ? reminder.created_by_user_id === user?.user_id
    : canManageShared;

  return (
    <section className="mt-6 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white">
      <div className="grid min-w-0 lg:grid-cols-[minmax(270px,0.34fr)_minmax(0,0.66fr)]">
        <section className="flex min-h-[600px] min-w-0 flex-col border-b border-[#E5E7EB] lg:border-b-0 lg:border-r">
          <header className="flex items-center justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
            <div><h2 className="text-lg font-bold text-[#2B3642]">Upcoming Events</h2><p className="mt-0.5 text-sm text-[#6B7280]">Don't miss your schedule</p></div>
            <button type="button" onClick={openCreate} title="Add reminder" aria-label="Add reminder" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#704389] text-white hover:bg-[#5F3675]"><Plus className="h-4 w-4" /></button>
          </header>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {filterDate && <div className="flex items-center justify-between text-xs text-[#6B7280]"><span>Showing {formatDate(parseDate(filterDate))}</span><button type="button" onClick={() => setFilterDate(null)} className="font-semibold text-[#704389]">All upcoming</button></div>}
            {loading ? <p className="py-8 text-center text-sm text-[#6B7280]">Loading reminders...</p>
              : upcomingReminders.length === 0 ? <div className="rounded-md border border-dashed border-[#D1D5DB] px-4 py-10 text-center"><CalendarDays className="mx-auto h-7 w-7 text-[#9CA3AF]" /><p className="mt-2 text-sm font-semibold text-[#4B5563]">No upcoming events</p><p className="mt-1 text-xs text-[#6B7280]">Your schedule is clear.</p></div>
                : upcomingReminders.map((reminder) => (
                  <article key={reminder.reminder_id} className="relative rounded-md border border-[#E5E7EB] bg-white p-3 hover:border-[#D8C7E2]">
                    <button type="button" onClick={() => { setActiveHoliday(null); setActiveReminder(reminder); }} className="block w-full min-w-0 text-left">
                      <div className="flex items-start gap-2.5">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${CATEGORY_TONES[reminder.category]}`} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2 pr-7">
                            <p className="truncate text-sm font-semibold text-[#2B3642]">{reminder.title}</p>
                            <span className="flex shrink-0 items-center gap-1"><span className={`rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold ${toneForPriority(reminder.priority)}`}>{reminder.priority}</span>{reminder.status === "Overdue" && <span className="rounded-sm border border-[#FECACA] bg-[#FFF1F2] px-1.5 py-0.5 text-[10px] font-semibold text-[#9F1239]">Overdue</span>}</span>
                          </div>
                          <p className="mt-1 text-xs font-medium text-[#704389]">{formatDate(parseDate(reminder.date), { month: "short", day: "numeric", year: "numeric" })} · {reminderTimeLabel(reminder)}</p>
                          {reminder.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-[#6B7280]">{reminder.description}</p>}
                          <p className="mt-2 text-[10px] font-semibold text-[#6B7280]">{reminder.category} · {reminder.visibility === "shared" ? "Shared office" : "Personal"}</p>
                        </div>
                      </div>
                    </button>
                    <button type="button" onClick={() => setOpenMenuId((current) => current === reminder.reminder_id ? null : reminder.reminder_id)} aria-label={`Actions for ${reminder.title}`} className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded text-[#6B7280] hover:bg-[#F3F4F6]"><MoreHorizontal className="h-4 w-4" /></button>
                    {openMenuId === reminder.reminder_id && <div className="absolute right-2 top-9 z-10 w-40 rounded-md border border-[#E5E7EB] bg-white p-1 shadow-lg">
                      <button type="button" onClick={() => { setActiveHoliday(null); setActiveReminder(reminder); setOpenMenuId(null); }} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#374151] hover:bg-[#F8FAFC]">View details</button>
                      {canManage(reminder) && <>
                        <button type="button" onClick={() => openEdit(reminder)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#374151] hover:bg-[#F8FAFC]"><Pencil className="h-3.5 w-3.5" />Edit</button>
                        {isReminderCompletionEligible(reminder, completionClock) && <button type="button" onClick={() => void markComplete(reminder)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#374151] hover:bg-[#F8FAFC]"><Check className="h-3.5 w-3.5" />Mark completed</button>}
                        <button type="button" onClick={() => void removeReminder(reminder)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-[#B91C1C] hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" />Delete</button>
                      </>}
                    </div>}
                  </article>
                ))}
          </div>
        </section>

        <section className="min-w-0 p-4 sm:p-5">
          <header className="flex flex-wrap items-center justify-between gap-3 pb-4">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => moveCalendar(-1)} aria-label="Previous period" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#E5E7EB] text-[#4B5563] hover:bg-[#F8FAFC]"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => moveCalendar(1)} aria-label="Next period" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#E5E7EB] text-[#4B5563] hover:bg-[#F8FAFC]"><ChevronRight className="h-4 w-4" /></button>
              <button type="button" onClick={goToday} className="ml-1 h-9 rounded-md border border-[#E5E7EB] px-3 text-xs font-semibold text-[#4B5563] hover:bg-[#F8FAFC]">Today</button>
              {calendarView === "month" ? (
                <div className="relative ml-2" ref={monthPickerRef}>
                  <button
                    ref={monthHeadingRef}
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={monthPickerOpen}
                    aria-controls="calendar-month-picker"
                    onClick={() => setMonthPickerOpen((open) => !open)}
                    className="inline-flex items-center gap-1 text-base font-bold text-[#2B3642] hover:text-[#704389] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#704389] focus-visible:ring-offset-2"
                  >
                    {calendarHeading}
                    <ChevronDown className={`h-3.5 w-3.5 text-[#704389] transition-transform ${monthPickerOpen ? "rotate-180" : ""}`} />
                  </button>
                  {monthPickerOpen && (
                    <div
                      id="calendar-month-picker"
                      role="dialog"
                      aria-label="Choose calendar month and year"
                      className="absolute left-0 top-full z-40 mt-2 w-[264px] rounded-md border border-[#E5E7EB] bg-white p-3 shadow-lg"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <button
                          type="button"
                          aria-label="Previous year"
                          onClick={() => shiftPickerYear(-1)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[#6B7280] hover:bg-[#F7F0FA] hover:text-[#5F3675] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#704389]"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="text-sm font-bold text-[#2B3642]" aria-live="polite">{anchorDate.getFullYear()}</span>
                        <button
                          type="button"
                          aria-label="Next year"
                          onClick={() => shiftPickerYear(1)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[#6B7280] hover:bg-[#F7F0FA] hover:text-[#5F3675] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#704389]"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1" role="group" aria-label="Select month">
                        {MONTH_NAMES.map((month, index) => {
                          const selected = anchorDate.getMonth() === index;
                          return (
                            <button
                              key={month}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => selectPickerMonth(anchorDate.getFullYear(), index)}
                              className={`rounded px-2 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#704389] ${selected ? "bg-[#704389] text-white" : "text-[#2B3642] hover:bg-[#F7F0FA] hover:text-[#5F3675]"}`}
                            >
                              {month}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          goToday();
                          setMonthPickerOpen(false);
                          monthHeadingRef.current?.focus();
                        }}
                        className="mt-2 w-full border-t border-[#E5E7EB] pt-2 text-left text-xs font-semibold text-[#704389] hover:text-[#5F3675] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#704389]"
                      >
                        Go to Today
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <h3 className="ml-2 text-base font-bold text-[#2B3642]">{calendarHeading}</h3>
              )}
            </div>
            <div className="inline-flex rounded-md border border-[#E5E7EB] bg-[#F8FAFC] p-0.5" role="group" aria-label="Calendar view">
              {(["day", "week", "month"] as const).map((view) => <button key={view} type="button" onClick={() => setCalendarView(view)} className={`rounded-sm px-3 py-1.5 text-xs font-semibold capitalize ${calendarView === view ? "bg-white text-[#704389] shadow-sm" : "text-[#6B7280] hover:text-[#2B3642]"}`}>{view}</button>)}
            </div>
          </header>
          {calendarView === "month" ? renderMonthCalendar() : calendarView === "week" ? renderWeekCalendar() : renderDayCalendar()}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] text-[#6B7280]">
            {CATEGORIES.slice(0, 6).map((category) => <span key={category} className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${CATEGORY_TONES[category]}`} />{category}</span>)}
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#DC2626]" />National Holiday</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-[#16A34A]" />Local Holiday</span>
          </div>
        </section>
      </div>

      {(formOpen || activeReminder || activeHoliday) && <ModalPortal>
        <div className="jurisguard-modal-overlay fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) { setFormOpen(false); setActiveReminder(null); setActiveHoliday(null); } }}>
          {formOpen ? <form onSubmit={(event) => void saveReminder(event)} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-[#E5E7EB] px-5 py-4"><div><h2 className="text-lg font-bold text-[#2B3642]">{editingReminder ? "Edit Reminder" : "Add Reminder"}</h2><p className="mt-0.5 text-xs text-[#6B7280]">Schedule a personal or shared office event.</p></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Close" className="rounded p-1 text-[#6B7280] hover:bg-[#F3F4F6]"><X className="h-4 w-4" /></button></div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <label className="text-xs font-semibold text-[#374151] sm:col-span-2">Reminder Title <span className="text-red-600">*</span><input required maxLength={200} value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] px-3 text-sm font-normal" /></label>
              <label className="text-xs font-semibold text-[#374151] sm:col-span-2">Description / Notes<textarea maxLength={4000} rows={2} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-md border border-[#D1D5DB] px-3 py-2 text-sm font-normal" /></label>
              <label className="text-xs font-semibold text-[#374151]">Date <span className="text-red-600">*</span><input type="date" required value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] px-3 text-sm font-normal" /></label>
              <label className="text-xs font-semibold text-[#374151]">Category<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value as ReminderCategory }))} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm font-normal">{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
              <label className="text-xs font-semibold text-[#374151]">Start Time <span className="font-normal text-[#6B7280]">(optional, leave blank for all day)</span><input type="time" value={form.start_time ?? ""} onChange={(event) => setForm((current) => ({ ...current, start_time: event.target.value, end_time: event.target.value ? current.end_time : "" }))} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] px-3 text-sm font-normal" /></label>
              <label className="text-xs font-semibold text-[#374151]">End Time<input type="time" min={form.start_time || undefined} disabled={!form.start_time} value={form.end_time ?? ""} onChange={(event) => setForm((current) => ({ ...current, end_time: event.target.value }))} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] px-3 text-sm font-normal disabled:bg-[#F8FAFC]" /></label>
              <label className="text-xs font-semibold text-[#374151]">Priority<select value={form.priority} onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as ReminderPriority }))} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm font-normal">{PRIORITIES.map((priority) => <option key={priority}>{priority}</option>)}</select></label>
              {canManageShared && <label className="text-xs font-semibold text-[#374151]">Visibility<select value={form.visibility} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value as ReminderInput["visibility"] }))} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm font-normal"><option value="personal">Personal - only me</option><option value="shared">Shared office</option></select></label>}
              <label className={`text-xs font-semibold text-[#374151] ${canManageShared ? "sm:col-span-2" : "sm:col-span-2"}`}>Notification Timing<select value={form.notification_minutes_before === null ? "none" : String(form.notification_minutes_before)} onChange={(event) => setForm((current) => ({ ...current, notification_minutes_before: event.target.value === "none" ? null : Number(event.target.value) }))} className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm font-normal">{NOTIFICATION_CHOICES.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}</select></label>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4"><button type="button" onClick={() => setFormOpen(false)} className="h-9 rounded-md border border-[#D1D5DB] px-4 text-sm font-semibold text-[#4B5563]">Cancel</button><button type="submit" disabled={saving || !form.title.trim()} className="h-9 rounded-md bg-[#704389] px-4 text-sm font-semibold text-white hover:bg-[#5F3675] disabled:opacity-50">{saving ? "Saving..." : editingReminder ? "Save Changes" : "Add Reminder"}</button></div>
          </form> : activeReminder ? <div className="w-full max-w-lg rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-[#E5E7EB] px-5 py-4"><div><p className="text-[11px] font-semibold uppercase text-[#704389]">{activeReminder.visibility === "shared" ? "Shared Office Reminder" : "Personal Reminder"}</p><h2 className="mt-1 text-lg font-bold text-[#2B3642]">{activeReminder.title}</h2></div><button type="button" onClick={() => setActiveReminder(null)} aria-label="Close" className="rounded p-1 text-[#6B7280] hover:bg-[#F3F4F6]"><X className="h-4 w-4" /></button></div>
            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3 text-sm"><p className="flex items-center gap-2 text-[#374151]"><CalendarDays className="h-4 w-4 text-[#704389]" />{formatDate(parseDate(activeReminder.date), { dateStyle: "full" })}</p><p className="flex items-center gap-2 text-[#374151]"><Clock3 className="h-4 w-4 text-[#704389]" />{reminderTimeLabel(activeReminder)}</p></div>
              <div className="flex flex-wrap gap-2"><span className="rounded-sm bg-[#F8FAFC] px-2 py-1 text-xs text-[#4B5563]">{activeReminder.category}</span><span className={`rounded-sm border px-2 py-1 text-xs font-semibold ${toneForPriority(activeReminder.priority)}`}>{activeReminder.priority}</span><span className={`rounded-sm border px-2 py-1 text-xs font-semibold ${activeReminder.status === "Overdue" ? "border-[#FECACA] bg-[#FFF1F2] text-[#9F1239]" : activeReminder.status === "Done" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-[#D8C7E2] bg-[#F7F0FA] text-[#704389]"}`}>{activeReminder.status}</span></div>
              {activeReminder.description && <p className="whitespace-pre-wrap text-sm leading-6 text-[#4B5563]">{activeReminder.description}</p>}
              <p className="text-xs text-[#6B7280]">{activeReminder.visibility === "shared" ? "Visible to approved office users." : "Visible only to you."}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-[#E5E7EB] px-5 py-4"><button type="button" onClick={() => setActiveReminder(null)} className="h-9 rounded-md border border-[#D1D5DB] px-4 text-sm font-semibold text-[#4B5563]">Close</button>{canManage(activeReminder) && <><button type="button" onClick={() => openEdit(activeReminder)} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[#704389] px-3 text-sm font-semibold text-[#704389]"><Pencil className="h-3.5 w-3.5" />Edit</button>{isReminderCompletionEligible(activeReminder, completionClock) && <button type="button" onClick={() => void markComplete(activeReminder)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#704389] px-3 text-sm font-semibold text-white"><Check className="h-3.5 w-3.5" />Complete</button>}<button type="button" onClick={() => void removeReminder(activeReminder)} aria-label="Delete reminder" className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-200 text-red-700 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button></>}</div>
          </div> : activeHoliday && <div className="w-full max-w-lg rounded-md bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-[#E5E7EB] px-5 py-4"><div><p className={`text-[11px] font-semibold uppercase ${activeHoliday.coverage === "National" ? "text-[#DC2626]" : "text-[#16A34A]"}`}>{activeHoliday.coverage} Holiday · {activeHoliday.geographic_scope}</p><h2 className="mt-1 text-lg font-bold text-[#2B3642]">{activeHoliday.name}</h2></div><button type="button" onClick={() => setActiveHoliday(null)} aria-label="Close" className="rounded p-1 text-[#6B7280] hover:bg-[#F3F4F6]"><X className="h-4 w-4" /></button></div>
            <div className="space-y-3 p-5 text-sm"><p className="flex items-center gap-2 text-[#374151]"><CalendarDays className="h-4 w-4 text-[#704389]" />{formatDate(parseDate(activeHoliday.date), { dateStyle: "full" })}</p><p><span className="font-semibold text-[#374151]">Classification: </span><span className="text-[#4B5563]">{activeHoliday.classification}</span></p><p><span className="font-semibold text-[#374151]">Official reference: </span><span className="text-[#4B5563]">{activeHoliday.reference}</span></p><a href={activeHoliday.source_url} target="_blank" rel="noreferrer" className="inline-flex text-sm font-semibold text-[#704389] underline decoration-[#D8C7E2] underline-offset-2 hover:text-[#5F3675]">View official source</a></div>
            <div className="flex justify-end border-t border-[#E5E7EB] px-5 py-4"><button type="button" onClick={() => setActiveHoliday(null)} className="h-9 rounded-md border border-[#D1D5DB] px-4 text-sm font-semibold text-[#4B5563]">Close</button></div>
          </div>}
        </div>
      </ModalPortal>}
    </section>
  );
}
