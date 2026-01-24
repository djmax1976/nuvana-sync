/**
 * Employees Page
 *
 * Lists all employees with the ability to add, edit, and manage employee status.
 * Requires store manager role for access.
 *
 * @module renderer/pages/EmployeesPage
 */

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  useEmployees,
  useCreateEmployee,
  useUpdateEmployee,
  useUpdateEmployeePin,
  useDeactivateEmployee,
  useReactivateEmployee,
  type Employee,
} from '../lib/hooks/useEmployees';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '../components/ui/form';
import { Plus, Pencil, Key, UserX, UserCheck, AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '../components/ui/alert';

// ============================================================================
// Validation Schemas
// ============================================================================

const createEmployeeSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    role: z.enum(['cashier', 'shift_manager'], {
      message: 'Please select a role',
    }),
    pin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
    confirmPin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  })
  .refine((data) => data.pin === data.confirmPin, {
    message: 'PINs do not match',
    path: ['confirmPin'],
  });

const updateEmployeeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  role: z.enum(['cashier', 'shift_manager']),
});

const updatePinSchema = z
  .object({
    currentPin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
    newPin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
    confirmPin: z.string().regex(/^\d{4}$/, 'PIN must be exactly 4 digits'),
  })
  .refine((data) => data.newPin === data.confirmPin, {
    message: 'New PINs do not match',
    path: ['confirmPin'],
  });

type CreateEmployeeForm = z.infer<typeof createEmployeeSchema>;
type UpdateEmployeeForm = z.infer<typeof updateEmployeeSchema>;
type UpdatePinForm = z.infer<typeof updatePinSchema>;

// ============================================================================
// Helper Functions
// ============================================================================

function formatRole(role: string): string {
  switch (role) {
    case 'store_manager':
      return 'Store Manager';
    case 'shift_manager':
      return 'Shift Manager';
    case 'cashier':
      return 'Cashier';
    default:
      return role;
  }
}

function getRoleBadgeVariant(role: string): 'default' | 'secondary' | 'outline' {
  switch (role) {
    case 'store_manager':
      return 'default';
    case 'shift_manager':
      return 'secondary';
    default:
      return 'outline';
  }
}

function formatDate(dateString: string | null): string {
  if (!dateString) return 'Never';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ============================================================================
// Main Component
// ============================================================================

export default function EmployeesPage() {
  const { data, isLoading, error, refetch } = useEmployees();
  const createMutation = useCreateEmployee();
  const updateMutation = useUpdateEmployee();
  const updatePinMutation = useUpdateEmployeePin();
  const deactivateMutation = useDeactivateEmployee();
  const reactivateMutation = useReactivateEmployee();

  // Dialog states
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPinDialog, setShowPinDialog] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Forms
  const createForm = useForm<CreateEmployeeForm>({
    resolver: zodResolver(createEmployeeSchema),
    defaultValues: {
      name: '',
      role: 'cashier',
      pin: '',
      confirmPin: '',
    },
  });

  const editForm = useForm<UpdateEmployeeForm>({
    resolver: zodResolver(updateEmployeeSchema),
  });

  const pinForm = useForm<UpdatePinForm>({
    resolver: zodResolver(updatePinSchema),
    defaultValues: {
      currentPin: '',
      newPin: '',
      confirmPin: '',
    },
  });

  // Handlers
  const handleCreate = async (data: CreateEmployeeForm) => {
    setActionError(null);
    try {
      await createMutation.mutateAsync(data);
      setShowAddDialog(false);
      createForm.reset();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to create employee');
    }
  };

  const handleEdit = async (data: UpdateEmployeeForm) => {
    if (!selectedEmployee) return;
    setActionError(null);
    try {
      await updateMutation.mutateAsync({
        userId: selectedEmployee.user_id,
        ...data,
      });
      setShowEditDialog(false);
      setSelectedEmployee(null);
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update employee');
    }
  };

  const handleUpdatePin = async (data: UpdatePinForm) => {
    if (!selectedEmployee) return;
    setActionError(null);
    try {
      await updatePinMutation.mutateAsync({
        userId: selectedEmployee.user_id,
        ...data,
      });
      setShowPinDialog(false);
      setSelectedEmployee(null);
      pinForm.reset();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update PIN');
    }
  };

  const handleToggleStatus = async (employee: Employee) => {
    setActionError(null);
    const action = employee.active ? 'deactivate' : 'reactivate';
    if (!confirm(`Are you sure you want to ${action} ${employee.name}?`)) return;

    try {
      if (employee.active) {
        await deactivateMutation.mutateAsync(employee.user_id);
      } else {
        await reactivateMutation.mutateAsync(employee.user_id);
      }
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${action} employee`);
    }
  };

  const openEditDialog = (employee: Employee) => {
    setSelectedEmployee(employee);
    editForm.reset({
      name: employee.name,
      role: employee.role as 'cashier' | 'shift_manager',
    });
    setShowEditDialog(true);
  };

  const openPinDialog = (employee: Employee) => {
    setSelectedEmployee(employee);
    pinForm.reset();
    setShowPinDialog(true);
  };

  // Render error state
  if (error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {error instanceof Error ? error.message : 'Failed to load employees'}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employees</h1>
          <p className="text-muted-foreground">Manage store employees and their access</p>
        </div>
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Add Employee
        </Button>
      </div>

      {/* Error Alert */}
      {actionError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* Employees Table */}
      <div className="rounded-lg border bg-card">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <LoadingSpinner />
          </div>
        ) : data && data.employees.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.employees.map((employee) => (
                <TableRow key={employee.user_id}>
                  <TableCell className="font-medium">{employee.name}</TableCell>
                  <TableCell>
                    <Badge variant={getRoleBadgeVariant(employee.role)}>
                      {formatRole(employee.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={employee.active ? 'success' : 'destructive'}>
                      {employee.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(employee.last_login_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Store managers cannot be edited via this interface */}
                      {employee.role !== 'store_manager' && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditDialog(employee)}
                            title="Edit employee"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openPinDialog(employee)}
                            title="Change PIN"
                          >
                            <Key className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleToggleStatus(employee)}
                            title={employee.active ? 'Deactivate' : 'Reactivate'}
                          >
                            {employee.active ? (
                              <UserX className="h-4 w-4 text-destructive" />
                            ) : (
                              <UserCheck className="h-4 w-4 text-success" />
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <p>No employees found</p>
            <Button variant="link" onClick={() => setShowAddDialog(true)}>
              Add your first employee
            </Button>
          </div>
        )}
      </div>

      {/* Add Employee Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Employee</DialogTitle>
            <DialogDescription>
              Create a new employee account with a 4-digit PIN for login.
            </DialogDescription>
          </DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit(handleCreate)} className="space-y-4">
              <FormField
                control={createForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter employee name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="cashier">Cashier</SelectItem>
                        <SelectItem value="shift_manager">Shift Manager</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="pin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PIN</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="Enter 4-digit PIN"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={createForm.control}
                name="confirmPin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm PIN</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="Re-enter PIN"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create Employee'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Employee Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Employee</DialogTitle>
            <DialogDescription>Update employee details.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleEdit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter employee name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="cashier">Cashier</SelectItem>
                        <SelectItem value="shift_manager">Shift Manager</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowEditDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Change PIN Dialog */}
      <Dialog open={showPinDialog} onOpenChange={setShowPinDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change PIN</DialogTitle>
            <DialogDescription>
              {selectedEmployee && `Change PIN for ${selectedEmployee.name}`}
            </DialogDescription>
          </DialogHeader>
          <Form {...pinForm}>
            <form onSubmit={pinForm.handleSubmit(handleUpdatePin)} className="space-y-4">
              <FormField
                control={pinForm.control}
                name="currentPin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Current PIN</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="Enter current PIN"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={pinForm.control}
                name="newPin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>New PIN</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="Enter new 4-digit PIN"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={pinForm.control}
                name="confirmPin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm New PIN</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="Re-enter new PIN"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setShowPinDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updatePinMutation.isPending}>
                  {updatePinMutation.isPending ? 'Updating...' : 'Update PIN'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
