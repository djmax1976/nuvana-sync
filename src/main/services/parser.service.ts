/**
 * Parser Service
 *
 * Routes parsed NAXML documents to appropriate DAL for local storage.
 * After storage, enqueues records for cloud synchronization.
 *
 * @module main/services/parser
 * @security SEC-006: All database operations use parameterized queries via DAL
 * @security DB-006: All operations are store-scoped
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { createNAXMLParser } from '../../shared/naxml/parser';
import type { NAXMLDocument } from '../../shared/naxml/types';
import type {
  NAXMLDocumentType,
  NAXMLFuelGradeMovementData,
  NAXMLFuelProductMovementData,
  NAXMLMiscellaneousSummaryMovementData,
  NAXMLMerchandiseCodeMovementData,
  NAXMLTaxLevelMovementData,
  NAXMLItemSalesMovementData,
  NAXMLTankProductMovementData,
  NAXMLFGMDetail,
  NAXMLFPMDetail,
  NAXMLMSMDetail,
  NAXMLTLMDetail,
  NAXMLISMDetail,
  NAXMLTPMDetail,
  NAXMLMCMDetail,
} from '../../shared/naxml/types';
import { createLogger } from '../utils/logger';
import {
  processedFilesDAL,
  syncQueueDAL,
  fuelGradeMovementsDAL,
  fuelProductMovementsDAL,
  miscellaneousSummariesDAL,
  merchandiseMovementsDAL,
  taxLevelMovementsDAL,
  itemSalesMovementsDAL,
  tenderProductMovementsDAL,
  shiftsDAL,
  daySummariesDAL,
  transactionsDAL,
} from '../dal';
import { withTransaction } from './database.service';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of processing a file
 */
export interface FileProcessingResult {
  success: boolean;
  documentType: NAXMLDocumentType | 'Unknown';
  recordsCreated: number;
  error?: string;
  processingDurationMs: number;
  fileId?: string;
}

/**
 * Entity type mapping for sync queue
 */
type EntityType =
  | 'fuel_grade_movement'
  | 'fuel_product_movement'
  | 'miscellaneous_summary'
  | 'merchandise_movement'
  | 'tax_level_movement'
  | 'item_sales_movement'
  | 'tender_product_movement'
  | 'shift'
  | 'transaction';

// ============================================================================
// Constants
// ============================================================================

/** Maximum file size to process (100MB) - SEC-015 */
const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;

// ============================================================================
// Logger
// ============================================================================

const log = createLogger('parser-service');

// ============================================================================
// Parser Service
// ============================================================================

/**
 * Parser Service for NAXML document processing
 *
 * Routes parsed documents to appropriate DAL for storage and
 * queues records for cloud synchronization.
 */
export class ParserService {
  private storeId: string;
  private parser = createNAXMLParser();

  constructor(storeId: string) {
    this.storeId = storeId;
  }

  /**
   * Process a NAXML file from disk
   * SEC-015: Validates file size before processing
   *
   * @param filePath - Path to the XML file
   * @param fileHash - Pre-computed SHA-256 hash of the file
   * @returns Processing result
   */
  async processFile(filePath: string, fileHash: string): Promise<FileProcessingResult> {
    const startTime = Date.now();
    const fileName = path.basename(filePath);

    log.info('Processing file', { fileName, storeId: this.storeId });

    try {
      // SEC-015: Check file size limit
      const stats = await fs.stat(filePath);
      if (stats.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(
          `File exceeds maximum size limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`
        );
      }

      // Check for duplicate by hash
      if (processedFilesDAL.isFileProcessed(this.storeId, fileHash)) {
        log.info('Skipping duplicate file', { fileName, fileHash: fileHash.substring(0, 16) });
        return {
          success: true,
          documentType: 'Unknown',
          recordsCreated: 0,
          error: 'Duplicate file (already processed)',
          processingDurationMs: Date.now() - startTime,
          fileId: '',
        };
      }

      // Read and parse the file
      const xml = await fs.readFile(filePath, 'utf-8');
      const parseResult = this.parser.parse(xml);

      // Route and store based on document type
      const recordCount = await this.routeAndStore(parseResult, fileHash);

      // Record successful processing
      const processedFile = processedFilesDAL.recordFile({
        store_id: this.storeId,
        file_path: filePath,
        file_name: fileName,
        file_hash: fileHash,
        file_size: stats.size,
        document_type: parseResult.documentType,
        record_count: recordCount,
        status: 'SUCCESS',
        processing_duration_ms: Date.now() - startTime,
      });

      log.info('File processed successfully', {
        fileName,
        documentType: parseResult.documentType,
        recordsCreated: recordCount,
        durationMs: Date.now() - startTime,
      });

      return {
        success: true,
        documentType: parseResult.documentType,
        recordsCreated: recordCount,
        processingDurationMs: Date.now() - startTime,
        fileId: processedFile.id,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error('File processing failed', {
        fileName,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Record failed processing - wrapped in try-catch to preserve original error
      let fileId: string | undefined;
      try {
        const processedFile = processedFilesDAL.recordFile({
          store_id: this.storeId,
          file_path: filePath,
          file_name: fileName,
          file_hash: fileHash,
          file_size: 0,
          document_type: 'Unknown',
          record_count: 0,
          status: 'FAILED',
          error_message: errorMessage,
          processing_duration_ms: Date.now() - startTime,
        });
        fileId = processedFile.id;
      } catch (recordError) {
        log.error('Failed to record processing failure', {
          fileName,
          originalError: errorMessage,
          recordError: recordError instanceof Error ? recordError.message : String(recordError),
        });
      }

      return {
        success: false,
        documentType: 'Unknown',
        recordsCreated: 0,
        error: errorMessage,
        processingDurationMs: Date.now() - startTime,
        fileId,
      };
    }
  }

  /**
   * Process XML content directly (without file system)
   * Used for testing and IPC handling
   *
   * @param xml - XML content string
   * @param fileHash - Hash of the content
   * @param fileName - Original file name for logging
   * @returns Record count
   */
  async processContent(xml: string, fileHash: string, fileName: string): Promise<number> {
    // Check for duplicate
    if (processedFilesDAL.isFileProcessed(this.storeId, fileHash)) {
      log.debug('Skipping duplicate content', { fileName });
      return 0;
    }

    const parseResult = this.parser.parse(xml);
    return this.routeAndStore(parseResult, fileHash);
  }

  /**
   * Route parsed document to appropriate processor
   *
   * @param parseResult - Parsed NAXML document
   * @param fileHash - File hash for linking records
   * @returns Number of records created
   */
  private async routeAndStore(parseResult: NAXMLDocument, fileHash: string): Promise<number> {
    const { documentType, data } = parseResult;

    switch (documentType) {
      case 'FuelGradeMovement':
        return this.processFuelGradeMovement(data as NAXMLFuelGradeMovementData, fileHash);

      case 'FuelProductMovement':
        return this.processFuelProductMovement(data as NAXMLFuelProductMovementData, fileHash);

      case 'MiscellaneousSummaryMovement':
        return this.processMiscellaneousSummary(
          data as NAXMLMiscellaneousSummaryMovementData,
          fileHash
        );

      case 'MerchandiseCodeMovement':
        return this.processMerchandiseMovement(data as NAXMLMerchandiseCodeMovementData, fileHash);

      case 'TaxLevelMovement':
        return this.processTaxLevelMovement(data as NAXMLTaxLevelMovementData, fileHash);

      case 'ItemSalesMovement':
        return this.processItemSalesMovement(data as NAXMLItemSalesMovementData, fileHash);

      case 'TankProductMovement':
        return this.processTenderProductMovement(data as NAXMLTankProductMovementData, fileHash);

      case 'POSJournal':
        // POS Journal requires special handling - transactions with line items
        return this.processPOSJournal(data, fileHash);

      default:
        log.warn('Unknown document type, skipping', { documentType });
        return 0;
    }
  }

  // ==========================================================================
  // Document Type Processors
  // ==========================================================================

  /**
   * Process Fuel Grade Movement (FGM)
   * SEC-006: Uses parameterized DAL methods
   */
  private processFuelGradeMovement(data: NAXMLFuelGradeMovementData, fileHash: string): number {
    const { movementHeader, fgmDetails, salesMovementHeader } = data;
    const businessDate = movementHeader.businessDate;
    let count = 0;

    // Get or create shift for shift-level reports
    let shiftId: string | undefined;
    if (salesMovementHeader && movementHeader.primaryReportPeriod === 98) {
      const shift = shiftsDAL.getOrCreateForDate(this.storeId, businessDate);
      shiftId = shift.shift_id;
    }

    // Use transaction for atomicity
    return withTransaction(() => {
      for (const detail of fgmDetails) {
        const recordId = fuelGradeMovementsDAL.createFromNAXML(
          this.storeId,
          businessDate,
          this.mapFGMDetail(detail),
          fileHash,
          shiftId
        );

        // Enqueue for sync
        this.enqueueForSync('fuel_grade_movement', recordId);
        count++;
      }

      log.debug('FGM records created', { count, businessDate });
      return count;
    });
  }

  /**
   * Map FGM detail to DAL input format
   */
  private mapFGMDetail(detail: NAXMLFGMDetail): import('../dal').NAXMLFGMInput {
    return {
      fuelGradeId: detail.fuelGradeId,
      fgmTenderSummary: detail.fgmTenderSummary,
      fgmPositionSummary: detail.fgmPositionSummary,
    };
  }

  /**
   * Process Fuel Product Movement (FPM)
   * SEC-006: Uses parameterized DAL methods
   */
  private processFuelProductMovement(data: NAXMLFuelProductMovementData, fileHash: string): number {
    const { movementHeader, fpmDetails } = data;
    const businessDate = movementHeader.businessDate;
    let count = 0;

    return withTransaction(() => {
      for (const detail of fpmDetails) {
        const recordIds = fuelProductMovementsDAL.createFromNAXML(
          this.storeId,
          businessDate,
          this.mapFPMDetail(detail),
          fileHash
        );

        for (const recordId of recordIds) {
          this.enqueueForSync('fuel_product_movement', recordId);
        }
        count += recordIds.length;
      }

      log.debug('FPM records created', { count, businessDate });
      return count;
    });
  }

  /**
   * Map FPM detail to DAL input format
   */
  private mapFPMDetail(detail: NAXMLFPMDetail): import('../dal').NAXMLFPMInput {
    return {
      fuelProductId: detail.fuelProductId,
      fpmNonResettableTotals: detail.fpmNonResettableTotals || [],
    };
  }

  /**
   * Process Miscellaneous Summary Movement (MSM)
   * SEC-006: Uses parameterized DAL methods
   */
  private processMiscellaneousSummary(
    data: NAXMLMiscellaneousSummaryMovementData,
    fileHash: string
  ): number {
    const { movementHeader, msmDetails, salesMovementHeader } = data;
    const businessDate = movementHeader.businessDate;
    let count = 0;

    // Get shift for shift-level reports
    let shiftId: string | undefined;
    if (salesMovementHeader && movementHeader.primaryReportPeriod === 98) {
      const shift = shiftsDAL.getOrCreateForDate(this.storeId, businessDate);
      shiftId = shift.shift_id;
    }

    return withTransaction(() => {
      for (const detail of msmDetails) {
        const recordId = miscellaneousSummariesDAL.createFromNAXML(
          this.storeId,
          businessDate,
          this.mapMSMDetail(detail),
          fileHash,
          shiftId
        );

        this.enqueueForSync('miscellaneous_summary', recordId);
        count++;
      }

      log.debug('MSM records created', { count, businessDate });
      return count;
    });
  }

  /**
   * Map MSM detail to DAL input format
   */
  private mapMSMDetail(detail: NAXMLMSMDetail): import('../dal').NAXMLMSMInput {
    return {
      miscellaneousSummaryCodes: detail.miscellaneousSummaryCodes,
      registerId: detail.registerId,
      cashierId: detail.cashierId,
      tillId: detail.tillId,
      msmSalesTotals: detail.msmSalesTotals,
    };
  }

  /**
   * Process Merchandise Code Movement (MCM)
   * SEC-006: Uses parameterized DAL methods
   */
  private processMerchandiseMovement(
    data: NAXMLMerchandiseCodeMovementData,
    fileHash: string
  ): number {
    const { movementHeader, mcmDetails, salesMovementHeader } = data;
    const businessDate = movementHeader.businessDate;
    let count = 0;

    let shiftId: string | undefined;
    if (salesMovementHeader && movementHeader.primaryReportPeriod === 98) {
      const shift = shiftsDAL.getOrCreateForDate(this.storeId, businessDate);
      shiftId = shift.shift_id;
    }

    return withTransaction(() => {
      for (const detail of mcmDetails) {
        const mcmInput = this.mapMCMDetail(detail);
        const recordId = merchandiseMovementsDAL.createFromNAXML(
          this.storeId,
          businessDate,
          mcmInput,
          fileHash,
          shiftId
        );

        this.enqueueForSync('merchandise_movement', recordId);
        count++;
      }

      log.debug('MCM records created', { count, businessDate });
      return count;
    });
  }

  /**
   * Map MCM detail to DAL input format
   * Maps from types.ts NAXMLMCMDetail structure
   */
  private mapMCMDetail(detail: NAXMLMCMDetail): import('../dal').NAXMLMCMInput {
    const salesTotals = detail.mcmSalesTotals;
    return {
      departmentId: detail.merchandiseCode,
      categoryId: detail.merchandiseCodeDescription,
      quantitySold: salesTotals?.salesQuantity,
      amountSold: salesTotals?.salesAmount,
      discountAmount: salesTotals?.discountAmount,
      refundAmount: salesTotals?.refundAmount,
      transactionCount: salesTotals?.transactionCount,
    };
  }

  /**
   * Process Tax Level Movement (TLM)
   * SEC-006: Uses parameterized DAL methods
   */
  private processTaxLevelMovement(data: NAXMLTaxLevelMovementData, fileHash: string): number {
    const { movementHeader, tlmDetails, salesMovementHeader } = data;
    const businessDate = movementHeader.businessDate;
    let count = 0;

    let shiftId: string | undefined;
    if (salesMovementHeader && movementHeader.primaryReportPeriod === 98) {
      const shift = shiftsDAL.getOrCreateForDate(this.storeId, businessDate);
      shiftId = shift.shift_id;
    }

    return withTransaction(() => {
      for (const detail of tlmDetails) {
        const tlmInput = this.mapTLMDetail(detail);
        const recordId = taxLevelMovementsDAL.createFromNAXML(
          this.storeId,
          businessDate,
          tlmInput,
          fileHash,
          shiftId
        );

        this.enqueueForSync('tax_level_movement', recordId);
        count++;
      }

      log.debug('TLM records created', { count, businessDate });
      return count;
    });
  }

  /**
   * Map TLM detail to DAL input format
   * Maps from types.ts NAXMLTLMDetail structure
   */
  private mapTLMDetail(detail: NAXMLTLMDetail): import('../dal').NAXMLTLMInput {
    return {
      taxLevel: detail.taxLevelId,
      taxableAmount: detail.taxableSalesAmount,
      taxAmount: detail.taxCollectedAmount,
      exemptAmount: detail.taxExemptSalesAmount,
    };
  }

  /**
   * Process Item Sales Movement (ISM)
   * SEC-006: Uses parameterized bulk insert for performance
   */
  private processItemSalesMovement(data: NAXMLItemSalesMovementData, fileHash: string): number {
    const { movementHeader, ismDetails, salesMovementHeader } = data;
    const businessDate = movementHeader.businessDate;

    let shiftId: string | undefined;
    if (salesMovementHeader && movementHeader.primaryReportPeriod === 98) {
      const shift = shiftsDAL.getOrCreateForDate(this.storeId, businessDate);
      shiftId = shift.shift_id;
    }

    // Map to bulk input format
    const items = ismDetails.map((detail) => this.mapISMDetail(detail));

    // Use bulk insert for performance (ISM can have many items)
    const count = itemSalesMovementsDAL.bulkCreateFromNAXML(
      this.storeId,
      businessDate,
      items,
      fileHash,
      shiftId
    );

    // Note: For ISM, we enqueue the file as a batch rather than individual items
    // This prevents sync queue explosion for large ISM files
    if (count > 0) {
      // Enqueue a summary record for sync
      syncQueueDAL.enqueue({
        store_id: this.storeId,
        entity_type: 'item_sales_movement_batch',
        entity_id: fileHash,
        operation: 'CREATE',
        payload: { businessDate, count, fileHash },
      });
    }

    log.debug('ISM records created', { count, businessDate });
    return count;
  }

  /**
   * Map ISM detail to DAL input format
   * Maps from types.ts NAXMLISMDetail structure
   */
  private mapISMDetail(detail: NAXMLISMDetail): import('../dal').NAXMLISMInput {
    return {
      itemCode: detail.itemCode,
      itemDescription: detail.itemDescription,
      departmentId: detail.merchandiseCode,
      upc: undefined, // Not in NAXMLISMDetail
      quantitySold: detail.salesQuantity,
      amountSold: detail.salesAmount,
      discountAmount: undefined, // Not in NAXMLISMDetail
      transactionCount: undefined, // Not in NAXMLISMDetail
    };
  }

  /**
   * Process Tank Product Movement (TPM) - maps to tank inventory data
   * SEC-006: Uses parameterized DAL methods
   * Note: TPM is tank inventory, not tender data. Maps to tender_product_movements
   * table for now (to be refactored if separate tank table needed)
   */
  private processTenderProductMovement(
    data: NAXMLTankProductMovementData,
    fileHash: string
  ): number {
    const { movementHeader, tpmDetails } = data;
    const businessDate = movementHeader.businessDate;
    let count = 0;

    // TPM doesn't have salesMovementHeader - it's tank inventory data
    return withTransaction(() => {
      for (const detail of tpmDetails) {
        const tpmInput = this.mapTPMDetail(detail);
        const recordId = tenderProductMovementsDAL.createFromNAXML(
          this.storeId,
          businessDate,
          tpmInput,
          fileHash,
          undefined // No shift for tank data
        );

        this.enqueueForSync('tender_product_movement', recordId);
        count++;
      }

      log.debug('TPM records created', { count, businessDate });
      return count;
    });
  }

  /**
   * Map TPM detail to DAL input format
   * Maps from types.ts NAXMLTPMDetail structure (tank inventory)
   */
  private mapTPMDetail(detail: NAXMLTPMDetail): import('../dal').NAXMLTPMInput {
    return {
      tenderId: detail.tankId,
      tenderType: detail.fuelProductId,
      amount: detail.tankVolume,
      transactionCount: undefined, // Tank data doesn't have transaction count
    };
  }

  /**
   * Process POS Journal (PJR)
   * Creates shifts, transactions, line items, and payments
   * SEC-006: Uses parameterized DAL methods within transaction
   */
  private processPOSJournal(data: unknown, fileHash: string): number {
    // POS Journal structure is more complex - parse and handle
    const pjrData = data as {
      journalHeader?: { businessDate?: string };
      transactions?: unknown[];
    };

    if (!pjrData.journalHeader?.businessDate || !pjrData.transactions) {
      log.warn('Invalid POS Journal structure');
      return 0;
    }

    const businessDate = pjrData.journalHeader.businessDate;
    let count = 0;

    return withTransaction(() => {
      // Ensure day summary exists
      daySummariesDAL.getOrCreateForDate(this.storeId, businessDate);

      for (const txn of pjrData.transactions || []) {
        const transaction = txn as {
          transactionNumber?: number;
          transactionTime?: string;
          shiftNumber?: number;
          registerId?: string;
          cashierId?: string;
          totalAmount?: number;
          paymentType?: string;
          lineItems?: Array<{
            lineNumber: number;
            itemCode?: string;
            description?: string;
            quantity?: number;
            unitPrice?: number;
            totalPrice?: number;
            departmentId?: string;
          }>;
          payments?: Array<{
            paymentType: string;
            amount: number;
            referenceNumber?: string;
          }>;
        };

        // Get or create shift
        const shift = shiftsDAL.getOrCreateForDate(this.storeId, businessDate);

        // Create transaction with details
        const created = transactionsDAL.createWithDetails({
          store_id: this.storeId,
          shift_id: shift.shift_id,
          business_date: businessDate,
          transaction_number: transaction.transactionNumber,
          transaction_time: transaction.transactionTime,
          register_id: transaction.registerId,
          cashier_id: transaction.cashierId,
          total_amount: transaction.totalAmount,
          payment_type: transaction.paymentType,
          lineItems: transaction.lineItems?.map((item, idx) => ({
            line_number: item.lineNumber || idx + 1,
            item_code: item.itemCode,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unitPrice,
            total_price: item.totalPrice,
            department_id: item.departmentId,
          })),
          payments: transaction.payments?.map((payment) => ({
            payment_type: payment.paymentType,
            amount: payment.amount,
            reference_number: payment.referenceNumber,
          })),
        });

        // Enqueue transaction for sync
        this.enqueueForSync('transaction', created.transaction_id);
        count++;
      }

      log.debug('PJR transactions created', { count, businessDate });
      return count;
    });
  }

  // ==========================================================================
  // Sync Queue Helper
  // ==========================================================================

  /**
   * Enqueue a record for cloud synchronization
   * SEC-006: Uses parameterized DAL method
   *
   * @param entityType - Type of entity
   * @param entityId - Entity ID
   */
  private enqueueForSync(entityType: EntityType, entityId: string): void {
    syncQueueDAL.enqueue({
      store_id: this.storeId,
      entity_type: entityType,
      entity_id: entityId,
      operation: 'CREATE',
      payload: { entityType, entityId },
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new ParserService instance for a store
 *
 * @param storeId - Store identifier
 * @returns New ParserService instance
 */
export function createParserService(storeId: string): ParserService {
  return new ParserService(storeId);
}
