import { useState } from 'react';
import { MyStoreSidebar } from './MyStoreSidebar';
import { Header } from './Header';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '../ui/sheet';
import { Button } from '../ui/button';
import { Menu } from 'lucide-react';

interface MyStoreDashboardLayoutProps {
  children: React.ReactNode;
}

/**
 * MyStore Terminal Dashboard Layout component for Electron
 * Provides layout structure for terminal-focused dashboard with minimal navigation
 *
 * @requirements
 * - AC #1: Simplified dashboard layout with sidebar navigation
 * - AC #2: Sidebar shows navigation links for desktop app
 */
export function MyStoreDashboardLayout({ children }: MyStoreDashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden" data-testid="mystore-dashboard-layout">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block">
        <MyStoreSidebar />
      </aside>

      {/* Mobile Sidebar Sheet */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent
          side="left"
          className="w-64 p-0"
          onInteractOutside={() => setSidebarOpen(false)}
        >
          <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Navigation menu for Nuvana dashboard
          </SheetDescription>
          <MyStoreSidebar onNavigate={() => setSidebarOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile Header with Menu Button */}
        <div className="lg:hidden">
          <div className="flex h-16 items-center justify-between border-b bg-background px-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarOpen(true)}
              data-testid="mystore-sidebar-toggle"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <h2 className="text-lg font-bold text-foreground">Nuvana</h2>
            <div className="flex-1" />
            <Header variant="controls-only" />
          </div>
        </div>

        {/* Desktop Header */}
        <div className="hidden lg:block">
          <Header variant="full" />
        </div>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto bg-background p-6">{children}</main>
      </div>
    </div>
  );
}
