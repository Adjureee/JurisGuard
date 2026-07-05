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
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-gold-600">
          <span aria-hidden="true" className="h-px w-6 bg-gold-400" />
          {eyebrow}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 sm:text-[1.6rem]">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-sm text-gray-500">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
