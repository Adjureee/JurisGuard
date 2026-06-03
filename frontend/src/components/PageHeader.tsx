import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}

export default function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: PageHeaderProps) {
  return (
    <div className="mb-6 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold uppercase tracking-wide text-[#704389]">
          {eyebrow}
        </p>
        <h1 className="mt-1 text-2xl font-bold text-[#2B3642]">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm text-[#6B7280]">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="min-w-0 max-w-full">{actions}</div> : null}
    </div>
  );
}
