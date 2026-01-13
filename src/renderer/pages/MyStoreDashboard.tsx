import {
  StatsGrid,
  ExpectedDeliveries,
  RecentlyActivatedPacks,
  SalesByDepartment,
  RecentTransactions,
  RecentActivity,
  RecentVoids,
  RecentShiftHistory,
} from "../components/mystore-dashboard";

/**
 * MyStore Terminal Dashboard Home Page
 *
 * @requirements
 * - AC #1: Dashboard home page for terminal operators
 * - AC #2: Store name displayed in header component
 * - AC #3: Displays key metrics, recent activity, and operational data
 */
export function MyStoreDashboard() {
  return (
    <div className="space-y-6" data-testid="mystore-dashboard-page">
      {/* Stats Grid - 4 stat cards */}
      <StatsGrid />

      {/* Content Grid - 3 equal cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
        <SalesByDepartment />
        <RecentlyActivatedPacks />
        <ExpectedDeliveries />
      </div>

      {/* Bottom Grid - 2 cards side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        <RecentTransactions />
        <RecentActivity />
      </div>

      {/* Full Width - Recent Voids */}
      <RecentVoids />

      {/* Full Width - Recent Shift History */}
      <RecentShiftHistory />
    </div>
  );
}
