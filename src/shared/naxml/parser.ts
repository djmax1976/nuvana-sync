/**
 * NAXML Parser Service
 *
 * Parses NAXML 3.x XML documents into typed TypeScript objects.
 * Implements secure XML parsing with XXE prevention.
 *
 * @module services/naxml/naxml.parser
 * @security XXE prevention via disabled external entities
 */

import { XMLParser, XMLValidator } from 'fast-xml-parser';
import {
  DEFAULT_NAXML_PARSER_OPTIONS,
  type NAXMLDocument,
  type NAXMLDocumentType,
  type NAXMLParserOptions,
  type NAXMLVersion,
  type NAXMLTransactionDocument,
  type NAXMLTransactionHeader,
  type NAXMLTransactionDetail,
  type NAXMLTransactionTender,
  type NAXMLTransactionTax,
  type NAXMLTransactionTotal,
  type NAXMLDepartmentDocument,
  type NAXMLDepartment,
  type NAXMLTenderDocument,
  type NAXMLTenderType,
  type NAXMLTaxRateDocument,
  type NAXMLTaxRate,
  type NAXMLPriceBookDocument,
  type NAXMLPriceBookItem,
  type NAXMLEmployeeDocument,
  type NAXMLEmployee,
  type NAXMLMaintenanceHeader,
  type NAXMLValidationResult,
  type NAXMLValidationError,
  // Movement Report types (FGM, FPM, MSM, TLM, MCM, ISM, TPM)
  type NAXMLFuelGradeMovementData,
  type NAXMLMovementHeader,
  type NAXMLSalesMovementHeader,
  type NAXMLFGMDetail,
  type NAXMLFGMTenderSummary,
  type NAXMLFGMTender,
  type NAXMLFGMSellPriceSummary,
  type NAXMLFGMServiceLevelSummary,
  type NAXMLFGMSalesTotals,
  type NAXMLFGMPumpTestTotals,
  type NAXMLFGMPositionSummary,
  type NAXMLFGMNonResettableTotal,
  type NAXMLFGMPriceTierSummary,
  type NAXMLPrimaryReportPeriod,
  VALID_FUEL_TENDER_CODES,
  type NAXMLFuelTenderCode,
  // MSM types
  type NAXMLMiscellaneousSummaryMovementData,
  type NAXMLMSMDetail,
  type NAXMLMiscellaneousSummaryCodes,
  type NAXMLMSMSalesTotals,
  // MSM Fuel Data Extraction types
  type MSMFuelSalesByGrade,
  type MSMOutsideDispenserRecord,
  type MSMDiscountTotals,
  type MSMFuelTotals,
  type MSMExtractedFuelData,
  // FPM types
  type NAXMLFuelProductMovementData,
  type NAXMLFPMDetail,
  type NAXMLFPMNonResettableTotals,
  // ISM types
  type NAXMLItemSalesMovementData,
  type NAXMLISMDetail,
  // TPM types
  type NAXMLTankProductMovementData,
  type NAXMLTPMDetail,
  // TLM types
  type NAXMLTaxLevelMovementData,
  type NAXMLTLMDetail,
  // MCM types
  type NAXMLMerchandiseCodeMovementData,
  type NAXMLMCMDetail,
  type NAXMLMCMSalesTotals,
  // POSJournal types (PJR)
  type NAXMLPOSJournalDocument,
  type NAXMLTransmissionHeader,
  type NAXMLJournalReport,
  type NAXMLJournalHeader,
  type NAXMLSaleEvent,
  type NAXMLOtherEvent,
  type NAXMLTransactionDetailGroup,
  type NAXMLTransactionLine,
  type NAXMLTransactionLineStatus,
  type NAXMLFuelLine,
  type NAXMLFuelPrepayLine,
  type NAXMLMerchandiseLine,
  type NAXMLJournalTenderInfo,
  type NAXMLJournalTender,
  type NAXMLJournalTransactionTax,
  type NAXMLJournalTransactionSummary,
  type NAXMLLinkedTransactionInfo,
  type NAXMLItemTax,
  type NAXMLServiceLevelCode,
  type NAXMLEntryMethod,
  type NAXMLTenderCode,
  type NAXMLTransactionLinkReason,
} from './types';
import {
  NAXMLFuelGradeMovementDataSchema,
  NAXMLMiscellaneousSummaryMovementDataSchema,
  NAXMLFuelProductMovementDataSchema,
} from './schema';

// ============================================================================
// Error Codes
// ============================================================================

export const NAXML_PARSER_ERROR_CODES = {
  INVALID_XML: 'NAXML_INVALID_XML',
  UNSUPPORTED_VERSION: 'NAXML_UNSUPPORTED_VERSION',
  UNKNOWN_DOCUMENT_TYPE: 'NAXML_UNKNOWN_DOCUMENT_TYPE',
  MISSING_REQUIRED_FIELD: 'NAXML_MISSING_REQUIRED_FIELD',
  INVALID_FIELD_VALUE: 'NAXML_INVALID_FIELD_VALUE',
  PARSE_ERROR: 'NAXML_PARSE_ERROR',
  // FGM-specific error codes
  FGM_MISSING_FUEL_GRADE_ID: 'FGM_MISSING_FUEL_GRADE_ID',
  FGM_INVALID_TENDER_CODE: 'FGM_INVALID_TENDER_CODE',
  FGM_INVALID_SALES_VOLUME: 'FGM_INVALID_SALES_VOLUME',
  FGM_INVALID_SALES_AMOUNT: 'FGM_INVALID_SALES_AMOUNT',
  FGM_INVALID_REPORT_PERIOD: 'FGM_INVALID_REPORT_PERIOD',
  FGM_MISSING_MOVEMENT_HEADER: 'FGM_MISSING_MOVEMENT_HEADER',
  FGM_VALIDATION_FAILED: 'FGM_VALIDATION_FAILED',
  // MSM-specific error codes
  MSM_MISSING_MOVEMENT_HEADER: 'MSM_MISSING_MOVEMENT_HEADER',
  MSM_MISSING_SUMMARY_CODES: 'MSM_MISSING_SUMMARY_CODES',
  MSM_INVALID_TENDER_CODE: 'MSM_INVALID_TENDER_CODE',
  MSM_VALIDATION_FAILED: 'MSM_VALIDATION_FAILED',
  // FPM-specific error codes
  FPM_MISSING_MOVEMENT_HEADER: 'FPM_MISSING_MOVEMENT_HEADER',
  FPM_MISSING_PRODUCT_ID: 'FPM_MISSING_PRODUCT_ID',
  FPM_MISSING_POSITION_ID: 'FPM_MISSING_POSITION_ID',
  FPM_INVALID_METER_READING: 'FPM_INVALID_METER_READING',
  FPM_VALIDATION_FAILED: 'FPM_VALIDATION_FAILED',
} as const;

export type NAXMLParserErrorCode =
  (typeof NAXML_PARSER_ERROR_CODES)[keyof typeof NAXML_PARSER_ERROR_CODES];

// ============================================================================
// Parser Error Class
// ============================================================================

/**
 * Custom error class for NAXML parsing errors
 */
export class NAXMLParserError extends Error {
  readonly code: NAXMLParserErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: NAXMLParserErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'NAXMLParserError';
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, NAXMLParserError.prototype);
  }
}

// ============================================================================
// Secure XML Parser Configuration
// ============================================================================

/**
 * Creates a secure XML parser with XXE prevention
 * @security Disables external entities, DTD processing, and parameter entities
 */
function createSecureXMLParser(options: NAXMLParserOptions): XMLParser {
  return new XMLParser({
    // Security: Disable external entity resolution (XXE prevention)
    // Note: fast-xml-parser does not support external entities by default,
    // but we explicitly configure it for defense in depth
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    cdataPropName: '#cdata',
    // Parsing options - keep attributes as strings to preserve leading zeros in codes (e.g., Code="001")
    parseAttributeValue: false,
    // Keep tag values as strings to preserve leading zeros in codes (e.g., "001")
    parseTagValue: false,
    trimValues: options.trimWhitespace,
    // Array handling - force arrays for repeating elements
    isArray: (name: string) => {
      return ARRAY_ELEMENT_NAMES.includes(name);
    },
    // Tag name transformation
    tagValueProcessor: (_tagName: string, tagValue: string) => {
      // Handle boolean values
      if (tagValue === 'Y' || tagValue === 'true') return true;
      if (tagValue === 'N' || tagValue === 'false') return false;
      return tagValue;
    },
  });
}

/**
 * Elements that should always be parsed as arrays
 * SEC-014: Explicit allowlist of array element names
 */
const ARRAY_ELEMENT_NAMES = [
  // Standard NAXML elements
  'LineItem',
  'Tender',
  'Tax',
  'Department',
  'Item',
  'Employee',
  'TaxRate',
  'ModifierCode',
  'Error',
  // Movement Report elements (FGM, MSM, FPM, TLM, MCM, ISM, TPM)
  'FGMDetail',
  'FGMTenderSummary',
  'FGMPositionSummary',
  'FGMPriceTierSummary',
  'FPMDetail',
  'FPMNonResettableTotals',
  'MSMDetail',
  'TLMDetail',
  'MCMDetail',
  'ISMDetail',
  'TPMDetail',
  // POSJournal elements (PJR)
  'SaleEvent',
  'OtherEvent',
  'TransactionLine',
];

// ============================================================================
// Parser Class
// ============================================================================

/**
 * NAXML Parser
 *
 * Parses NAXML XML documents into typed TypeScript objects.
 * Supports transaction documents, maintenance documents, and acknowledgments.
 */
export class NAXMLParser {
  private readonly options: NAXMLParserOptions;
  private readonly parser: XMLParser;

  constructor(options: Partial<NAXMLParserOptions> = {}) {
    this.options = { ...DEFAULT_NAXML_PARSER_OPTIONS, ...options };
    this.parser = createSecureXMLParser(this.options);
  }

  /**
   * Parse an NAXML document string
   *
   * @param xml - The XML string to parse
   * @returns Parsed NAXML document
   * @throws NAXMLParserError on parsing failure
   */
  parse<T = unknown>(xml: string): NAXMLDocument<T> {
    // Validate XML structure first
    const validationResult = XMLValidator.validate(xml);
    if (validationResult !== true) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.INVALID_XML,
        `Invalid XML structure: ${validationResult.err?.msg || 'Unknown error'}`,
        { line: validationResult.err?.line, col: validationResult.err?.col }
      );
    }

    // Parse XML
    const parsed = this.parser.parse(xml);

    // Detect document type
    const documentType = this.detectDocumentType(parsed);
    if (!documentType) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.UNKNOWN_DOCUMENT_TYPE,
        'Unable to determine NAXML document type from root element'
      );
    }

    // Extract version
    const version = this.extractVersion(parsed, documentType);

    // Parse based on document type
    const data = this.parseDocumentData<T>(parsed, documentType);

    // Extract timestamp and store ID
    const { timestamp, storeLocationId } = this.extractMetadata(parsed, documentType);

    return {
      documentType,
      version,
      timestamp,
      storeLocationId,
      data,
    };
  }

  /**
   * Parse a transaction document
   */
  parseTransaction(xml: string): NAXMLDocument<NAXMLTransactionDocument> {
    return this.parse<NAXMLTransactionDocument>(xml);
  }

  /**
   * Parse a department maintenance document
   */
  parseDepartments(xml: string): NAXMLDocument<NAXMLDepartmentDocument> {
    return this.parse<NAXMLDepartmentDocument>(xml);
  }

  /**
   * Parse a tender maintenance document
   */
  parseTenders(xml: string): NAXMLDocument<NAXMLTenderDocument> {
    return this.parse<NAXMLTenderDocument>(xml);
  }

  /**
   * Parse a tax rate maintenance document
   */
  parseTaxRates(xml: string): NAXMLDocument<NAXMLTaxRateDocument> {
    return this.parse<NAXMLTaxRateDocument>(xml);
  }

  /**
   * Parse a price book document
   */
  parsePriceBook(xml: string): NAXMLDocument<NAXMLPriceBookDocument> {
    return this.parse<NAXMLPriceBookDocument>(xml);
  }

  /**
   * Parse an employee maintenance document
   */
  parseEmployees(xml: string): NAXMLDocument<NAXMLEmployeeDocument> {
    return this.parse<NAXMLEmployeeDocument>(xml);
  }

  /**
   * Parse a Fuel Grade Movement (FGM) document.
   *
   * Parses FGM files containing fuel sales data broken down by grade, tender type,
   * and/or fuel position. This method handles both "by tender" (Period 2) and
   * "by position" (Period 98) FGM variants.
   *
   * @param xml - The FGM XML string to parse
   * @returns Parsed FGM document with Zod-validated data
   * @throws NAXMLParserError with code FGM_VALIDATION_FAILED if Zod validation fails
   *
   * @example
   * ```typescript
   * const parser = createNAXMLParser();
   * const result = parser.parseFuelGradeMovement(fgmXmlString);
   * console.log(result.data.movementHeader.businessDate);
   * console.log(result.data.fgmDetails.length);
   * ```
   */
  parseFuelGradeMovement(xml: string): NAXMLDocument<NAXMLFuelGradeMovementData> {
    const result = this.parse<NAXMLFuelGradeMovementData>(xml);

    // Validate with Zod schema
    const validationResult = NAXMLFuelGradeMovementDataSchema.safeParse(result.data);
    if (!validationResult.success) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FGM_VALIDATION_FAILED,
        `FGM validation failed: ${validationResult.error.message}`,
        { zodErrors: validationResult.error.issues }
      );
    }

    return result;
  }

  /**
   * Parse a Miscellaneous Summary Movement (MSM) document.
   *
   * Parses MSM files containing summary data including:
   * - Grand totals (sales, non-taxable, fuel/merchandise breakdowns)
   * - Drawer operations (safe drops, loans, payouts, payins)
   * - Transaction statistics (counts, voids, refunds, driveoffs)
   * - Fuel sales by grade (aggregated by grade)
   * - Tax totals by code
   * - Tender breakdown by method of payment
   *
   * @param xml - The MSM XML string to parse
   * @returns Parsed MSM document with Zod-validated data
   * @throws NAXMLParserError with code MSM_VALIDATION_FAILED if Zod validation fails
   *
   * @example
   * ```typescript
   * const parser = createNAXMLParser();
   * const result = parser.parseMiscellaneousSummaryMovement(msmXmlString);
   * console.log(result.data.movementHeader.businessDate);
   * console.log(result.data.msmDetails.length);
   * ```
   */
  parseMiscellaneousSummaryMovement(
    xml: string
  ): NAXMLDocument<NAXMLMiscellaneousSummaryMovementData> {
    const result = this.parse<NAXMLMiscellaneousSummaryMovementData>(xml);

    // Validate with Zod schema
    const validationResult = NAXMLMiscellaneousSummaryMovementDataSchema.safeParse(result.data);
    if (!validationResult.success) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.MSM_VALIDATION_FAILED,
        `MSM validation failed: ${validationResult.error.message}`,
        { zodErrors: validationResult.error.issues }
      );
    }

    return result;
  }

  /**
   * Parse a Fuel Product Movement (FPM) document.
   *
   * Parses FPM files containing non-resettable pump meter readings used for
   * fuel reconciliation. Each FPM file contains cumulative totalizer readings
   * for all fuel products across all dispensing positions.
   *
   * @param xml - The FPM XML string to parse
   * @returns Parsed FPM document with Zod-validated data
   * @throws NAXMLParserError with code FPM_VALIDATION_FAILED if Zod validation fails
   *
   * @example
   * ```typescript
   * const parser = createNAXMLParser();
   * const result = parser.parseFuelProductMovement(fpmXmlString);
   * console.log(result.data.movementHeader.businessDate);
   * console.log(result.data.fpmDetails.length);
   * // Access meter readings for product 1, position 1:
   * const product1 = result.data.fpmDetails.find(d => d.fuelProductId === '1');
   * const pos1Reading = product1?.fpmNonResettableTotals.find(t => t.fuelPositionId === '1');
   * console.log(pos1Reading?.fuelProductNonResettableVolumeNumber);
   * ```
   */
  parseFuelProductMovement(xml: string): NAXMLDocument<NAXMLFuelProductMovementData> {
    const result = this.parse<NAXMLFuelProductMovementData>(xml);

    // Validate with Zod schema
    const validationResult = NAXMLFuelProductMovementDataSchema.safeParse(result.data);
    if (!validationResult.success) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FPM_VALIDATION_FAILED,
        `FPM validation failed: ${validationResult.error.message}`,
        { zodErrors: validationResult.error.issues }
      );
    }

    return result;
  }

  /**
   * Validate XML without full parsing
   */
  validate(xml: string): NAXMLValidationResult {
    const errors: NAXMLValidationError[] = [];
    const warnings: NAXMLValidationError[] = [];

    // Basic XML structure validation
    const structureResult = XMLValidator.validate(xml);
    if (structureResult !== true) {
      errors.push({
        code: NAXML_PARSER_ERROR_CODES.INVALID_XML,
        message: structureResult.err?.msg || 'Invalid XML structure',
        line: structureResult.err?.line,
        column: structureResult.err?.col,
        severity: 'critical',
      });
      return { isValid: false, errors, warnings };
    }

    // Parse to check document type
    try {
      const parsed = this.parser.parse(xml);
      const documentType = this.detectDocumentType(parsed);

      if (!documentType) {
        errors.push({
          code: NAXML_PARSER_ERROR_CODES.UNKNOWN_DOCUMENT_TYPE,
          message: 'Unable to determine NAXML document type',
          severity: 'critical',
        });
        return { isValid: false, errors, warnings };
      }

      const version = this.extractVersion(parsed, documentType);

      // Version check
      if (!['3.2', '3.4', '4.0'].includes(version)) {
        warnings.push({
          code: NAXML_PARSER_ERROR_CODES.UNSUPPORTED_VERSION,
          message: `NAXML version ${version} may not be fully supported`,
          severity: 'error',
        });
      }

      return {
        isValid: errors.length === 0,
        documentType,
        version,
        errors,
        warnings,
      };
    } catch (error) {
      errors.push({
        code: NAXML_PARSER_ERROR_CODES.PARSE_ERROR,
        message: error instanceof Error ? error.message : 'Unknown parse error',
        severity: 'critical',
      });
      return { isValid: false, errors, warnings };
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Detect the NAXML document type from parsed XML
   * SEC-014: Uses strict allowlist matching for document type detection
   */
  private detectDocumentType(parsed: Record<string, unknown>): NAXMLDocumentType | null {
    const rootKeys = Object.keys(parsed);

    for (const key of rootKeys) {
      // POSJournal (Gilbarco Passport PJR files) - NAXML-POSJournal root element
      if (key.includes('NAXML-POSJournal') || key.includes('POSJournal')) {
        return 'POSJournal';
      }
      // Movement Report types (Gilbarco Passport) - check NAXML-MovementReport first
      if (key.includes('NAXML-MovementReport') || key.includes('MovementReport')) {
        // Need to inspect child elements to determine specific type
        const root = parsed[key] as Record<string, unknown>;
        if (root?.FuelGradeMovement) return 'FuelGradeMovement';
        if (root?.FuelProductMovement) return 'FuelProductMovement';
        if (root?.MiscellaneousSummaryMovement) return 'MiscellaneousSummaryMovement';
        if (root?.TaxLevelMovement) return 'TaxLevelMovement';
        if (root?.MerchandiseCodeMovement) return 'MerchandiseCodeMovement';
        if (root?.ItemSalesMovement) return 'ItemSalesMovement';
        if (root?.TankProductMovement) return 'TankProductMovement';
      }
      // Standard NAXML document types
      if (key.includes('TransactionDocument')) return 'TransactionDocument';
      if (key.includes('DepartmentMaintenance')) return 'DepartmentMaintenance';
      if (key.includes('TenderMaintenance')) return 'TenderMaintenance';
      if (key.includes('TaxRateMaintenance')) return 'TaxRateMaintenance';
      if (key.includes('PriceBookMaintenance')) return 'PriceBookMaintenance';
      if (key.includes('EmployeeMaintenance')) return 'EmployeeMaintenance';
      if (key.includes('InventoryMovement')) return 'InventoryMovement';
      if (key.includes('Acknowledgment')) return 'Acknowledgment';
    }

    return null;
  }

  /**
   * Extract NAXML version from parsed document
   */
  private extractVersion(
    parsed: Record<string, unknown>,
    documentType: NAXMLDocumentType
  ): NAXMLVersion {
    const rootKey = this.getRootKey(parsed, documentType);
    const root = parsed[rootKey] as Record<string, unknown>;

    // Check for version attribute
    const versionRaw = root?.['@_version'];
    // Convert to string if the parser returned a number
    const version = versionRaw != null ? String(versionRaw) : undefined;

    if (version) {
      if (version.startsWith('3.2')) return '3.2';
      if (version.startsWith('3.4')) return '3.4';
      if (version.startsWith('4')) return '4.0';
    }

    // Default to 3.4 if not specified
    return this.options.version;
  }

  /**
   * Get the root element key for a document type
   * SEC-014: Handles MovementReport and POSJournal special cases
   */
  private getRootKey(parsed: Record<string, unknown>, documentType: NAXMLDocumentType): string {
    const keys = Object.keys(parsed);

    // POSJournal uses NAXML-POSJournal as root
    if (documentType === 'POSJournal') {
      const journalKey = keys.find(
        (k) => k.includes('NAXML-POSJournal') || k.includes('POSJournal')
      );
      if (journalKey) return journalKey;
    }

    // Movement Report types use NAXML-MovementReport as root
    const movementReportTypes = [
      'FuelGradeMovement',
      'FuelProductMovement',
      'MiscellaneousSummaryMovement',
      'TaxLevelMovement',
      'MerchandiseCodeMovement',
      'ItemSalesMovement',
      'TankProductMovement',
    ];

    if (movementReportTypes.includes(documentType)) {
      const movementKey = keys.find(
        (k) => k.includes('NAXML-MovementReport') || k.includes('MovementReport')
      );
      if (movementKey) return movementKey;
    }

    return keys.find((k) => k.includes(documentType)) || keys[0] || documentType;
  }

  /**
   * Check if document type is a Movement Report type
   */
  private isMovementReportType(documentType: NAXMLDocumentType): boolean {
    return [
      'FuelGradeMovement',
      'FuelProductMovement',
      'MiscellaneousSummaryMovement',
      'TaxLevelMovement',
      'MerchandiseCodeMovement',
      'ItemSalesMovement',
      'TankProductMovement',
    ].includes(documentType);
  }

  /**
   * Extract metadata (timestamp, store ID) from document
   * SEC-014: Handles MovementReport special case (TransmissionHeader)
   */
  private extractMetadata(
    parsed: Record<string, unknown>,
    documentType: NAXMLDocumentType
  ): { timestamp: Date; storeLocationId: string } {
    const rootKey = this.getRootKey(parsed, documentType);
    const root = parsed[rootKey] as Record<string, unknown>;

    let storeLocationId = '';
    let timestamp = new Date();

    // Movement Report types use TransmissionHeader and MovementHeader
    if (this.isMovementReportType(documentType)) {
      const transmissionHeader = root?.TransmissionHeader as Record<string, unknown>;
      storeLocationId = String(transmissionHeader?.StoreLocationID || '');

      // Get the specific movement type container
      const movementContainer = root?.[documentType] as Record<string, unknown>;
      const movementHeader = movementContainer?.MovementHeader as Record<string, unknown>;

      if (movementHeader?.BusinessDate) {
        const dateStr = String(movementHeader.BusinessDate);
        const timeStr = movementHeader?.BeginTime ? String(movementHeader.BeginTime) : '00:00:00';
        // eslint-disable-next-line no-restricted-syntax -- Parsing NAXML business dates in ISO format
        timestamp = new Date(`${dateStr}T${timeStr}`);
      }
    } else if (documentType === 'TransactionDocument') {
      // Transaction documents
      const header = root?.TransactionHeader as Record<string, unknown>;
      storeLocationId = String(header?.StoreLocationID || '');
      const dateStr = header?.TransactionDate as string;
      if (dateStr) {
        timestamp = new Date(dateStr);
      }
    } else {
      // Maintenance documents
      const header = root?.MaintenanceHeader as Record<string, unknown>;
      storeLocationId = String(header?.StoreLocationID || '');
      const dateStr = header?.MaintenanceDate as string;
      if (dateStr) {
        timestamp = new Date(dateStr);
      }
    }

    return { timestamp, storeLocationId };
  }

  /**
   * Parse document data based on type
   * SEC-014: Routes Movement Report types to specialized parsers
   */
  private parseDocumentData<T>(
    parsed: Record<string, unknown>,
    documentType: NAXMLDocumentType
  ): T {
    const rootKey = this.getRootKey(parsed, documentType);
    const root = parsed[rootKey] as Record<string, unknown>;

    switch (documentType) {
      case 'TransactionDocument':
        return this.parseTransactionData(root) as T;
      case 'DepartmentMaintenance':
        return this.parseDepartmentData(root) as T;
      case 'TenderMaintenance':
        return this.parseTenderData(root) as T;
      case 'TaxRateMaintenance':
        return this.parseTaxRateData(root) as T;
      case 'PriceBookMaintenance':
        return this.parsePriceBookData(root) as T;
      case 'EmployeeMaintenance':
        return this.parseEmployeeData(root) as T;
      // Movement Report types
      case 'FuelGradeMovement':
        return this.parseFuelGradeMovementData(root) as T;
      case 'FuelProductMovement':
        return this.parseFuelProductMovementData(root) as T;
      case 'MiscellaneousSummaryMovement':
        return this.parseMiscellaneousSummaryMovementData(root) as T;
      case 'ItemSalesMovement':
        return this.parseItemSalesMovementData(root) as T;
      case 'TankProductMovement':
        return this.parseTankProductMovementData(root) as T;
      case 'TaxLevelMovement':
        return this.parseTaxLevelMovementData(root) as T;
      case 'MerchandiseCodeMovement':
        return this.parseMerchandiseCodeMovementData(root) as T;
      // POSJournal (PJR)
      case 'POSJournal':
        return this.parsePOSJournalData(root) as T;
      default:
        return root as T;
    }
  }

  /**
   * Parse transaction document data
   */
  private parseTransactionData(root: Record<string, unknown>): NAXMLTransactionDocument {
    const header = root.TransactionHeader as Record<string, unknown>;
    const detailContainer = root.TransactionDetail as Record<string, unknown>;
    const tenderContainer = root.TransactionTender as Record<string, unknown>;
    const taxContainer = root.TransactionTax as Record<string, unknown>;
    const totalContainer = root.TransactionTotal as Record<string, unknown>;

    return {
      transactionHeader: this.parseTransactionHeader(header),
      transactionDetail: this.parseTransactionDetails(detailContainer),
      transactionTender: this.parseTransactionTenders(tenderContainer),
      transactionTax: this.parseTransactionTaxes(taxContainer),
      transactionTotal: this.parseTransactionTotal(totalContainer),
    };
  }

  private parseTransactionHeader(header: Record<string, unknown>): NAXMLTransactionHeader {
    // Support both ID (NAXML spec) and Id (common variation) suffixes
    return {
      storeLocationId: String(header?.StoreLocationID || header?.StoreLocationId || ''),
      terminalId: String(header?.TerminalID || header?.TerminalId || ''),
      transactionId: String(header?.TransactionID || header?.TransactionId || ''),
      businessDate: String(header?.BusinessDate || ''),
      transactionDate: String(header?.TransactionDate || ''),
      transactionType: String(header?.TransactionType || 'Sale') as
        | 'Sale'
        | 'Refund'
        | 'VoidSale'
        | 'NoSale'
        | 'PaidOut'
        | 'PaidIn'
        | 'SafeDrop'
        | 'EndOfShift',
      cashierId:
        header?.CashierID || header?.CashierId
          ? String(header.CashierID || header.CashierId)
          : undefined,
      operatorId:
        header?.OperatorID || header?.OperatorId
          ? String(header.OperatorID || header.OperatorId)
          : undefined,
      shiftNumber: header?.ShiftNumber ? String(header.ShiftNumber) : undefined,
    };
  }

  private parseTransactionDetails(container: Record<string, unknown>): NAXMLTransactionDetail[] {
    const items = this.ensureArray(container?.LineItem);
    return items.map((item: Record<string, unknown>, index: number) => ({
      lineNumber: Number(item?.LineNumber || item?.['@_LineNumber'] || index + 1),
      itemCode: String(item?.ItemCode || ''),
      description: String(item?.Description || ''),
      departmentCode: String(item?.DepartmentCode || ''),
      quantity: this.parseNumber(item?.Quantity, 1),
      unitPrice: this.parseNumber(item?.UnitPrice, 0),
      extendedPrice: this.parseNumber(item?.ExtendedPrice, 0),
      taxCode: item?.TaxCode ? String(item.TaxCode) : undefined,
      taxAmount: this.parseNumber(item?.TaxAmount, 0),
      discountAmount: item?.DiscountAmount ? this.parseNumber(item.DiscountAmount, 0) : undefined,
      modifierCodes: item?.ModifierCodes
        ? this.ensureArray(item.ModifierCodes).map(String)
        : undefined,
      isVoid: Boolean(item?.IsVoid),
      isRefund: Boolean(item?.IsRefund),
    }));
  }

  private parseTransactionTenders(container: Record<string, unknown>): NAXMLTransactionTender[] {
    const tenders = this.ensureArray(container?.Tender);
    return tenders.map((tender: Record<string, unknown>) => ({
      tenderCode: String(tender?.TenderCode || ''),
      tenderDescription: String(tender?.TenderDescription || ''),
      amount: this.parseNumber(tender?.Amount, 0),
      referenceNumber: tender?.ReferenceNumber ? String(tender.ReferenceNumber) : undefined,
      cardType: tender?.CardType ? String(tender.CardType) : undefined,
      cardLast4: tender?.CardLast4 ? String(tender.CardLast4) : undefined,
      changeGiven: tender?.ChangeGiven ? this.parseNumber(tender.ChangeGiven, 0) : undefined,
    }));
  }

  private parseTransactionTaxes(container: Record<string, unknown>): NAXMLTransactionTax[] {
    const taxes = this.ensureArray(container?.Tax);
    return taxes.map((tax: Record<string, unknown>) => ({
      taxCode: String(tax?.TaxCode || tax?.['@_TaxCode'] || ''),
      taxDescription: String(tax?.TaxDescription || ''),
      taxableAmount: this.parseNumber(tax?.TaxableAmount, 0),
      taxAmount: this.parseNumber(tax?.TaxAmount, 0),
      taxRate: this.parseNumber(tax?.TaxRate, 0),
      jurisdiction: tax?.Jurisdiction ? String(tax.Jurisdiction) : undefined,
    }));
  }

  private parseTransactionTotal(container: Record<string, unknown>): NAXMLTransactionTotal {
    return {
      subtotal: this.parseNumber(container?.Subtotal, 0),
      taxTotal: this.parseNumber(container?.TaxTotal, 0),
      grandTotal: this.parseNumber(container?.GrandTotal, 0),
      discountTotal: container?.DiscountTotal
        ? this.parseNumber(container.DiscountTotal, 0)
        : undefined,
      changeDue: container?.ChangeDue ? this.parseNumber(container.ChangeDue, 0) : undefined,
      itemCount: container?.ItemCount ? Number(container.ItemCount) : undefined,
    };
  }

  /**
   * Parse department maintenance data
   */
  private parseDepartmentData(root: Record<string, unknown>): NAXMLDepartmentDocument {
    const header = root.MaintenanceHeader as Record<string, unknown>;
    const deptContainer = root.Departments as Record<string, unknown>;

    return {
      maintenanceHeader: this.parseMaintenanceHeader(header),
      departments: this.parseDepartmentList(deptContainer),
    };
  }

  private parseMaintenanceHeader(header: Record<string, unknown>): NAXMLMaintenanceHeader {
    return {
      storeLocationId: String(header?.StoreLocationID || ''),
      maintenanceDate: String(header?.MaintenanceDate || ''),
      maintenanceType: (header?.MaintenanceType === 'Incremental' ? 'Incremental' : 'Full') as
        | 'Full'
        | 'Incremental',
      effectiveDate: header?.EffectiveDate ? String(header.EffectiveDate) : undefined,
      sequenceNumber: header?.SequenceNumber ? Number(header.SequenceNumber) : undefined,
    };
  }

  private parseDepartmentList(container: Record<string, unknown>): NAXMLDepartment[] {
    const depts = this.ensureArray(container?.Department);
    return depts.map((dept: Record<string, unknown>) => ({
      departmentCode: String(dept?.Code || dept?.['@_Code'] || dept?.DepartmentCode || ''),
      description: String(dept?.Description || ''),
      isTaxable: this.parseBoolean(dept?.IsTaxable),
      taxRateCode: dept?.TaxRateCode ? String(dept.TaxRateCode) : undefined,
      minimumAge: dept?.MinimumAge ? Number(dept.MinimumAge) : undefined,
      isActive: this.parseBoolean(dept?.IsActive, true),
      sortOrder: dept?.SortOrder ? Number(dept.SortOrder) : undefined,
      action: dept?.['@_Action'] as 'Add' | 'Update' | 'Delete' | 'AddUpdate' | undefined,
    }));
  }

  /**
   * Parse tender maintenance data
   */
  private parseTenderData(root: Record<string, unknown>): NAXMLTenderDocument {
    const header = root.MaintenanceHeader as Record<string, unknown>;
    const tenderContainer = root.Tenders as Record<string, unknown>;

    return {
      maintenanceHeader: this.parseMaintenanceHeader(header),
      tenders: this.parseTenderTypes(tenderContainer),
    };
  }

  private parseTenderTypes(container: Record<string, unknown>): NAXMLTenderType[] {
    const tenders = this.ensureArray(container?.Tender);
    return tenders.map((tender: Record<string, unknown>) => ({
      tenderCode: String(tender?.Code || tender?.['@_Code'] || tender?.TenderCode || ''),
      description: String(tender?.Description || ''),
      isCashEquivalent: this.parseBoolean(tender?.IsCashEquivalent),
      isElectronic: this.parseBoolean(tender?.IsElectronic),
      affectsCashDrawer: this.parseBoolean(tender?.AffectsCashDrawer, true),
      requiresReference: this.parseBoolean(tender?.RequiresReference),
      isActive: this.parseBoolean(tender?.IsActive, true),
      sortOrder: tender?.SortOrder ? Number(tender.SortOrder) : undefined,
      action: tender?.['@_Action'] as 'Add' | 'Update' | 'Delete' | 'AddUpdate' | undefined,
    }));
  }

  /**
   * Parse tax rate maintenance data
   */
  private parseTaxRateData(root: Record<string, unknown>): NAXMLTaxRateDocument {
    const header = root.MaintenanceHeader as Record<string, unknown>;
    const taxContainer = root.TaxRates as Record<string, unknown>;

    return {
      maintenanceHeader: this.parseMaintenanceHeader(header),
      taxRates: this.parseTaxRateList(taxContainer),
    };
  }

  private parseTaxRateList(container: Record<string, unknown>): NAXMLTaxRate[] {
    const rates = this.ensureArray(container?.TaxRate);
    return rates.map((rate: Record<string, unknown>) => ({
      taxRateCode: String(rate?.Code || rate?.['@_Code'] || rate?.TaxRateCode || ''),
      description: String(rate?.Description || ''),
      rate: this.parseNumber(rate?.Rate, 0),
      isActive: this.parseBoolean(rate?.IsActive, true),
      jurisdictionCode: rate?.JurisdictionCode ? String(rate.JurisdictionCode) : undefined,
      taxType: rate?.TaxType ? String(rate.TaxType) : undefined,
      action: rate?.['@_Action'] as 'Add' | 'Update' | 'Delete' | 'AddUpdate' | undefined,
    }));
  }

  /**
   * Parse price book data
   */
  private parsePriceBookData(root: Record<string, unknown>): NAXMLPriceBookDocument {
    const header = root.MaintenanceHeader as Record<string, unknown>;
    const itemContainer = root.Items as Record<string, unknown>;

    return {
      maintenanceHeader: this.parseMaintenanceHeader(header),
      items: this.parsePriceBookItems(itemContainer),
    };
  }

  private parsePriceBookItems(container: Record<string, unknown>): NAXMLPriceBookItem[] {
    const items = this.ensureArray(container?.Item);
    return items.map((item: Record<string, unknown>) => ({
      itemCode: String(item?.ItemCode || item?.Code || ''),
      description: String(item?.Description || ''),
      shortDescription: item?.ShortDescription ? String(item.ShortDescription) : undefined,
      departmentCode: String(item?.DepartmentCode || ''),
      unitPrice: this.parseNumber(item?.UnitPrice, 0),
      taxRateCode: String(item?.TaxRateCode || ''),
      isActive: this.parseBoolean(item?.IsActive, true),
      effectiveDate: item?.EffectiveDate ? String(item.EffectiveDate) : undefined,
      expirationDate: item?.ExpirationDate ? String(item.ExpirationDate) : undefined,
      minimumAge: item?.MinimumAge ? Number(item.MinimumAge) : undefined,
      foodStampEligible: item?.FoodStampEligible
        ? this.parseBoolean(item.FoodStampEligible)
        : undefined,
      action: item?.['@_Action'] as 'Add' | 'Update' | 'Delete' | 'AddUpdate' | undefined,
    }));
  }

  /**
   * Parse employee data
   */
  private parseEmployeeData(root: Record<string, unknown>): NAXMLEmployeeDocument {
    const header = root.MaintenanceHeader as Record<string, unknown>;
    const empContainer = root.Employees as Record<string, unknown>;

    return {
      maintenanceHeader: this.parseMaintenanceHeader(header),
      employees: this.parseEmployeeList(empContainer),
    };
  }

  private parseEmployeeList(container: Record<string, unknown>): NAXMLEmployee[] {
    const employees = this.ensureArray(container?.Employee);
    return employees.map((emp: Record<string, unknown>) => ({
      employeeId: String(emp?.EmployeeID || emp?.ID || ''),
      firstName: String(emp?.FirstName || ''),
      lastName: String(emp?.LastName || ''),
      isActive: this.parseBoolean(emp?.IsActive, true),
      pinHash: emp?.PINHash ? String(emp.PINHash) : undefined,
      jobTitle: emp?.JobTitle ? String(emp.JobTitle) : undefined,
      hireDate: emp?.HireDate ? String(emp.HireDate) : undefined,
      terminationDate: emp?.TerminationDate ? String(emp.TerminationDate) : undefined,
      accessLevel: emp?.AccessLevel ? Number(emp.AccessLevel) : undefined,
      action: emp?.['@_Action'] as 'Add' | 'Update' | 'Delete' | 'AddUpdate' | undefined,
    }));
  }

  // ============================================================================
  // Movement Report Parsing Methods (FGM, FPM, MSM, TLM, MCM, ISM, TPM)
  // ============================================================================

  /**
   * Parse Fuel Grade Movement (FGM) document data.
   *
   * This method parses the root NAXML-MovementReport element containing
   * FuelGradeMovement data. Handles both "by tender" and "by position" variants.
   *
   * @param root - The parsed NAXML-MovementReport root element
   * @returns Parsed FGM data structure
   * @throws NAXMLParserError if required fields are missing
   *
   * SEC-014: Validates required fields and uses strict type parsing
   */
  private parseFuelGradeMovementData(root: Record<string, unknown>): NAXMLFuelGradeMovementData {
    const fgmContainer = root.FuelGradeMovement as Record<string, unknown>;

    if (!fgmContainer) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.MISSING_REQUIRED_FIELD,
        'FuelGradeMovement element not found in document'
      );
    }

    const movementHeaderRaw = fgmContainer.MovementHeader as Record<string, unknown>;
    if (!movementHeaderRaw) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FGM_MISSING_MOVEMENT_HEADER,
        'MovementHeader not found in FuelGradeMovement'
      );
    }

    const movementHeader = this.parseMovementHeader(movementHeaderRaw);

    // SalesMovementHeader is optional (present only for shift reports, Period 98)
    const salesMovementHeaderRaw = fgmContainer.SalesMovementHeader as
      | Record<string, unknown>
      | undefined;
    const salesMovementHeader = salesMovementHeaderRaw
      ? this.parseSalesMovementHeader(salesMovementHeaderRaw)
      : undefined;

    // Parse FGMDetail array
    const fgmDetailArray = this.ensureArray(fgmContainer.FGMDetail);
    const fgmDetails = fgmDetailArray.map((detail) =>
      this.parseFGMDetail(detail as Record<string, unknown>)
    );

    return {
      movementHeader,
      salesMovementHeader,
      fgmDetails,
    };
  }

  /**
   * Parse MovementHeader element.
   *
   * This is the shared header structure used by all movement report types.
   * Contains period information, business date, and report timing.
   *
   * @param header - Raw MovementHeader element
   * @returns Parsed movement header
   *
   * SEC-014: Validates PrimaryReportPeriod against allowed values (2 or 98)
   */
  private parseMovementHeader(header: Record<string, unknown>): NAXMLMovementHeader {
    const primaryReportPeriod = this.parseNumber(header.PrimaryReportPeriod, 2);

    // Validate PrimaryReportPeriod is one of the allowed values
    if (primaryReportPeriod !== 2 && primaryReportPeriod !== 98) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FGM_INVALID_REPORT_PERIOD,
        `Invalid PrimaryReportPeriod: ${primaryReportPeriod}. Must be 2 (day close) or 98 (shift close)`,
        { primaryReportPeriod }
      );
    }

    return {
      reportSequenceNumber: this.parseNumber(header.ReportSequenceNumber, 1),
      primaryReportPeriod: primaryReportPeriod as NAXMLPrimaryReportPeriod,
      secondaryReportPeriod: this.parseNumber(header.SecondaryReportPeriod, 0),
      businessDate: String(header.BusinessDate || ''),
      beginDate: String(header.BeginDate || ''),
      beginTime: String(header.BeginTime || '00:00:00'),
      endDate: String(header.EndDate || ''),
      endTime: String(header.EndTime || '00:00:00'),
    };
  }

  /**
   * Parse SalesMovementHeader element.
   *
   * Present in shift-level reports (Period 98) to identify the specific
   * register, cashier, and till for the shift.
   *
   * @param header - Raw SalesMovementHeader element
   * @returns Parsed sales movement header
   */
  private parseSalesMovementHeader(header: Record<string, unknown>): NAXMLSalesMovementHeader {
    return {
      registerId: String(header.RegisterID || ''),
      cashierId: String(header.CashierID || ''),
      tillId: String(header.TillID || ''),
    };
  }

  /**
   * Parse FGMDetail element.
   *
   * Each FGMDetail contains data for a single fuel grade. The structure varies:
   * - "By Tender" variant contains FGMTenderSummary elements
   * - "By Position" variant contains FGMPositionSummary elements
   *
   * @param detail - Raw FGMDetail element
   * @returns Parsed FGM detail
   * @throws NAXMLParserError if FuelGradeID is missing
   *
   * SEC-014: Validates FuelGradeID presence
   */
  private parseFGMDetail(detail: Record<string, unknown>): NAXMLFGMDetail {
    const fuelGradeId = String(detail.FuelGradeID || '');

    if (!fuelGradeId) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FGM_MISSING_FUEL_GRADE_ID,
        'FuelGradeID is required in FGMDetail'
      );
    }

    // Check for "by tender" variant (array of FGMTenderSummary)
    const tenderSummaryRaw = detail.FGMTenderSummary;
    const fgmTenderSummary = tenderSummaryRaw
      ? this.parseFGMTenderSummary(
          Array.isArray(tenderSummaryRaw)
            ? (tenderSummaryRaw[0] as Record<string, unknown>)
            : (tenderSummaryRaw as Record<string, unknown>)
        )
      : undefined;

    // Check for "by position" variant (array of FGMPositionSummary)
    const positionSummaryArray = this.ensureArray(detail.FGMPositionSummary);
    const fgmPositionSummaries =
      positionSummaryArray.length > 0
        ? positionSummaryArray.map((ps) =>
            this.parseFGMPositionSummary(ps as Record<string, unknown>)
          )
        : undefined;

    // Return based on which variant is present
    const result: NAXMLFGMDetail = {
      fuelGradeId,
    };

    if (fgmTenderSummary) {
      result.fgmTenderSummary = fgmTenderSummary;
    }

    // For position summaries, store ALL summaries in the array
    // Also keep first one in deprecated fgmPositionSummary for backwards compat
    if (fgmPositionSummaries && fgmPositionSummaries.length > 0) {
      result.fgmPositionSummary = fgmPositionSummaries[0];
      result.fgmPositionSummaries = fgmPositionSummaries;
    }

    return result;
  }

  /**
   * Parse FGMTenderSummary element.
   *
   * Contains fuel sales for a specific grade broken down by tender type.
   * Present in "by tender" variant of FGM files.
   *
   * @param summary - Raw FGMTenderSummary element
   * @returns Parsed tender summary
   */
  private parseFGMTenderSummary(summary: Record<string, unknown>): NAXMLFGMTenderSummary {
    // Tender may be an array (from ARRAY_ELEMENT_NAMES) - take first element
    const tenderArray = this.ensureArray(summary.Tender);
    const tenderRaw = (tenderArray[0] || {}) as Record<string, unknown>;
    const sellPriceSummaryRaw = summary.FGMSellPriceSummary as Record<string, unknown>;

    return {
      tender: this.parseFGMTender(tenderRaw),
      fgmSellPriceSummary: this.parseFGMSellPriceSummary(sellPriceSummaryRaw || {}),
    };
  }

  /**
   * Parse FGM Tender element.
   *
   * @param tender - Raw Tender element
   * @returns Parsed tender
   *
   * SEC-014: Validates TenderCode against allowlist of valid fuel tender codes
   */
  private parseFGMTender(tender: Record<string, unknown>): NAXMLFGMTender {
    const tenderCode = String(tender.TenderCode || 'cash');

    // Validate tender code against allowlist
    if (!VALID_FUEL_TENDER_CODES.includes(tenderCode as NAXMLFuelTenderCode)) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FGM_INVALID_TENDER_CODE,
        `Invalid TenderCode: ${tenderCode}. Must be one of: ${VALID_FUEL_TENDER_CODES.join(', ')}`,
        { tenderCode }
      );
    }

    return {
      tenderCode: tenderCode as NAXMLFuelTenderCode,
      tenderSubCode: String(tender.TenderSubCode || 'generic'),
    };
  }

  /**
   * Parse FGMSellPriceSummary element.
   *
   * @param summary - Raw FGMSellPriceSummary element
   * @returns Parsed sell price summary
   */
  private parseFGMSellPriceSummary(summary: Record<string, unknown>): NAXMLFGMSellPriceSummary {
    const serviceLevelSummaryRaw = summary.FGMServiceLevelSummary as
      | Record<string, unknown>
      | undefined;

    return {
      actualSalesPrice: this.parseNumber(summary.ActualSalesPrice, 0),
      fgmServiceLevelSummary: this.parseFGMServiceLevelSummary(serviceLevelSummaryRaw || {}),
    };
  }

  /**
   * Parse FGMServiceLevelSummary element.
   *
   * @param summary - Raw FGMServiceLevelSummary element
   * @returns Parsed service level summary
   */
  private parseFGMServiceLevelSummary(
    summary: Record<string, unknown>
  ): NAXMLFGMServiceLevelSummary {
    const salesTotalsRaw = summary.FGMSalesTotals as Record<string, unknown> | undefined;

    return {
      serviceLevelCode: String(summary.ServiceLevelCode || '1'),
      fgmSalesTotals: this.parseFGMSalesTotals(salesTotalsRaw || {}),
    };
  }

  /**
   * Parse FGMPositionSummary element.
   *
   * Contains fuel sales for a specific grade at a specific fuel position.
   * Present in "by position" variant of FGM files.
   *
   * @param summary - Raw FGMPositionSummary element
   * @returns Parsed position summary
   */
  private parseFGMPositionSummary(summary: Record<string, unknown>): NAXMLFGMPositionSummary {
    const fuelPositionId = String(summary.FuelPositionID || '');

    // Parse optional non-resettable total
    const nonResettableTotalRaw = summary.FGMNonResettableTotal as
      | Record<string, unknown>
      | undefined;
    const fgmNonResettableTotal = nonResettableTotalRaw
      ? this.parseFGMNonResettableTotal(nonResettableTotalRaw)
      : undefined;

    // Parse price tier summaries
    const priceTierArray = this.ensureArray(summary.FGMPriceTierSummary);
    const fgmPriceTierSummaries = priceTierArray.map((pt) =>
      this.parseFGMPriceTierSummary(pt as Record<string, unknown>)
    );

    return {
      fuelPositionId,
      fgmNonResettableTotal,
      fgmPriceTierSummaries,
    };
  }

  /**
   * Parse FGMNonResettableTotal element.
   *
   * Contains cumulative (lifetime) meter readings that never reset.
   * Used for reconciliation and variance detection.
   *
   * @param total - Raw FGMNonResettableTotal element
   * @returns Parsed non-resettable total
   */
  private parseFGMNonResettableTotal(total: Record<string, unknown>): NAXMLFGMNonResettableTotal {
    return {
      fuelGradeNonResettableTotalVolume: this.parseNumber(
        total.FuelGradeNonResettableTotalVolume,
        0
      ),
      fuelGradeNonResettableTotalAmount: this.parseNumber(
        total.FuelGradeNonResettableTotalAmount,
        0
      ),
    };
  }

  /**
   * Parse FGMPriceTierSummary element.
   *
   * Fuel may be sold at different prices based on payment method.
   * Common tiers: "0001" (cash), "0002" (credit).
   *
   * @param summary - Raw FGMPriceTierSummary element
   * @returns Parsed price tier summary
   */
  private parseFGMPriceTierSummary(summary: Record<string, unknown>): NAXMLFGMPriceTierSummary {
    const salesTotalsRaw = summary.FGMSalesTotals as Record<string, unknown> | undefined;

    return {
      priceTierCode: String(summary.PriceTierCode || '0001'),
      fgmSalesTotals: this.parseFGMSalesTotals(salesTotalsRaw || {}),
    };
  }

  /**
   * Parse FGMSalesTotals element.
   *
   * This is the core sales data structure containing volume, amount,
   * and discount information. Used throughout FGM documents.
   *
   * @param totals - Raw FGMSalesTotals element
   * @returns Parsed sales totals
   *
   * SEC-014: Validates that sales volume and amount are non-negative
   */
  private parseFGMSalesTotals(totals: Record<string, unknown>): NAXMLFGMSalesTotals {
    const fuelGradeSalesVolume = this.parseNumber(totals.FuelGradeSalesVolume, 0);
    const fuelGradeSalesAmount = this.parseNumber(totals.FuelGradeSalesAmount, 0);

    // Validate non-negative values (SEC-014)
    if (fuelGradeSalesVolume < 0) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FGM_INVALID_SALES_VOLUME,
        `Invalid FuelGradeSalesVolume: ${fuelGradeSalesVolume}. Value must be non-negative`,
        { fuelGradeSalesVolume }
      );
    }

    if (fuelGradeSalesAmount < 0) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FGM_INVALID_SALES_AMOUNT,
        `Invalid FuelGradeSalesAmount: ${fuelGradeSalesAmount}. Value must be non-negative`,
        { fuelGradeSalesAmount }
      );
    }

    // Parse optional pump test totals
    const pumpTestTotalsRaw = totals.PumpTestTotals as Record<string, unknown> | undefined;
    const pumpTestTotals = pumpTestTotalsRaw
      ? this.parseFGMPumpTestTotals(pumpTestTotalsRaw)
      : undefined;

    return {
      fuelGradeSalesVolume,
      fuelGradeSalesAmount,
      discountAmount: this.parseNumber(totals.DiscountAmount, 0),
      discountCount: this.parseNumber(totals.DiscountCount, 0),
      taxExemptSalesVolume:
        totals.TaxExemptSalesVolume !== undefined
          ? this.parseNumber(totals.TaxExemptSalesVolume, 0)
          : undefined,
      dispenserDiscountAmount:
        totals.DispenserDiscountAmount !== undefined
          ? this.parseNumber(totals.DispenserDiscountAmount, 0)
          : undefined,
      dispenserDiscountCount:
        totals.DispenserDiscountCount !== undefined
          ? this.parseNumber(totals.DispenserDiscountCount, 0)
          : undefined,
      pumpTestTotals,
    };
  }

  /**
   * Parse FGMPumpTestTotals element.
   *
   * Tracks fuel dispensed during pump calibration tests.
   * This fuel is not sold and should be excluded from sales calculations.
   *
   * @param totals - Raw PumpTestTotals element
   * @returns Parsed pump test totals
   */
  private parseFGMPumpTestTotals(totals: Record<string, unknown>): NAXMLFGMPumpTestTotals {
    return {
      pumpTestAmount: this.parseNumber(totals.PumpTestAmount, 0),
      pumpTestVolume: this.parseNumber(totals.PumpTestVolume, 0),
      returnTankId:
        totals.ReturnTankID && String(totals.ReturnTankID).trim()
          ? String(totals.ReturnTankID)
          : undefined,
    };
  }

  // ============================================================================
  // MSM (Miscellaneous Summary Movement) Parsing Methods
  // ============================================================================

  /**
   * Parse Miscellaneous Summary Movement (MSM) document data.
   *
   * This method parses the root NAXML-MovementReport element containing
   * MiscellaneousSummaryMovement data. MSM files contain various summary data
   * including grand totals, drawer operations, statistics, fuel sales by grade,
   * tax totals, and tender breakdowns.
   *
   * @param root - The parsed NAXML-MovementReport root element
   * @returns Parsed MSM data structure
   * @throws NAXMLParserError if required fields are missing
   *
   * SEC-014: Validates required fields and uses strict type parsing
   */
  private parseMiscellaneousSummaryMovementData(
    root: Record<string, unknown>
  ): NAXMLMiscellaneousSummaryMovementData {
    const msmContainer = root.MiscellaneousSummaryMovement as Record<string, unknown>;

    if (!msmContainer) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.MISSING_REQUIRED_FIELD,
        'MiscellaneousSummaryMovement element not found in document'
      );
    }

    const movementHeaderRaw = msmContainer.MovementHeader as Record<string, unknown>;
    if (!movementHeaderRaw) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.MSM_MISSING_MOVEMENT_HEADER,
        'MovementHeader not found in MiscellaneousSummaryMovement'
      );
    }

    const movementHeader = this.parseMovementHeader(movementHeaderRaw);

    // SalesMovementHeader is optional (present only for shift reports, Period 98)
    const salesMovementHeaderRaw = msmContainer.SalesMovementHeader as
      | Record<string, unknown>
      | undefined;
    const salesMovementHeader = salesMovementHeaderRaw
      ? this.parseSalesMovementHeader(salesMovementHeaderRaw)
      : undefined;

    // Parse MSMDetail array - MSM documents contain MSMDetail elements both inside
    // and potentially outside the MiscellaneousSummaryMovement container
    // (for outside terminal summaries in production files)
    const msmDetailArrayInContainer = this.ensureArray(msmContainer.MSMDetail);

    // Also check for MSMDetail elements at root level (outside the container)
    // These are typically outside terminal/pump tender summaries
    const msmDetailArrayAtRoot = this.ensureArray(root.MSMDetail);

    // Combine both arrays, parsing each detail
    const msmDetails = [
      ...msmDetailArrayInContainer.map((detail) =>
        this.parseMSMDetail(detail as Record<string, unknown>)
      ),
      ...msmDetailArrayAtRoot.map((detail) =>
        this.parseMSMDetail(detail as Record<string, unknown>)
      ),
    ];

    return {
      movementHeader,
      salesMovementHeader,
      msmDetails,
    };
  }

  /**
   * Parse MSMDetail element.
   *
   * Each MSMDetail represents a specific type of summary data,
   * identified by the combination of code, subCode, and optional modifier.
   *
   * Common summary codes include:
   * - safeDrop, safeLoan - Drawer operations
   * - refunds, payouts, payins - Transaction adjustments
   * - statistics (with subCodes: transactions, voids, noSales, etc.)
   * - totalizer (sales, tax breakdowns)
   * - fuelSalesByGrade (fuel + grade modifier)
   * - openingBalance, closingBalance - Till balances
   * - taxTotals (by tax code)
   *
   * @param detail - Raw MSMDetail element
   * @returns Parsed MSM detail
   *
   * SEC-014: Validates summary codes presence
   */
  private parseMSMDetail(detail: Record<string, unknown>): NAXMLMSMDetail {
    const codesRaw = detail.MiscellaneousSummaryCodes as Record<string, unknown>;

    // Parse summary codes (required)
    const miscellaneousSummaryCodes = this.parseMSMSummaryCodes(codesRaw || {});

    // Parse optional register/cashier/till IDs
    // Note: In production files, these may appear as REGISTERID (uppercase)
    const registerId = detail.RegisterID || detail.REGISTERID || detail.registerId;
    const cashierId = detail.CashierID || detail.CASHIERID || detail.cashierId;
    const tillId = detail.TillID || detail.TILLID || detail.tillId;

    // Parse sales totals
    const salesTotalsRaw = detail.MSMSalesTotals as Record<string, unknown>;
    const msmSalesTotals = this.parseMSMSalesTotals(salesTotalsRaw || {});

    return {
      miscellaneousSummaryCodes,
      registerId: registerId ? String(registerId) : undefined,
      cashierId: cashierId ? String(cashierId) : undefined,
      tillId: tillId ? String(tillId) : undefined,
      msmSalesTotals,
    };
  }

  /**
   * Parse MiscellaneousSummaryCodes element.
   *
   * The combination of code, subCode, and modifier uniquely identifies
   * what data is being reported.
   *
   * @param codes - Raw MiscellaneousSummaryCodes element
   * @returns Parsed summary codes
   */
  private parseMSMSummaryCodes(codes: Record<string, unknown>): NAXMLMiscellaneousSummaryCodes {
    return {
      miscellaneousSummaryCode: String(codes.MiscellaneousSummaryCode || ''),
      miscellaneousSummarySubCode: codes.MiscellaneousSummarySubCode
        ? String(codes.MiscellaneousSummarySubCode)
        : undefined,
      miscellaneousSummarySubCodeModifier: codes.MiscellaneousSummarySubCodeModifier
        ? String(codes.MiscellaneousSummarySubCodeModifier)
        : undefined,
    };
  }

  /**
   * Parse MSMSalesTotals element.
   *
   * Contains the summary amount and count, plus optional tender information.
   * Note: For fuelSalesByGrade entries, the "count" field actually contains
   * the volume in gallons, not a transaction count.
   *
   * @param totals - Raw MSMSalesTotals element
   * @returns Parsed MSM sales totals
   *
   * SEC-014: Validates tender code if present
   */
  private parseMSMSalesTotals(totals: Record<string, unknown>): NAXMLMSMSalesTotals {
    // Parse optional tender - may be array (from ARRAY_ELEMENT_NAMES)
    const tenderArray = this.ensureArray(totals.Tender);
    const tenderRaw =
      tenderArray.length > 0 ? (tenderArray[0] as Record<string, unknown>) : undefined;

    let tender: NAXMLFGMTender | undefined;
    if (tenderRaw) {
      const tenderCode = String(tenderRaw.TenderCode || '');
      const tenderSubCode = String(tenderRaw.TenderSubCode || '');

      // Only validate non-empty tender codes
      if (tenderCode && tenderCode.trim().length > 0) {
        // Validate tender code against allowlist (SEC-014)
        if (!VALID_FUEL_TENDER_CODES.includes(tenderCode as NAXMLFuelTenderCode)) {
          throw new NAXMLParserError(
            NAXML_PARSER_ERROR_CODES.MSM_INVALID_TENDER_CODE,
            `Invalid TenderCode in MSM: ${tenderCode}. Must be one of: ${VALID_FUEL_TENDER_CODES.join(', ')}`,
            { tenderCode }
          );
        }

        tender = {
          tenderCode: tenderCode as NAXMLFuelTenderCode,
          tenderSubCode: tenderSubCode || 'generic',
        };
      }
    }

    return {
      tender,
      miscellaneousSummaryAmount: this.parseNumber(totals.MiscellaneousSummaryAmount, 0),
      miscellaneousSummaryCount: this.parseNumber(totals.MiscellaneousSummaryCount, 0),
    };
  }

  // ============================================================================
  // ISM (Item Sales Movement) Parsing Methods
  // ============================================================================

  /**
   * Parse Item Sales Movement (ISM) document data.
   *
   * This method parses the root NAXML-MovementReport element containing
   * ItemSalesMovement data. ISM files contain item-level sales summaries.
   *
   * @param root - The parsed NAXML-MovementReport root element
   * @returns Parsed ISM data structure
   * @throws NAXMLParserError if required fields are missing
   *
   * SEC-014: Validates required fields and uses strict type parsing
   */
  private parseItemSalesMovementData(root: Record<string, unknown>): NAXMLItemSalesMovementData {
    const ismContainer = root.ItemSalesMovement as Record<string, unknown>;

    if (!ismContainer) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.MISSING_REQUIRED_FIELD,
        'ItemSalesMovement element not found in document'
      );
    }

    const movementHeaderRaw = ismContainer.MovementHeader as Record<string, unknown>;
    if (!movementHeaderRaw) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.MISSING_REQUIRED_FIELD,
        'MovementHeader not found in ItemSalesMovement'
      );
    }

    const movementHeader = this.parseMovementHeader(movementHeaderRaw);

    // SalesMovementHeader is optional (present only for shift reports, Period 98)
    const salesMovementHeaderRaw = ismContainer.SalesMovementHeader as
      | Record<string, unknown>
      | undefined;
    const salesMovementHeader = salesMovementHeaderRaw
      ? this.parseSalesMovementHeader(salesMovementHeaderRaw)
      : undefined;

    // Parse ISMDetail array
    const ismDetailArray = this.ensureArray(ismContainer.ISMDetail);
    const ismDetails = ismDetailArray.map((detail) =>
      this.parseISMDetail(detail as Record<string, unknown>)
    );

    return {
      movementHeader,
      salesMovementHeader,
      ismDetails,
    };
  }

  /**
   * Parse ISMDetail element.
   *
   * Each ISMDetail contains item-level sales data including item code,
   * description, quantity sold, and sales amount.
   *
   * @param detail - Raw ISMDetail element
   * @returns Parsed ISM detail
   *
   * SEC-014: Validates item code presence
   */
  private parseISMDetail(detail: Record<string, unknown>): NAXMLISMDetail {
    const itemCode = String(detail.ItemCode || '');

    if (!itemCode) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.MISSING_REQUIRED_FIELD,
        'ItemCode is required in ISMDetail'
      );
    }

    // Parse sales totals
    const salesTotalsRaw = detail.ISMSalesTotals as Record<string, unknown>;

    return {
      itemCode,
      itemDescription: String(detail.ItemDescription || ''),
      merchandiseCode: String(detail.DepartmentID || detail.MerchandiseCode || ''),
      salesQuantity: this.parseNumber(salesTotalsRaw?.ItemSalesQuantity, 0),
      salesAmount: this.parseNumber(salesTotalsRaw?.ItemSalesAmount, 0),
      unitPrice:
        salesTotalsRaw?.ItemSalesAmount && salesTotalsRaw?.ItemSalesQuantity
          ? this.parseNumber(salesTotalsRaw.ItemSalesAmount, 0) /
            this.parseNumber(salesTotalsRaw.ItemSalesQuantity, 1)
          : 0,
    };
  }

  // ============================================================================
  // FPM (Fuel Product Movement) Parsing Methods
  // ============================================================================

  /**
   * Parse Fuel Product Movement (FPM) document data.
   *
   * This method parses the root NAXML-MovementReport element containing
   * FuelProductMovement data. FPM files contain non-resettable meter readings
   * from fuel dispensers used for reconciliation.
   *
   * @param root - The parsed NAXML-MovementReport root element
   * @returns Parsed FPM data structure
   * @throws NAXMLParserError if required fields are missing
   *
   * SEC-014: Validates required fields and uses strict type parsing
   */
  private parseFuelProductMovementData(
    root: Record<string, unknown>
  ): NAXMLFuelProductMovementData {
    const fpmContainer = root.FuelProductMovement as Record<string, unknown>;

    if (!fpmContainer) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.MISSING_REQUIRED_FIELD,
        'FuelProductMovement element not found in document'
      );
    }

    const movementHeaderRaw = fpmContainer.MovementHeader as Record<string, unknown>;
    if (!movementHeaderRaw) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FPM_MISSING_MOVEMENT_HEADER,
        'MovementHeader not found in FuelProductMovement'
      );
    }

    const movementHeader = this.parseMovementHeader(movementHeaderRaw);

    // Parse FPMDetail array
    const fpmDetailArray = this.ensureArray(fpmContainer.FPMDetail);
    const fpmDetails = fpmDetailArray.map((detail) =>
      this.parseFPMDetail(detail as Record<string, unknown>)
    );

    return {
      movementHeader,
      fpmDetails,
    };
  }

  /**
   * Parse FPMDetail element.
   *
   * Each FPMDetail contains meter readings for a single fuel product
   * across all dispensing positions that carry that product.
   *
   * @param detail - Raw FPMDetail element
   * @returns Parsed FPM detail
   * @throws NAXMLParserError if FuelProductID is missing
   *
   * SEC-014: Validates FuelProductID presence
   */
  private parseFPMDetail(detail: Record<string, unknown>): NAXMLFPMDetail {
    const fuelProductId = String(detail.FuelProductID || '');

    if (!fuelProductId) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FPM_MISSING_PRODUCT_ID,
        'FuelProductID is required in FPMDetail'
      );
    }

    // Parse FPMNonResettableTotals array
    const nonResettableTotalsArray = this.ensureArray(detail.FPMNonResettableTotals);
    const fpmNonResettableTotals = nonResettableTotalsArray.map((totals) =>
      this.parseFPMNonResettableTotals(totals as Record<string, unknown>)
    );

    return {
      fuelProductId,
      fpmNonResettableTotals,
    };
  }

  /**
   * Parse FPMNonResettableTotals element.
   *
   * Contains cumulative (lifetime) meter readings for a specific
   * fuel product at a specific dispenser position. These readings
   * never reset and are used for reconciliation and variance detection.
   *
   * @param totals - Raw FPMNonResettableTotals element
   * @returns Parsed non-resettable totals
   * @throws NAXMLParserError if FuelPositionID is missing or meter readings are invalid
   *
   * SEC-014: Validates FuelPositionID presence and non-negative meter readings
   */
  private parseFPMNonResettableTotals(
    totals: Record<string, unknown>
  ): NAXMLFPMNonResettableTotals {
    const fuelPositionId = String(totals.FuelPositionID || '');

    if (!fuelPositionId) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FPM_MISSING_POSITION_ID,
        'FuelPositionID is required in FPMNonResettableTotals'
      );
    }

    const volumeNumber = this.parseNumber(totals.FuelProductNonResettableVolumeNumber, 0);
    const amountNumber = this.parseNumber(totals.FuelProductNonResettableAmountNumber, 0);

    // Validate non-negative meter readings (SEC-014)
    // Meter readings are cumulative and should never be negative
    if (volumeNumber < 0) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FPM_INVALID_METER_READING,
        `Invalid FuelProductNonResettableVolumeNumber: ${volumeNumber}. Meter readings must be non-negative`,
        { fuelPositionId, volumeNumber }
      );
    }

    if (amountNumber < 0) {
      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.FPM_INVALID_METER_READING,
        `Invalid FuelProductNonResettableAmountNumber: ${amountNumber}. Meter readings must be non-negative`,
        { fuelPositionId, amountNumber }
      );
    }

    return {
      fuelPositionId,
      fuelProductNonResettableVolumeNumber: volumeNumber,
      fuelProductNonResettableAmountNumber: amountNumber,
    };
  }

  // ============================================================================
  // TPM (Tank Product Movement) Parsing Methods
  // ============================================================================

  /**
   * Parse Tank Product Movement (TPM) document data.
   *
   * This method parses the root NAXML-MovementReport element containing
   * TankProductMovement data. TPM files contain tank inventory readings
   * for fuel storage tanks.
   *
   * @param root - The parsed NAXML-MovementReport root element
   * @returns Parsed TPM data structure
   *
   * SEC-014: Validates required fields and uses strict type parsing
   */
  private parseTankProductMovementData(
    root: Record<string, unknown>
  ): NAXMLTankProductMovementData {
    const tpmContainer = root.TankProductMovement as Record<string, unknown>;

    if (!tpmContainer) {
      return {
        movementHeader: this.getDefaultMovementHeader(),
        tpmDetails: [],
      };
    }

    const movementHeaderRaw = tpmContainer.MovementHeader as Record<string, unknown>;
    const movementHeader = movementHeaderRaw
      ? this.parseMovementHeader(movementHeaderRaw)
      : this.getDefaultMovementHeader();

    // Parse TPMDetail array (may be empty for some stores)
    const tpmDetailArray = this.ensureArray(tpmContainer.TPMDetail);
    const tpmDetails = tpmDetailArray.map((detail) =>
      this.parseTPMDetail(detail as Record<string, unknown>)
    );

    return {
      movementHeader,
      tpmDetails,
    };
  }

  /**
   * Parse TPMDetail element.
   *
   * Each TPMDetail contains tank inventory data for a single storage tank.
   *
   * @param detail - Raw TPMDetail element
   * @returns Parsed TPM detail
   */
  private parseTPMDetail(detail: Record<string, unknown>): NAXMLTPMDetail {
    return {
      tankId: String(detail.TankID || detail.TankId || ''),
      fuelProductId: String(detail.FuelProductID || detail.FuelProductId || ''),
      tankVolume: this.parseNumber(detail.TankVolume, 0),
      tankCapacity: detail.TankCapacity ? this.parseNumber(detail.TankCapacity, 0) : undefined,
      tankUllage: detail.TankUllage ? this.parseNumber(detail.TankUllage, 0) : undefined,
    };
  }

  // ============================================================================
  // TLM (Tax Level Movement) Parsing Methods
  // ============================================================================

  /**
   * Parse Tax Level Movement (TLM) document data.
   *
   * TLM files contain tax collection summaries by tax level/code.
   *
   * @param root - The parsed NAXML-MovementReport root element
   * @returns Parsed TLM data structure
   */
  private parseTaxLevelMovementData(root: Record<string, unknown>): NAXMLTaxLevelMovementData {
    const tlmContainer = root.TaxLevelMovement as Record<string, unknown>;

    if (!tlmContainer) {
      return {
        movementHeader: this.getDefaultMovementHeader(),
        tlmDetails: [],
      };
    }

    const movementHeaderRaw = tlmContainer.MovementHeader as Record<string, unknown>;
    const movementHeader = movementHeaderRaw
      ? this.parseMovementHeader(movementHeaderRaw)
      : this.getDefaultMovementHeader();

    const salesMovementHeaderRaw = tlmContainer.SalesMovementHeader as Record<string, unknown>;
    const salesMovementHeader = salesMovementHeaderRaw
      ? this.parseSalesMovementHeader(salesMovementHeaderRaw)
      : undefined;

    // Parse TLMDetail array
    const tlmDetailArray = this.ensureArray(tlmContainer.TLMDetail);
    const tlmDetails = tlmDetailArray.map((detail) =>
      this.parseTLMDetail(detail as Record<string, unknown>)
    );

    return {
      movementHeader,
      salesMovementHeader,
      tlmDetails,
    };
  }

  /**
   * Parse TLMDetail element.
   */
  private parseTLMDetail(detail: Record<string, unknown>): NAXMLTLMDetail {
    return {
      taxLevelId: String(detail.TaxLevelID || detail.TaxLevelId || ''),
      merchandiseCode: String(detail.MerchandiseCode || '0'),
      taxableSalesAmount: this.parseNumber(detail.TaxableSalesAmount, 0),
      taxableSalesRefundedAmount: this.parseNumber(detail.TaxableSalesRefundedAmount, 0),
      taxCollectedAmount: this.parseNumber(detail.TaxCollectedAmount, 0),
      taxExemptSalesAmount: this.parseNumber(detail.TaxExemptSalesAmount, 0),
      taxExemptSalesRefundedAmount: this.parseNumber(detail.TaxExemptSalesRefundedAmount, 0),
      taxForgivenSalesAmount: this.parseNumber(detail.TaxForgivenSalesAmount, 0),
      taxForgivenSalesRefundedAmount: this.parseNumber(detail.TaxForgivenSalesRefundedAmount, 0),
      taxRefundedAmount: this.parseNumber(detail.TaxRefundedAmount, 0),
    };
  }

  // ============================================================================
  // MCM (Merchandise Code Movement) Parsing Methods
  // ============================================================================

  /**
   * Parse Merchandise Code Movement (MCM) document data.
   *
   * MCM files contain sales summaries by merchandise/department code.
   *
   * @param root - The parsed NAXML-MovementReport root element
   * @returns Parsed MCM data structure
   */
  private parseMerchandiseCodeMovementData(
    root: Record<string, unknown>
  ): NAXMLMerchandiseCodeMovementData {
    const mcmContainer = root.MerchandiseCodeMovement as Record<string, unknown>;

    if (!mcmContainer) {
      return {
        movementHeader: this.getDefaultMovementHeader(),
        mcmDetails: [],
      };
    }

    const movementHeaderRaw = mcmContainer.MovementHeader as Record<string, unknown>;
    const movementHeader = movementHeaderRaw
      ? this.parseMovementHeader(movementHeaderRaw)
      : this.getDefaultMovementHeader();

    const salesMovementHeaderRaw = mcmContainer.SalesMovementHeader as Record<string, unknown>;
    const salesMovementHeader = salesMovementHeaderRaw
      ? this.parseSalesMovementHeader(salesMovementHeaderRaw)
      : undefined;

    // Parse MCMDetail array
    const mcmDetailArray = this.ensureArray(mcmContainer.MCMDetail);
    const mcmDetails = mcmDetailArray.map((detail) =>
      this.parseMCMDetail(detail as Record<string, unknown>)
    );

    return {
      movementHeader,
      salesMovementHeader,
      mcmDetails,
    };
  }

  /**
   * Parse MCMDetail element.
   */
  private parseMCMDetail(detail: Record<string, unknown>): NAXMLMCMDetail {
    const salesTotalsRaw = detail.MCMSalesTotals as Record<string, unknown> | undefined;

    const defaultSalesTotals: NAXMLMCMSalesTotals = {
      discountAmount: 0,
      discountCount: 0,
      promotionAmount: 0,
      promotionCount: 0,
      refundAmount: 0,
      refundCount: 0,
      salesQuantity: 0,
      salesAmount: 0,
      transactionCount: 0,
      openDepartmentSalesAmount: 0,
      openDepartmentTransactionCount: 0,
    };

    return {
      merchandiseCode: String(detail.MerchandiseCode || ''),
      merchandiseCodeDescription: String(detail.MerchandiseCodeDescription || ''),
      mcmSalesTotals: salesTotalsRaw
        ? {
            discountAmount: this.parseNumber(salesTotalsRaw.DiscountAmount, 0),
            discountCount: this.parseNumber(salesTotalsRaw.DiscountCount, 0),
            promotionAmount: this.parseNumber(salesTotalsRaw.PromotionAmount, 0),
            promotionCount: this.parseNumber(salesTotalsRaw.PromotionCount, 0),
            refundAmount: this.parseNumber(salesTotalsRaw.RefundAmount, 0),
            refundCount: this.parseNumber(salesTotalsRaw.RefundCount, 0),
            salesQuantity: this.parseNumber(salesTotalsRaw.SalesQuantity, 0),
            salesAmount: this.parseNumber(salesTotalsRaw.SalesAmount, 0),
            transactionCount: this.parseNumber(salesTotalsRaw.TransactionCount, 0),
            openDepartmentSalesAmount: this.parseNumber(
              salesTotalsRaw.OpenDepartmentSalesAmount,
              0
            ),
            openDepartmentTransactionCount: this.parseNumber(
              salesTotalsRaw.OpenDepartmentTransactionCount,
              0
            ),
          }
        : defaultSalesTotals,
    };
  }

  /**
   * Get default movement header for documents missing the header.
   */
  private getDefaultMovementHeader(): NAXMLMovementHeader {
    return {
      primaryReportPeriod: 98, // Default to shift-level (98) instead of 0
      secondaryReportPeriod: 0,
      reportSequenceNumber: 0,
      businessDate: new Date().toISOString().split('T')[0],
      beginDate: '',
      beginTime: '',
      endDate: '',
      endTime: '',
    };
  }

  // ============================================================================
  // PJR (POSJournal) Parsing Methods
  // ============================================================================

  /**
   * Parse POSJournal (PJR) document data.
   *
   * This method parses Gilbarco POSJournal documents which contain
   * complete transaction-level data including:
   * - Sale events with all line items
   * - Fuel dispensing details
   * - Merchandise sales
   * - Tender/payment information
   * - Tax summaries
   *
   * @param root - The parsed NAXML-POSJournal root element
   * @returns Parsed PJR document structure
   * @throws NAXMLParserError if required fields are missing
   *
   * SEC-014: Validates required fields and uses strict type parsing
   */
  private parsePOSJournalData(root: Record<string, unknown>): NAXMLPOSJournalDocument {
    // Extract TransmissionHeader (optional but common in Gilbarco format)
    const transmissionHeaderRaw = root.TransmissionHeader as Record<string, unknown>;
    const transmissionHeader = this.parseTransmissionHeader(transmissionHeaderRaw || {});

    // Extract JournalReport container
    const journalReportRaw = root.JournalReport as Record<string, unknown>;

    // Handle case where POSJournal envelope contains a TransactionDocument instead of JournalReport
    // This is a valid but uncommon NAXML structure (some POS systems use POSJournal as an envelope)
    if (!journalReportRaw) {
      // Check if there's a TransactionDocument inside (NAXML-POSJournal with TransactionDocument content)
      if (root.TransactionDocument) {
        // Return empty journal report - the document will be handled at a higher level
        return {
          transmissionHeader,
          journalReport: {
            journalHeader: {
              reportSequenceNumber: 0,
              primaryReportPeriod: 0,
              secondaryReportPeriod: 0,
              beginDate: '',
              beginTime: '',
              endDate: '',
              endTime: '',
            },
            saleEvents: [],
          },
        };
      }

      throw new NAXMLParserError(
        NAXML_PARSER_ERROR_CODES.MISSING_REQUIRED_FIELD,
        'JournalReport element not found in POSJournal document'
      );
    }

    const journalReport = this.parseJournalReport(journalReportRaw);

    return {
      transmissionHeader,
      journalReport,
    };
  }

  /**
   * Parse TransmissionHeader element.
   */
  private parseTransmissionHeader(header: Record<string, unknown>): NAXMLTransmissionHeader {
    return {
      storeLocationId: String(header?.StoreLocationID || header?.StoreLocationId || ''),
      vendorName: String(header?.VendorName || ''),
      vendorModelVersion: String(header?.VendorModelVersion || ''),
    };
  }

  /**
   * Parse JournalReport element.
   */
  private parseJournalReport(report: Record<string, unknown>): NAXMLJournalReport {
    const journalHeaderRaw = report.JournalHeader as Record<string, unknown>;
    const journalHeader = this.parseJournalHeader(journalHeaderRaw || {});

    // Parse SaleEvents array - may be nested in SaleEvents container or directly under JournalReport
    const saleEventsContainer = report.SaleEvents as Record<string, unknown>;
    const saleEventsRaw = saleEventsContainer
      ? this.ensureArray(saleEventsContainer.SaleEvent)
      : this.ensureArray(report.SaleEvent);

    const saleEvents = saleEventsRaw.map((event) =>
      this.parseSaleEvent(event as Record<string, unknown>)
    );

    // Parse OtherEvents array (optional)
    const otherEventsContainer = report.OtherEvents as Record<string, unknown>;
    const otherEventsRaw = otherEventsContainer
      ? this.ensureArray(otherEventsContainer.OtherEvent)
      : this.ensureArray(report.OtherEvent);

    const otherEvents =
      otherEventsRaw.length > 0
        ? otherEventsRaw.map((event) => this.parseOtherEvent(event as Record<string, unknown>))
        : undefined;

    return {
      journalHeader,
      saleEvents,
      otherEvents,
    };
  }

  /**
   * Parse JournalHeader element.
   */
  private parseJournalHeader(header: Record<string, unknown>): NAXMLJournalHeader {
    return {
      reportSequenceNumber: this.parseNumber(header.ReportSequenceNumber, 0),
      primaryReportPeriod: this.parseNumber(header.PrimaryReportPeriod, 0),
      secondaryReportPeriod: this.parseNumber(header.SecondaryReportPeriod, 0),
      beginDate: String(header.BeginDate || ''),
      beginTime: String(header.BeginTime || '00:00:00'),
      endDate: String(header.EndDate || ''),
      endTime: String(header.EndTime || '00:00:00'),
    };
  }

  /**
   * Parse SaleEvent element (individual transaction).
   */
  private parseSaleEvent(event: Record<string, unknown>): NAXMLSaleEvent {
    // Parse transaction detail group (contains all line items)
    const detailGroupRaw = event.TransactionDetailGroup as Record<string, unknown>;
    const transactionDetailGroup = this.parseTransactionDetailGroup(detailGroupRaw || {});

    // Parse transaction summary (totals)
    const summaryRaw = event.TransactionSummary as Record<string, unknown>;
    const transactionSummary = this.parsePJRTransactionSummary(summaryRaw || {});

    // Parse linked transaction info (optional - for prepay completion, refunds, etc.)
    const linkedInfoRaw = event.LinkedTransactionInfo as Record<string, unknown>;
    const linkedTransactionInfo = linkedInfoRaw
      ? this.parseLinkedTransactionInfo(linkedInfoRaw)
      : undefined;

    return {
      eventSequenceId: this.parseNumber(
        event.EventSequenceID || event.EventSequenceId || event.eventSequenceId,
        0
      ),
      trainingModeFlag: this.parseBoolean(event.TrainingModeFlag),
      cashierId: String(event.CashierID || event.CashierId || ''),
      registerId: String(event.RegisterID || event.RegisterId || ''),
      tillId: String(event.TillID || event.TillId || ''),
      outsideSalesFlag: this.parseBoolean(event.OutsideSalesFlag),
      transactionId: String(event.TransactionID || event.TransactionId || ''),
      eventStartDate: String(event.EventStartDate || ''),
      eventStartTime: String(event.EventStartTime || ''),
      eventEndDate: String(event.EventEndDate || ''),
      eventEndTime: String(event.EventEndTime || ''),
      businessDate: String(event.BusinessDate || ''),
      receiptDate: String(event.ReceiptDate || ''),
      receiptTime: String(event.ReceiptTime || ''),
      offlineFlag: this.parseBoolean(event.OfflineFlag),
      suspendFlag: this.parseBoolean(event.SuspendFlag),
      linkedTransactionInfo,
      transactionDetailGroup,
      transactionSummary,
    };
  }

  /**
   * Parse TransactionDetailGroup element (container for all line items).
   */
  private parseTransactionDetailGroup(group: Record<string, unknown>): NAXMLTransactionDetailGroup {
    const transactionLinesRaw = this.ensureArray(group.TransactionLine);
    const transactionLines = transactionLinesRaw.map((line) =>
      this.parsePJRTransactionLine(line as Record<string, unknown>)
    );

    return {
      transactionLines,
    };
  }

  /**
   * Parse TransactionLine element (wrapper for individual line items).
   * Each line can contain one of: FuelLine, MerchandiseLine, TenderInfo, TransactionTax, FuelPrepayLine
   */
  private parsePJRTransactionLine(line: Record<string, unknown>): NAXMLTransactionLine {
    // Parse status - may be attribute (@_Status) or element (Status)
    const statusRaw = String(line.Status || line['@_Status'] || 'normal').toLowerCase();
    const status = this.validateTransactionLineStatus(statusRaw);

    // Parse optional elements based on what's present
    const fuelLineRaw = line.FuelLine as Record<string, unknown>;
    const fuelLine = fuelLineRaw ? this.parsePJRFuelLine(fuelLineRaw) : undefined;

    const fuelPrepayLineRaw = line.FuelPrepayLine as Record<string, unknown>;
    const fuelPrepayLine = fuelPrepayLineRaw
      ? this.parsePJRFuelPrepayLine(fuelPrepayLineRaw)
      : undefined;

    const tenderInfoRaw = line.TenderInfo as Record<string, unknown>;
    const tenderInfo = tenderInfoRaw ? this.parsePJRTenderInfo(tenderInfoRaw) : undefined;

    const taxRaw = line.TransactionTax as Record<string, unknown>;
    const transactionTax = taxRaw ? this.parsePJRTransactionTax(taxRaw) : undefined;

    const merchLineRaw = line.MerchandiseLine as Record<string, unknown>;
    const merchandiseLine = merchLineRaw ? this.parsePJRMerchandiseLine(merchLineRaw) : undefined;

    return {
      status,
      fuelLine,
      fuelPrepayLine,
      tenderInfo,
      transactionTax,
      merchandiseLine,
    };
  }

  /**
   * Validate and normalize transaction line status.
   */
  private validateTransactionLineStatus(status: string): NAXMLTransactionLineStatus {
    const validStatuses: NAXMLTransactionLineStatus[] = ['normal', 'cancel', 'void', 'refund'];
    if (validStatuses.includes(status as NAXMLTransactionLineStatus)) {
      return status as NAXMLTransactionLineStatus;
    }
    return 'normal'; // Default fallback
  }

  /**
   * Parse FuelLine element (fuel dispensing details).
   */
  private parsePJRFuelLine(line: Record<string, unknown>): NAXMLFuelLine {
    return {
      fuelGradeId: String(line.FuelGradeID || line.FuelGradeId || ''),
      fuelPositionId: String(line.FuelPositionID || line.FuelPositionId || ''),
      priceTierCode: String(line.PriceTierCode || ''),
      timeTierCode: String(line.TimeTierCode || ''),
      serviceLevelCode: this.validateServiceLevelCode(String(line.ServiceLevelCode || 'self')),
      description: String(line.Description || ''),
      entryMethod: this.validateEntryMethod(String(line.EntryMethod || 'manual')),
      actualSalesPrice: this.parseNumber(line.ActualSalesPrice, 0),
      merchandiseCode: String(line.MerchandiseCode || ''),
      regularSellPrice: this.parseNumber(line.RegularSellPrice, 0),
      salesQuantity: this.parseNumber(line.SalesQuantity, 0),
      salesAmount: this.parseNumber(line.SalesAmount, 0),
      itemTax: line.ItemTax
        ? this.parsePJRItemTax(line.ItemTax as Record<string, unknown>)
        : undefined,
    };
  }

  /**
   * Parse FuelPrepayLine element (prepay authorization).
   */
  private parsePJRFuelPrepayLine(line: Record<string, unknown>): NAXMLFuelPrepayLine {
    return {
      fuelPositionId: String(line.FuelPositionID || line.FuelPositionId || ''),
      salesAmount: this.parseNumber(line.SalesAmount, 0),
    };
  }

  /**
   * Parse MerchandiseLine element (non-fuel items).
   */
  private parsePJRMerchandiseLine(line: Record<string, unknown>): NAXMLMerchandiseLine {
    return {
      itemCode: String(line.ItemCode || ''),
      description: String(line.Description || ''),
      departmentCode: String(line.DepartmentCode || ''),
      salesQuantity: this.parseNumber(line.SalesQuantity, 1),
      unitPrice: this.parseNumber(line.UnitPrice, 0),
      salesAmount: this.parseNumber(line.SalesAmount, 0),
      itemTax: line.ItemTax
        ? this.parsePJRItemTax(line.ItemTax as Record<string, unknown>)
        : undefined,
      entryMethod: line.EntryMethod
        ? this.validateEntryMethod(String(line.EntryMethod))
        : undefined,
      modifierCodes: line.ModifierCode
        ? this.ensureArray(line.ModifierCode).map(String)
        : undefined,
    };
  }

  /**
   * Parse TenderInfo element (payment information).
   */
  private parsePJRTenderInfo(info: Record<string, unknown>): NAXMLJournalTenderInfo {
    const tenderRaw = info.Tender as Record<string, unknown>;
    return {
      tender: this.parsePJRTender(tenderRaw || {}),
      tenderAmount: this.parseNumber(info.TenderAmount, 0),
      changeFlag: this.parseBoolean(info.ChangeFlag),
      changeAmount:
        info.ChangeAmount !== undefined ? this.parseNumber(info.ChangeAmount, 0) : undefined,
    };
  }

  /**
   * Parse Tender element (tender type details).
   */
  private parsePJRTender(tender: Record<string, unknown>): NAXMLJournalTender {
    return {
      tenderCode: this.validateTenderCode(String(tender.TenderCode || 'cash')),
      tenderSubCode: String(tender.TenderSubCode || ''),
    };
  }

  /**
   * Parse TransactionTax element (tax breakdown for transaction).
   */
  private parsePJRTransactionTax(tax: Record<string, unknown>): NAXMLJournalTransactionTax {
    return {
      taxLevelId: String(tax.TaxLevelID || tax.TaxLevelId || ''),
      taxableSalesAmount: this.parseNumber(tax.TaxableSalesAmount, 0),
      taxCollectedAmount: this.parseNumber(tax.TaxCollectedAmount, 0),
      taxableSalesRefundedAmount: this.parseNumber(tax.TaxableSalesRefundedAmount, 0),
      taxRefundedAmount: this.parseNumber(tax.TaxRefundedAmount, 0),
      taxExemptSalesAmount: this.parseNumber(tax.TaxExemptSalesAmount, 0),
      taxExemptSalesRefundedAmount: this.parseNumber(tax.TaxExemptSalesRefundedAmount, 0),
      taxForgivenSalesAmount: this.parseNumber(tax.TaxForgivenSalesAmount, 0),
      taxForgivenSalesRefundedAmount: this.parseNumber(tax.TaxForgivenSalesRefundedAmount, 0),
      taxForgivenAmount: this.parseNumber(tax.TaxForgivenAmount, 0),
    };
  }

  /**
   * Parse TransactionSummary element (transaction totals).
   */
  private parsePJRTransactionSummary(
    summary: Record<string, unknown>
  ): NAXMLJournalTransactionSummary {
    return {
      transactionTotalGrossAmount: this.parseNumber(summary.TransactionTotalGrossAmount, 0),
      transactionTotalNetAmount: this.parseNumber(summary.TransactionTotalNetAmount, 0),
      transactionTotalTaxSalesAmount: this.parseNumber(summary.TransactionTotalTaxSalesAmount, 0),
      transactionTotalTaxExemptAmount: this.parseNumber(summary.TransactionTotalTaxExemptAmount, 0),
      transactionTotalTaxNetAmount: this.parseNumber(summary.TransactionTotalTaxNetAmount, 0),
      transactionTotalGrandAmount: this.parseNumber(summary.TransactionTotalGrandAmount, 0),
      transactionTotalGrandAmountDirection:
        String(summary.TransactionTotalGrandAmountDirection || 'Collected') === 'Refunded'
          ? 'Refunded'
          : 'Collected',
    };
  }

  /**
   * Parse ItemTax element (line-item tax reference).
   */
  private parsePJRItemTax(tax: Record<string, unknown>): NAXMLItemTax {
    return {
      taxLevelId: String(tax.TaxLevelID || tax.TaxLevelId || ''),
    };
  }

  /**
   * Parse LinkedTransactionInfo element (for prepay completion, refunds, etc.).
   */
  private parseLinkedTransactionInfo(info: Record<string, unknown>): NAXMLLinkedTransactionInfo {
    return {
      originalStoreLocationId: String(
        info.OriginalStoreLocationID || info.OriginalStoreLocationId || ''
      ),
      originalRegisterId: String(info.OriginalRegisterID || info.OriginalRegisterId || ''),
      originalTransactionId: String(info.OriginalTransactionID || info.OriginalTransactionId || ''),
      originalEventStartDate: String(info.OriginalEventStartDate || ''),
      originalEventStartTime: String(info.OriginalEventStartTime || ''),
      originalEventEndDate: String(info.OriginalEventEndDate || ''),
      originalEventEndTime: String(info.OriginalEventEndTime || ''),
      transactionLinkReason: this.validateTransactionLinkReason(
        String(info.TransactionLinkReason || 'other')
      ),
    };
  }

  /**
   * Parse OtherEvent element (non-sale transactions like no-sale, paid-out).
   */
  private parseOtherEvent(event: Record<string, unknown>): NAXMLOtherEvent {
    return {
      eventSequenceId: this.parseNumber(event.EventSequenceID || event.EventSequenceId, 0),
      eventType: String(event.EventType || ''),
      cashierId: String(event.CashierID || event.CashierId || ''),
      registerId: String(event.RegisterID || event.RegisterId || ''),
      eventDate: String(event.EventDate || ''),
      eventTime: String(event.EventTime || ''),
      businessDate: String(event.BusinessDate || ''),
      description: event.Description ? String(event.Description) : undefined,
      amount: event.Amount !== undefined ? this.parseNumber(event.Amount, 0) : undefined,
    };
  }

  // ============================================================================
  // PJR Validation Helper Methods
  // ============================================================================

  /**
   * Validate and normalize service level code.
   */
  private validateServiceLevelCode(code: string): NAXMLServiceLevelCode {
    const normalizedCode = code.toLowerCase();
    // Handle numeric codes from Gilbarco (1=self, 2=full, 3=mini)
    if (normalizedCode === '1' || normalizedCode === 'self') return 'self';
    if (normalizedCode === '2' || normalizedCode === 'full') return 'full';
    if (normalizedCode === '3' || normalizedCode === 'mini') return 'mini';
    return 'self'; // Default
  }

  /**
   * Validate and normalize entry method.
   */
  private validateEntryMethod(method: string): NAXMLEntryMethod {
    const validMethods: NAXMLEntryMethod[] = [
      'manual',
      'scanned',
      'keyed',
      'rfid',
      'card',
      'other',
    ];
    const normalized = method.toLowerCase();
    if (validMethods.includes(normalized as NAXMLEntryMethod)) {
      return normalized as NAXMLEntryMethod;
    }
    return 'manual'; // Default
  }

  /**
   * Validate and normalize tender code.
   */
  private validateTenderCode(code: string): NAXMLTenderCode {
    const validCodes: NAXMLTenderCode[] = [
      'cash',
      'check',
      'creditDebit',
      'foodStamps',
      'giftCard',
      'fleet',
      'coupon',
      'loyalty',
      'houseCharge',
      'other',
    ];
    const normalized = code.toLowerCase();

    // Direct match
    if (validCodes.includes(normalized as NAXMLTenderCode)) {
      return normalized as NAXMLTenderCode;
    }

    // Map common variations
    if (normalized.includes('credit') || normalized.includes('debit')) return 'creditDebit';
    if (normalized.includes('cash')) return 'cash';
    if (normalized.includes('check')) return 'check';
    if (normalized.includes('food') || normalized.includes('ebt')) return 'foodStamps';
    if (normalized.includes('gift')) return 'giftCard';
    if (normalized.includes('fleet')) return 'fleet';
    if (normalized.includes('coupon')) return 'coupon';
    if (normalized.includes('loyal')) return 'loyalty';
    if (normalized.includes('house') || normalized.includes('charge')) return 'houseCharge';

    return 'other'; // Default
  }

  /**
   * Validate and normalize transaction link reason.
   */
  private validateTransactionLinkReason(reason: string): NAXMLTransactionLinkReason {
    const validReasons: NAXMLTransactionLinkReason[] = [
      'fuelPrepay',
      'fuelPostpay',
      'layaway',
      'refund',
      'void',
      'split',
      'other',
    ];
    const normalized = reason.toLowerCase();

    // Direct match
    if (validReasons.includes(normalized as NAXMLTransactionLinkReason)) {
      return normalized as NAXMLTransactionLinkReason;
    }

    // Map common variations
    if (normalized.includes('prepay')) return 'fuelPrepay';
    if (normalized.includes('postpay')) return 'fuelPostpay';
    if (normalized.includes('refund')) return 'refund';
    if (normalized.includes('void')) return 'void';
    if (normalized.includes('split')) return 'split';

    return 'other'; // Default
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Ensure a value is an array
   */
  private ensureArray<T = Record<string, unknown>>(value: unknown): T[] {
    if (!value) return [];
    if (Array.isArray(value)) return value as T[];
    return [value] as T[];
  }

  /**
   * Parse a number value safely
   */
  private parseNumber(value: unknown, defaultValue: number): number {
    if (value === null || value === undefined) return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * Parse a boolean value (handles "Y"/"N" and "true"/"false")
   */
  private parseBoolean(value: unknown, defaultValue = false): boolean {
    if (value === null || value === undefined) return defaultValue;
    if (typeof value === 'boolean') return value;
    const str = String(value).toLowerCase();
    if (str === 'y' || str === 'yes' || str === 'true' || str === '1') return true;
    if (str === 'n' || str === 'no' || str === 'false' || str === '0') return false;
    return defaultValue;
  }
}

// ============================================================================
// Exports
// ============================================================================

/**
 * Create a new NAXML parser instance
 */
export function createNAXMLParser(options?: Partial<NAXMLParserOptions>): NAXMLParser {
  return new NAXMLParser(options);
}

/**
 * Parse NAXML XML string (convenience function)
 */
export function parseNAXML<T = unknown>(
  xml: string,
  options?: Partial<NAXMLParserOptions>
): NAXMLDocument<T> {
  const parser = createNAXMLParser(options);
  return parser.parse<T>(xml);
}

/**
 * Validate NAXML XML string (convenience function)
 */
export function validateNAXML(
  xml: string,
  options?: Partial<NAXMLParserOptions>
): NAXMLValidationResult {
  const parser = createNAXMLParser(options);
  return parser.validate(xml);
}

/**
 * Parse Fuel Grade Movement (FGM) XML string (convenience function).
 *
 * This function provides a convenient way to parse FGM documents with
 * Zod schema validation. Handles both "by tender" and "by position" variants.
 *
 * @param xml - The FGM XML string to parse
 * @param options - Optional parser options
 * @returns Parsed and validated FGM document
 * @throws NAXMLParserError on parsing or validation failure
 *
 * @example
 * ```typescript
 * const result = parseFuelGradeMovement(fgmXmlString);
 * console.log(result.data.movementHeader.businessDate);
 * console.log(result.data.fgmDetails.length);
 * ```
 */
export function parseFuelGradeMovement(
  xml: string,
  options?: Partial<NAXMLParserOptions>
): NAXMLDocument<NAXMLFuelGradeMovementData> {
  const parser = createNAXMLParser(options);
  return parser.parseFuelGradeMovement(xml);
}

/**
 * Parse Miscellaneous Summary Movement (MSM) XML string (convenience function).
 *
 * This function provides a convenient way to parse MSM documents with
 * Zod schema validation. MSM files contain various summary data including:
 * - Grand totals (sales, non-taxable, fuel/merchandise breakdowns)
 * - Drawer operations (safe drops, loans, payouts, payins)
 * - Transaction statistics (counts, voids, refunds, driveoffs)
 * - Fuel sales by grade (aggregated by grade)
 * - Tax totals by code
 * - Tender breakdown by method of payment
 *
 * @param xml - The MSM XML string to parse
 * @param options - Optional parser options
 * @returns Parsed and validated MSM document
 * @throws NAXMLParserError on parsing or validation failure
 *
 * @example
 * ```typescript
 * const result = parseMiscellaneousSummaryMovement(msmXmlString);
 * console.log(result.data.movementHeader.businessDate);
 * console.log(result.data.msmDetails.length);
 *
 * // Filter for fuel sales by grade
 * const fuelSales = result.data.msmDetails.filter(
 *   d => d.miscellaneousSummaryCodes.miscellaneousSummaryCode === 'fuelSalesByGrade'
 * );
 * ```
 */
export function parseMiscellaneousSummaryMovement(
  xml: string,
  options?: Partial<NAXMLParserOptions>
): NAXMLDocument<NAXMLMiscellaneousSummaryMovementData> {
  const parser = createNAXMLParser(options);
  return parser.parseMiscellaneousSummaryMovement(xml);
}

/**
 * Parse Fuel Product Movement (FPM) XML string (convenience function).
 *
 * This function provides a convenient way to parse FPM documents with
 * Zod schema validation. FPM files contain non-resettable pump meter readings
 * used for fuel reconciliation between book sales and actual fuel dispensed.
 *
 * Key data in FPM files:
 * - Fuel product identifiers (mapping to grades)
 * - Position-level cumulative volume readings
 * - Position-level cumulative amount readings (often 0 in Gilbarco systems)
 *
 * @param xml - The FPM XML string to parse
 * @param options - Optional parser options
 * @returns Parsed and validated FPM document
 * @throws NAXMLParserError on parsing or validation failure
 *
 * @example
 * ```typescript
 * const result = parseFuelProductMovement(fpmXmlString);
 * console.log(result.data.movementHeader.businessDate);
 * console.log(result.data.fpmDetails.length);
 *
 * // Get meter readings for product 1, position 1:
 * const product1 = result.data.fpmDetails.find(d => d.fuelProductId === '1');
 * const pos1Reading = product1?.fpmNonResettableTotals.find(t => t.fuelPositionId === '1');
 * console.log(`Volume: ${pos1Reading?.fuelProductNonResettableVolumeNumber} gallons`);
 * ```
 */
export function parseFuelProductMovement(
  xml: string,
  options?: Partial<NAXMLParserOptions>
): NAXMLDocument<NAXMLFuelProductMovementData> {
  const parser = createNAXMLParser(options);
  return parser.parseFuelProductMovement(xml);
}

// ============================================================================
// MSM Fuel Data Extraction
// ============================================================================

/**
 * MSM Summary code constants for fuel data extraction.
 *
 * @remarks
 * These constants define the exact code/subCode combinations used
 * in MSM files for fuel-related data. Following SEC-014 allowlist pattern.
 */
const MSM_FUEL_CODES = {
  /** Parent code for all fuel sales by grade entries */
  FUEL_SALES_BY_GRADE: 'fuelSalesByGrade',

  /** SubCode for total fuel sales (inside + outside combined) */
  FUEL_TOTAL: 'fuel',

  /** SubCode for inside (in-store/cash) fuel sales */
  FUEL_INSIDE: 'insideFuel',

  /** SubCode for outside (pay-at-pump) fuel sales - Period 1 only */
  FUEL_OUTSIDE: 'outsideSales',

  /** SubCode for outside percentage - not used for extraction */
  FUEL_OUTSIDE_PERCENT: 'outsidePercent',
} as const;

/**
 * MSM Discount code constants.
 */
const MSM_DISCOUNT_CODES = {
  /** Statistics parent code */
  STATISTICS: 'statistics',

  /** Discount parent code */
  DISCOUNT: 'discount',

  /** SubCode for discount statistics */
  DISCOUNTS: 'discounts',

  /** SubCode for fixed amount discounts */
  AMOUNT_FIXED: 'amountFixed',

  /** SubCode for percentage discounts */
  AMOUNT_PERCENTAGE: 'amountPercentage',

  /** SubCode for promotional discounts */
  PROMOTIONAL: 'promotional',

  /** SubCode for fuel discounts */
  FUEL: 'fuel',

  /** SubCode for store coupon discounts */
  STORE_COUPONS: 'storeCoupons',
} as const;

/**
 * Extract fuel data from parsed MSM document.
 *
 * This function processes parsed MSM data to extract structured fuel sales
 * information with inside/outside breakdown and discount totals.
 *
 * @remarks
 * ### Period Differences
 *
 * **Period 1 (Daily/Store Day):**
 * - Contains complete fuel breakdown by grade
 * - Includes `outsideSales` subCode with volume by grade
 * - Discount data (including fuel discounts) is present
 * - No SalesMovementHeader (store-level aggregate)
 *
 * **Period 98 (Shift Close):**
 * - Contains fuel breakdown by grade for inside sales
 * - `outsideSales` by grade is NOT available
 * - Outside dispenser records may appear after closing tag
 * - Contains SalesMovementHeader with register/cashier/till
 *
 * ### Data Mapping
 *
 * | MSM Code | SubCode | Modifier | Meaning |
 * |----------|---------|----------|---------|
 * | fuelSalesByGrade | fuel | {gradeId} | Total fuel (inside + outside) |
 * | fuelSalesByGrade | insideFuel | {gradeId} | Inside/cash fuel only |
 * | fuelSalesByGrade | outsideSales | {gradeId} | Outside/pay-at-pump (Period 1 only) |
 * | statistics | discounts | - | Discount statistics total |
 * | discount | fuel | - | Fuel-specific discounts |
 *
 * @param data - Parsed MSM document data (from parseMiscellaneousSummaryMovement)
 * @returns Extracted fuel data with inside/outside breakdown and discount totals
 *
 * @example
 * ```typescript
 * const msmDoc = parseMiscellaneousSummaryMovement(xmlContent);
 * const fuelData = extractFuelDataFromMSM(msmDoc.data);
 *
 * // Access inside fuel totals
 * console.log(`Inside: $${fuelData.totals.insideAmount} / ${fuelData.totals.insideVolume} gal`);
 *
 * // Access outside fuel totals (Period 1 only)
 * if (fuelData.period === 1) {
 *   console.log(`Outside: $${fuelData.totals.outsideAmount} / ${fuelData.totals.outsideVolume} gal`);
 * }
 *
 * // Access fuel discounts
 * console.log(`Fuel Discounts: $${fuelData.discounts.fuel}`);
 *
 * // Access fuel by grade
 * for (const grade of fuelData.totalFuel) {
 *   console.log(`Grade ${grade.gradeId}: $${grade.amount} / ${grade.volume} gal`);
 * }
 * ```
 *
 * @security SEC-014: Uses allowlist pattern for code matching
 */
export function extractFuelDataFromMSM(
  data: NAXMLMiscellaneousSummaryMovementData
): MSMExtractedFuelData {
  const { movementHeader, msmDetails } = data;

  // Initialize collections
  const insideFuel: MSMFuelSalesByGrade[] = [];
  const outsideFuel: MSMFuelSalesByGrade[] = [];
  const totalFuel: MSMFuelSalesByGrade[] = [];
  const outsideDispensers: MSMOutsideDispenserRecord[] = [];

  // Initialize discount totals
  const discounts: MSMDiscountTotals = {
    statistics: 0,
    amountFixed: 0,
    amountPercentage: 0,
    promotional: 0,
    fuel: 0,
    storeCoupons: 0,
  };

  // Process each MSM detail entry
  for (const detail of msmDetails) {
    const codes = detail.miscellaneousSummaryCodes;
    const code = codes.miscellaneousSummaryCode;
    const subCode = codes.miscellaneousSummarySubCode;
    const modifier = codes.miscellaneousSummarySubCodeModifier;
    const salesTotals = detail.msmSalesTotals;

    // Extract fuel sales by grade
    // SEC-014: Allowlist validation for code matching
    if (code === MSM_FUEL_CODES.FUEL_SALES_BY_GRADE && modifier) {
      const gradeEntry: MSMFuelSalesByGrade = {
        gradeId: modifier,
        amount: salesTotals?.miscellaneousSummaryAmount ?? 0,
        // Note: miscellaneousSummaryCount is volume (gallons) for fuel entries
        volume: salesTotals?.miscellaneousSummaryCount ?? 0,
      };

      switch (subCode) {
        case MSM_FUEL_CODES.FUEL_TOTAL:
          totalFuel.push(gradeEntry);
          break;
        case MSM_FUEL_CODES.FUEL_INSIDE:
          insideFuel.push(gradeEntry);
          break;
        case MSM_FUEL_CODES.FUEL_OUTSIDE:
          outsideFuel.push(gradeEntry);
          break;
        // outsidePercent is not extracted (not volume/amount data)
      }
    }

    // Extract discount data
    // SEC-014: Allowlist validation for discount codes
    if (code === MSM_DISCOUNT_CODES.STATISTICS && subCode === MSM_DISCOUNT_CODES.DISCOUNTS) {
      discounts.statistics = salesTotals?.miscellaneousSummaryAmount ?? 0;
    } else if (code === MSM_DISCOUNT_CODES.DISCOUNT) {
      const amount = salesTotals?.miscellaneousSummaryAmount ?? 0;
      switch (subCode) {
        case MSM_DISCOUNT_CODES.AMOUNT_FIXED:
          discounts.amountFixed = amount;
          break;
        case MSM_DISCOUNT_CODES.AMOUNT_PERCENTAGE:
          discounts.amountPercentage = amount;
          break;
        case MSM_DISCOUNT_CODES.PROMOTIONAL:
          discounts.promotional = amount;
          break;
        case MSM_DISCOUNT_CODES.FUEL:
          discounts.fuel = amount;
          break;
        case MSM_DISCOUNT_CODES.STORE_COUPONS:
          discounts.storeCoupons = amount;
          break;
      }
    }

    // Extract outside dispenser records (Period 98)
    // These records have registerId, tillId and tender info for outside sales
    if (
      detail.registerId &&
      detail.tillId &&
      salesTotals?.tender?.tenderCode &&
      (salesTotals.tender.tenderCode === 'outsideCredit' ||
        salesTotals.tender.tenderCode === 'outsideDebit')
    ) {
      outsideDispensers.push({
        registerId: detail.registerId,
        cashierId: detail.cashierId ?? '',
        tillId: detail.tillId,
        tender: salesTotals.tender.tenderCode as 'outsideCredit' | 'outsideDebit',
        amount: salesTotals.miscellaneousSummaryAmount ?? 0,
        count: salesTotals.miscellaneousSummaryCount ?? 0,
      });
    }
  }

  // Calculate totals
  const totals = calculateFuelTotals(insideFuel, outsideFuel, totalFuel, discounts);

  // Determine period type (cast to expected union)
  const period = movementHeader.primaryReportPeriod as 1 | 2 | 98;

  return {
    period,
    insideFuel,
    outsideFuel,
    totalFuel,
    outsideDispensers,
    discounts,
    totals,
    businessDate: movementHeader.businessDate,
    sourceInfo: {
      primaryReportPeriod: movementHeader.primaryReportPeriod,
      secondaryReportPeriod: movementHeader.secondaryReportPeriod,
      beginDate: movementHeader.beginDate,
      beginTime: movementHeader.beginTime,
      endDate: movementHeader.endDate,
      endTime: movementHeader.endTime,
    },
  };
}

/**
 * Calculate aggregated fuel totals from extracted data.
 *
 * @param insideFuel - Inside fuel sales by grade
 * @param outsideFuel - Outside fuel sales by grade (may be empty for Period 98)
 * @param totalFuel - Total fuel sales by grade
 * @param discounts - Discount totals
 * @returns Aggregated fuel totals
 */
function calculateFuelTotals(
  insideFuel: MSMFuelSalesByGrade[],
  outsideFuel: MSMFuelSalesByGrade[],
  totalFuel: MSMFuelSalesByGrade[],
  discounts: MSMDiscountTotals
): MSMFuelTotals {
  // Sum inside fuel
  const insideAmount = insideFuel.reduce((sum, g) => sum + g.amount, 0);
  const insideVolume = insideFuel.reduce((sum, g) => sum + g.volume, 0);

  // Sum outside fuel (may be empty for Period 98)
  const outsideAmount = outsideFuel.reduce((sum, g) => sum + g.amount, 0);
  const outsideVolume = outsideFuel.reduce((sum, g) => sum + g.volume, 0);

  // Sum total fuel (should match inside + outside for Period 1)
  const grandTotalAmount = totalFuel.reduce((sum, g) => sum + g.amount, 0);
  const grandTotalVolume = totalFuel.reduce((sum, g) => sum + g.volume, 0);

  // Total discount amount is primarily the fuel discount
  const discountAmount = discounts.fuel;

  return {
    insideAmount,
    insideVolume,
    outsideAmount,
    outsideVolume,
    grandTotalAmount,
    grandTotalVolume,
    discountAmount,
  };
}
