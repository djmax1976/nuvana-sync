/**
 * Clock In/Out Page
 *
 * Placeholder page for employee time tracking functionality.
 */

import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card';
import { Clock } from 'lucide-react';

export default function ClockInOutPage() {
  return (
    <div className="space-y-6" data-testid="clock-in-out-page">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Clock In/Out
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Employee time tracking functionality will be available here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
