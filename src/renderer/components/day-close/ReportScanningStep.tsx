
/**
 * Report Scanning Step Component
 *
 * Shared component used by both Shift Close (Step 1) and Day Close (Step 2) wizards.
 * Allows users to enter vendor invoices and reports for data extraction.
 *
 * Report Categories:
 * - Lottery Reports: Daily lottery settlement (instant sales, online sales, cashes)
 * - Gaming Reports: Video gaming terminal daily report
 * - Vendor Invoices: Delivery invoices received today
 * - Cash Payouts: Lottery winners, money orders, check cashing
 *
 * @usage
 * - Shift Close: Used as Step 1 (no prior lottery step)
 * - Day Close: Used as Step 2 (after lottery close step)
 *
 * @security
 * - FE-001: STATE_MANAGEMENT - Secure state with useCallback/useMemo
 * - FE-002: FORM_VALIDATION - Input validation for numeric fields
 * - SEC-014: INPUT_VALIDATION - Sanitize all user inputs
 */

import { useState, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Play,
  ClipboardList,
  DollarSign,
  Camera,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ScanReportModal,
  LotteryWizardFields,
} from "@/components/document-scanning";

// ============ TYPES ============

/**
 * Lottery Reports Data Structure
 *
 * Represents the daily lottery settlement report data from the terminal.
 * Field order follows the physical report layout for UX consistency.
 *
 * @security SEC-014: INPUT_VALIDATION - All numeric fields validated via sanitizeNumericInput
 * @security FE-002: FORM_VALIDATION - Field values sanitized before state updates
 */
export interface LotteryReportsData {
  /** Instant (scratch-off) ticket sales for the day */
  instantSales: number;
  /** Instant ticket cashes/redemptions (payouts for scratch-off winners) */
  instantCashes: number;
  /** Online lottery sales for the day */
  onlineSales: number;
  /** Online lottery cashes/redemptions (payouts for online lottery winners) */
  onlineCashes: number;
}

export interface GamingReportsData {
  netTerminalIncome: number;
  plays: number;
  payouts: number;
}

export interface VendorInvoice {
  id: string;
  vendorName: string;
  amount: number;
}

export interface CashPayoutsData {
  lotteryWinners: number;
  moneyOrders: number;
  checkCashing: number;
}

export interface ReportScanningState {
  lotteryReports: LotteryReportsData | null;
  gamingReports: GamingReportsData | null;
  vendorInvoices: VendorInvoice[];
  cashPayouts: CashPayoutsData | null;
}

interface ReportScanningStepProps {
  storeId: string;
  onComplete: (data: ReportScanningState) => void;
  onBack: () => void;
  canGoBack: boolean;
  initialData: ReportScanningState | null;
  /** Business date for OCR validation (YYYY-MM-DD format) */
  businessDate?: string;
  /** Optional shift context for traceability */
  shiftId?: string;
  /** Optional day summary context for traceability */
  daySummaryId?: string;
  /** Optional lottery day context for traceability */
  lotteryDayId?: string;
}

// ============ HELPER FUNCTIONS ============

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function sanitizeNumericInput(value: string): number {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

// ============ REPORT SECTION COMPONENT ============

/**
 * Props for the ReportSection component
 *
 * @security FE-005: UI_SECURITY - No sensitive data in props, display only
 */
interface ReportSectionProps {
  /** Section title displayed in header */
  title: string;
  /** Description text shown below title */
  description: string;
  /** Icon element to display in colored background */
  icon: React.ReactNode;
  /** Background color class for icon container */
  iconBgColor: string;
  /** Current status of the section */
  status: "pending" | "scanned" | "recorded";
  /** Optional count to display with status (e.g., "3 Scanned") */
  statusCount?: number;
  /** Content to render inside the section */
  children: React.ReactNode;
  /** Optional callback for scan button - if provided, shows "Scan Report" button */
  onScanReport?: () => void;
  /** Whether to show the scan report button */
  showScanButton?: boolean;
}

/**
 * ReportSection Component
 *
 * Reusable section container for report categories with status badge and optional scan button.
 * Displays icon, title, description, action button, and status in a consistent layout.
 *
 * @security FE-005: UI_SECURITY - Display-only component, no sensitive data handling
 * @security SEC-004: XSS - React auto-escapes all text content
 */
function ReportSection({
  title,
  description,
  icon,
  iconBgColor,
  status,
  statusCount,
  children,
  onScanReport,
  showScanButton = false,
}: ReportSectionProps) {
  const statusLabel =
    status === "scanned"
      ? statusCount
        ? `${statusCount} Scanned`
        : "Scanned"
      : status === "recorded"
        ? "Recorded"
        : "Pending";

  const statusColor =
    status === "pending"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300";

  return (
    <div
      className="border rounded-lg p-4"
      data-testid={`report-section-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              iconBgColor,
            )}
            aria-hidden="true"
          >
            {icon}
          </div>
          <div>
            <h3 className="font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Scan Report Button - positioned before status badge */}
          {showScanButton && onScanReport && (
            <Button
              variant="outline"
              size="sm"
              onClick={onScanReport}
              className="text-xs h-7 px-2"
              data-testid={`scan-report-btn-${title.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <Camera className="mr-1 h-3 w-3" />
              Scan Report
            </Button>
          )}
          <Badge className={statusColor}>{statusLabel}</Badge>
        </div>
      </div>
      {children}
    </div>
  );
}

// ============ MAIN COMPONENT ============

export function ReportScanningStep({
  storeId,
  onComplete,
  onBack,
  canGoBack,
  initialData,
  businessDate,
  shiftId,
  daySummaryId,
  lotteryDayId,
}: ReportScanningStepProps) {
  // ============ STATE ============
  /**
   * Lottery reports state with proper initialization
   * @security SEC-014: INPUT_VALIDATION - Default values are safe numbers
   */
  const [lotteryReports, setLotteryReports] = useState<LotteryReportsData>(
    initialData?.lotteryReports ?? {
      instantSales: 0,
      instantCashes: 0,
      onlineSales: 0,
      onlineCashes: 0,
    },
  );

  // State for scan modal
  const [scanModalOpen, setScanModalOpen] = useState(false);

  const [gamingReports, setGamingReports] = useState<GamingReportsData>(
    initialData?.gamingReports ?? {
      netTerminalIncome: 0,
      plays: 0,
      payouts: 0,
    },
  );

  const [vendorInvoices, setVendorInvoices] = useState<VendorInvoice[]>(
    initialData?.vendorInvoices ?? [],
  );

  const [cashPayouts, setCashPayouts] = useState<CashPayoutsData>(
    initialData?.cashPayouts ?? {
      lotteryWinners: 0,
      moneyOrders: 0,
      checkCashing: 0,
    },
  );

  // Track which sections have been "scanned" (have data)
  // A section is considered "scanned" when any field has a non-zero value
  const lotteryScanned =
    lotteryReports.instantSales > 0 ||
    lotteryReports.instantCashes > 0 ||
    lotteryReports.onlineSales > 0 ||
    lotteryReports.onlineCashes > 0;

  const gamingScanned =
    gamingReports.netTerminalIncome > 0 ||
    gamingReports.plays > 0 ||
    gamingReports.payouts > 0;

  const cashPayoutsRecorded =
    cashPayouts.lotteryWinners > 0 ||
    cashPayouts.moneyOrders > 0 ||
    cashPayouts.checkCashing > 0;

  // ============ CALCULATED VALUES ============
  /**
   * Total lottery sales (instant + online)
   * @security SEC-014: INPUT_VALIDATION - Values already sanitized on input
   */
  const totalLotterySales = useMemo(
    () => lotteryReports.instantSales + lotteryReports.onlineSales,
    [lotteryReports],
  );

  /**
   * Total lottery payouts/cashes (instant cashes + online cashes)
   * Used for display in summary section
   */
  const totalLotteryCashes = useMemo(
    () => lotteryReports.instantCashes + lotteryReports.onlineCashes,
    [lotteryReports],
  );

  const totalVendorInvoices = useMemo(
    () => vendorInvoices.reduce((sum, inv) => sum + inv.amount, 0),
    [vendorInvoices],
  );

  // ============ HANDLERS ============
  const handleLotteryChange = useCallback(
    (field: keyof LotteryReportsData, value: string) => {
      setLotteryReports((prev) => ({
        ...prev,
        [field]: sanitizeNumericInput(value),
      }));
    },
    [],
  );

  const handleGamingChange = useCallback(
    (field: keyof GamingReportsData, value: string) => {
      setGamingReports((prev) => ({
        ...prev,
        [field]: sanitizeNumericInput(value),
      }));
    },
    [],
  );

  const handleCashPayoutsChange = useCallback(
    (field: keyof CashPayoutsData, value: string) => {
      setCashPayouts((prev) => ({
        ...prev,
        [field]: sanitizeNumericInput(value),
      }));
    },
    [],
  );

  const handleAddVendorInvoice = useCallback(() => {
    const newInvoice: VendorInvoice = {
      id: `vendor-${Date.now()}`,
      vendorName: "",
      amount: 0,
    };
    setVendorInvoices((prev) => [...prev, newInvoice]);
  }, []);

  const handleVendorInvoiceChange = useCallback(
    (id: string, field: "vendorName" | "amount", value: string) => {
      setVendorInvoices((prev) =>
        prev.map((inv) =>
          inv.id === id
            ? {
                ...inv,
                [field]:
                  field === "amount" ? sanitizeNumericInput(value) : value,
              }
            : inv,
        ),
      );
    },
    [],
  );

  const handleRemoveVendorInvoice = useCallback((id: string) => {
    setVendorInvoices((prev) => prev.filter((inv) => inv.id !== id));
  }, []);

  /**
   * Handle scan complete - populate lottery fields from OCR
   * @security SEC-014: INPUT_VALIDATION - Values validated on backend
   */
  const handleScanComplete = useCallback(
    (wizardFields: LotteryWizardFields) => {
      setLotteryReports((prev) => ({
        ...prev,
        onlineSales: wizardFields.onlineSales,
        onlineCashes: wizardFields.onlineCashes,
        instantCashes: wizardFields.instantCashes,
      }));
      setScanModalOpen(false);
    },
    [],
  );

  const handleComplete = useCallback(() => {
    const data: ReportScanningState = {
      lotteryReports: lotteryScanned ? lotteryReports : null,
      gamingReports: gamingScanned ? gamingReports : null,
      vendorInvoices,
      cashPayouts: cashPayoutsRecorded ? cashPayouts : null,
    };
    onComplete(data);
  }, [
    lotteryReports,
    lotteryScanned,
    gamingReports,
    gamingScanned,
    vendorInvoices,
    cashPayouts,
    cashPayoutsRecorded,
    onComplete,
  ]);

  // ============ RENDER ============
  return (
    <div className="space-y-6" data-testid="report-scanning-step">
      <Card>
        <CardContent className="space-y-6 pt-6">
          {/* Lottery Reports */}
          <ReportSection
            title="Lottery Reports"
            description="Daily lottery settlement report from terminal"
            icon={<FileText className="w-6 h-6 text-purple-600" />}
            iconBgColor="bg-purple-100 dark:bg-purple-900/30"
            status={lotteryScanned ? "scanned" : "pending"}
            showScanButton={true}
            onScanReport={() => setScanModalOpen(true)}
          >
            {/*
              Layout: Single row with 4 columns for lottery fields
              Instant Sales | Instant Cashes | Online Sales | Online Cashes

              @security FE-002: FORM_VALIDATION - All inputs use sanitizeNumericInput
              @security SEC-014: INPUT_VALIDATION - Values validated on change
            */}
            <div className="bg-muted/50 rounded-lg p-3 grid grid-cols-4 gap-4 text-sm">
              <div>
                <label
                  htmlFor="lottery-instant-sales"
                  className="text-muted-foreground block mb-1"
                >
                  Instant Sales
                </label>
                <Input
                  id="lottery-instant-sales"
                  type="text"
                  inputMode="decimal"
                  value={lotteryReports.instantSales || ""}
                  onChange={(e) =>
                    handleLotteryChange("instantSales", e.target.value)
                  }
                  placeholder="0.00"
                  className="font-mono"
                  data-testid="lottery-instant-sales-input"
                  aria-label="Instant lottery sales amount"
                />
              </div>
              <div>
                <label
                  htmlFor="lottery-instant-cashes"
                  className="text-muted-foreground block mb-1"
                >
                  Instant Cashes
                </label>
                <Input
                  id="lottery-instant-cashes"
                  type="text"
                  inputMode="decimal"
                  value={lotteryReports.instantCashes || ""}
                  onChange={(e) =>
                    handleLotteryChange("instantCashes", e.target.value)
                  }
                  placeholder="0.00"
                  className="font-mono"
                  data-testid="lottery-instant-cashes-input"
                  aria-label="Instant lottery cashes/redemptions amount"
                />
              </div>
              <div>
                <label
                  htmlFor="lottery-online-sales"
                  className="text-muted-foreground block mb-1"
                >
                  Online Sales
                </label>
                <Input
                  id="lottery-online-sales"
                  type="text"
                  inputMode="decimal"
                  value={lotteryReports.onlineSales || ""}
                  onChange={(e) =>
                    handleLotteryChange("onlineSales", e.target.value)
                  }
                  placeholder="0.00"
                  className="font-mono"
                  data-testid="lottery-online-sales-input"
                  aria-label="Online lottery sales amount"
                />
              </div>
              <div>
                <label
                  htmlFor="lottery-online-cashes"
                  className="text-muted-foreground block mb-1"
                >
                  Online Cashes
                </label>
                <Input
                  id="lottery-online-cashes"
                  type="text"
                  inputMode="decimal"
                  value={lotteryReports.onlineCashes || ""}
                  onChange={(e) =>
                    handleLotteryChange("onlineCashes", e.target.value)
                  }
                  placeholder="0.00"
                  className="font-mono"
                  data-testid="lottery-online-cashes-input"
                  aria-label="Online lottery cashes/redemptions amount"
                />
              </div>
            </div>
          </ReportSection>

          {/* Gaming Reports */}
          <ReportSection
            title="Gaming Reports"
            description="Video gaming terminal daily report"
            icon={<Play className="w-6 h-6 text-orange-600" />}
            iconBgColor="bg-orange-100"
            status={gamingScanned ? "scanned" : "pending"}
          >
            <div className="bg-muted/50 rounded-lg p-3 grid grid-cols-3 gap-4 text-sm">
              <div>
                <label className="text-muted-foreground block mb-1">
                  Net Terminal Income
                </label>
                <Input
                  type="text"
                  value={gamingReports.netTerminalIncome || ""}
                  onChange={(e) =>
                    handleGamingChange("netTerminalIncome", e.target.value)
                  }
                  placeholder="0.00"
                  className="font-mono"
                  data-testid="gaming-nti-input"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">
                  Plays
                </label>
                <Input
                  type="text"
                  value={gamingReports.plays || ""}
                  onChange={(e) => handleGamingChange("plays", e.target.value)}
                  placeholder="0"
                  className="font-mono"
                  data-testid="gaming-plays-input"
                />
              </div>
              <div>
                <label className="text-muted-foreground block mb-1">
                  Payouts
                </label>
                <Input
                  type="text"
                  value={gamingReports.payouts || ""}
                  onChange={(e) =>
                    handleGamingChange("payouts", e.target.value)
                  }
                  placeholder="0.00"
                  className="font-mono"
                  data-testid="gaming-payouts-input"
                />
              </div>
            </div>
          </ReportSection>

          {/* Vendor Invoices */}
          <ReportSection
            title="Vendor Invoices"
            description="Delivery invoices received today"
            icon={<ClipboardList className="w-6 h-6 text-blue-600" />}
            iconBgColor="bg-blue-100"
            status={vendorInvoices.length > 0 ? "scanned" : "pending"}
            statusCount={
              vendorInvoices.length > 0 ? vendorInvoices.length : undefined
            }
          >
            <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
              {vendorInvoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center gap-2"
                  data-testid={`vendor-invoice-${invoice.id}`}
                >
                  <Input
                    type="text"
                    value={invoice.vendorName}
                    onChange={(e) =>
                      handleVendorInvoiceChange(
                        invoice.id,
                        "vendorName",
                        e.target.value,
                      )
                    }
                    placeholder="Vendor name"
                    className="flex-1"
                  />
                  <Input
                    type="text"
                    value={invoice.amount || ""}
                    onChange={(e) =>
                      handleVendorInvoiceChange(
                        invoice.id,
                        "amount",
                        e.target.value,
                      )
                    }
                    placeholder="0.00"
                    className="w-32 font-mono"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemoveVendorInvoice(invoice.id)}
                    className="text-destructive hover:text-destructive"
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {vendorInvoices.length > 0 && (
                <div className="flex justify-between pt-2 border-t mt-2">
                  <span className="font-medium">Total</span>
                  <span className="font-semibold">
                    {formatCurrency(totalVendorInvoices)}
                  </span>
                </div>
              )}
            </div>
            <Button
              variant="outline"
              className="w-full mt-3 border-dashed"
              onClick={handleAddVendorInvoice}
              data-testid="add-vendor-invoice-btn"
            >
              <Camera className="mr-2 h-4 w-4" />
              Add Vendor Invoice
            </Button>
          </ReportSection>

          {/* Cash Payouts */}
          <ReportSection
            title="Cash Payouts"
            description="Lottery winners, money orders, etc."
            icon={<DollarSign className="w-6 h-6 text-green-600" />}
            iconBgColor="bg-green-100"
            status={cashPayoutsRecorded ? "recorded" : "pending"}
          >
            <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <label className="text-muted-foreground">
                  Lottery Winners Paid
                </label>
                <Input
                  type="text"
                  value={cashPayouts.lotteryWinners || ""}
                  onChange={(e) =>
                    handleCashPayoutsChange("lotteryWinners", e.target.value)
                  }
                  placeholder="0.00"
                  className="w-32 font-mono"
                  data-testid="cash-lottery-winners-input"
                />
              </div>
              <div className="flex justify-between items-center">
                <label className="text-muted-foreground">
                  Money Orders Sold
                </label>
                <Input
                  type="text"
                  value={cashPayouts.moneyOrders || ""}
                  onChange={(e) =>
                    handleCashPayoutsChange("moneyOrders", e.target.value)
                  }
                  placeholder="0.00"
                  className="w-32 font-mono"
                  data-testid="cash-money-orders-input"
                />
              </div>
              <div className="flex justify-between items-center">
                <label className="text-muted-foreground">Check Cashing</label>
                <Input
                  type="text"
                  value={cashPayouts.checkCashing || ""}
                  onChange={(e) =>
                    handleCashPayoutsChange("checkCashing", e.target.value)
                  }
                  placeholder="0.00"
                  className="w-32 font-mono"
                  data-testid="cash-check-cashing-input"
                />
              </div>
            </div>
          </ReportSection>
        </CardContent>
      </Card>

      {/* Summary Card */}
      <Card className="bg-primary/5 border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="bg-card rounded-lg p-3 border">
              <p className="text-muted-foreground">Lottery Sales</p>
              <p
                className="text-xl font-bold"
                data-testid="summary-lottery-sales"
              >
                {formatCurrency(totalLotterySales)}
              </p>
            </div>
            <div className="bg-card rounded-lg p-3 border">
              <p className="text-muted-foreground">Lottery Cashes</p>
              <p
                className="text-xl font-bold text-destructive"
                data-testid="summary-lottery-cashes"
              >
                {formatCurrency(-totalLotteryCashes)}
              </p>
            </div>
            <div className="bg-card rounded-lg p-3 border">
              <p className="text-muted-foreground">Gaming Income</p>
              <p className="text-xl font-bold">
                {formatCurrency(gamingReports.netTerminalIncome)}
              </p>
            </div>
            <div className="bg-card rounded-lg p-3 border">
              <p className="text-muted-foreground">Vendor Invoices</p>
              <p className="text-xl font-bold">
                {formatCurrency(totalVendorInvoices)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Footer Actions */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={onBack}
              disabled={!canGoBack}
              data-testid="report-scanning-back-btn"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button
              onClick={handleComplete}
              data-testid="report-scanning-next-btn"
            >
              Next
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Scan Report Modal for OCR */}
      <ScanReportModal
        open={scanModalOpen}
        onOpenChange={setScanModalOpen}
        storeId={storeId}
        businessDate={businessDate ?? new Date().toISOString().split("T")[0]}
        documentType="LOTTERY_SALES_REPORT"
        onScanComplete={handleScanComplete}
        shiftId={shiftId}
        daySummaryId={daySummaryId}
        lotteryDayId={lotteryDayId}
      />
    </div>
  );
}
