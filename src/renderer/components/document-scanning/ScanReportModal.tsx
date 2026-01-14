/**
 * Scan Report Modal Component
 *
 * Modal dialog for scanning/uploading lottery reports and other documents.
 * Handles image capture (camera or file upload), sends to backend OCR API,
 * and displays verification dialog for extracted data.
 *
 * Features:
 * - Camera capture (mobile devices)
 * - File upload (desktop)
 * - Image preview before processing
 * - OCR processing with loading state
 * - Error handling and retry
 *
 * @security FE-001: STATE_MANAGEMENT - Secure state handling
 * @security FE-002: FORM_VALIDATION - File validation (type, size)
 * @security SEC-015: FILE_SECURITY - MIME type and magic byte validation on backend
 */

import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Camera, Upload, RotateCcw, Loader2, AlertCircle, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Types from document-scanning.types.ts
export interface LotteryWizardFields {
  onlineSales: number;
  onlineCashes: number;
  instantCashes: number;
}

export interface DocumentScanResult {
  success: boolean;
  documentId: string;
  documentType: string;
  status: string;
  ocrResult?: {
    confidence: number;
    rawTextLength: number;
    wizardFields?: LotteryWizardFields;
    fieldConfidence?: Record<string, number>;
    reportDate?: string;
  };
  dateValidation?: {
    isValid: boolean;
    expectedDate: string;
    reportDate?: string;
    errorMessage?: string;
  };
  processingTimeMs: number;
  warnings: string[];
}

interface ScanReportModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal should close */
  onOpenChange: (open: boolean) => void;
  /** Store ID for RLS context */
  storeId: string;
  /** Business date for validation */
  businessDate: string;
  /** Document type being scanned */
  documentType: 'LOTTERY_SALES_REPORT' | 'LOTTERY_INVOICE_REPORT' | 'GAMING_REPORT';
  /** Callback when scan completes successfully with verified data */
  onScanComplete: (wizardFields: LotteryWizardFields) => void;
  /** Optional shift context */
  shiftId?: string;
  /** Optional day summary context */
  daySummaryId?: string;
  /** Optional lottery day context */
  lotteryDayId?: string;
}

// Allowed MIME types matching backend validation
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

// Maximum file size (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Backend URL for API calls
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

type ScanState = 'idle' | 'previewing' | 'processing' | 'verifying' | 'error';

export function ScanReportModal({
  open,
  onOpenChange,
  storeId,
  businessDate,
  documentType,
  onScanComplete,
  shiftId,
  daySummaryId,
  lotteryDayId,
}: ScanReportModalProps) {
  // State
  const [state, setState] = useState<ScanState>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<DocumentScanResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  /**
   * Reset modal state to initial values
   */
  const resetState = useCallback(() => {
    setState('idle');
    setSelectedFile(null);
    setPreviewUrl(null);
    setScanResult(null);
    setErrorMessage(null);
    // Revoke object URL to prevent memory leaks
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  /**
   * Handle modal close - cleanup and reset
   */
  const handleClose = useCallback(() => {
    resetState();
    onOpenChange(false);
  }, [resetState, onOpenChange]);

  /**
   * Validate selected file
   * @security FE-002: FORM_VALIDATION - Validate file type and size
   */
  const validateFile = useCallback((file: File): string | null => {
    // Check MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type as (typeof ALLOWED_MIME_TYPES)[number])) {
      return `Invalid file type: ${file.type}. Allowed types: JPEG, PNG, WebP`;
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      return `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 10MB`;
    }

    return null;
  }, []);

  /**
   * Handle file selection (from file picker or camera)
   */
  const handleFileSelect = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      // Validate file
      const validationError = validateFile(file);
      if (validationError) {
        setErrorMessage(validationError);
        setState('error');
        return;
      }

      // Create preview URL
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setSelectedFile(file);
      setState('previewing');
      setErrorMessage(null);

      // Reset input so same file can be selected again
      event.target.value = '';
    },
    [validateFile]
  );

  /**
   * Convert file to base64 for API submission
   */
  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        // Remove data URL prefix to get pure base64
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  }, []);

  /**
   * Submit document for OCR processing
   */
  const handleProcessDocument = useCallback(async () => {
    if (!selectedFile) return;

    setState('processing');
    setErrorMessage(null);

    try {
      // Convert to base64
      const imageData = await fileToBase64(selectedFile);

      // Submit to API
      const response = await fetch(`${BACKEND_URL}/api/documents/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Include auth cookies
        body: JSON.stringify({
          storeId,
          documentType,
          imageData,
          filename: selectedFile.name,
          mimeType: selectedFile.type,
          fileSizeBytes: selectedFile.size,
          businessDate,
          shiftId,
          daySummaryId,
          lotteryDayId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || 'Failed to process document');
      }

      // Check if OCR succeeded
      if (!result.success) {
        throw new Error(result.message || 'Document scanning failed');
      }

      // Store result and move to verification
      setScanResult(result);
      setState('verifying');
    } catch (error) {
      console.error('[ScanReportModal] OCR processing error:', error);
      setErrorMessage(error instanceof Error ? error.message : 'An unexpected error occurred');
      setState('error');
    }
  }, [
    selectedFile,
    storeId,
    documentType,
    businessDate,
    shiftId,
    daySummaryId,
    lotteryDayId,
    fileToBase64,
  ]);

  /**
   * Handle verification confirmation
   */
  const handleConfirmVerification = useCallback(
    (wizardFields: LotteryWizardFields) => {
      // Submit verification to backend (for audit trail)
      if (scanResult) {
        fetch(`${BACKEND_URL}/api/documents/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            documentId: scanResult.documentId,
            confirmedWizardFields: wizardFields,
            action: 'accept',
          }),
        }).catch(console.error); // Fire and forget for audit
      }

      // Pass verified data to parent
      onScanComplete(wizardFields);
      handleClose();
    },
    [scanResult, onScanComplete, handleClose]
  );

  /**
   * Handle verification rejection
   */
  const handleRejectVerification = useCallback(() => {
    // Submit rejection to backend (for audit trail)
    if (scanResult) {
      fetch(`${BACKEND_URL}/api/documents/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          documentId: scanResult.documentId,
          confirmedWizardFields: {
            onlineSales: 0,
            onlineCashes: 0,
            instantCashes: 0,
          },
          action: 'reject',
          rejectionReason: 'User rejected OCR results',
        }),
      }).catch(console.error);
    }

    // Return to idle state for retry
    resetState();
  }, [scanResult, resetState]);

  // Render content based on state
  const renderContent = () => {
    switch (state) {
      case 'idle':
        return (
          <div className="space-y-4">
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
              <Camera className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">
                Take a photo or upload an image of your lottery report
              </p>
              <div className="flex justify-center gap-4">
                {/* Camera capture - shows on mobile */}
                <Button
                  variant="outline"
                  onClick={() => cameraInputRef.current?.click()}
                  className="md:hidden"
                  data-testid="scan-camera-btn"
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Take Photo
                </Button>

                {/* File upload */}
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="scan-upload-btn"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Image
                </Button>
              </div>
            </div>

            {/* Hidden file inputs */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="scan-camera-input"
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileSelect}
              data-testid="scan-file-input"
            />

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                For best results, ensure the report is well-lit and the text is clearly visible. The
                report date will be validated against: <strong>{businessDate}</strong>
              </AlertDescription>
            </Alert>
          </div>
        );

      case 'previewing':
        return (
          <div className="space-y-4">
            {/* Image preview */}
            <div className="relative aspect-[4/3] bg-muted rounded-lg overflow-hidden">
              {previewUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Document preview"
                  className="w-full h-full object-contain"
                  data-testid="scan-preview-image"
                />
              )}
            </div>

            {/* File info */}
            {selectedFile && (
              <div className="text-sm text-muted-foreground text-center">
                {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-center gap-4">
              <Button variant="outline" onClick={resetState} data-testid="scan-retake-btn">
                <RotateCcw className="mr-2 h-4 w-4" />
                Retake
              </Button>
              <Button onClick={handleProcessDocument} data-testid="scan-process-btn">
                <Check className="mr-2 h-4 w-4" />
                Process Document
              </Button>
            </div>
          </div>
        );

      case 'processing':
        return (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">Processing document...</p>
            <p className="text-sm text-muted-foreground mt-2">
              Extracting text and validating report data
            </p>
          </div>
        );

      case 'verifying':
        return (
          <OCRVerificationView
            scanResult={scanResult!}
            previewUrl={previewUrl}
            onConfirm={handleConfirmVerification}
            onReject={handleRejectVerification}
          />
        );

      case 'error':
        return (
          <div className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {errorMessage || 'An error occurred while processing the document'}
              </AlertDescription>
            </Alert>

            <div className="flex justify-center gap-4">
              <Button variant="outline" onClick={resetState} data-testid="scan-retry-btn">
                <RotateCcw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          'max-w-2xl',
          // Use wider modal in verification state for side-by-side comparison
          state === 'verifying' && 'max-w-4xl'
        )}
      >
        <DialogHeader>
          <DialogTitle>Scan Lottery Report</DialogTitle>
          <DialogDescription>
            {state === 'verifying'
              ? 'Review and confirm the extracted data'
              : 'Capture or upload your lottery sales report for automatic data extraction'}
          </DialogDescription>
        </DialogHeader>

        {renderContent()}
      </DialogContent>
    </Dialog>
  );
}

// ============ OCR VERIFICATION VIEW ============

interface OCRVerificationViewProps {
  scanResult: DocumentScanResult;
  previewUrl: string | null;
  onConfirm: (wizardFields: LotteryWizardFields) => void;
  onReject: () => void;
}

/**
 * Side-by-side verification component
 * Shows scanned image next to extracted data for user verification
 */
function OCRVerificationView({
  scanResult,
  previewUrl,
  onConfirm,
  onReject,
}: OCRVerificationViewProps) {
  // Extract wizard fields or use defaults
  const extractedFields = scanResult.ocrResult?.wizardFields ?? {
    onlineSales: 0,
    onlineCashes: 0,
    instantCashes: 0,
  };

  // Editable state for corrections
  const [editedFields, setEditedFields] = useState<LotteryWizardFields>(extractedFields);

  // Field confidence scores
  const fieldConfidence = scanResult.ocrResult?.fieldConfidence ?? {};

  // Date validation
  const dateValidation = scanResult.dateValidation;
  const hasDateWarning = dateValidation && !dateValidation.isValid;

  // Warnings
  const warnings = scanResult.warnings ?? [];

  /**
   * Handle field edit
   */
  const handleFieldChange = (field: keyof LotteryWizardFields, value: string) => {
    const numValue = parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
    setEditedFields((prev) => ({ ...prev, [field]: numValue }));
  };

  /**
   * Get confidence color class
   */
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-600';
    if (confidence >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  /**
   * Format currency for display
   */
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  };

  return (
    <div className="space-y-4">
      {/* Date warning alert */}
      {hasDateWarning && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Date Mismatch:</strong> {dateValidation?.errorMessage}
          </AlertDescription>
        </Alert>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <ul className="list-disc list-inside text-sm">
              {warnings.map((warning, idx) => (
                <li key={idx}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {/* Side by side layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Image preview (left side) */}
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Scanned Document</h4>
          <div className="min-h-[300px] max-h-[500px] bg-muted rounded-lg overflow-hidden border flex items-center justify-center">
            {previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Scanned document"
                className="max-w-full max-h-[480px] object-contain"
                data-testid="verification-image"
              />
            )}
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Confidence: {scanResult.ocrResult?.confidence?.toFixed(0) ?? 0}%</span>
            <span>Processed in {scanResult.processingTimeMs}ms</span>
          </div>
        </div>

        {/* Extracted data (right side) */}
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Extracted Data</h4>
          <div className="border rounded-lg p-4 space-y-4">
            {/* Online Sales */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Online Sales</label>
                <span
                  className={cn('text-xs', getConfidenceColor(fieldConfidence.onlineSales ?? 0))}
                >
                  {fieldConfidence.onlineSales?.toFixed(0) ?? 0}% confident
                </span>
              </div>
              <input
                type="text"
                value={editedFields.onlineSales || ''}
                onChange={(e) => handleFieldChange('onlineSales', e.target.value)}
                className="w-full px-3 py-2 border rounded-md font-mono text-right"
                data-testid="verify-online-sales"
              />
            </div>

            {/* Online Cashes */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Online Cashes</label>
                <span
                  className={cn('text-xs', getConfidenceColor(fieldConfidence.onlineCashes ?? 0))}
                >
                  {fieldConfidence.onlineCashes?.toFixed(0) ?? 0}% confident
                </span>
              </div>
              <input
                type="text"
                value={editedFields.onlineCashes || ''}
                onChange={(e) => handleFieldChange('onlineCashes', e.target.value)}
                className="w-full px-3 py-2 border rounded-md font-mono text-right"
                data-testid="verify-online-cashes"
              />
            </div>

            {/* Instant Cashes */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Instant Cashes</label>
                <span
                  className={cn('text-xs', getConfidenceColor(fieldConfidence.instantCashes ?? 0))}
                >
                  {fieldConfidence.instantCashes?.toFixed(0) ?? 0}% confident
                </span>
              </div>
              <input
                type="text"
                value={editedFields.instantCashes || ''}
                onChange={(e) => handleFieldChange('instantCashes', e.target.value)}
                className="w-full px-3 py-2 border rounded-md font-mono text-right"
                data-testid="verify-instant-cashes"
              />
            </div>

            {/* Summary */}
            <div className="border-t pt-3 mt-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Sales</span>
                <span className="font-medium">{formatCurrency(editedFields.onlineSales)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Cashes</span>
                <span className="font-medium text-destructive">
                  {formatCurrency(-(editedFields.onlineCashes + editedFields.instantCashes))}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-4 pt-4 border-t">
        <Button variant="outline" onClick={onReject} data-testid="verify-reject-btn">
          <X className="mr-2 h-4 w-4" />
          Reject & Retry
        </Button>
        <Button onClick={() => onConfirm(editedFields)} data-testid="verify-confirm-btn">
          <Check className="mr-2 h-4 w-4" />
          Confirm Values
        </Button>
      </div>
    </div>
  );
}
