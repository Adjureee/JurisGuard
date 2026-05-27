interface StepIndicatorProps {
  steps: string[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {steps.map((item, index) => (
        <div
          key={item}
          className={`rounded-md border px-3 py-2 text-sm ${
            index === currentStep
              ? "border-[#2F80ED] bg-[#2F80ED] text-white"
              : index < currentStep
                ? "border-[#15803D] bg-[#15803D] text-white"
                : "border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280]"
          }`}
        >
          <span className="mr-2 font-semibold">Step {index + 1}</span>
          {item}
        </div>
      ))}
    </div>
  );
}

