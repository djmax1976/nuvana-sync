
/**
 * Shift Close Step Indicator Component
 *
 * 2-step progress indicator for shift closing workflow:
 * - Step 1: Report Scanning
 * - Step 2: Shift Closing
 *
 * Reuses the same visual style as the Day Close wizard's StepIndicator.
 *
 * @security
 * - FE-005: UI_SECURITY - No sensitive data displayed
 */

import { Check } from "lucide-react";

export type ShiftCloseStep = 1 | 2;

interface ShiftCloseStepIndicatorProps {
  currentStep: ShiftCloseStep;
  reportScanningCompleted: boolean;
}

/**
 * ShiftCloseStepIndicator component
 *
 * Displays a 2-step progress indicator for the shift close wizard.
 * Visual design matches the Day Close wizard for consistency.
 */
export function ShiftCloseStepIndicator({
  currentStep,
  reportScanningCompleted,
}: ShiftCloseStepIndicatorProps) {
  const steps = [
    {
      number: 1 as const,
      label: "Report Scanning",
      completed: reportScanningCompleted,
    },
    { number: 2 as const, label: "Close Shift", completed: false },
  ];

  return (
    <div className="bg-card px-6 py-4" data-testid="shift-close-step-indicator">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-center gap-4">
          {steps.map((step, index) => (
            <div key={step.number} className="flex items-center">
              {/* Step circle and label */}
              <div className="flex items-center">
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg transition-colors ${
                    step.completed
                      ? "bg-green-600 text-white"
                      : currentStep === step.number
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                  }`}
                  data-testid={`shift-close-step-${step.number}-indicator`}
                >
                  {step.completed ? <Check className="w-5 h-5" /> : step.number}
                </div>
                <span
                  className={`ml-3 font-medium ${
                    step.completed
                      ? "text-green-600"
                      : currentStep === step.number
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </span>
              </div>

              {/* Connecting line (not after last step) */}
              {index < steps.length - 1 && (
                <div
                  className={`w-24 h-1 mx-4 transition-colors ${
                    step.completed ? "bg-green-600" : "bg-muted"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
