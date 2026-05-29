interface AuthImagePanelProps {
  eyebrow?: string;
  headline: string;
  description: string;
}

export default function AuthImagePanel({
  eyebrow = "JurisGuard",
  headline,
  description,
}: AuthImagePanelProps) {
  return (
    <div className="relative hidden min-h-[600px] overflow-hidden bg-[#2B3642] lg:block">
      <img
        src="/loginimage.png"
        alt="JurisGuard legal operations workspace"
        className="h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#111827]/85 via-[#111827]/35 to-[#111827]/20" />
      <div className="absolute left-8 top-8 flex items-center gap-3 text-white">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
            <path
              fill="currentColor"
              d="M12 3 4 6v5c0 5 3.4 8.3 8 10 4.6-1.7 8-5 8-10V6l-8-3Zm0 3.2 5 1.9V11c0 3.4-2 5.8-5 7.2-3-1.4-5-3.8-5-7.2V8.1l5-1.9ZM9 10h6v2H9v-2Zm1 3h4v2h-4v-2Z"
            />
          </svg>
        </div>
        <div>
          <p className="text-base font-bold tracking-wide">{eyebrow}</p>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-white/70">
            PAO Panabo
          </p>
        </div>
      </div>
      <div className="absolute bottom-7 left-8 right-8 text-white">
        <p className="max-w-sm text-2xl font-bold leading-tight">{headline}</p>
        <p className="mt-3 max-w-md text-sm font-medium leading-6 text-white/78">
          {description}
        </p>
      </div>
    </div>
  );
}

