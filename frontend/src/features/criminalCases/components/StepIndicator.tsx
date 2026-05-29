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
              ? "border-[#4A7FB0] bg-[#4A7FB0] text-white shadow-md "
              : index < currentStep
                ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]"
                : "border-[#E5E7EB] bg-white text-[#4B5563]"
          }`}
        >
          <span className="mr-2 font-semibold">Step {index + 1}</span>
          {item}
        </div>
      ))}
    </div>
  );
}

