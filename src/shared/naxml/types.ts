/**
 * NAXML 3.4 Type Definitions
 *
 * Type definitions for NAXML (NACS XML) data exchange format.
 * Based on Conexxus NAXML specification for convenience store POS systems.
 *
 * Supports NAXML versions 3.2, 3.4, and 4.0.
 *
 * @module types/naxml.types
 * @see https://www.conexxus.org/retail-merchandise-data-exchange
 */

// ============================================================================
// NAXML Document Types
// ============================================================================

/**
 * Supported NAXML versions
 */
export type NAXMLVersion = "3.2" | "3.4" | "4.0";

/**
 * NAXML document types for different data exchanges
 */
export type NAXMLDocumentType =
  | "PriceBookMaintenance"
  | "TransactionDocument"
  | "InventoryMovement"
  | "EmployeeMaintenance"
  | "TenderMaintenance"
  | "DepartmentMaintenance"
  | "TaxRateMaintenance"
  | "Acknowledgment"
  | "POSJournal" // Gilbarco Passport POS Journal Report (PJR files)
  // Movement Report Types (Gilbarco Passport)
  | "FuelGradeMovement" // FGM - Fuel sales by grade, tender, position
  | "FuelProductMovement" // FPM - Pump meter readings
  | "MiscellaneousSummaryMovement" // MSM - Grand totals, drawer ops, statistics
  | "TaxLevelMovement" // TLM - Tax collection summaries
  | "MerchandiseCodeMovement" // MCM - Department/merchandise sales
  | "ItemSalesMovement" // ISM - Individual item sales
  | "TankProductMovement"; // TPM - Tank inventory readings

/**
 * NAXML maintenance action types
 */
export type NAXMLMaintenanceAction = "Add" | "Update" | "Delete" | "AddUpdate";

/**
 * NAXML transaction types
 */
export type NAXMLTransactionType =
  | "Sale"
  | "Refund"
  | "VoidSale"
  | "NoSale"
  | "PaidOut"
  | "PaidIn"
  | "SafeDrop"
  | "EndOfShift";

// ============================================================================
// NAXML Document Structures
// ============================================================================

/**
 * Base interface for all NAXML documents
 */
export interface NAXMLDocument<T = unknown> {
  /** Type of NAXML document */
  documentType: NAXMLDocumentType;
  /** NAXML version */
  version: NAXMLVersion;
  /** Document generation timestamp */
  timestamp: Date;
  /** Store location identifier */
  storeLocationId: string;
  /** Document data payload */
  data: T;
  /** Optional namespace URI */
  namespace?: string;
}

/**
 * NAXML parser options
 */
export interface NAXMLParserOptions {
  /** NAXML version to parse */
  version: NAXMLVersion;
  /** Whether to perform strict XSD validation */
  strictValidation: boolean;
  /** Whether to throw on unknown elements */
  throwOnUnknown: boolean;
  /** Whether to trim whitespace from values */
  trimWhitespace: boolean;
  /** Encoding (default: UTF-8) */
  encoding?: "UTF-8" | "ISO-8859-1";
}

/**
 * Default parser options
 */
export const DEFAULT_NAXML_PARSER_OPTIONS: NAXMLParserOptions = {
  version: "3.4",
  strictValidation: true,
  throwOnUnknown: false,
  trimWhitespace: true,
  encoding: "UTF-8",
};

/**
 * NAXML builder options
 */
export interface NAXMLBuilderOptions {
  /** NAXML version to generate */
  version: NAXMLVersion;
  /** Whether to include XML declaration */
  includeDeclaration: boolean;
  /** Whether to format with indentation */
  prettyPrint: boolean;
  /** Indentation string (default: 2 spaces) */
  indent?: string;
  /** Whether to include namespace */
  includeNamespace: boolean;
}

/**
 * Default builder options
 */
export const DEFAULT_NAXML_BUILDER_OPTIONS: NAXMLBuilderOptions = {
  version: "3.4",
  includeDeclaration: true,
  prettyPrint: true,
  indent: "  ",
  includeNamespace: true,
};

// ============================================================================
// Transaction Document Types
// ============================================================================

/**
 * NAXML Transaction Document structure
 */
export interface NAXMLTransactionDocument {
  /** Transaction header information */
  transactionHeader: NAXMLTransactionHeader;
  /** Line item details */
  transactionDetail: NAXMLTransactionDetail[];
  /** Tender/payment information */
  transactionTender: NAXMLTransactionTender[];
  /** Tax breakdown */
  transactionTax: NAXMLTransactionTax[];
  /** Transaction totals */
  transactionTotal: NAXMLTransactionTotal;
}

/**
 * Transaction header information
 */
export interface NAXMLTransactionHeader {
  /** Store location identifier */
  storeLocationId: string;
  /** Terminal/register identifier */
  terminalId: string;
  /** Unique transaction identifier */
  transactionId: string;
  /** Business date (YYYY-MM-DD) */
  businessDate: string;
  /** Full transaction timestamp (ISO 8601) */
  transactionDate: string;
  /** Type of transaction */
  transactionType: NAXMLTransactionType;
  /** Cashier identifier */
  cashierId?: string;
  /** Operator identifier */
  operatorId?: string;
  /** Shift number */
  shiftNumber?: string;
  /** Customer identifier */
  customerId?: string;
}

/**
 * Transaction line item detail
 */
export interface NAXMLTransactionDetail {
  /** Line number in transaction */
  lineNumber: number;
  /** Item/product code (UPC, PLU, or SKU) */
  itemCode: string;
  /** Item description */
  description: string;
  /** Department code */
  departmentCode: string;
  /** Quantity sold */
  quantity: number;
  /** Unit of measure */
  unitOfMeasure?: string;
  /** Unit price */
  unitPrice: number;
  /** Extended price (quantity * unit price) */
  extendedPrice: number;
  /** Tax code applicable to this item */
  taxCode?: string;
  /** Tax amount for this line */
  taxAmount: number;
  /** Discount amount applied */
  discountAmount?: number;
  /** Discount reason code */
  discountReasonCode?: string;
  /** Modifier codes (e.g., food stamp eligible) */
  modifierCodes?: string[];
  /** Whether this is a void line */
  isVoid?: boolean;
  /** Whether this is a refund line */
  isRefund?: boolean;
  /** Cost of goods (for margin calculation) */
  costAmount?: number;
}

/**
 * Transaction tender/payment
 */
export interface NAXMLTransactionTender {
  /** Tender type code */
  tenderCode: string;
  /** Tender type description */
  tenderDescription: string;
  /** Amount paid with this tender */
  amount: number;
  /** Reference number (e.g., check number, auth code) */
  referenceNumber?: string;
  /** Card type for electronic payments */
  cardType?: string;
  /** Last 4 digits of card (masked) */
  cardLast4?: string;
  /** Whether change was given */
  changeGiven?: number;
}

/**
 * Transaction tax breakdown
 */
export interface NAXMLTransactionTax {
  /** Tax code */
  taxCode: string;
  /** Tax description */
  taxDescription: string;
  /** Taxable amount */
  taxableAmount: number;
  /** Tax amount */
  taxAmount: number;
  /** Tax rate percentage */
  taxRate: number;
  /** Tax jurisdiction */
  jurisdiction?: string;
}

/**
 * Transaction totals
 */
export interface NAXMLTransactionTotal {
  /** Subtotal before tax */
  subtotal: number;
  /** Total tax amount */
  taxTotal: number;
  /** Grand total */
  grandTotal: number;
  /** Total discount applied */
  discountTotal?: number;
  /** Change due to customer */
  changeDue?: number;
  /** Number of items sold */
  itemCount?: number;
}

// ============================================================================
// POSJournal Types (Gilbarco Passport PJR Files)
// ============================================================================

/**
 * POSJournal transaction line status
 * SEC-014: Strict allowlist for status values
 */
export type NAXMLTransactionLineStatus =
  | "normal"
  | "cancel"
  | "void"
  | "refund";

/**
 * Service level codes for fuel transactions
 * SEC-014: Strict allowlist for service level values
 */
export type NAXMLServiceLevelCode = "self" | "full" | "mini";

/**
 * Entry method codes
 * SEC-014: Strict allowlist for entry method values
 */
export type NAXMLEntryMethod =
  | "manual"
  | "scanned"
  | "keyed"
  | "rfid"
  | "card"
  | "other";

/**
 * Tender codes (based on NAXML specification)
 * SEC-014: Strict allowlist for tender codes
 */
export type NAXMLTenderCode =
  | "cash"
  | "check"
  | "creditDebit"
  | "foodStamps"
  | "giftCard"
  | "fleet"
  | "coupon"
  | "loyalty"
  | "houseCharge"
  | "other";

/**
 * Transaction link reasons
 * SEC-014: Strict allowlist for link reasons
 */
export type NAXMLTransactionLinkReason =
  | "fuelPrepay"
  | "fuelPostpay"
  | "layaway"
  | "refund"
  | "void"
  | "split"
  | "other";

/**
 * NAXML POSJournal Document structure (Gilbarco Passport format)
 * Root element: NAXML-POSJournal
 */
export interface NAXMLPOSJournalDocument {
  /** Transmission header with store info */
  transmissionHeader: NAXMLTransmissionHeader;
  /** Journal report containing events */
  journalReport: NAXMLJournalReport;
}

/**
 * Transmission header (common in Gilbarco POS Journal)
 */
export interface NAXMLTransmissionHeader {
  /** Store location identifier */
  storeLocationId: string;
  /** POS vendor name (e.g., "Gilbarco-VeederRoot") */
  vendorName: string;
  /** Vendor model/version */
  vendorModelVersion: string;
}

/**
 * Journal report container
 */
export interface NAXMLJournalReport {
  /** Journal header with report metadata */
  journalHeader: NAXMLJournalHeader;
  /** Sale events (most common) */
  saleEvents: NAXMLSaleEvent[];
  /** Other events (non-sale transactions) */
  otherEvents?: NAXMLOtherEvent[];
}

/**
 * Journal header with report period information
 */
export interface NAXMLJournalHeader {
  /** Report sequence number */
  reportSequenceNumber: number;
  /** Primary report period (shift) */
  primaryReportPeriod: number;
  /** Secondary report period */
  secondaryReportPeriod: number;
  /** Report begin date (YYYY-MM-DD) */
  beginDate: string;
  /** Report begin time (HH:MM:SS) */
  beginTime: string;
  /** Report end date (YYYY-MM-DD) */
  endDate: string;
  /** Report end time (HH:MM:SS) */
  endTime: string;
}

/**
 * Sale event representing a complete transaction
 */
export interface NAXMLSaleEvent {
  /** Event sequence ID within the report */
  eventSequenceId: number;
  /** Whether transaction was in training mode */
  trainingModeFlag: boolean;
  /** Cashier identifier */
  cashierId: string;
  /** Register/terminal identifier */
  registerId: string;
  /** Till identifier */
  tillId: string;
  /** Whether this is an outside (pay-at-pump) sale */
  outsideSalesFlag: boolean;
  /** Unique transaction identifier */
  transactionId: string;
  /** Event start date (YYYY-MM-DD) */
  eventStartDate: string;
  /** Event start time (HH:MM:SS) */
  eventStartTime: string;
  /** Event end date (YYYY-MM-DD) */
  eventEndDate: string;
  /** Event end time (HH:MM:SS) */
  eventEndTime: string;
  /** Business date (YYYY-MM-DD) */
  businessDate: string;
  /** Receipt date (YYYY-MM-DD) */
  receiptDate: string;
  /** Receipt time (HH:MM:SS) */
  receiptTime: string;
  /** Whether transaction was processed offline */
  offlineFlag: boolean;
  /** Whether transaction is suspended */
  suspendFlag: boolean;
  /** Linked transaction info (for prepay completion, etc.) */
  linkedTransactionInfo?: NAXMLLinkedTransactionInfo;
  /** Transaction detail group containing all line items */
  transactionDetailGroup: NAXMLTransactionDetailGroup;
  /** Transaction summary totals */
  transactionSummary: NAXMLJournalTransactionSummary;
}

/**
 * Linked transaction information for related transactions
 */
export interface NAXMLLinkedTransactionInfo {
  /** Original store location ID */
  originalStoreLocationId: string;
  /** Original register ID */
  originalRegisterId: string;
  /** Original transaction ID */
  originalTransactionId: string;
  /** Original event start date */
  originalEventStartDate: string;
  /** Original event start time */
  originalEventStartTime: string;
  /** Original event end date */
  originalEventEndDate: string;
  /** Original event end time */
  originalEventEndTime: string;
  /** Reason for transaction link */
  transactionLinkReason: NAXMLTransactionLinkReason;
}

/**
 * Transaction detail group containing all line items
 */
export interface NAXMLTransactionDetailGroup {
  /** Transaction lines (fuel, merchandise, tender, tax, etc.) */
  transactionLines: NAXMLTransactionLine[];
}

/**
 * Individual transaction line
 */
export interface NAXMLTransactionLine {
  /** Line status (normal, cancel, void, refund) */
  status: NAXMLTransactionLineStatus;
  /** Fuel line details (if fuel transaction) */
  fuelLine?: NAXMLFuelLine;
  /** Fuel prepay line (for prepay authorization) */
  fuelPrepayLine?: NAXMLFuelPrepayLine;
  /** Tender/payment information */
  tenderInfo?: NAXMLJournalTenderInfo;
  /** Tax information for the line */
  transactionTax?: NAXMLJournalTransactionTax;
  /** Merchandise line (non-fuel items) */
  merchandiseLine?: NAXMLMerchandiseLine;
}

/**
 * Fuel line for fuel dispensing transactions
 */
export interface NAXMLFuelLine {
  /** Fuel grade identifier (e.g., "002" for Unleaded Plus) */
  fuelGradeId: string;
  /** Fuel position/pump identifier */
  fuelPositionId: string;
  /** Price tier code */
  priceTierCode: string;
  /** Time tier code */
  timeTierCode: string;
  /** Service level (self, full, mini) */
  serviceLevelCode: NAXMLServiceLevelCode;
  /** Description (e.g., "UNLEAD PLS") */
  description: string;
  /** Entry method */
  entryMethod: NAXMLEntryMethod;
  /** Actual selling price per unit */
  actualSalesPrice: number;
  /** Merchandise code for categorization */
  merchandiseCode: string;
  /** Regular selling price per unit */
  regularSellPrice: number;
  /** Quantity dispensed (gallons/liters) */
  salesQuantity: number;
  /** Total sales amount */
  salesAmount: number;
  /** Tax information */
  itemTax?: NAXMLItemTax;
}

/**
 * Fuel prepay line for prepay transactions
 */
export interface NAXMLFuelPrepayLine {
  /** Fuel position/pump identifier */
  fuelPositionId: string;
  /** Prepaid amount */
  salesAmount: number;
}

/**
 * Tender information within transaction line
 */
export interface NAXMLJournalTenderInfo {
  /** Tender details */
  tender: NAXMLJournalTender;
  /** Tender amount */
  tenderAmount: number;
  /** Whether change was given */
  changeFlag: boolean;
  /** Change amount (if applicable) */
  changeAmount?: number;
}

/**
 * Tender type details
 */
export interface NAXMLJournalTender {
  /** Tender code (cash, creditDebit, etc.) */
  tenderCode: NAXMLTenderCode;
  /** Tender sub-code (generic, visa, mc, etc.) */
  tenderSubCode: string;
}

/**
 * Transaction tax within journal
 */
export interface NAXMLJournalTransactionTax {
  /** Tax level identifier */
  taxLevelId: string;
  /** Taxable sales amount */
  taxableSalesAmount: number;
  /** Tax collected */
  taxCollectedAmount: number;
  /** Taxable sales refunded */
  taxableSalesRefundedAmount: number;
  /** Tax refunded */
  taxRefundedAmount: number;
  /** Tax exempt sales */
  taxExemptSalesAmount: number;
  /** Tax exempt sales refunded */
  taxExemptSalesRefundedAmount: number;
  /** Tax forgiven sales */
  taxForgivenSalesAmount: number;
  /** Tax forgiven sales refunded */
  taxForgivenSalesRefundedAmount: number;
  /** Tax forgiven amount */
  taxForgivenAmount: number;
}

/**
 * Item-level tax reference
 */
export interface NAXMLItemTax {
  /** Tax level identifier */
  taxLevelId: string;
}

/**
 * Merchandise line for non-fuel items
 */
export interface NAXMLMerchandiseLine {
  /** Item code (UPC, PLU, or SKU) */
  itemCode: string;
  /** Item description */
  description: string;
  /** Department code */
  departmentCode: string;
  /** Quantity sold */
  salesQuantity: number;
  /** Unit price */
  unitPrice: number;
  /** Extended/total price */
  salesAmount: number;
  /** Tax information */
  itemTax?: NAXMLItemTax;
  /** Entry method */
  entryMethod?: NAXMLEntryMethod;
  /** Modifier codes */
  modifierCodes?: string[];
}

/**
 * Transaction summary totals for journal events
 */
export interface NAXMLJournalTransactionSummary {
  /** Gross total before adjustments */
  transactionTotalGrossAmount: number;
  /** Net total after adjustments */
  transactionTotalNetAmount: number;
  /** Total tax on sales */
  transactionTotalTaxSalesAmount: number;
  /** Total tax exempt amount */
  transactionTotalTaxExemptAmount: number;
  /** Net tax amount */
  transactionTotalTaxNetAmount: number;
  /** Grand total (direction: Collected or Refunded) */
  transactionTotalGrandAmount: number;
  /** Grand total direction */
  transactionTotalGrandAmountDirection: "Collected" | "Refunded";
}

/**
 * Other events (non-sale transactions like no-sale, paid-out, etc.)
 */
export interface NAXMLOtherEvent {
  /** Event sequence ID */
  eventSequenceId: number;
  /** Event type */
  eventType: string;
  /** Cashier identifier */
  cashierId: string;
  /** Register identifier */
  registerId: string;
  /** Event date */
  eventDate: string;
  /** Event time */
  eventTime: string;
  /** Business date */
  businessDate: string;
  /** Description/reason */
  description?: string;
  /** Amount (if applicable) */
  amount?: number;
}

// ============================================================================
// Price Book Types
// ============================================================================

/**
 * NAXML Price Book maintenance document
 */
export interface NAXMLPriceBookDocument {
  /** Maintenance header */
  maintenanceHeader: NAXMLMaintenanceHeader;
  /** Price book items */
  items: NAXMLPriceBookItem[];
}

/**
 * Maintenance header for NAXML maintenance documents
 */
export interface NAXMLMaintenanceHeader {
  /** Store location ID */
  storeLocationId: string;
  /** Maintenance timestamp */
  maintenanceDate: string;
  /** Type of maintenance (Full, Incremental) */
  maintenanceType: "Full" | "Incremental";
  /** Effective date for changes */
  effectiveDate?: string;
  /** Sequence number for ordering */
  sequenceNumber?: number;
}

/**
 * Price book item definition
 */
export interface NAXMLPriceBookItem {
  /** Item code (UPC, PLU, or SKU) */
  itemCode: string;
  /** Item description */
  description: string;
  /** Short description for receipt */
  shortDescription?: string;
  /** Department code */
  departmentCode: string;
  /** Unit price */
  unitPrice: number;
  /** Tax rate code */
  taxRateCode: string;
  /** Whether item is active */
  isActive: boolean;
  /** Date when price becomes effective */
  effectiveDate?: string;
  /** Date when price expires */
  expirationDate?: string;
  /** Unit of measure */
  unitOfMeasure?: string;
  /** Pack size */
  packSize?: number;
  /** Item category */
  category?: string;
  /** Subcategory */
  subcategory?: string;
  /** Minimum age requirement */
  minimumAge?: number;
  /** Food stamp eligible */
  foodStampEligible?: boolean;
  /** Vendor code */
  vendorCode?: string;
  /** Cost price */
  costPrice?: number;
  /** Maintenance action */
  action?: NAXMLMaintenanceAction;
}

// ============================================================================
// Department Types
// ============================================================================

/**
 * NAXML Department maintenance document
 */
export interface NAXMLDepartmentDocument {
  /** Maintenance header */
  maintenanceHeader: NAXMLMaintenanceHeader;
  /** Departments */
  departments: NAXMLDepartment[];
}

/**
 * Department definition
 */
export interface NAXMLDepartment {
  /** Department code */
  departmentCode: string;
  /** Department description */
  description: string;
  /** Whether items are taxable by default */
  isTaxable: boolean;
  /** Default tax rate code */
  taxRateCode?: string;
  /** Minimum age requirement for purchase */
  minimumAge?: number;
  /** Whether department is active */
  isActive: boolean;
  /** Display sort order */
  sortOrder?: number;
  /** Parent department code (for hierarchies) */
  parentDepartmentCode?: string;
  /** Department type/category */
  departmentType?: string;
  /** Negative department (for refunds) */
  isNegative?: boolean;
  /** Maintenance action */
  action?: NAXMLMaintenanceAction;
}

// ============================================================================
// Tender Type Types
// ============================================================================

/**
 * NAXML Tender maintenance document
 */
export interface NAXMLTenderDocument {
  /** Maintenance header */
  maintenanceHeader: NAXMLMaintenanceHeader;
  /** Tender types */
  tenders: NAXMLTenderType[];
}

/**
 * Tender type definition
 */
export interface NAXMLTenderType {
  /** Tender code */
  tenderCode: string;
  /** Tender description */
  description: string;
  /** Whether this is cash or cash equivalent */
  isCashEquivalent: boolean;
  /** Whether this is an electronic payment */
  isElectronic: boolean;
  /** Whether this affects cash drawer */
  affectsCashDrawer: boolean;
  /** Whether a reference number is required */
  requiresReference: boolean;
  /** Whether this tender type is active */
  isActive: boolean;
  /** Display sort order */
  sortOrder?: number;
  /** Maximum amount allowed */
  maxAmount?: number;
  /** Minimum amount allowed */
  minAmount?: number;
  /** Maintenance action */
  action?: NAXMLMaintenanceAction;
}

// ============================================================================
// Tax Rate Types
// ============================================================================

/**
 * NAXML Tax Rate maintenance document
 */
export interface NAXMLTaxRateDocument {
  /** Maintenance header */
  maintenanceHeader: NAXMLMaintenanceHeader;
  /** Tax rates */
  taxRates: NAXMLTaxRate[];
}

/**
 * Tax rate definition
 */
export interface NAXMLTaxRate {
  /** Tax rate code */
  taxRateCode: string;
  /** Tax rate description */
  description: string;
  /** Tax rate as decimal (e.g., 0.0825 for 8.25%) */
  rate: number;
  /** Whether this tax rate is active */
  isActive: boolean;
  /** Jurisdiction code */
  jurisdictionCode?: string;
  /** Tax type (Sales, Use, Excise, etc.) */
  taxType?: string;
  /** Effective date */
  effectiveDate?: string;
  /** Expiration date */
  expirationDate?: string;
  /** Maintenance action */
  action?: NAXMLMaintenanceAction;
}

// ============================================================================
// Employee/Cashier Types
// ============================================================================

/**
 * NAXML Employee maintenance document
 */
export interface NAXMLEmployeeDocument {
  /** Maintenance header */
  maintenanceHeader: NAXMLMaintenanceHeader;
  /** Employees */
  employees: NAXMLEmployee[];
}

/**
 * Employee definition
 */
export interface NAXMLEmployee {
  /** Employee/Cashier ID */
  employeeId: string;
  /** First name */
  firstName: string;
  /** Last name */
  lastName: string;
  /** Whether this employee is active */
  isActive: boolean;
  /** Employee PIN (hashed in transit) */
  pinHash?: string;
  /** Job title/role */
  jobTitle?: string;
  /** Hire date */
  hireDate?: string;
  /** Termination date */
  terminationDate?: string;
  /** Access level */
  accessLevel?: number;
  /** Maintenance action */
  action?: NAXMLMaintenanceAction;
}

// ============================================================================
// Acknowledgment Types
// ============================================================================

/**
 * NAXML Acknowledgment document
 */
export interface NAXMLAcknowledgment {
  /** Original document ID being acknowledged */
  originalDocumentId: string;
  /** Original document type */
  originalDocumentType: NAXMLDocumentType;
  /** Acknowledgment status */
  status: "Received" | "Processed" | "Rejected" | "PartiallyProcessed";
  /** Timestamp of acknowledgment */
  timestamp: string;
  /** Number of records processed */
  recordsProcessed?: number;
  /** Number of records failed */
  recordsFailed?: number;
  /** Error messages if any */
  errors?: NAXMLAcknowledgmentError[];
}

/**
 * Acknowledgment error detail
 */
export interface NAXMLAcknowledgmentError {
  /** Error code */
  errorCode: string;
  /** Error message */
  errorMessage: string;
  /** Line number or record that caused error */
  lineNumber?: number;
  /** Field name that caused error */
  fieldName?: string;
  /** Invalid value that was rejected */
  rejectedValue?: string;
}

// ============================================================================
// Validation Types
// ============================================================================

/**
 * Validation result for NAXML documents
 */
export interface NAXMLValidationResult {
  /** Whether document is valid */
  isValid: boolean;
  /** Document type detected */
  documentType?: NAXMLDocumentType;
  /** NAXML version detected */
  version?: NAXMLVersion;
  /** Validation errors */
  errors: NAXMLValidationError[];
  /** Validation warnings (non-fatal) */
  warnings: NAXMLValidationWarning[];
}

/**
 * Validation error
 */
export interface NAXMLValidationError {
  /** Error code */
  code: string;
  /** Human-readable error message */
  message: string;
  /** Line number in XML */
  line?: number;
  /** Column number in XML */
  column?: number;
  /** XPath to problematic element */
  path?: string;
  /** Severity level */
  severity: "error" | "critical";
}

/**
 * Validation warning
 */
export interface NAXMLValidationWarning {
  /** Warning code */
  code: string;
  /** Human-readable warning message */
  message: string;
  /** Line number in XML */
  line?: number;
  /** XPath to problematic element */
  path?: string;
}

// ============================================================================
// File Processing Types
// ============================================================================

/**
 * File processing status
 */
export type NAXMLFileStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCESS"
  | "PARTIAL"
  | "FAILED"
  | "SKIPPED";

/**
 * File direction
 */
export type NAXMLFileDirection = "IMPORT" | "EXPORT";

/**
 * NAXML file log entry
 */
export interface NAXMLFileLogEntry {
  /** Unique identifier */
  fileLogId: string;
  /** Store identifier */
  storeId: string;
  /** POS integration identifier */
  posIntegrationId: string;
  /** Original file name */
  fileName: string;
  /** File type (document type) */
  fileType: NAXMLDocumentType;
  /** Direction (import/export) */
  direction: NAXMLFileDirection;
  /** Processing status */
  status: NAXMLFileStatus;
  /** Number of records in file */
  recordCount?: number;
  /** Error message if failed */
  errorMessage?: string;
  /** SHA-256 hash for duplicate detection */
  fileHash: string;
  /** File size in bytes */
  fileSizeBytes: number;
  /** When file was processed */
  processedAt?: Date;
  /** When record was created */
  createdAt: Date;
}

/**
 * File watcher configuration
 */
export interface NAXMLFileWatcherConfig {
  /** Configuration identifier (auto-generated if not provided) */
  configId?: string;
  /** Store identifier */
  storeId: string;
  /** POS integration identifier */
  posIntegrationId: string;
  /** Path to watch for files */
  watchPath: string;
  /** Path to move processed files */
  processedPath?: string;
  /** Path to move error files */
  errorPath?: string;
  /** Poll interval in seconds */
  pollIntervalSeconds: number;
  /** Whether watcher is active */
  isActive: boolean;
  /** File patterns to watch (glob) */
  filePatterns: string[];
  /** Last poll timestamp */
  lastPollAt?: Date;
  /** Record timestamps (auto-set if not provided) */
  createdAt?: Date;
  updatedAt?: Date;
}

// ============================================================================
// Import/Export Result Types
// ============================================================================

/**
 * Result of importing NAXML data
 */
export interface NAXMLImportResult<T = unknown> {
  /** Whether import was successful */
  success: boolean;
  /** Document type that was imported */
  documentType: NAXMLDocumentType;
  /** Number of records processed */
  recordCount: number;
  /** Number of records successfully imported */
  successCount: number;
  /** Number of records that failed */
  failedCount: number;
  /** Imported data */
  data: T[];
  /** Errors encountered */
  errors: NAXMLImportError[];
  /** Processing duration in milliseconds */
  durationMs: number;
  /** Source file path */
  sourceFile?: string;
  /** File hash */
  fileHash?: string;
}

/**
 * Import error detail
 */
export interface NAXMLImportError {
  /** Line/record number */
  lineNumber?: number;
  /** Record identifier (e.g., item code) */
  recordId?: string;
  /** Error code */
  errorCode: string;
  /** Error message */
  errorMessage: string;
  /** Raw data that caused error */
  rawData?: string;
}

/**
 * Result of exporting NAXML data
 */
export interface NAXMLExportResult {
  /** Whether export was successful */
  success: boolean;
  /** Document type that was exported */
  documentType: NAXMLDocumentType;
  /** Number of records exported */
  recordCount: number;
  /** Generated file path */
  filePath: string;
  /** Generated file name */
  fileName: string;
  /** File size in bytes */
  fileSizeBytes: number;
  /** File hash */
  fileHash: string;
  /** Export duration in milliseconds */
  durationMs: number;
  /** Error message if failed */
  errorMessage?: string;
}

// ============================================================================
// Movement Report Types (Gilbarco Passport)
// ============================================================================

/**
 * Primary Report Period values indicating report scope.
 *
 * @remarks
 * These values determine whether the report contains shift-level or day-level data.
 * - Period 2: Day/Store Close totals (aggregated across all shifts)
 * - Period 98: Shift Close totals (individual shift data)
 *
 * SEC-014: Strict allowlist for report period values
 */
export type NAXMLPrimaryReportPeriod = 2 | 98;

/**
 * Movement report tender codes (fuel-specific).
 *
 * @remarks
 * These codes identify the payment method used for fuel transactions.
 * Different from general tender codes as they're specific to fuel sales breakdown.
 *
 * SEC-014: Strict allowlist for fuel tender codes
 */
export type NAXMLFuelTenderCode =
  | "cash" // Inside cash sales
  | "outsideCredit" // Pay-at-pump credit card
  | "outsideDebit" // Pay-at-pump debit card
  | "insideCredit" // Inside credit card
  | "insideDebit" // Inside debit card
  | "fleet"; // Fleet card sales

/**
 * Valid fuel tender codes as readonly array for runtime validation.
 * SEC-014: Allowlist for validation
 */
export const VALID_FUEL_TENDER_CODES = [
  "cash",
  "outsideCredit",
  "outsideDebit",
  "insideCredit",
  "insideDebit",
  "fleet",
] as const;

/**
 * Miscellaneous Summary codes for MSM reports.
 *
 * SEC-014: Strict allowlist for MSM summary codes
 */
export type NAXMLMiscellaneousSummaryCode =
  | "safeDrop"
  | "safeLoan"
  | "refunds"
  | "payouts"
  | "payins"
  | "totalizers"
  | "statistics"
  | "discount"
  | "totalizer"
  | "summaryTotals"
  | "sales"
  | "openingBalance"
  | "closingBalance"
  | "taxTotals"
  | "fuelSalesByGrade";

/**
 * Miscellaneous Summary sub-codes.
 *
 * SEC-014: Strict allowlist for MSM sub-codes
 */
export type NAXMLMiscellaneousSummarySubCode =
  | "total"
  | "loan"
  | "vendorPay"
  | "carWashSales"
  | "discounts"
  | "itemssold"
  | "noSales"
  | "transactions"
  | "nonFuelVoidItems"
  | "voidTransactions"
  | "postVoids"
  | "driveoff"
  | "refunds"
  | "safeDrop"
  | "overShort"
  | "correction"
  | "amountFixed"
  | "amountPercentage"
  | "promotional"
  | "fuel"
  | "storeCoupons"
  | "sales"
  | "tax"
  | "nonTaxableSales"
  | "MOP"
  | "taxableSalesByTaxCode"
  | "taxCollectedByTaxCode"
  | "taxExemptedByTaxCode"
  | "insideFuel";

// ============================================================================
// Movement Report Base Interfaces
// ============================================================================

/**
 * Base interface for all NAXML Movement Report documents.
 *
 * @remarks
 * Movement reports are generated by Gilbarco Passport POS systems to summarize
 * sales, fuel dispensing, tax collection, and other operational data.
 * Root element: `NAXML-MovementReport`
 *
 * @example
 * ```typescript
 * const doc: NAXMLMovementReportDocument<NAXMLFuelGradeMovementData> = {
 *   transmissionHeader: { storeLocationId: "299", vendorName: "Gilbarco-VeederRoot", ... },
 *   movementType: "FuelGradeMovement",
 *   data: { movementHeader: { ... }, fgmDetails: [...] }
 * };
 * ```
 */
export interface NAXMLMovementReportDocument<T = unknown> {
  /** Transmission header with store and vendor information */
  transmissionHeader: NAXMLTransmissionHeader;
  /** Type of movement report */
  movementType: NAXMLMovementReportType;
  /** Movement report data payload */
  data: T;
}

/**
 * Union type for all movement report types.
 *
 * SEC-014: Strict allowlist for movement report types
 */
export type NAXMLMovementReportType =
  | "FuelGradeMovement"
  | "FuelProductMovement"
  | "MiscellaneousSummaryMovement"
  | "TaxLevelMovement"
  | "MerchandiseCodeMovement"
  | "ItemSalesMovement"
  | "TankProductMovement";

/**
 * Movement header common to all movement reports.
 *
 * @remarks
 * Contains report period, sequence, and date/time information.
 * Present in every movement report type.
 *
 * @example
 * ```typescript
 * const header: NAXMLMovementHeader = {
 *   reportSequenceNumber: 1,
 *   primaryReportPeriod: 2, // Day close
 *   secondaryReportPeriod: 0,
 *   businessDate: "2026-01-02",
 *   beginDate: "2026-01-02",
 *   beginTime: "23:59:45",
 *   endDate: "2026-01-03",
 *   endTime: "23:59:52"
 * };
 * ```
 */
export interface NAXMLMovementHeader {
  /** Report sequence number within the period */
  reportSequenceNumber: number;

  /**
   * Primary report period indicating scope.
   * - 2: Day/Store Close (aggregated)
   * - 98: Shift Close (individual shift)
   */
  primaryReportPeriod: NAXMLPrimaryReportPeriod;

  /** Secondary report period (typically 0) */
  secondaryReportPeriod: number;

  /** Business date for the report (YYYY-MM-DD) */
  businessDate: string;

  /** Report period begin date (YYYY-MM-DD) */
  beginDate: string;

  /** Report period begin time (HH:MM:SS) */
  beginTime: string;

  /** Report period end date (YYYY-MM-DD) */
  endDate: string;

  /** Report period end time (HH:MM:SS) */
  endTime: string;
}

/**
 * Sales movement header for shift-specific reports.
 *
 * @remarks
 * Present in movement reports when PrimaryReportPeriod is 98 (shift close).
 * Identifies the specific register, cashier, and till for the shift.
 *
 * @example
 * ```typescript
 * const salesHeader: NAXMLSalesMovementHeader = {
 *   registerId: "1",
 *   cashierId: "1",
 *   tillId: "4133"
 * };
 * ```
 */
export interface NAXMLSalesMovementHeader {
  /** Register/terminal identifier */
  registerId: string;

  /** Cashier identifier who worked the shift */
  cashierId: string;

  /** Till identifier for cash drawer tracking */
  tillId: string;
}

// ============================================================================
// FGM - Fuel Grade Movement Types
// ============================================================================

/**
 * Fuel Grade Movement document data.
 *
 * @remarks
 * FGM files contain fuel sales data broken down by grade, tender type, and/or
 * fuel position. This is the primary source of fuel sales data for reporting.
 *
 * FGM files come in several variants:
 * - **By Tender (Period 2)**: Sales grouped by payment method
 * - **By Position (Period 98)**: Sales grouped by pump/dispenser
 * - **With Totals (Period 2)**: Includes non-resettable meter readings
 * - **Summary (Period 2)**: Grade-level totals only
 *
 * @see {@link NAXMLFGMDetail} for detail records
 *
 * @example
 * ```typescript
 * const fgmData: NAXMLFuelGradeMovementData = {
 *   movementHeader: { primaryReportPeriod: 2, businessDate: "2026-01-02", ... },
 *   salesMovementHeader: undefined, // Day close - no shift info
 *   fgmDetails: [
 *     { fuelGradeId: "001", fgmTenderSummary: { tender: { tenderCode: "cash" }, ... } },
 *     { fuelGradeId: "001", fgmTenderSummary: { tender: { tenderCode: "outsideCredit" }, ... } }
 *   ]
 * };
 * ```
 */
export interface NAXMLFuelGradeMovementData {
  /** Movement header with period and date information */
  movementHeader: NAXMLMovementHeader;

  /** Sales movement header (present for shift reports, Period 98) */
  salesMovementHeader?: NAXMLSalesMovementHeader;

  /** Array of fuel grade detail records */
  fgmDetails: NAXMLFGMDetail[];
}

/**
 * Fuel Grade Movement detail record.
 *
 * @remarks
 * FGM files may contain multiple FGMDetail entries per grade, grouped by:
 * - Tender type (cash, outsideCredit, outsideDebit) in "by tender" variant
 * - Position (pump number) in "by position" variant
 * - Price tier (cash vs credit pricing) within position summaries
 *
 * Each detail record contains exactly one of:
 * - `fgmTenderSummary`: When grouped by tender type
 * - `fgmPositionSummary`: When grouped by position/pump
 *
 * @example
 * ```typescript
 * // By tender variant
 * const byTender: NAXMLFGMDetail = {
 *   fuelGradeId: "001",
 *   fgmTenderSummary: {
 *     tender: { tenderCode: "cash", tenderSubCode: "generic" },
 *     fgmSellPriceSummary: { actualSalesPrice: 2.519, fgmServiceLevelSummary: { ... } }
 *   }
 * };
 *
 * // By position variant
 * const byPosition: NAXMLFGMDetail = {
 *   fuelGradeId: "001",
 *   fgmPositionSummary: {
 *     fuelPositionId: "2",
 *     fgmNonResettableTotal: { ... },
 *     fgmPriceTierSummaries: [...]
 *   }
 * };
 * ```
 */
export interface NAXMLFGMDetail {
  /**
   * Fuel grade identifier.
   * Common values: "001" (Regular), "002" (Plus), "003" (Premium), "021" (Diesel), "300" (Kerosene)
   */
  fuelGradeId: string;

  /** Tender-based sales summary (present in "by tender" variant) */
  fgmTenderSummary?: NAXMLFGMTenderSummary;

  /** Position-based sales summary (present in "by position" variant) */
  fgmPositionSummary?: NAXMLFGMPositionSummary;
}

/**
 * FGM Tender Summary - Sales grouped by payment method.
 *
 * @remarks
 * Contains fuel sales for a specific grade broken down by tender type.
 * Present in "by tender" variant of FGM files (typically Period 2).
 */
export interface NAXMLFGMTenderSummary {
  /** Tender type information */
  tender: NAXMLFGMTender;

  /** Sell price summary containing sales totals */
  fgmSellPriceSummary: NAXMLFGMSellPriceSummary;
}

/**
 * FGM Tender identification.
 */
export interface NAXMLFGMTender {
  /** Tender code (cash, outsideCredit, outsideDebit, etc.) */
  tenderCode: NAXMLFuelTenderCode;

  /** Tender sub-code (typically "generic") */
  tenderSubCode: string;
}

/**
 * FGM Sell Price Summary - Price and service level breakdown.
 */
export interface NAXMLFGMSellPriceSummary {
  /** Actual selling price per unit (e.g., 2.519 per gallon) */
  actualSalesPrice: number;

  /** Service level summary containing sales totals */
  fgmServiceLevelSummary: NAXMLFGMServiceLevelSummary;
}

/**
 * FGM Service Level Summary - Sales totals at service level.
 */
export interface NAXMLFGMServiceLevelSummary {
  /** Service level code (1 = self-service) */
  serviceLevelCode: string;

  /** Fuel grade sales totals */
  fgmSalesTotals: NAXMLFGMSalesTotals;
}

/**
 * FGM Position Summary - Sales grouped by pump/dispenser.
 *
 * @remarks
 * Contains fuel sales for a specific grade at a specific fuel position.
 * Present in "by position" variant of FGM files (typically Period 98).
 */
export interface NAXMLFGMPositionSummary {
  /** Fuel position/pump identifier (e.g., "1", "2", "3") */
  fuelPositionId: string;

  /** Non-resettable totalizer readings (optional, present in "with totals" variant) */
  fgmNonResettableTotal?: NAXMLFGMNonResettableTotal;

  /** Price tier summaries (cash price vs credit price tiers) */
  fgmPriceTierSummaries: NAXMLFGMPriceTierSummary[];
}

/**
 * FGM Non-Resettable Total - Cumulative meter readings.
 *
 * @remarks
 * These are lifetime totalizer values that never reset.
 * Used for reconciliation and variance detection.
 */
export interface NAXMLFGMNonResettableTotal {
  /** Cumulative volume dispensed (gallons/liters) */
  fuelGradeNonResettableTotalVolume: number;

  /** Cumulative sales amount ($) */
  fuelGradeNonResettableTotalAmount: number;
}

/**
 * FGM Price Tier Summary - Sales by price tier.
 *
 * @remarks
 * Fuel may be sold at different prices based on payment method.
 * Common tiers:
 * - "0001": Cash price tier
 * - "0002": Credit price tier
 */
export interface NAXMLFGMPriceTierSummary {
  /** Price tier code (e.g., "0001" = cash, "0002" = credit) */
  priceTierCode: string;

  /** Sales totals for this price tier */
  fgmSalesTotals: NAXMLFGMSalesTotals;
}

/**
 * FGM Sales Totals - Core sales data for fuel.
 *
 * @remarks
 * Contains the actual volume, amount, and discount information
 * for fuel sales. This is the core data structure used for
 * shift and day summaries.
 *
 * @example
 * ```typescript
 * const totals: NAXMLFGMSalesTotals = {
 *   fuelGradeSalesVolume: 201.676,  // gallons sold
 *   fuelGradeSalesAmount: 508,       // total $ before discounts
 *   discountAmount: 7.43,            // discount $ applied
 *   discountCount: 1,                // number of discounted transactions
 *   taxExemptSalesVolume: 0,         // tax-exempt gallons
 *   pumpTestTotals: { ... }          // pump test data (optional)
 * };
 * ```
 */
export interface NAXMLFGMSalesTotals {
  /** Total volume sold (gallons or liters) */
  fuelGradeSalesVolume: number;

  /** Total sales amount ($) */
  fuelGradeSalesAmount: number;

  /** Total discount amount applied ($) */
  discountAmount: number;

  /** Number of transactions with discounts applied */
  discountCount: number;

  /** Tax-exempt sales volume (optional) */
  taxExemptSalesVolume?: number;

  /** Dispenser discount amount (optional, in position summaries) */
  dispenserDiscountAmount?: number;

  /** Dispenser discount count (optional) */
  dispenserDiscountCount?: number;

  /** Pump test totals (optional) */
  pumpTestTotals?: NAXMLFGMPumpTestTotals;
}

/**
 * FGM Pump Test Totals - Fuel used for pump testing.
 *
 * @remarks
 * Tracks fuel dispensed during pump calibration tests.
 * This fuel is not sold and should be excluded from sales calculations.
 */
export interface NAXMLFGMPumpTestTotals {
  /** Amount of pump test fuel ($) */
  pumpTestAmount: number;

  /** Volume of pump test fuel (gallons/liters) */
  pumpTestVolume: number;

  /** Tank ID where test fuel was returned (optional) */
  returnTankId?: string;
}

// ============================================================================
// FPM - Fuel Product Movement Types
// ============================================================================

/**
 * Fuel Product Movement document data.
 *
 * @remarks
 * FPM files contain non-resettable meter readings from fuel dispensers.
 * These readings are used for reconciliation between book sales and actual
 * fuel dispensed.
 *
 * @example
 * ```typescript
 * const fpmData: NAXMLFuelProductMovementData = {
 *   movementHeader: { primaryReportPeriod: 2, businessDate: "2026-01-02", ... },
 *   fpmDetails: [
 *     {
 *       fuelProductId: "1",
 *       fpmNonResettableTotals: [
 *         { fuelPositionId: "1", volumeNumber: 228745.691, amountNumber: 0 },
 *         { fuelPositionId: "2", volumeNumber: 208738.815, amountNumber: 0 }
 *       ]
 *     }
 *   ]
 * };
 * ```
 */
export interface NAXMLFuelProductMovementData {
  /** Movement header with period and date information */
  movementHeader: NAXMLMovementHeader;

  /** Array of fuel product detail records */
  fpmDetails: NAXMLFPMDetail[];
}

/**
 * FPM Detail - Meter readings for a fuel product.
 *
 * @remarks
 * Each FPMDetail represents readings for one fuel product across
 * all dispensing positions that carry that product.
 */
export interface NAXMLFPMDetail {
  /** Fuel product identifier (e.g., "1", "2", "3", "4") */
  fuelProductId: string;

  /** Non-resettable totalizer readings by position */
  fpmNonResettableTotals: NAXMLFPMNonResettableTotals[];
}

/**
 * FPM Non-Resettable Totals - Position meter readings.
 *
 * @remarks
 * Contains cumulative (lifetime) meter readings for a specific
 * fuel product at a specific dispenser position.
 */
export interface NAXMLFPMNonResettableTotals {
  /** Fuel position/pump identifier */
  fuelPositionId: string;

  /** Cumulative sales amount (often 0 in Gilbarco systems) */
  fuelProductNonResettableAmountNumber: number;

  /** Cumulative volume dispensed (gallons/liters) */
  fuelProductNonResettableVolumeNumber: number;
}

// ============================================================================
// MSM - Miscellaneous Summary Movement Types
// ============================================================================

/**
 * Miscellaneous Summary Movement document data.
 *
 * @remarks
 * MSM files contain grand totals, drawer operations, transaction statistics,
 * and various summary data. This is a rich data source for shift/day summaries.
 *
 * Key data available in MSM files:
 * - Safe drops and loans
 * - Opening and closing balances
 * - Transaction counts and void statistics
 * - Over/short calculations
 * - Fuel sales by grade (aggregated)
 * - Tax totals by code
 *
 * @example
 * ```typescript
 * const msmData: NAXMLMiscellaneousSummaryMovementData = {
 *   movementHeader: { primaryReportPeriod: 98, ... },
 *   salesMovementHeader: { registerId: "1", cashierId: "1", tillId: "4133" },
 *   msmDetails: [
 *     { codes: { code: "safeLoan", subCode: "loan" }, salesTotals: { amount: 200, count: 1 } },
 *     { codes: { code: "statistics", subCode: "transactions" }, salesTotals: { amount: 0, count: 51 } }
 *   ]
 * };
 * ```
 */
export interface NAXMLMiscellaneousSummaryMovementData {
  /** Movement header with period and date information */
  movementHeader: NAXMLMovementHeader;

  /** Sales movement header (present for shift reports) */
  salesMovementHeader?: NAXMLSalesMovementHeader;

  /** Array of miscellaneous summary detail records */
  msmDetails: NAXMLMSMDetail[];
}

/**
 * MSM Detail - Individual summary line item.
 *
 * @remarks
 * Each MSMDetail represents a specific type of summary data,
 * identified by the combination of code, subCode, and optional modifier.
 */
export interface NAXMLMSMDetail {
  /** Summary codes identifying the data type */
  miscellaneousSummaryCodes: NAXMLMiscellaneousSummaryCodes;

  /** Optional register ID (for outside terminal summaries) */
  registerId?: string;

  /** Optional cashier ID */
  cashierId?: string;

  /** Optional till ID */
  tillId?: string;

  /** Sales totals for this summary type */
  msmSalesTotals: NAXMLMSMSalesTotals;
}

/**
 * MSM Summary Codes - Identifies the type of summary data.
 *
 * @remarks
 * The combination of code, subCode, and modifier uniquely identifies
 * what data is being reported. Examples:
 * - safeLoan + loan = Till loan amount
 * - statistics + transactions = Transaction count
 * - fuelSalesByGrade + fuel + "001" = Grade 001 fuel sales
 */
export interface NAXMLMiscellaneousSummaryCodes {
  /** Primary summary code */
  miscellaneousSummaryCode: string;

  /** Secondary summary code (optional) */
  miscellaneousSummarySubCode?: string;

  /** Modifier code (optional, e.g., grade ID "001", tax code "99") */
  miscellaneousSummarySubCodeModifier?: string;
}

/**
 * MSM Sales Totals - Summary amounts and counts.
 */
export interface NAXMLMSMSalesTotals {
  /** Tender information (optional) */
  tender?: NAXMLFGMTender;

  /** Summary amount ($) or special value */
  miscellaneousSummaryAmount: number;

  /**
   * Summary count (transactions, items, or volume for fuel).
   * Note: For fuelSalesByGrade, this is actually the volume in gallons.
   */
  miscellaneousSummaryCount: number;
}

// ============================================================================
// TLM - Tax Level Movement Types
// ============================================================================

/**
 * Tax Level Movement document data.
 *
 * @remarks
 * TLM files contain tax collection summaries by tax level/code.
 * Used for tax reporting and compliance.
 *
 * @example
 * ```typescript
 * const tlmData: NAXMLTaxLevelMovementData = {
 *   movementHeader: { primaryReportPeriod: 98, ... },
 *   salesMovementHeader: { registerId: "1", ... },
 *   tlmDetails: [
 *     {
 *       taxLevelId: "99",
 *       merchandiseCode: "0",
 *       taxableSalesAmount: 795,
 *       taxCollectedAmount: 0,
 *       ...
 *     }
 *   ]
 * };
 * ```
 */
export interface NAXMLTaxLevelMovementData {
  /** Movement header with period and date information */
  movementHeader: NAXMLMovementHeader;

  /** Sales movement header (present for shift reports) */
  salesMovementHeader?: NAXMLSalesMovementHeader;

  /** Array of tax level detail records */
  tlmDetails: NAXMLTLMDetail[];
}

/**
 * TLM Detail - Tax collection data by tax level.
 */
export interface NAXMLTLMDetail {
  /** Tax level identifier (e.g., "99") */
  taxLevelId: string;

  /** Merchandise code (typically "0" for all) */
  merchandiseCode: string;

  /** Taxable sales amount ($) */
  taxableSalesAmount: number;

  /** Taxable sales that were refunded ($) */
  taxableSalesRefundedAmount: number;

  /** Tax collected amount ($) */
  taxCollectedAmount: number;

  /** Tax-exempt sales amount ($) */
  taxExemptSalesAmount: number;

  /** Tax-exempt sales refunded ($) */
  taxExemptSalesRefundedAmount: number;

  /** Tax-forgiven sales amount ($) */
  taxForgivenSalesAmount: number;

  /** Tax-forgiven sales refunded ($) */
  taxForgivenSalesRefundedAmount: number;

  /** Tax refunded amount ($) */
  taxRefundedAmount: number;
}

// ============================================================================
// MCM - Merchandise Code Movement Types
// ============================================================================

/**
 * Merchandise Code Movement document data.
 *
 * @remarks
 * MCM files contain sales summaries by merchandise/department code.
 * Used for department-level reporting.
 *
 * @example
 * ```typescript
 * const mcmData: NAXMLMerchandiseCodeMovementData = {
 *   movementHeader: { primaryReportPeriod: 98, ... },
 *   salesMovementHeader: { registerId: "1", ... },
 *   mcmDetails: [
 *     {
 *       merchandiseCode: "1024",
 *       merchandiseCodeDescription: "Fuel 1",
 *       mcmSalesTotals: { salesAmount: 795, salesQuantity: 51, ... }
 *     }
 *   ]
 * };
 * ```
 */
export interface NAXMLMerchandiseCodeMovementData {
  /** Movement header with period and date information */
  movementHeader: NAXMLMovementHeader;

  /** Sales movement header (present for shift reports) */
  salesMovementHeader?: NAXMLSalesMovementHeader;

  /** Array of merchandise code detail records */
  mcmDetails: NAXMLMCMDetail[];
}

/**
 * MCM Detail - Sales data by merchandise/department code.
 */
export interface NAXMLMCMDetail {
  /** Merchandise/department code */
  merchandiseCode: string;

  /** Description of the merchandise code */
  merchandiseCodeDescription: string;

  /** Sales totals for this merchandise code */
  mcmSalesTotals: NAXMLMCMSalesTotals;
}

/**
 * MCM Sales Totals - Department-level sales data.
 */
export interface NAXMLMCMSalesTotals {
  /** Discount amount applied ($) */
  discountAmount: number;

  /** Number of discount applications */
  discountCount: number;

  /** Promotion amount ($) */
  promotionAmount: number;

  /** Number of promotional items */
  promotionCount: number;

  /** Refund amount ($) */
  refundAmount: number;

  /** Number of refunds */
  refundCount: number;

  /** Quantity of items sold */
  salesQuantity: number;

  /** Total sales amount ($) */
  salesAmount: number;

  /** Number of transactions */
  transactionCount: number;

  /** Open department sales amount ($) */
  openDepartmentSalesAmount: number;

  /** Open department transaction count */
  openDepartmentTransactionCount: number;
}

// ============================================================================
// ISM - Item Sales Movement Types
// ============================================================================

/**
 * Item Sales Movement document data.
 *
 * @remarks
 * ISM files contain individual item sales data.
 * May be empty if no item-level data is configured.
 *
 * @example
 * ```typescript
 * const ismData: NAXMLItemSalesMovementData = {
 *   movementHeader: { primaryReportPeriod: 98, ... },
 *   ismDetails: [] // Often empty
 * };
 * ```
 */
export interface NAXMLItemSalesMovementData {
  /** Movement header with period and date information */
  movementHeader: NAXMLMovementHeader;

  /** Sales movement header (optional) */
  salesMovementHeader?: NAXMLSalesMovementHeader;

  /** Array of item sales detail records (may be empty) */
  ismDetails: NAXMLISMDetail[];
}

/**
 * ISM Detail - Individual item sales data.
 */
export interface NAXMLISMDetail {
  /** Item code (UPC/PLU) */
  itemCode: string;

  /** Item description */
  itemDescription: string;

  /** Department/merchandise code */
  merchandiseCode: string;

  /** Quantity sold */
  salesQuantity: number;

  /** Total sales amount ($) */
  salesAmount: number;

  /** Unit price ($) */
  unitPrice: number;
}

// ============================================================================
// TPM - Tank Product Movement Types
// ============================================================================

/**
 * Tank Product Movement document data.
 *
 * @remarks
 * TPM files contain tank inventory readings for fuel storage tanks.
 * Used for inventory management and reconciliation.
 * May be empty if tank monitoring is not configured.
 *
 * @example
 * ```typescript
 * const tpmData: NAXMLTankProductMovementData = {
 *   movementHeader: { primaryReportPeriod: 2, ... },
 *   tpmDetails: [] // Often empty if no tank monitoring
 * };
 * ```
 */
export interface NAXMLTankProductMovementData {
  /** Movement header with period and date information */
  movementHeader: NAXMLMovementHeader;

  /** Array of tank product detail records (may be empty) */
  tpmDetails: NAXMLTPMDetail[];
}

/**
 * TPM Detail - Tank inventory data.
 */
export interface NAXMLTPMDetail {
  /** Tank identifier */
  tankId: string;

  /** Fuel product ID in this tank */
  fuelProductId: string;

  /** Current tank volume (gallons/liters) */
  tankVolume: number;

  /** Tank capacity (gallons/liters) */
  tankCapacity?: number;

  /** Tank ullage/space remaining (gallons/liters) */
  tankUllage?: number;

  /** Water level in tank (inches) */
  waterLevel?: number;

  /** Product temperature (Fahrenheit) */
  productTemperature?: number;

  /** Reading timestamp */
  readingTimestamp?: string;
}

// ============================================================================
// Parser Error Types for Movement Reports
// ============================================================================

/**
 * Error codes specific to Movement Report parsing.
 */
export const NAXML_MOVEMENT_REPORT_ERROR_CODES = {
  // General errors
  INVALID_DOCUMENT_TYPE: "MR_INVALID_DOCUMENT_TYPE",
  MISSING_MOVEMENT_HEADER: "MR_MISSING_MOVEMENT_HEADER",
  INVALID_REPORT_PERIOD: "MR_INVALID_REPORT_PERIOD",
  INVALID_DATE_FORMAT: "MR_INVALID_DATE_FORMAT",

  // FGM specific errors
  FGM_MISSING_FUEL_GRADE_ID: "FGM_MISSING_FUEL_GRADE_ID",
  FGM_INVALID_TENDER_CODE: "FGM_INVALID_TENDER_CODE",
  FGM_INVALID_SALES_VOLUME: "FGM_INVALID_SALES_VOLUME",
  FGM_INVALID_SALES_AMOUNT: "FGM_INVALID_SALES_AMOUNT",
  FGM_MISMATCHED_TOTALS: "FGM_MISMATCHED_TOTALS",
  FGM_INVALID_POSITION_ID: "FGM_INVALID_POSITION_ID",

  // FPM specific errors
  FPM_MISSING_PRODUCT_ID: "FPM_MISSING_PRODUCT_ID",
  FPM_INVALID_METER_READING: "FPM_INVALID_METER_READING",

  // MSM specific errors
  MSM_INVALID_SUMMARY_CODE: "MSM_INVALID_SUMMARY_CODE",
  MSM_INVALID_AMOUNT: "MSM_INVALID_AMOUNT",

  // TLM specific errors
  TLM_MISSING_TAX_LEVEL_ID: "TLM_MISSING_TAX_LEVEL_ID",
  TLM_INVALID_TAX_AMOUNT: "TLM_INVALID_TAX_AMOUNT",

  // MCM specific errors
  MCM_MISSING_MERCHANDISE_CODE: "MCM_MISSING_MERCHANDISE_CODE",
} as const;

/**
 * Type for movement report error codes.
 */
export type NAXMLMovementReportErrorCode =
  (typeof NAXML_MOVEMENT_REPORT_ERROR_CODES)[keyof typeof NAXML_MOVEMENT_REPORT_ERROR_CODES];

/**
 * Movement report parsing result.
 *
 * @template T - The specific movement report data type
 */
export interface NAXMLMovementReportParseResult<T> {
  /** Whether parsing was successful */
  success: boolean;

  /** Movement report type detected */
  movementType: NAXMLMovementReportType;

  /** Parsed document (if successful) */
  document?: NAXMLMovementReportDocument<T>;

  /** Parsing errors (if any) */
  errors: NAXMLMovementReportParseError[];

  /** Parsing warnings (non-fatal issues) */
  warnings: NAXMLMovementReportParseWarning[];

  /** Source file information */
  sourceFile?: {
    fileName: string;
    fileHash: string;
    fileSizeBytes: number;
  };

  /** Processing duration in milliseconds */
  durationMs: number;
}

/**
 * Movement report parsing error.
 */
export interface NAXMLMovementReportParseError {
  /** Error code */
  code: NAXMLMovementReportErrorCode;

  /** Human-readable error message */
  message: string;

  /** XPath or location of the error */
  path?: string;

  /** Invalid value that caused the error */
  value?: string;
}

/**
 * Movement report parsing warning.
 */
export interface NAXMLMovementReportParseWarning {
  /** Warning code */
  code: string;

  /** Human-readable warning message */
  message: string;

  /** XPath or location of the warning */
  path?: string;
}
