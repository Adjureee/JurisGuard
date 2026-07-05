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
          className={`rounded-lg border px-3 py-2 text-sm ${
            index === currentStep
              ? "border-brand-600 bg-brand-600 text-white shadow-sm"
              : index < currentStep
                ? "border-emerald-200 dark:border-emerald-400/25 bg-emerald-50 dark:bg-emerald-400/10 text-emerald-800 dark:text-emerald-300"
                : "border-line bg-card text-muted"
          }`}
        >
          <span className="mr-2 font-semibold">Step {index + 1}</span>
          {item}
        </div>
      ))}
    </div>
  );
}


