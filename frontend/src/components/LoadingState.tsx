interface LoadingStateProps {
  label: string;
  className?: string;
}

export default function LoadingState({ label, className = "" }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`loading-state flex min-h-48 flex-col items-center justify-center gap-3 px-4 text-sm font-medium text-[#4B5563] ${className}`}
    >
      <span className="loading-state__spinner" aria-hidden="true" />
      <span>{label}</span>
      <span className="loading-state__track" aria-hidden="true">
        <span className="loading-state__bar" />
      </span>
    </div>
  );
}
