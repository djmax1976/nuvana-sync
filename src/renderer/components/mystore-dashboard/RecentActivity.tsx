import { Card, CardHeader, CardTitle, CardContent } from "../ui/card";
import {
  sanitizeForDisplay,
  maskEmployeeName,
} from "../../lib/utils/security";

/**
 * RecentActivity Component
 *
 * Displays an activity feed with avatar initials,
 * action description, time ago, and meta info.
 *
 * Security Features:
 * - SEC-004: XSS prevention via sanitized output
 * - FE-005: Employee name masking for privacy
 * - WCAG 2.1: Full accessibility support with ARIA live region
 *
 * Story: MyStore Dashboard Redesign
 */

// Sample activity data - will be replaced with real API data
const activities = [
  {
    id: "1",
    initials: "JD",
    fullName: "John Davis",
    title: "John Davis closed Shift #445",
    time: "32 minutes ago",
    meta: "$3,245.00",
    color: "primary" as const,
    activityType: "shift_close" as const,
  },
  {
    id: "2",
    initials: "SM",
    fullName: "Sarah Miller",
    title: "Sarah Miller opened current shift",
    time: "1 hour ago",
    meta: "Shift #446",
    color: "success" as const,
    activityType: "shift_open" as const,
  },
  {
    id: "3",
    initials: "LP",
    fullName: "Lottery Pack",
    title: "Lottery Pack #2847 activated",
    time: "1 hour ago",
    meta: "$5 Game",
    color: "warning" as const,
    activityType: "lottery_activation" as const,
  },
  {
    id: "4",
    initials: "JD",
    fullName: "John Davis",
    title: "Cash drop performed",
    time: "2 hours ago",
    meta: "$500.00",
    color: "primary" as const,
    activityType: "cash_drop" as const,
  },
];

const avatarColors = {
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
};

// Mask activity titles to protect employee names
function maskActivityTitle(title: string, fullName: string): string {
  const maskedName = maskEmployeeName(fullName);
  return title.replace(fullName, maskedName);
}

export function RecentActivity() {
  return (
    <Card
      data-testid="recent-activity"
      role="region"
      aria-labelledby="recent-activity-title"
    >
      <CardHeader className="flex flex-row items-center justify-between p-5 border-b">
        <CardTitle
          id="recent-activity-title"
          className="text-base font-semibold"
        >
          Recent Activity
        </CardTitle>
        <span
          className="text-xs text-muted-foreground"
          aria-label="Showing activity from the last 2 hours"
        >
          Last 2 hours
        </span>
      </CardHeader>
      <CardContent className="p-5">
        <ul
          className="space-y-0"
          role="feed"
          aria-label="Store activity feed"
          aria-live="polite"
        >
          {activities.map((activity, index) => {
            // Sanitize all display values (SEC-004)
            const safeInitials = sanitizeForDisplay(activity.initials);
            const safeTitle = sanitizeForDisplay(
              maskActivityTitle(activity.title, activity.fullName),
            );
            const safeTime = sanitizeForDisplay(activity.time);
            const safeMeta = sanitizeForDisplay(activity.meta);

            return (
              <li
                key={activity.id}
                className={`flex gap-3 py-3.5 ${index < activities.length - 1 ? "border-b" : ""}`}
                role="article"
                aria-label={`${safeTitle}, ${safeTime}`}
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-semibold ${avatarColors[activity.color]}`}
                  aria-hidden="true"
                >
                  {safeInitials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-foreground">{safeTitle}</div>
                  <div className="text-xs text-muted-foreground">
                    <time dateTime={safeTime}>{safeTime}</time>
                  </div>
                </div>
                <div
                  className="font-mono text-xs text-primary whitespace-nowrap"
                  aria-label={`Value: ${safeMeta}`}
                >
                  {safeMeta}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
