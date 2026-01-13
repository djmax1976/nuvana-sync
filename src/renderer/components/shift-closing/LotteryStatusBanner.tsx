
/**
 * Lottery Status Banner Component
 *
 * Displays the current lottery status for shift/day closing workflows.
 * Shows different states: closed (green), required (amber), or optional (blue).
 *
 * @security
 * - FE-005: UI_SECURITY - No sensitive data exposed
 * - SEC-004: XSS - All outputs are properly escaped by React
 */

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

import type { LotteryStatusBannerProps, LotteryStatus } from "./types";
import { formatCurrency } from "./utils";

/**
 * Get banner configuration based on lottery status and requirement
 */
function getBannerConfig(
  status: LotteryStatus,
  isRequired: boolean,
): {
  variant: "success" | "warning" | "info" | "pending";
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  showButton: boolean;
  buttonLabel: string;
} {
  if (status === "closed" || status === "closed_earlier") {
    return {
      variant: "success",
      icon: (
        <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
      ),
      title: "Lottery Day Closed",
      subtitle: status === "closed_earlier" ? "Closed earlier today" : "",
      showButton: false,
      buttonLabel: "",
    };
  }

  // Pending - Lottery scanned, awaiting day close commit
  if (status === "pending") {
    return {
      variant: "pending",
      icon: (
        <CheckCircle2 className="h-6 w-6 text-blue-600 dark:text-blue-400" />
      ),
      title: "Lottery Scanned - Ready to Close",
      subtitle: "Click 'Complete Day Close' to finalize",
      showButton: false,
      buttonLabel: "",
    };
  }

  // Not closed
  if (isRequired) {
    return {
      variant: "warning",
      icon: (
        <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
      ),
      title: "Lottery Close Required",
      subtitle: "Scan all bin ending numbers to close lottery",
      showButton: true,
      buttonLabel: "Close Lottery",
    };
  }

  // Optional (shift close)
  return {
    variant: "info",
    icon: <Info className="h-6 w-6 text-blue-600 dark:text-blue-400" />,
    title: "Lottery Not Closed",
    subtitle: "You can optionally close lottery before ending shift",
    showButton: true,
    buttonLabel: "Close Lottery (Optional)",
  };
}

/**
 * Get CSS classes for banner variant
 */
function getVariantClasses(
  variant: "success" | "warning" | "info" | "pending",
): {
  card: string;
  title: string;
  subtitle: string;
  button: string;
} {
  switch (variant) {
    case "success":
      return {
        card: "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/30",
        title: "text-green-700 dark:text-green-300",
        subtitle: "text-green-600 dark:text-green-400",
        button: "",
      };
    case "pending":
      // Pending uses blue theme with a subtle pulsing indication
      return {
        card: "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30",
        title: "text-blue-700 dark:text-blue-300",
        subtitle: "text-blue-600 dark:text-blue-400",
        button: "",
      };
    case "warning":
      return {
        card: "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30",
        title: "text-amber-700 dark:text-amber-300",
        subtitle: "text-amber-600 dark:text-amber-400",
        button: "bg-amber-600 hover:bg-amber-700 text-white",
      };
    case "info":
      return {
        card: "border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/30",
        title: "text-blue-700 dark:text-blue-300",
        subtitle: "text-blue-600 dark:text-blue-400",
        button: "bg-blue-600 hover:bg-blue-700 text-white",
      };
  }
}

/**
 * Lottery Status Banner
 *
 * Displays contextual banner based on:
 * - Whether lottery is closed or not
 * - Whether lottery is required (day close) or optional (shift close)
 * - Current lottery total if closed
 */
export function LotteryStatusBanner({
  status,
  lotteryData,
  lotteryTotal,
  isRequired,
  onOpenLotteryModal,
}: LotteryStatusBannerProps) {
  const config = getBannerConfig(status, isRequired);
  const classes = getVariantClasses(config.variant);

  // Determine subtitle text
  const subtitleText =
    (status === "closed" || status === "pending") && lotteryData
      ? `${lotteryData.closings_created} pack(s) ${status === "pending" ? "scanned" : "closed"}`
      : config.subtitle;

  // Show lottery total for closed, pending, or closed_earlier statuses
  const showLotteryTotal =
    status === "closed" || status === "closed_earlier" || status === "pending";

  return (
    <Card className={classes.card} data-testid="lottery-status-banner">
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          {/* Left side - Status info */}
          <div className="flex items-center gap-3">
            {config.icon}
            <div>
              <p className={`font-medium ${classes.title}`}>{config.title}</p>
              {subtitleText && (
                <p className={`text-sm ${classes.subtitle}`}>{subtitleText}</p>
              )}
            </div>
          </div>

          {/* Right side - Total or Button */}
          {showLotteryTotal ? (
            <div className="text-right">
              <p className={`text-sm ${classes.subtitle}`}>
                {status === "pending" ? "Estimated Sales" : "Lottery Sales"}
              </p>
              <p className={`text-2xl font-bold ${classes.title}`}>
                {formatCurrency(lotteryTotal)}
              </p>
            </div>
          ) : config.showButton ? (
            <Button
              onClick={onOpenLotteryModal}
              className={classes.button}
              data-testid="open-lottery-modal-btn"
            >
              {config.buttonLabel}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
