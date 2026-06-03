import {
  DATE_FILTER_OPTIONS,
  type DateFilterValue,
} from "../utils/dateFilters";

interface DateFilterSelectProps {
  value: DateFilterValue;
  onChange: (value: DateFilterValue) => void;
  label?: string;
}

export default function DateFilterSelect({
  value,
  onChange,
  label = "Date",
}: DateFilterSelectProps) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#4B5563]">
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as DateFilterValue)}
        className="mt-1 h-10 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-sm text-[#2B3642] outline-none transition focus:border-[#704389] focus:ring-2 focus:ring-[#704389]/20"
      >
        {DATE_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
