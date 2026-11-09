import type { UseFormRegisterReturn } from "react-hook-form";
import type { ClientRecord } from "../../../types";
import { initials } from "../caseWorkflowHelpers";

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-rose-400">{message}</p>;
}

export function TextInput({
  label,
  registration,
  error,
  type = "text",
  disabled = false,
  readOnly = false,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#4B5563]">{label}</span>
      <input
        type={type}
        disabled={disabled}
        readOnly={readOnly}
        {...registration}
        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20 disabled:cursor-not-allowed disabled:bg-[#F3F4F6] disabled:text-[#6B7280]"
      />
      <FieldError message={error} />
    </label>
  );
}

export function TextArea({
  label,
  registration,
  error,
}: {
  label: string;
  registration: UseFormRegisterReturn;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-[#4B5563]">{label}</span>
      <textarea
        {...registration}
        rows={4}
        className="mt-1 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#2B3642] outline-none transition duration-200 focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
      />
      <FieldError message={error} />
    </label>
  );
}

export function InventorySourceField({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}) {
  return (
    <div className="rounded-md border border-[#D1D5DB] bg-[#F8FAFC] px-3 py-2.5">
      <p className="text-sm font-medium text-[#4B5563]">{label}</p>
      <p className="mt-1 min-h-5 break-words text-sm font-semibold text-[#2B3642]">
        {value || "Not provided"}
      </p>
      <p className="mt-1 text-xs text-[#6B7280]">{source}</p>
    </div>
  );
}

export function SelectedClientCard({
  client,
  locked = false,
  onView,
  onRemove,
}: {
  client: ClientRecord;
  locked?: boolean;
  onView: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex min-w-[240px] max-w-full items-center gap-3 rounded-md border border-[#E5E7EB] bg-white px-3 py-2 shadow-sm sm:max-w-[320px]">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#704389] text-xs font-semibold text-white">
        {initials(client.client.name)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#2B3642]">
          {client.client.name}
        </p>
        {locked && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#704389]">
            Selected
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onView}
          className="rounded-md border border-[#704389] bg-white px-2.5 py-1 text-xs font-semibold text-[#704389] transition hover:bg-[#704389] hover:text-white"
        >
          View
        </button>
        {onRemove && !locked && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-semibold text-[#4B5563] transition hover:bg-[#F8FAFC]"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

export function ReviewField({
  label,
  value,
}: {
  label: string;
  value: string | number | boolean | undefined | null;
}) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-semibold text-[#2B3642]">
        {typeof value === "boolean" ? (value ? "Yes" : "No") : value || "-"}
      </p>
    </div>
  );
}
