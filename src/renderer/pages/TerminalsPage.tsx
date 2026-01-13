/**
 * Terminals Page
 *
 * Shows shift management for the store. Since this is a standalone
 * desktop app, we display shifts grouped by register rather than
 * physical terminals.
 *
 * Route: /terminals
 *
 * @module renderer/pages/TerminalsPage
 * @security SEC-014: Uses IPC layer for data access
 */

import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Monitor, Loader2, AlertCircle, Clock, User } from 'lucide-react';
import { storesAPI, shiftsAPI, type Shift } from '../lib/api/ipc-client';

/**
 * Group shifts by register_id to simulate terminals
 */
interface RegisterWithShifts {
  register_id: string;
  name: string;
  activeShift: Shift | null;
  todayShifts: Shift[];
}

/**
 * Register card component displaying register info and shift status
 */
function RegisterCard({ register }: { register: RegisterWithShifts }) {
  const navigate = useNavigate();

  const handleViewShifts = () => {
    // Navigate to shifts page with register filter
    navigate('/shifts', { state: { registerId: register.register_id } });
  };

  const handleViewActiveShift = () => {
    if (register.activeShift) {
      navigate(`/shifts/${register.activeShift.shift_id}`);
    }
  };

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {register.name}
          </CardTitle>
          {register.activeShift ? (
            <Badge variant="default" className="bg-green-600">
              Shift Open
            </Badge>
          ) : (
            <Badge variant="secondary">No Active Shift</Badge>
          )}
        </div>
        <CardDescription className="text-xs">
          Register ID: {register.register_id}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {register.activeShift && (
          <div className="space-y-2 mb-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              <span>
                Shift #{register.activeShift.shift_number} - Started{' '}
                {register.activeShift.start_time
                  ? new Date(register.activeShift.start_time).toLocaleTimeString()
                  : 'N/A'}
              </span>
            </div>
            {register.activeShift.cashier_id && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <User className="h-4 w-4" />
                <span>Cashier ID: {register.activeShift.cashier_id}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {register.activeShift ? (
            <Button
              onClick={handleViewActiveShift}
              className="flex-1"
              variant="default"
            >
              View Active Shift
            </Button>
          ) : (
            <Button
              onClick={handleViewShifts}
              className="flex-1"
              variant="outline"
            >
              View Shift History
            </Button>
          )}
        </div>

        {register.todayShifts.length > 0 && (
          <p className="text-xs text-muted-foreground mt-3 text-center">
            {register.todayShifts.length} shift
            {register.todayShifts.length !== 1 ? 's' : ''} today
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Process shifts into register groups
 */
function processShiftsIntoRegisters(shifts: Shift[]): RegisterWithShifts[] {
  const today = new Date().toISOString().split('T')[0];
  const registerMap = new Map<string, RegisterWithShifts>();

  // Group shifts by register_id
  for (const shift of shifts) {
    const registerId = shift.register_id || 'default';

    if (!registerMap.has(registerId)) {
      registerMap.set(registerId, {
        register_id: registerId,
        name: registerId === 'default' ? 'Main Register' : `Register ${registerId}`,
        activeShift: null,
        todayShifts: [],
      });
    }

    const register = registerMap.get(registerId)!;

    // Check if this is an active shift
    if (shift.status === 'OPEN') {
      register.activeShift = shift;
    }

    // Check if this is a today's shift
    if (shift.business_date === today) {
      register.todayShifts.push(shift);
    }
  }

  // If no registers found, create a default one
  if (registerMap.size === 0) {
    registerMap.set('default', {
      register_id: 'default',
      name: 'Main Register',
      activeShift: null,
      todayShifts: [],
    });
  }

  return Array.from(registerMap.values()).sort((a, b) =>
    a.register_id.localeCompare(b.register_id)
  );
}

export default function TerminalsPage() {
  // Get store info via IPC
  const {
    data: storeInfo,
    isLoading: storeLoading,
    isError: storeError,
  } = useQuery({
    queryKey: ['stores', 'info'],
    queryFn: () => storesAPI.getInfo(),
    retry: 1,
  });

  // Get today's shifts to show on terminals
  const today = new Date().toISOString().split('T')[0];
  const {
    data: shiftsData,
    isLoading: shiftsLoading,
    isError: shiftsError,
  } = useQuery({
    queryKey: ['shifts', 'list', { startDate: today }],
    queryFn: () => shiftsAPI.list({ startDate: today, endDate: today, limit: 100 }),
    retry: 1,
  });

  // Loading state
  if (storeLoading || shiftsLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading registers...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (storeError || shiftsError) {
    return (
      <div className="space-y-6" data-testid="terminals-page">
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <p>Failed to load register data. Please try again.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Process shifts into registers
  const registers = processShiftsIntoRegisters(shiftsData?.shifts || []);

  // Count active shifts
  const activeShiftCount = registers.filter((r) => r.activeShift !== null).length;

  const storeName = storeInfo?.name || 'Store';

  return (
    <div className="space-y-6" data-testid="terminals-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Monitor className="h-6 w-6" />
            Registers
          </h1>
          <p className="text-muted-foreground mt-1">
            {storeName} - {registers.length} register
            {registers.length !== 1 ? 's' : ''}
            {activeShiftCount > 0 && (
              <span className="ml-2 text-green-600">
                ({activeShiftCount} active shift
                {activeShiftCount !== 1 ? 's' : ''})
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Registers Grid */}
      {registers.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground text-center">
              No registers configured. Shifts will appear here once data is synced.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {registers.map((register) => (
            <RegisterCard key={register.register_id} register={register} />
          ))}
        </div>
      )}
    </div>
  );
}
