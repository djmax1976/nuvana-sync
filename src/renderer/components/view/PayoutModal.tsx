/**
 * PayoutModal Component
 *
 * Modal for displaying payout details:
 * - Cash: List of individual payouts with images
 * - Lottery/Gaming: Image viewer with zoom controls
 *
 * @module src/renderer/components/view/PayoutModal
 * @security FE-001: Uses JSX auto-escaping, no dangerouslySetInnerHTML
 * @security SEC-004: All content rendered via text nodes, XSS-safe
 * @security SEC-014: Image URL validation to prevent javascript: protocol
 */

import * as React from 'react';
import { X, CircleDollarSign, Ticket, Gamepad2, ImageIcon, ZoomIn, ZoomOut } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';

/* ============================================================================
   TYPES
   ============================================================================ */

export type PayoutModalType = 'cash' | 'lottery' | 'gaming';

export interface CashPayoutItem {
  id: string;
  description: string;
  amount: number;
  timestamp: string;
  /** Thumbnail image URL (validated before rendering) */
  imageUrl?: string | null;
}

export interface CashPayoutsData {
  type: 'cash';
  payouts: CashPayoutItem[];
  totalAmount: number;
}

export interface ImagePayoutData {
  type: 'lottery' | 'gaming';
  /** Full image URL (validated before rendering) */
  imageUrl?: string | null;
  imageName?: string;
  totalAmount: number;
  scannedAt?: string;
}

export type PayoutModalData = CashPayoutsData | ImagePayoutData;

export interface PayoutModalProps {
  /** Type of payout modal */
  type: PayoutModalType;
  /** Payout data to display */
  data: PayoutModalData;
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Optional callback when image is clicked for full view */
  onImageClick?: (imageUrl: string) => void;
  /** Optional data-testid override */
  'data-testid'?: string;
}

/* ============================================================================
   UTILITIES
   ============================================================================ */

/**
 * Validates that an image URL is safe (no javascript: protocol)
 * SEC-014: Input validation for image URLs
 */
function isValidImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  // Block javascript: and data: protocols except data:image
  if (trimmed.startsWith('javascript:')) return false;
  if (trimmed.startsWith('data:') && !trimmed.startsWith('data:image/')) return false;
  return true;
}

/* ============================================================================
   TYPE ICONS
   ============================================================================ */

const typeIcons: Record<PayoutModalType, React.ReactNode> = {
  cash: <CircleDollarSign className="w-5 h-5" />,
  lottery: <Ticket className="w-5 h-5" />,
  gaming: <Gamepad2 className="w-5 h-5" />,
};

const typeLabels: Record<PayoutModalType, string> = {
  cash: 'Cash Payouts',
  lottery: 'Lottery Report',
  gaming: 'Gaming Report',
};

const typeBgClasses: Record<PayoutModalType, string> = {
  cash: 'bg-red-950 text-red-400',
  lottery: 'bg-emerald-950 text-emerald-400',
  gaming: 'bg-violet-950 text-violet-400',
};

const typeGradientClasses: Record<PayoutModalType, string> = {
  cash: 'from-red-950/50 to-slate-900',
  lottery: 'from-emerald-950/50 to-slate-900',
  gaming: 'from-violet-950/50 to-slate-900',
};

/* ============================================================================
   CASH PAYOUT LIST COMPONENT
   ============================================================================ */

interface CashPayoutListProps {
  payouts: CashPayoutItem[];
  onImageClick?: (imageUrl: string) => void;
  testId: string;
}

const CashPayoutList = React.memo(function CashPayoutList({
  payouts,
  onImageClick,
  testId,
}: CashPayoutListProps) {
  return (
    <div className="space-y-3" data-testid={testId}>
      {payouts.map((payout) => (
        <div
          key={payout.id}
          className="flex items-center gap-4 p-3 rounded-xl bg-slate-800/50 border border-border hover:bg-slate-800 transition-colors"
          data-testid={`${testId}-item-${payout.id}`}
        >
          {/* Image Thumbnail */}
          <div
            className={cn(
              'w-12 h-12 rounded-lg bg-slate-700 flex items-center justify-center overflow-hidden',
              isValidImageUrl(payout.imageUrl)
                ? 'cursor-pointer hover:ring-2 ring-cyan-500 transition-all'
                : ''
            )}
            onClick={() => {
              if (isValidImageUrl(payout.imageUrl) && onImageClick) {
                onImageClick(payout.imageUrl!);
              }
            }}
            role={isValidImageUrl(payout.imageUrl) ? 'button' : undefined}
            tabIndex={isValidImageUrl(payout.imageUrl) ? 0 : undefined}
            aria-label={isValidImageUrl(payout.imageUrl) ? 'View full image' : undefined}
          >
            {isValidImageUrl(payout.imageUrl) ? (
              <img
                src={payout.imageUrl!}
                alt={`Payout receipt for ${payout.description}`}
                className="w-full h-full object-cover"
                data-testid={`${testId}-image-${payout.id}`}
              />
            ) : (
              <ImageIcon className="w-6 h-6 text-slate-400" />
            )}
          </div>

          {/* Details */}
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{payout.description}</p>
            <p className="text-xs text-muted-foreground">{payout.timestamp}</p>
          </div>

          {/* Amount */}
          <div className="text-right">
            <p className="font-mono font-semibold text-red-400">{formatCurrency(payout.amount)}</p>
          </div>
        </div>
      ))}
    </div>
  );
});

/* ============================================================================
   IMAGE VIEWER COMPONENT
   ============================================================================ */

interface ImageViewerProps {
  imageUrl?: string | null;
  imageName?: string;
  testId: string;
}

const ImageViewer = React.memo(function ImageViewer({
  imageUrl,
  imageName,
  testId,
}: ImageViewerProps) {
  const [zoom, setZoom] = React.useState(1);
  const hasValidImage = isValidImageUrl(imageUrl);

  const handleZoomIn = React.useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.25, 3));
  }, []);

  const handleZoomOut = React.useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

  return (
    <div
      className="relative w-full max-w-2xl aspect-[3/4] bg-slate-800 rounded-xl border border-border flex items-center justify-center mx-auto overflow-hidden"
      data-testid={testId}
    >
      {hasValidImage ? (
        <img
          src={imageUrl!}
          alt={imageName || 'Report image'}
          className="max-w-full max-h-full object-contain transition-transform duration-200"
          style={{ transform: `scale(${zoom})` }}
          data-testid={`${testId}-image`}
        />
      ) : (
        <div className="text-center p-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-slate-700/50 flex items-center justify-center">
            <ImageIcon className="w-10 h-10 text-slate-500" />
          </div>
          <p className="text-muted-foreground text-sm">{imageName || 'No image available'}</p>
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex gap-2" data-testid={`${testId}-zoom-controls`}>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleZoomIn}
          disabled={zoom >= 3}
          className="bg-slate-800/80 border border-border hover:bg-slate-700"
          aria-label="Zoom in"
          data-testid={`${testId}-zoom-in`}
        >
          <ZoomIn className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={handleZoomOut}
          disabled={zoom <= 0.5}
          className="bg-slate-800/80 border border-border hover:bg-slate-700"
          aria-label="Zoom out"
          data-testid={`${testId}-zoom-out`}
        >
          <ZoomOut className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
});

/* ============================================================================
   MAIN COMPONENT
   ============================================================================ */

export const PayoutModal = React.memo(function PayoutModal({
  type,
  data,
  isOpen,
  onClose,
  onImageClick,
  'data-testid': testId = 'payout-modal',
}: PayoutModalProps) {
  // Handle Escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const isCashType = data.type === 'cash';
  const subtitle = isCashType
    ? `${(data as CashPayoutsData).payouts.length} payouts recorded`
    : (data as ImagePayoutData).scannedAt
      ? `Scanned on ${(data as ImagePayoutData).scannedAt}`
      : 'Report image';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden p-0"
        data-testid={testId}
      >
        {/* Header */}
        <DialogHeader
          className={cn('p-4 border-b border-border bg-gradient-to-r', typeGradientClasses[type])}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center',
                  typeBgClasses[type]
                )}
              >
                {typeIcons[type]}
              </span>
              <div>
                <DialogTitle className="text-lg font-semibold">{typeLabels[type]}</DialogTitle>
                <p className="text-xs text-muted-foreground" data-testid={`${testId}-subtitle`}>
                  {subtitle}
                </p>
              </div>
            </div>
            {!isCashType && (
              <span
                className="text-lg font-bold font-mono text-red-400"
                data-testid={`${testId}-header-amount`}
              >
                ({formatCurrency(Math.abs(data.totalAmount))})
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4" data-testid={`${testId}-content`}>
          {isCashType ? (
            <CashPayoutList
              payouts={(data as CashPayoutsData).payouts}
              onImageClick={onImageClick}
              testId={`${testId}-list`}
            />
          ) : (
            <div className="flex items-center justify-center bg-slate-950/50 rounded-xl p-4">
              <ImageViewer
                imageUrl={(data as ImagePayoutData).imageUrl}
                imageName={(data as ImagePayoutData).imageName}
                testId={`${testId}-viewer`}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="p-4 border-t border-border bg-slate-900/80"
          data-testid={`${testId}-footer`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {isCashType ? 'Total Payouts' : 'Total Amount'}
            </span>
            <span
              className="text-xl font-bold font-mono text-red-400"
              data-testid={`${testId}-total`}
            >
              ({formatCurrency(Math.abs(data.totalAmount))})
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
});

PayoutModal.displayName = 'PayoutModal';

export default PayoutModal;
