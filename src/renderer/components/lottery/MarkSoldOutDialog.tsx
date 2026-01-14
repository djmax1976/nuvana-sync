/**
 * Mark Sold Out Dialog Component
 *
 * Story: Lottery Pack Auto-Depletion Feature
 *
 * Confirmation dialog for manually marking a lottery pack as sold out (depleted).
 * This is used when the last ticket has been sold but not yet recorded.
 *
 * @requirements
 * - Display pack details for confirmation
 * - Show warning that action cannot be undone
 * - Require explicit confirmation before marking as sold
 * - Show loading state during API call
 * - Show toast on success/failure
 *
 * MCP Guidance Applied:
 * - SEC-004: XSS - React auto-escapes output
 * - FE-001: STATE_MANAGEMENT - Proper loading/error states
 * - SEC-009: TRANSACTION - Backend handles atomic updates
 */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { usePackDetails, useMarkPackAsSoldOut } from '@/hooks/useLottery';

interface MarkSoldOutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packId: string | null;
  onSuccess?: () => void;
}

/**
 * MarkSoldOutDialog component
 * Confirmation dialog for marking a lottery pack as sold out
 * Displays pack details and requires explicit confirmation
 */
export function MarkSoldOutDialog({
  open,
  onOpenChange,
  packId,
  onSuccess,
}: MarkSoldOutDialogProps) {
  const { toast } = useToast();
  const markSoldOutMutation = useMarkPackAsSoldOut();

  // Fetch pack details when dialog opens and packId is provided
  const {
    data: packData,
    isLoading: isLoadingPack,
    isError: isPackError,
    error: packError,
  } = usePackDetails(packId, { enabled: open && !!packId });

  const handleMarkSoldOut = async () => {
    if (!packId) {
      toast({
        title: 'Error',
        description: 'Pack ID is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      // Pass packId and empty data object for the mutation
      // MCP Guidance: API-001 - Always send valid JSON body for POST requests
      const response = await markSoldOutMutation.mutateAsync({
        packId,
        data: {}, // Empty object - closing_serial defaults to serial_end on backend
      });

      if (response.success) {
        toast({
          title: 'Pack marked as sold out',
          description: `Pack ${packData?.pack_number || packId} has been marked as sold out.`,
        });

        onOpenChange(false);
        onSuccess?.();
      } else {
        throw new Error(response.message || 'Failed to mark pack as sold out');
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to mark pack as sold out';
      toast({
        title: 'Error',
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!markSoldOutMutation.isPending) {
      onOpenChange(newOpen);
    }
  };

  const isProcessing = markSoldOutMutation.isPending;

  // Loading state while fetching pack details
  if (isLoadingPack && open && packId) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Mark Pack as Sold Out</DialogTitle>
            <DialogDescription>Loading pack details...</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Error state if pack details fail to load
  if (isPackError && open && packId) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Mark Pack as Sold Out</DialogTitle>
            <DialogDescription>Failed to load pack details</DialogDescription>
          </DialogHeader>
          <div className="p-4 text-center">
            <p className="text-destructive">{packError?.message || 'Unknown error'}</p>
            <Button variant="outline" onClick={() => handleOpenChange(false)} className="mt-4">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Pack details for display (sanitized via React's automatic escaping)
  const packNumber = packData?.pack_number || 'Unknown';
  const gameName = packData?.game?.name || 'Unknown';
  const binName = packData?.bin?.label || 'N/A';
  const serialEnd = packData?.closing_serial || 'N/A';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto"
        aria-describedby="mark-sold-out-description"
      >
        <DialogHeader>
          <DialogTitle>Mark Pack as Sold Out</DialogTitle>
          <DialogDescription id="mark-sold-out-description">
            Mark this pack as sold out when all tickets have been sold.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4"
            role="alert"
            aria-live="polite"
          >
            <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" aria-hidden="true" />
            <div className="flex-1 space-y-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-500">
                This action cannot be undone
              </p>
              <p className="text-sm text-muted-foreground">
                The pack will be marked as depleted and removed from the active bin. The ending
                serial will be set to the last ticket ({serialEnd}).
              </p>
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Pack Details:</p>
            <div className="rounded-md bg-muted p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pack Number:</span>
                <span className="font-medium font-mono">{packNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Game:</span>
                <span className="font-medium">{gameName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Bin:</span>
                <span className="font-medium">{binName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Last Ticket:</span>
                <span className="font-medium font-mono">{serialEnd}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <span className="font-medium text-green-600">{packData?.status || 'ACTIVE'}</span>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isProcessing}
            className="focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleMarkSoldOut}
            disabled={isProcessing}
            data-testid="confirm-mark-sold-button"
            className="bg-amber-600 hover:bg-amber-700 text-white focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            aria-label={
              isProcessing ? 'Marking pack as sold out...' : `Mark pack ${packNumber} as sold out`
            }
          >
            {isProcessing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <CheckCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Mark as Sold Out
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
