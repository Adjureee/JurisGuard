interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(0,1fr))]">
      {steps.map((item, index) => (
        <div
          key={item}
          className={`min-w-0 rounded-lg border px-3 py-2 text-sm transition ${
            index === currentStep
              ? "border-[#704389] bg-[#704389] font-semibold text-white shadow-sm"
              : index < currentStep
                ? "border-[#D1FAE5] bg-[#ECFDF5] text-[#047857]"
                : "border-[#E5E7EB] bg-[#F8FAFC] text-[#6B7280]"
          }`}
        >
          <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-80">
            Step {index + 1}
          </span>
          <span className="mt-0.5 block truncate">{item}</span>
        </div>
      ))}
    </div>
  );
}


