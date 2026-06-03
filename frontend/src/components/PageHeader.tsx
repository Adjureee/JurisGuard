import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  compact?: boolean;
}

export default function PageHeader({
  actions,
  compact = false,
  description,
  eyebrow,
  title,
}: PageHeaderProps) {
  return (
    <div
      className={`flex min-w-0 flex-col lg:flex-row lg:items-end lg:justify-between ${
        compact ? "mb-3 gap-2" : "mb-6 gap-3"
      }`}
    >
      <div className="min-w-0">
        <p
          className={`font-semibold uppercase tracking-wide text-[#704389] ${
            compact ? "text-xs" : "text-sm"
          }`}
        >
          {eyebrow}
        </p>
        <h1
          className={`mt-1 font-bold text-[#2B3642] ${
            compact ? "text-xl" : "text-2xl"
          }`}
        >
          {title}
        </h1>
        {description ? (
          <p
            className={`max-w-3xl text-sm text-[#6B7280] ${
              compact ? "mt-1 leading-snug" : "mt-2"
            }`}
          >
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="min-w-0 max-w-full">{actions}</div> : null}
    </div>
  );
}
