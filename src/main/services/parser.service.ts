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
import { createNAXMLParser, extractFuelDataFromMSM } from '../../shared/naxml/parser';
import type { NAXMLDocument, MSMExtractedFuelData } from '../../shared/naxml/types';
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
  NAXMLTLMDetail,
  NAXMLTPMDetail,
  NAXMLMCMDetail,
  // POSJournal types
  NAXMLPOSJournalDocument,
  NAXMLSaleEvent,
  NAXMLJournalTransactionTax,
} from '../../shared/naxml/types';
import { createLogger } from '../utils/logger';
import {
  processedFilesDAL,
  shiftsDAL,
  daySummariesDAL,
  transactionsDAL,
  // POS ID Mapping DALs for external ID → internal UUID translation
  posCashierMappingsDAL,
  posTerminalMappingsDAL,
  posFuelPositionMappingsDAL,
  posTillMappingsDAL,
  posFuelGradeMappingsDAL,
  posDepartmentMappingsDAL,
  posTaxLevelMappingsDAL,
  posTenderMappingsDAL,
  posPriceTierMappingsDAL,
  // Schema-Aligned DALs
  shiftSummariesDAL,
  shiftFuelSummariesDAL,
  shiftDepartmentSummariesDAL,
  shiftTenderSummariesDAL,
  shiftTaxSummariesDAL,
  meterReadingsDAL,
  tankReadingsDAL,
  type FuelTenderType,
  // MSM Fuel Data DALs (v014 - Phase 4)
  dayFuelSummariesDAL,
  msmDiscountSummariesDAL,
  msmOutsideDispenserRecordsDAL,
  type MSMDiscountType,
  // Transaction Types for PJR processing
  type CreateLineItemData,
  type CreatePaymentData,
  type CreateTaxSummaryData,
} from '../dal';
import { withTransaction } from './database.service';
import { eventBus, MainEvents } from '../utils/event-bus';
import {
  determineShiftCloseType,
  buildShiftSyncPayload,
  SHIFT_SYNC_PRIORITY,
} from '../ipc/shifts.handlers';
import type { ShiftClosedEvent } from '../../shared/types/shift-events';
import { syncQueueDAL } from '../dal/sync-queue.dal';

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
  /** Indicates the file was skipped (e.g., duplicate detection) */
  skipped?: boolean;
}

// NOTE: Transaction sync removed - no push endpoint exists in API spec
// Transactions are parsed and stored locally but not synced to cloud
// API spec only supports lottery-related push operations

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
      const isDuplicate = processedFilesDAL.isFileProcessed(this.storeId, fileHash);

      if (isDuplicate) {
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
      const errorStack = error instanceof Error ? error.stack : undefined;

      log.error('File processing failed', {
        fileName,
        error: errorMessage,
        stack: errorStack,
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
   * DB-006: Store-scoped operations
   *
   * Creates ID mappings for external POS IDs and handles shift closing
   * for Period 98 (shift close) files.
   */
  private processFuelGradeMovement(data: NAXMLFuelGradeMovementData, fileHash: string): number {
    const { movementHeader, fgmDetails, salesMovementHeader } = data;

    // Get the ACTUAL business date (adjusted for overnight shifts)
    const businessDate = this.getActualBusinessDate(
      movementHeader.businessDate,
      movementHeader.beginTime,
      movementHeader.endDate
    );

    // SHIFT CLOSE DETECTION (SEC-014: Input validation)
    // Primary check: EndDate sentinel value (2100-01-01 = open, actual date = closed)
    // Secondary check: Period 98 (shift-level report)
    const isShiftClosedByDate = this.isShiftClosedByEndDate(movementHeader.endDate);
    const isShiftCloseFile = movementHeader.primaryReportPeriod === 98;

    // Log detection method for debugging
    if (isShiftClosedByDate && !isShiftCloseFile) {
      log.info('FGM: Shift close detected via EndDate (non-Period 98 file)', {
        businessDate,
        endDate: movementHeader.endDate,
        primaryReportPeriod: movementHeader.primaryReportPeriod,
      });
    }

    // Shift should be closed if EITHER condition is true
    const shouldCloseShift = isShiftClosedByDate || isShiftCloseFile;
    let count = 0;

    // Track external IDs from XML and their internal mappings
    let externalCashierId: string | undefined;
    let externalRegisterId: string | undefined;
    let externalTillId: string | undefined;
    let internalUserId: string | null = null;
    let tillMappingId: string | undefined;

    if (salesMovementHeader) {
      // Store external IDs from XML
      externalCashierId = salesMovementHeader.cashierId;
      externalRegisterId = salesMovementHeader.registerId;
      externalTillId = salesMovementHeader.tillId;

      // Create/get cashier mapping - get internal_user_id if linked
      if (externalCashierId) {
        const cashierMapping = posCashierMappingsDAL.getOrCreate(this.storeId, externalCashierId);
        // Use internal_user_id if the mapping has been linked to a user
        internalUserId = cashierMapping.internal_user_id;
      }

      // Create/get terminal/register mapping (for reference tracking)
      if (externalRegisterId) {
        posTerminalMappingsDAL.getOrCreate(this.storeId, externalRegisterId, {
          source: 'xml:FuelGradeMovement',
        });
      }

      // Create/get till mapping
      if (externalTillId) {
        const terminalMapping = externalRegisterId
          ? posTerminalMappingsDAL.findByExternalId(this.storeId, externalRegisterId)
          : undefined;
        const tillMapping = posTillMappingsDAL.getOrCreate(
          this.storeId,
          externalTillId,
          businessDate,
          { relatedTerminalMappingId: terminalMapping?.id }
        );
        tillMappingId = tillMapping.id;
      }
    }

    // Get or create shift using EXTERNAL IDs (stored in external_* columns)
    // Only cashier_id is set if we have a valid internal_user_id (FK to users)
    //
    // IMPORTANT: Shift handling depends on whether this is a close event:
    // - For shift close (shouldCloseShift=true): Find existing shift, don't create new
    // - For active shift data: Get or create shift
    let shiftId: string | undefined;
    let shiftNumber: number = 1; // Track shift number for event emission
    if (salesMovementHeader) {
      if (shouldCloseShift) {
        // For shift close files: find existing shift for this date
        // First try by register, then fall back to any shift on this date
        // (handles case where Period 2 day-level file created shift without register ID)
        let existingClosedShift = shiftsDAL.findShiftByDateAndRegister(
          this.storeId,
          businessDate,
          externalRegisterId
        );
        if (!existingClosedShift) {
          // Fall back to date-only match (may find shift with NULL register)
          existingClosedShift = shiftsDAL.findShiftByDateAndRegister(
            this.storeId,
            businessDate,
            undefined // No register filter
          );
        }
        if (existingClosedShift) {
          // Use existing shift - update register ID if it was NULL
          shiftId = existingClosedShift.shift_id;
          shiftNumber = existingClosedShift.shift_number ?? 1;
          // Update register ID on shift if it was NULL (from day-level report)
          if (!existingClosedShift.external_register_id && externalRegisterId) {
            shiftsDAL.update(shiftId, { external_register_id: externalRegisterId });
          }
          log.debug('FGM: Using existing shift', {
            businessDate,
            externalRegisterId,
            shiftId,
            isOpen: !existingClosedShift.end_time,
          });
        } else {
          // No shift exists for this date/register - try adjacent dates for overnight shifts
          const openShiftToClose = shiftsDAL.findOpenShiftToClose(
            this.storeId,
            businessDate,
            externalRegisterId
          );
          if (openShiftToClose) {
            shiftId = openShiftToClose.shift_id;
            shiftNumber = openShiftToClose.shift_number ?? 1;
          } else {
            // CRITICAL: FGM files do NOT create shifts - only MSM files create shifts.
            // If no shift exists, log warning and continue without linking to shift.
            // DB-006: Store-scoped query ensures tenant isolation
            log.warn(
              'FGM: No existing shift found to close - MSM file may not have been processed',
              {
                businessDate,
                externalRegisterId,
                externalCashierId,
                detectionMethod: isShiftCloseFile ? 'Period98' : 'EndDate',
                endDate: movementHeader.endDate,
                hint: 'FGM data will be processed for mappings but not linked to a shift',
              }
            );
            // Continue processing without a shift - data will be captured in mappings
          }
        }
      } else {
        // Non-close file - find existing shift, don't create new ones
        // MSM files (processed first) should have already created shifts
        const existingShift = shiftsDAL.findShiftByDateAndRegister(
          this.storeId,
          businessDate,
          externalRegisterId
        );
        if (existingShift) {
          shiftId = existingShift.shift_id;
          log.debug('FGM: Linking to existing shift', {
            businessDate,
            externalRegisterId,
            shiftId,
          });

          // Link till mapping to shift
          if (tillMappingId) {
            posTillMappingsDAL.linkToShift(tillMappingId, shiftId);
          }
        } else {
          // No shift exists - log warning but don't create
          // This data will still be processed for mappings but won't be linked to a shift
          log.warn('FGM: No existing shift found to link (MSM may not have been processed)', {
            businessDate,
            externalRegisterId,
            externalCashierId,
          });
        }
      }
    } else {
      // No salesMovementHeader (day-level reports like Period 2)
      // Try to find an existing shift for this business date to link fuel data
      // Do NOT create shifts - MSM files should have already created them
      const existingShifts = shiftsDAL.findByDate(this.storeId, businessDate);
      if (existingShifts.length > 0) {
        // Use the first shift for this date (typically there's only one per register)
        shiftId = existingShifts[0].shift_id;
        log.debug('FGM: Linking to existing shift (day-level report)', {
          businessDate,
          shiftId,
          shiftCount: existingShifts.length,
        });
      } else {
        // No shift exists - log warning but continue processing
        // Data will be processed but not linked to a shift
        log.warn('FGM: No existing shift found for day-level report', {
          businessDate,
        });
      }
    }

    // Use transaction for atomicity
    return withTransaction(() => {
      // Get or create shift summary for the new schema
      let shiftSummaryId: string | undefined;
      if (shiftId) {
        const shiftSummary = shiftSummariesDAL.getOrCreateForShift(
          this.storeId,
          shiftId,
          businessDate,
          {
            shift_opened_at: `${movementHeader.beginDate}T${movementHeader.beginTime}`,
            cashier_user_id: internalUserId ?? undefined,
          }
        );
        shiftSummaryId = shiftSummary.shift_summary_id;
      }

      for (const detail of fgmDetails) {
        // Create fuel grade mapping
        if (detail.fuelGradeId) {
          posFuelGradeMappingsDAL.getOrCreate(this.storeId, detail.fuelGradeId);
        }

        // Create fuel position mappings if present
        if (detail.fgmPositionSummary?.fuelPositionId) {
          posFuelPositionMappingsDAL.getOrCreate(
            this.storeId,
            detail.fgmPositionSummary.fuelPositionId
          );
        }

        // Create tender mapping if present
        let _tenderType: FuelTenderType = 'ALL';
        if (detail.fgmTenderSummary?.tender) {
          const tender = detail.fgmTenderSummary.tender;
          posTenderMappingsDAL.getOrCreate(this.storeId, tender.tenderCode, {
            externalTenderSubcode: tender.tenderSubCode,
          });
          // Map tender code to FuelTenderType
          _tenderType = this.mapTenderCodeToFuelTenderType(tender.tenderCode);
        }

        // Create price tier mapping if present
        if (detail.fgmPositionSummary?.fgmPriceTierSummaries) {
          for (const tierSummary of detail.fgmPositionSummary.fgmPriceTierSummaries) {
            if (tierSummary.priceTierCode) {
              posPriceTierMappingsDAL.getOrCreate(this.storeId, tierSummary.priceTierCode);
            }
          }
        }

        // NOTE: Fuel summaries are now extracted from MSM files (fuelSalesByGrade)
        // which contain the authoritative aggregated totals per shift.
        // FGM files are only used for pump-level mappings, not for shift totals.
        // The MSM fuel data matches the Shift Close PDF report exactly.
        // DISABLED: This code block is intentionally disabled.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (false as boolean) {
          // DISABLED - using MSM fuelSalesByGrade instead
          if (shiftSummaryId && isShiftCloseFile) {
            const fuelData = this.extractFuelDataFromFGM(detail, 'ALL');
            shiftFuelSummariesDAL.createFromNAXML(shiftSummaryId, fuelData, fileHash);

            // Also create tender summary for this fuel tender
            if (detail.fgmTenderSummary?.tender) {
              const tenderData = this.extractTenderDataFromFGM(detail);
              if (tenderData) {
                shiftTenderSummariesDAL.upsert({
                  shift_summary_id: shiftSummaryId,
                  tender_code: tenderData.tenderCode,
                  tender_display_name: tenderData.tenderDisplayName,
                  total_amount: tenderData.totalAmount,
                  transaction_count: tenderData.transactionCount,
                });
              }
            }
          }
        }

        count++;
      }

      // Close shift if this is a shift-close event (Period 98 OR EndDate != sentinel)
      // SEC-014: EndDate check is authoritative per NAXML specification
      if (shouldCloseShift && shiftId) {
        const endTime = `${movementHeader.endDate}T${movementHeader.endTime}`;
        shiftsDAL.closeShift(shiftId, endTime);

        // Also close the shift summary
        if (shiftSummaryId) {
          shiftSummariesDAL.closeShiftSummary(
            this.storeId,
            shiftSummaryId,
            endTime,
            internalUserId ?? undefined
          );
        }

        log.info('Shift closed via FGM', {
          shiftId,
          businessDate,
          endTime,
          detectionMethod: isShiftCloseFile ? 'Period98' : 'EndDate',
          endDate: movementHeader.endDate,
        });

        // Emit shift closed event for renderer notification
        // LM-001: Structured logging with event context
        this.emitShiftClosedEvent({
          shiftId,
          businessDate,
          endTime,
          shiftNumber,
          externalRegisterId,
          externalCashierId,
        });
      }

      log.debug('FGM records created', {
        count,
        businessDate,
        shouldCloseShift,
        isShiftCloseFile,
        isShiftClosedByDate,
      });
      return count;
    });
  }

  /**
   * Map tender code to FuelTenderType
   */
  private mapTenderCodeToFuelTenderType(tenderCode: string): FuelTenderType {
    const code = tenderCode.toUpperCase();
    if (code === 'CASH' || code.includes('CASH')) return 'CASH';
    if (
      code === 'CREDIT' ||
      code.includes('CREDIT') ||
      code.includes('VISA') ||
      code.includes('MC') ||
      code.includes('AMEX')
    )
      return 'CREDIT';
    if (code === 'DEBIT' || code.includes('DEBIT')) return 'DEBIT';
    if (code === 'FLEET' || code.includes('FLEET')) return 'FLEET';
    return 'OTHER';
  }

  /**
   * Extract fuel summary data from FGM detail
   *
   * FGM structure has sales data at:
   * - fgmTenderSummary.fgmSellPriceSummary.fgmServiceLevelSummary.fgmSalesTotals
   * - fgmPositionSummary.fgmPriceTierSummaries[].fgmSalesTotals
   */
  private extractFuelDataFromFGM(
    detail: NAXMLFGMDetail,
    tenderType: FuelTenderType
  ): import('../dal').NAXMLShiftFuelInput {
    let salesVolume = 0;
    let salesAmount = 0;
    let discountAmount = 0;
    let discountCount = 0;
    let _unitPrice: number | undefined;

    // Try to get data from tender summary (more commonly used)
    if (detail.fgmTenderSummary?.fgmSellPriceSummary) {
      const salesTotals =
        detail.fgmTenderSummary.fgmSellPriceSummary.fgmServiceLevelSummary?.fgmSalesTotals;
      if (salesTotals) {
        salesVolume = salesTotals.fuelGradeSalesVolume || 0;
        salesAmount = salesTotals.fuelGradeSalesAmount || 0;
        discountAmount = salesTotals.discountAmount || 0;
        discountCount = salesTotals.discountCount || 0;
      }
      // Get unit price from sell price summary
      _unitPrice = detail.fgmTenderSummary.fgmSellPriceSummary.actualSalesPrice;
    }

    // Also try position summaries for pump-level breakdown (Period 98 files)
    // Sum ALL position summaries and ALL price tiers to get the total for this grade
    if (detail.fgmPositionSummaries && detail.fgmPositionSummaries.length > 0) {
      // Only use position data if we don't have tender data
      if (salesVolume === 0) {
        for (const position of detail.fgmPositionSummaries) {
          if (position.fgmPriceTierSummaries) {
            for (const tier of position.fgmPriceTierSummaries) {
              const tierTotals = tier.fgmSalesTotals;
              if (tierTotals) {
                salesVolume += tierTotals.fuelGradeSalesVolume || 0;
                salesAmount += tierTotals.fuelGradeSalesAmount || 0;
                discountAmount += tierTotals.discountAmount || 0;
              }
            }
          }
        }
      }
    } else if (detail.fgmPositionSummary?.fgmPriceTierSummaries) {
      // Fallback to single position summary for backwards compat
      if (salesVolume === 0) {
        for (const tier of detail.fgmPositionSummary.fgmPriceTierSummaries) {
          const tierTotals = tier.fgmSalesTotals;
          if (tierTotals) {
            salesVolume += tierTotals.fuelGradeSalesVolume || 0;
            salesAmount += tierTotals.fuelGradeSalesAmount || 0;
            discountAmount += tierTotals.discountAmount || 0;
          }
        }
      }
    }

    return {
      fuelGradeId: detail.fuelGradeId,
      tenderType,
      salesVolume,
      salesAmount,
      discountAmount,
      discountCount,
    };
  }

  /**
   * Extract tender data from FGM detail for tender summary
   *
   * Uses the sales totals from the tender summary path.
   */
  private extractTenderDataFromFGM(detail: NAXMLFGMDetail): {
    tenderCode: string;
    tenderDisplayName?: string;
    totalAmount: number;
    transactionCount: number;
  } | null {
    if (!detail.fgmTenderSummary?.tender) {
      return null;
    }

    const tender = detail.fgmTenderSummary.tender;
    const salesTotals =
      detail.fgmTenderSummary.fgmSellPriceSummary?.fgmServiceLevelSummary?.fgmSalesTotals;

    return {
      tenderCode: tender.tenderCode,
      tenderDisplayName: undefined, // NAXMLFGMTender doesn't have description
      totalAmount: salesTotals?.fuelGradeSalesAmount || 0,
      transactionCount: 0, // Transaction count not available in FGM tender structure
    };
  }

  /**
   * Process Fuel Product Movement (FPM) - pump meter readings
   * SEC-006: Uses parameterized DAL methods
   */
  private processFuelProductMovement(data: NAXMLFuelProductMovementData, fileHash: string): number {
    const { movementHeader, fpmDetails } = data;

    // Get the ACTUAL business date (adjusted for overnight shifts)
    const businessDate = this.getActualBusinessDate(
      movementHeader.businessDate,
      movementHeader.beginTime,
      movementHeader.endDate
    );
    let count = 0;

    return withTransaction(() => {
      for (const detail of fpmDetails) {
        // Extract meter readings from FPM non-resettable totals
        const readings = this.extractMeterReadingsFromFPM(detail);
        if (readings.length > 0) {
          const createdIds = meterReadingsDAL.createFromNAXML(
            this.storeId,
            businessDate,
            'CLOSE', // FPM non-resettable totals are typically close readings
            readings,
            fileHash
          );
          count += createdIds.length;
        }
      }

      log.debug('FPM meter readings created', { count, businessDate });
      return count;
    });
  }

  /**
   * Extract meter reading data from FPM detail
   */
  private extractMeterReadingsFromFPM(
    detail: NAXMLFPMDetail
  ): Array<import('../dal').NAXMLMeterReadingInput> {
    const readings: Array<import('../dal').NAXMLMeterReadingInput> = [];

    for (const total of detail.fpmNonResettableTotals || []) {
      readings.push({
        fuelPositionId: total.fuelPositionId,
        fuelProductId: detail.fuelProductId,
        volumeReading: total.fuelProductNonResettableVolumeNumber || 0,
        amountReading: total.fuelProductNonResettableAmountNumber,
      });
    }

    return readings;
  }

  /**
   * NAXML sentinel value indicating an open shift.
   * According to NAXML spec: EndDate = 2100-01-01 means shift is still open.
   * When a shift closes, EndDate is set to the actual closing date.
   * SEC-014: Defined as constant for validation against NAXML standard
   */
  private static readonly NAXML_OPEN_SHIFT_SENTINEL_DATE = '2100-01-01';

  /**
   * Determine if a shift should be closed based on NAXML EndDate.
   * SEC-014: Validates against NAXML specification.
   *
   * NAXML uses EndDate = 2100-01-01 as a sentinel value for OPEN shifts.
   * Any other valid date indicates the shift is CLOSED.
   *
   * @param endDate - The EndDate from MovementHeader
   * @returns true if shift should be closed, false if still open
   */
  private isShiftClosedByEndDate(endDate: string): boolean {
    // SEC-014: Validate input format (YYYY-MM-DD)
    if (!endDate || endDate.trim().length === 0) {
      return false;
    }

    // Sentinel value check: 2100-01-01 = OPEN shift
    if (endDate === ParserService.NAXML_OPEN_SHIFT_SENTINEL_DATE) {
      return false;
    }

    // Any other valid date format means CLOSED
    // SEC-014: Validate date format before accepting
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(endDate)) {
      log.warn('Invalid EndDate format in NAXML', { endDate });
      return false;
    }

    // Additional validation: ensure date is reasonable (not in distant future)
    const year = parseInt(endDate.substring(0, 4), 10);
    if (year >= 2100) {
      // Any year >= 2100 is treated as sentinel (open)
      return false;
    }

    return true;
  }

  /**
   * Determine the ACTUAL business date for overnight shifts.
   *
   * CRITICAL: For gas stations with 24-hour shifts starting near midnight:
   * - XML BusinessDate = the date when the shift OPENED (e.g., Jan 8 at 11:59 PM)
   * - XML EndDate = the date when the shift CLOSED (e.g., Jan 9 at 11:59 PM)
   * - The ACTUAL business day covered is EndDate (Jan 9), NOT BusinessDate (Jan 8)
   *
   * Example from PDF "Shift Close" report:
   * - "PERIOD FROM: Jan 08, 2026 11:59 PM TO: Jan 09, 2026 11:59 PM"
   * - This shift covers January 9th's business operations
   * - XML would have BusinessDate=2026-01-08, but actual business day is 2026-01-09
   *
   * @param businessDate - The BusinessDate from NAXML MovementHeader
   * @param beginTime - The BeginTime from NAXML MovementHeader (HH:MM:SS format)
   * @param endDate - The EndDate from NAXML MovementHeader (YYYY-MM-DD format)
   * @returns The actual business date (may be adjusted to EndDate for overnight shifts)
   */
  private getActualBusinessDate(
    businessDate: string,
    beginTime: string | undefined,
    endDate: string | undefined
  ): string {
    // If missing required fields, return original business date
    if (!beginTime || !endDate || !businessDate) {
      return businessDate;
    }

    // Skip if EndDate is the sentinel value (shift still open)
    if (endDate === ParserService.NAXML_OPEN_SHIFT_SENTINEL_DATE || endDate >= '2100') {
      return businessDate;
    }

    const beginHour = parseInt(beginTime.split(':')[0], 10);

    // If shift begins at 23:xx (11 PM+) and EndDate > BusinessDate,
    // this is an overnight shift pattern - use EndDate as the actual business day
    if (beginHour >= 23 && endDate > businessDate) {
      log.debug('Overnight shift: Using EndDate as business date', {
        originalBusinessDate: businessDate,
        adjustedBusinessDate: endDate,
        beginTime,
        endDate,
      });
      return endDate;
    }

    return businessDate;
  }

  /**
   * Process Miscellaneous Summary Movement (MSM)
   * SEC-006: Uses parameterized DAL methods
   * DB-006: Store-scoped operations
   *
   * Creates ID mappings for external POS IDs and handles shift closing.
   *
   * SHIFT CLOSE DETECTION:
   * Per NAXML specification, shifts are closed based on TWO conditions:
   * 1. Period 98 (shift-level report) - traditional detection
   * 2. EndDate != 2100-01-01 (sentinel value) - authoritative source
   *
   * The EndDate check is the PRIMARY and AUTHORITATIVE method because:
   * - It works even if Period 98 files are missing or corrupted
   * - It reflects the actual POS system state
   * - 2100-01-01 is the NAXML standard sentinel for "still open"
   */
  private processMiscellaneousSummary(
    data: NAXMLMiscellaneousSummaryMovementData,
    fileHash: string
  ): number {
    const { movementHeader, msmDetails, salesMovementHeader } = data;

    // Get the ACTUAL business date (adjusted for overnight shifts)
    const businessDate = this.getActualBusinessDate(
      movementHeader.businessDate,
      movementHeader.beginTime,
      movementHeader.endDate
    );

    // SHIFT CLOSE DETECTION (SEC-014: Input validation)
    // Primary check: EndDate sentinel value (2100-01-01 = open, actual date = closed)
    // Secondary check: Period 98 (shift-level report)
    const isShiftClosedByDate = this.isShiftClosedByEndDate(movementHeader.endDate);
    const isShiftCloseFile = movementHeader.primaryReportPeriod === 98;

    // Log detection method for debugging
    if (isShiftClosedByDate && !isShiftCloseFile) {
      log.info('Shift close detected via EndDate (non-Period 98 file)', {
        businessDate,
        endDate: movementHeader.endDate,
        primaryReportPeriod: movementHeader.primaryReportPeriod,
      });
    }

    // Shift should be closed if EITHER condition is true
    const shouldCloseShift = isShiftClosedByDate || isShiftCloseFile;
    let count = 0;

    // Track external IDs from XML and their internal mappings
    let externalCashierId: string | undefined;
    let externalRegisterId: string | undefined;
    let externalTillId: string | undefined;
    let internalUserId: string | null = null;
    let tillMappingId: string | undefined;

    if (salesMovementHeader) {
      // Store external IDs from XML
      externalCashierId = salesMovementHeader.cashierId;
      externalRegisterId = salesMovementHeader.registerId;
      externalTillId = salesMovementHeader.tillId;

      // Create/get cashier mapping - get internal_user_id if linked
      if (externalCashierId) {
        const cashierMapping = posCashierMappingsDAL.getOrCreate(this.storeId, externalCashierId);
        // Use internal_user_id if the mapping has been linked to a user
        internalUserId = cashierMapping.internal_user_id;
      }

      // Create/get terminal/register mapping (for reference tracking)
      if (externalRegisterId) {
        posTerminalMappingsDAL.getOrCreate(this.storeId, externalRegisterId, {
          source: 'xml:MiscellaneousSummary',
        });
      }

      // Create/get till mapping
      if (externalTillId) {
        const terminalMapping = externalRegisterId
          ? posTerminalMappingsDAL.findByExternalId(this.storeId, externalRegisterId)
          : undefined;
        const tillMapping = posTillMappingsDAL.getOrCreate(
          this.storeId,
          externalTillId,
          businessDate,
          { relatedTerminalMappingId: terminalMapping?.id }
        );
        tillMappingId = tillMapping.id;
      }
    }

    // Get or create shift using EXTERNAL IDs (stored in external_* columns)
    // Only cashier_id is set if we have a valid internal_user_id (FK to users)
    //
    // IMPORTANT: Shift handling depends on whether this is a close event:
    // - For shift close (shouldCloseShift=true): Find existing shift, don't create new
    // - For active shift data: Get or create shift
    let shiftId: string | undefined;
    let shiftNumber: number = 1; // Track shift number for event emission
    if (salesMovementHeader) {
      if (shouldCloseShift) {
        // For shift close files, first check for ANY shift (open or closed)
        const existingClosedShift = shiftsDAL.findShiftByDateAndRegister(
          this.storeId,
          businessDate,
          externalRegisterId
        );
        if (existingClosedShift) {
          shiftId = existingClosedShift.shift_id;
          shiftNumber = existingClosedShift.shift_number ?? 1;
          log.debug('MSM: Using existing shift', { businessDate, shiftId });
        } else {
          // Check adjacent dates for overnight shifts
          const openShiftToClose = shiftsDAL.findOpenShiftToClose(
            this.storeId,
            businessDate,
            externalRegisterId
          );
          if (openShiftToClose) {
            shiftId = openShiftToClose.shift_id;
            shiftNumber = openShiftToClose.shift_number ?? 1;
          } else {
            log.info('Creating closed shift from MSM (no prior shift found)', {
              businessDate,
              externalRegisterId,
              externalCashierId,
              detectionMethod: isShiftCloseFile ? 'Period98' : 'EndDate',
              endDate: movementHeader.endDate,
            });
            const shift = shiftsDAL.createClosedShift(this.storeId, businessDate, {
              externalCashierId,
              externalRegisterId,
              externalTillId,
              internalUserId: internalUserId ?? undefined,
              startTime: `${movementHeader.beginDate}T${movementHeader.beginTime}`,
              endTime: `${movementHeader.endDate}T${movementHeader.endTime}`,
            });
            shiftId = shift.shift_id;

            // SEC-017: Enqueue newly created closed shift for cloud sync
            // CRITICAL: Shift MUST sync BEFORE pack operations that reference it
            syncQueueDAL.enqueue({
              entity_type: 'shift',
              entity_id: shift.shift_id,
              operation: 'CREATE',
              store_id: this.storeId,
              priority: SHIFT_SYNC_PRIORITY,
              payload: buildShiftSyncPayload(shift),
            });
          }
        }
      } else {
        // Normal file (still open) - get or create shift
        const shift = shiftsDAL.getOrCreateForDate(this.storeId, businessDate, {
          // External IDs from POS XML (for reference/debugging)
          externalCashierId,
          externalRegisterId,
          externalTillId,
          // Internal user ID from mapping (FK-safe for users table)
          internalUserId: internalUserId ?? undefined,
          startTime: `${movementHeader.beginDate}T${movementHeader.beginTime}`,
        });
        shiftId = shift.shift_id;

        // SEC-017: Enqueue shift for cloud sync if not already pending
        // Avoids duplicate enqueue for shifts that already exist
        if (!syncQueueDAL.hasPendingSync('shift', shift.shift_id)) {
          syncQueueDAL.enqueue({
            entity_type: 'shift',
            entity_id: shift.shift_id,
            operation: 'CREATE',
            store_id: this.storeId,
            priority: SHIFT_SYNC_PRIORITY,
            payload: buildShiftSyncPayload(shift),
          });
        }

        // Link till mapping to shift
        if (tillMappingId) {
          posTillMappingsDAL.linkToShift(tillMappingId, shiftId);
        }
      }
    }

    return withTransaction(() => {
      // Get or create shift summary for the new schema
      let shiftSummaryId: string | undefined;
      if (shiftId) {
        const shiftSummary = shiftSummariesDAL.getOrCreateForShift(
          this.storeId,
          shiftId,
          businessDate,
          {
            shift_opened_at: `${movementHeader.beginDate}T${movementHeader.beginTime}`,
            cashier_user_id: internalUserId ?? undefined,
          }
        );
        shiftSummaryId = shiftSummary.shift_summary_id;
      }

      for (const detail of msmDetails) {
        // Create mappings for IDs in the detail
        if (detail.registerId) {
          posTerminalMappingsDAL.getOrCreate(this.storeId, detail.registerId, {
            source: 'xml:MiscellaneousSummary:detail',
          });
        }
        if (detail.cashierId) {
          posCashierMappingsDAL.getOrCreate(this.storeId, detail.cashierId);
        }
        if (detail.tillId) {
          posTillMappingsDAL.getOrCreate(this.storeId, detail.tillId, businessDate);
        }

        // Create mappings for fuel grades in detail records
        const codes = detail.miscellaneousSummaryCodes;
        if (
          codes.miscellaneousSummaryCode === 'fuelSalesByGrade' &&
          codes.miscellaneousSummarySubCodeModifier
        ) {
          posFuelGradeMappingsDAL.getOrCreate(
            this.storeId,
            codes.miscellaneousSummarySubCodeModifier
          );
        }

        count++;
      }

      // ========================================================================
      // Phase 4: MSM Fuel Data Extraction using extractFuelDataFromMSM
      // SEC-006: All database operations use parameterized queries via DAL
      // DB-006: All operations are store-scoped
      // ========================================================================

      // Extract structured fuel data from MSM using the parser function
      const extractedFuelData = extractFuelDataFromMSM(data);

      // Determine if this is Period 2 (Day/Store Close - Daily) or Period 98 (Shift)
      // Note: Per NAXML spec, Period 2 = Day/Store Close (aggregated daily data)
      // Period 98 = Shift Close (individual shift data)
      const isPeriod2Daily = movementHeader.primaryReportPeriod === 2;
      const isPeriod98Shift = movementHeader.primaryReportPeriod === 98;

      // ---------------------------------------------------------------------
      // Period 2 (Day/Store Close): Save to day_fuel_summaries
      // Contains complete daily fuel data with inside/outside breakdown
      // ---------------------------------------------------------------------
      if (isPeriod2Daily) {
        // Get or create day summary for the business date
        const daySummary = daySummariesDAL.getOrCreateForDate(this.storeId, businessDate);

        // Process total fuel by grade (totalFuel array)
        for (const gradeData of extractedFuelData.totalFuel) {
          // Find matching inside fuel data for this grade
          const insideGrade = extractedFuelData.insideFuel.find(
            (g) => g.gradeId === gradeData.gradeId
          );
          // Find matching outside fuel data for this grade
          const outsideGrade = extractedFuelData.outsideFuel.find(
            (g) => g.gradeId === gradeData.gradeId
          );

          // Create day fuel summary with inside/outside breakdown
          dayFuelSummariesDAL.createFromMSM(
            daySummary.day_summary_id,
            {
              gradeId: gradeData.gradeId,
              totalVolume: gradeData.volume,
              totalAmount: gradeData.amount,
              insideVolume: insideGrade?.volume ?? 0,
              insideAmount: insideGrade?.amount ?? 0,
              outsideVolume: outsideGrade?.volume ?? 0,
              outsideAmount: outsideGrade?.amount ?? 0,
              // Discount is at daily level, not per-grade
              discountAmount: 0,
            },
            fileHash
          );

          log.debug('MSM Period 2: Created day fuel summary', {
            gradeId: gradeData.gradeId,
            totalVolume: gradeData.volume,
            totalAmount: gradeData.amount,
            insideVolume: insideGrade?.volume ?? 0,
            outsideVolume: outsideGrade?.volume ?? 0,
          });
        }

        // Save discount summaries for Period 2 (daily discounts)
        this.saveMSMDiscountSummaries(
          businessDate,
          movementHeader.primaryReportPeriod,
          null, // No shift for daily
          extractedFuelData.discounts,
          fileHash
        );

        log.info('MSM Period 2: Daily fuel data processed', {
          businessDate,
          totalFuelGrades: extractedFuelData.totalFuel.length,
          insideAmount: extractedFuelData.totals.insideAmount,
          outsideAmount: extractedFuelData.totals.outsideAmount,
          grandTotalAmount: extractedFuelData.totals.grandTotalAmount,
          fuelDiscount: extractedFuelData.discounts.fuel,
        });
      }

      // ---------------------------------------------------------------------
      // Period 98 (Shift): Save to shift_fuel_summaries with inside/outside
      // Contains shift-level fuel data with inside breakdown
      // Outside dispenser records are saved separately (no grade breakdown)
      // ---------------------------------------------------------------------
      if (isPeriod98Shift && shiftSummaryId) {
        // Process inside fuel by grade (the primary data in Period 98)
        for (const insideGrade of extractedFuelData.insideFuel) {
          // Create shift fuel summary using MSM method with inside/outside breakdown
          shiftFuelSummariesDAL.createFromMSM(
            shiftSummaryId,
            {
              gradeId: insideGrade.gradeId,
              tenderType: 'ALL',
              // Total = inside for Period 98 (outside is in dispenser records)
              totalVolume: insideGrade.volume,
              totalAmount: insideGrade.amount,
              // Inside breakdown
              insideVolume: insideGrade.volume,
              insideAmount: insideGrade.amount,
              // Outside is not available by grade in Period 98
              outsideVolume: 0,
              outsideAmount: 0,
              // MSM metadata
              msmPeriod: movementHeader.primaryReportPeriod,
              msmSecondaryPeriod: movementHeader.secondaryReportPeriod,
              tillId: externalTillId,
              registerId: externalRegisterId,
            },
            fileHash
          );

          log.debug('MSM Period 98: Created shift fuel summary', {
            gradeId: insideGrade.gradeId,
            insideVolume: insideGrade.volume,
            insideAmount: insideGrade.amount,
            shiftSummaryId,
          });
        }

        // Save outside dispenser records (Period 98 specific)
        // These have amount and count but NOT volume by grade
        for (const dispenser of extractedFuelData.outsideDispensers) {
          msmOutsideDispenserRecordsDAL.upsert({
            store_id: this.storeId,
            business_date: businessDate,
            shift_id: shiftId,
            register_id: dispenser.registerId,
            till_id: dispenser.tillId || undefined,
            cashier_id: dispenser.cashierId || undefined,
            tender_type: dispenser.tender,
            amount: dispenser.amount,
            transaction_count: dispenser.count,
            source_file_hash: fileHash,
          });

          log.debug('MSM Period 98: Created outside dispenser record', {
            registerId: dispenser.registerId,
            tenderType: dispenser.tender,
            amount: dispenser.amount,
            count: dispenser.count,
          });
        }

        // Save discount summaries for Period 98 (shift-level discounts)
        // Note: Fuel discounts typically appear only in Period 1 (daily)
        this.saveMSMDiscountSummaries(
          businessDate,
          movementHeader.primaryReportPeriod,
          shiftId ?? null,
          extractedFuelData.discounts,
          fileHash
        );

        log.info('MSM Period 98: Shift fuel data processed', {
          businessDate,
          shiftId,
          insideFuelGrades: extractedFuelData.insideFuel.length,
          insideAmount: extractedFuelData.totals.insideAmount,
          outsideDispenserRecords: extractedFuelData.outsideDispensers.length,
        });
      }

      // Close shift if this is a shift-close event (Period 98 OR EndDate != sentinel)
      // SEC-014: EndDate check is authoritative per NAXML specification
      if (shouldCloseShift && shiftId) {
        const endTime = `${movementHeader.endDate}T${movementHeader.endTime}`;
        shiftsDAL.closeShift(shiftId, endTime);

        // Also close the shift summary
        if (shiftSummaryId) {
          shiftSummariesDAL.closeShiftSummary(
            this.storeId,
            shiftSummaryId,
            endTime,
            internalUserId ?? undefined
          );
        }

        log.info('Shift closed via MSM', {
          shiftId,
          businessDate,
          endTime,
          detectionMethod: isShiftCloseFile ? 'Period98' : 'EndDate',
          endDate: movementHeader.endDate,
        });

        // Emit shift closed event for renderer notification
        this.emitShiftClosedEvent({
          shiftId,
          businessDate,
          endTime,
          shiftNumber,
          externalRegisterId,
          externalCashierId,
        });
      }

      log.debug('MSM records created', {
        count,
        businessDate,
        shouldCloseShift,
        isShiftCloseFile,
        isShiftClosedByDate,
      });
      return count;
    });
  }

  /**
   * Process Merchandise Code Movement (MCM)
   * SEC-006: Uses parameterized DAL methods
   * DB-006: Store-scoped operations
   *
   * Creates ID mappings for external POS IDs and handles shift closing.
   * All MCM data is linked to shifts (not just Period 98) following
   * the AGKsoft pattern of Date+Shift linking.
   */
  private processMerchandiseMovement(
    data: NAXMLMerchandiseCodeMovementData,
    _fileHash: string
  ): number {
    const { movementHeader, mcmDetails, salesMovementHeader } = data;

    // Get the ACTUAL business date (adjusted for overnight shifts)
    const businessDate = this.getActualBusinessDate(
      movementHeader.businessDate,
      movementHeader.beginTime,
      movementHeader.endDate
    );

    // SHIFT CLOSE DETECTION (SEC-014: Input validation)
    // Primary check: EndDate sentinel value (2100-01-01 = open, actual date = closed)
    // Secondary check: Period 98 (shift-level report)
    const isShiftClosedByDate = this.isShiftClosedByEndDate(movementHeader.endDate);
    const isShiftCloseFile = movementHeader.primaryReportPeriod === 98;
    const shouldCloseShift = isShiftClosedByDate || isShiftCloseFile;
    let count = 0;

    // Track external IDs from XML and their internal mappings
    let externalCashierId: string | undefined;
    let externalRegisterId: string | undefined;
    let internalUserId: string | null = null;

    if (salesMovementHeader) {
      externalCashierId = salesMovementHeader.cashierId;
      externalRegisterId = salesMovementHeader.registerId;

      // Create/get cashier mapping - get internal_user_id if linked
      if (externalCashierId) {
        const cashierMapping = posCashierMappingsDAL.getOrCreate(this.storeId, externalCashierId);
        internalUserId = cashierMapping.internal_user_id;
      }

      // Create/get terminal/register mapping (for reference tracking)
      if (externalRegisterId) {
        posTerminalMappingsDAL.getOrCreate(this.storeId, externalRegisterId, {
          source: 'xml:MerchandiseMovement',
        });
      }
    }

    // Get or create shift - ALWAYS link MCM data to shifts (not just Period 98)
    let shiftId: string | undefined;
    let existingShift: ReturnType<typeof shiftsDAL.findShiftByDateAndRegister> | undefined;
    if (salesMovementHeader) {
      if (shouldCloseShift) {
        // For shift close files, first check for ANY shift (open or closed)
        existingShift = shiftsDAL.findShiftByDateAndRegister(
          this.storeId,
          businessDate,
          externalRegisterId
        );
        if (existingShift) {
          shiftId = existingShift.shift_id;
          log.debug('MCM: Using existing shift', { businessDate, shiftId });
        } else {
          // Check adjacent dates for overnight shifts
          const openShiftToClose = shiftsDAL.findOpenShiftToClose(
            this.storeId,
            businessDate,
            externalRegisterId
          );
          if (openShiftToClose) {
            shiftId = openShiftToClose.shift_id;
            existingShift = openShiftToClose;
          } else {
            // CRITICAL: MCM files do NOT create shifts - only MSM files create shifts.
            // If no shift exists, log warning and continue without linking to shift.
            // DB-006: Store-scoped query ensures tenant isolation
            log.warn(
              'MCM: No existing shift found to close - MSM file may not have been processed',
              {
                businessDate,
                externalRegisterId,
                externalCashierId,
                hint: 'MCM data will be processed for mappings but not linked to a shift',
              }
            );
            // Continue processing without a shift - data will be captured in mappings
          }
        }
      } else {
        // Non-close file - find existing shift, don't create new ones
        // MSM files (processed first) should have already created shifts
        const existingShift2 = shiftsDAL.findShiftByDateAndRegister(
          this.storeId,
          businessDate,
          externalRegisterId
        );
        if (existingShift2) {
          shiftId = existingShift2.shift_id;
          log.debug('MCM: Linking to existing shift', {
            businessDate,
            externalRegisterId,
            shiftId,
          });
        } else {
          log.warn('MCM: No existing shift found to link (MSM may not have been processed)', {
            businessDate,
            externalRegisterId,
            externalCashierId,
          });
        }
      }
    } else {
      // No salesMovementHeader (day-level reports) - link to existing shift only
      const existingShifts = shiftsDAL.findByDate(this.storeId, businessDate);
      if (existingShifts.length > 0) {
        shiftId = existingShifts[0].shift_id;
        log.debug('MCM: Linking to existing shift (day-level report)', {
          businessDate,
          shiftId,
        });
      } else {
        log.warn('MCM: No existing shift found for day-level report', {
          businessDate,
        });
      }
    }

    return withTransaction(() => {
      // Get or create shift summary for the new schema
      let shiftSummaryId: string | undefined;
      if (shiftId) {
        const shiftSummary = shiftSummariesDAL.getOrCreateForShift(
          this.storeId,
          shiftId,
          businessDate,
          {
            shift_opened_at: `${movementHeader.beginDate}T${movementHeader.beginTime}`,
            cashier_user_id: internalUserId ?? undefined,
          }
        );
        shiftSummaryId = shiftSummary.shift_summary_id;
      }

      for (const detail of mcmDetails) {
        // Create department mapping for the merchandise code
        if (detail.merchandiseCode) {
          posDepartmentMappingsDAL.getOrCreate(this.storeId, detail.merchandiseCode, {
            externalDescription: detail.merchandiseCodeDescription,
          });
        }

        // Create shift department summary record (aggregated by department)
        if (shiftSummaryId) {
          const departmentData = this.extractDepartmentDataFromMCM(detail);
          shiftDepartmentSummariesDAL.createFromNAXML(shiftSummaryId, departmentData);
        }

        count++;
      }

      // Close shift if this is a shift-close event
      if (shouldCloseShift && shiftId) {
        const endTime = `${movementHeader.endDate}T${movementHeader.endTime}`;
        shiftsDAL.closeShift(shiftId, endTime);

        if (shiftSummaryId) {
          shiftSummariesDAL.closeShiftSummary(
            this.storeId,
            shiftSummaryId,
            endTime,
            internalUserId ?? undefined
          );
        }

        log.info('Shift closed via MCM', { shiftId, businessDate, endTime });

        // Emit shift closed event for renderer notification
        this.emitShiftClosedEvent({
          shiftId,
          businessDate,
          endTime,
          shiftNumber: existingShift?.shift_number ?? 1,
          externalRegisterId,
          externalCashierId,
        });
      }

      log.debug('MCM records created', { count, businessDate, shiftId });
      return count;
    });
  }

  /**
   * Extract department summary data from MCM detail
   */
  private extractDepartmentDataFromMCM(
    detail: NAXMLMCMDetail
  ): import('../dal').NAXMLDepartmentInput {
    const salesTotals = detail.mcmSalesTotals;
    return {
      departmentCode: detail.merchandiseCode,
      departmentName: detail.merchandiseCodeDescription,
      grossSales: salesTotals?.salesAmount,
      returnsTotal: salesTotals?.refundAmount,
      discountsTotal: salesTotals?.discountAmount,
      transactionCount: salesTotals?.transactionCount,
      itemsSoldCount: salesTotals?.salesQuantity,
    };
  }

  /**
   * Process Tax Level Movement (TLM)
   * SEC-006: Uses parameterized DAL methods
   * DB-006: Store-scoped operations
   *
   * Creates ID mappings for external POS IDs and handles shift closing.
   * All TLM data is linked to shifts (not just Period 98) following
   * the AGKsoft pattern of Date+Shift linking.
   */
  private processTaxLevelMovement(data: NAXMLTaxLevelMovementData, _fileHash: string): number {
    const { movementHeader, tlmDetails, salesMovementHeader } = data;

    // Get the ACTUAL business date (adjusted for overnight shifts)
    const businessDate = this.getActualBusinessDate(
      movementHeader.businessDate,
      movementHeader.beginTime,
      movementHeader.endDate
    );

    // SHIFT CLOSE DETECTION (SEC-014: Input validation)
    // Primary check: EndDate sentinel value (2100-01-01 = open, actual date = closed)
    // Secondary check: Period 98 (shift-level report)
    const isShiftClosedByDate = this.isShiftClosedByEndDate(movementHeader.endDate);
    const isShiftCloseFile = movementHeader.primaryReportPeriod === 98;
    const shouldCloseShift = isShiftClosedByDate || isShiftCloseFile;
    let count = 0;

    // Track external IDs from XML and their internal mappings
    let externalCashierId: string | undefined;
    let externalRegisterId: string | undefined;
    let internalUserId: string | null = null;

    if (salesMovementHeader) {
      externalCashierId = salesMovementHeader.cashierId;
      externalRegisterId = salesMovementHeader.registerId;

      // Create/get cashier mapping - get internal_user_id if linked
      if (externalCashierId) {
        const cashierMapping = posCashierMappingsDAL.getOrCreate(this.storeId, externalCashierId);
        internalUserId = cashierMapping.internal_user_id;
      }

      // Create/get terminal/register mapping (for reference tracking)
      if (externalRegisterId) {
        posTerminalMappingsDAL.getOrCreate(this.storeId, externalRegisterId, {
          source: 'xml:TaxLevelMovement',
        });
      }
    }

    // Get or create shift - ALWAYS link TLM data to shifts (not just Period 98)
    let shiftId: string | undefined;
    let existingShift: ReturnType<typeof shiftsDAL.findShiftByDateAndRegister> | undefined;
    if (salesMovementHeader) {
      if (shouldCloseShift) {
        // For shift close files, first check for ANY shift (open or closed)
        existingShift = shiftsDAL.findShiftByDateAndRegister(
          this.storeId,
          businessDate,
          externalRegisterId
        );
        if (existingShift) {
          shiftId = existingShift.shift_id;
          log.debug('TLM: Using existing shift', { businessDate, shiftId });
        } else {
          // Check adjacent dates for overnight shifts
          const openShiftToClose = shiftsDAL.findOpenShiftToClose(
            this.storeId,
            businessDate,
            externalRegisterId
          );
          if (openShiftToClose) {
            shiftId = openShiftToClose.shift_id;
            existingShift = openShiftToClose;
          } else {
            // CRITICAL: TLM files do NOT create shifts - only MSM files create shifts.
            // If no shift exists, log warning and continue without linking to shift.
            // DB-006: Store-scoped query ensures tenant isolation
            log.warn(
              'TLM: No existing shift found to close - MSM file may not have been processed',
              {
                businessDate,
                externalRegisterId,
                externalCashierId,
                hint: 'TLM data will be processed for mappings but not linked to a shift',
              }
            );
            // Continue processing without a shift - data will be captured in mappings
          }
        }
      } else {
        // Non-close file - find existing shift, don't create new ones
        // MSM files (processed first) should have already created shifts
        const existingShift2 = shiftsDAL.findShiftByDateAndRegister(
          this.storeId,
          businessDate,
          externalRegisterId
        );
        if (existingShift2) {
          shiftId = existingShift2.shift_id;
          log.debug('TLM: Linking to existing shift', {
            businessDate,
            externalRegisterId,
            shiftId,
          });
        } else {
          log.warn('TLM: No existing shift found to link (MSM may not have been processed)', {
            businessDate,
            externalRegisterId,
            externalCashierId,
          });
        }
      }
    } else {
      // No salesMovementHeader (day-level reports) - link to existing shift only
      // DB-006: Store-scoped query ensures tenant isolation
      const existingShifts = shiftsDAL.findByDate(this.storeId, businessDate);
      if (existingShifts.length > 0) {
        shiftId = existingShifts[0].shift_id;
        log.debug('TLM: Linking to existing shift (day-level report)', {
          businessDate,
          shiftId,
        });
      } else {
        log.warn('TLM: No existing shift found for day-level report', {
          businessDate,
        });
      }
    }

    return withTransaction(() => {
      // Get or create shift summary for the new schema
      let shiftSummaryId: string | undefined;
      if (shiftId) {
        const shiftSummary = shiftSummariesDAL.getOrCreateForShift(
          this.storeId,
          shiftId,
          businessDate,
          {
            shift_opened_at: `${movementHeader.beginDate}T${movementHeader.beginTime}`,
            cashier_user_id: internalUserId ?? undefined,
          }
        );
        shiftSummaryId = shiftSummary.shift_summary_id;
      }

      for (const detail of tlmDetails) {
        // Create tax level mapping
        if (detail.taxLevelId) {
          posTaxLevelMappingsDAL.getOrCreate(this.storeId, detail.taxLevelId);
        }

        // Create shift tax summary record (aggregated by tax code)
        if (shiftSummaryId) {
          const taxData = this.extractTaxDataFromTLM(detail);
          shiftTaxSummariesDAL.createFromNAXML(shiftSummaryId, taxData);
        }

        count++;
      }

      // Close shift if this is a shift-close event
      if (shouldCloseShift && shiftId) {
        const endTime = `${movementHeader.endDate}T${movementHeader.endTime}`;
        shiftsDAL.closeShift(shiftId, endTime);

        if (shiftSummaryId) {
          shiftSummariesDAL.closeShiftSummary(
            this.storeId,
            shiftSummaryId,
            endTime,
            internalUserId ?? undefined
          );
        }

        log.info('Shift closed via TLM', { shiftId, businessDate, endTime });

        // Emit shift closed event for renderer notification
        this.emitShiftClosedEvent({
          shiftId,
          businessDate,
          endTime,
          shiftNumber: existingShift?.shift_number ?? 1,
          externalRegisterId,
          externalCashierId,
        });
      }

      log.debug('TLM records created', { count, businessDate, shiftId });
      return count;
    });
  }

  /**
   * Extract tax summary data from TLM detail
   */
  private extractTaxDataFromTLM(detail: NAXMLTLMDetail): import('../dal').NAXMLTaxInput {
    return {
      taxCode: detail.taxLevelId,
      taxableAmount: detail.taxableSalesAmount,
      taxCollected: detail.taxCollectedAmount,
      exemptAmount: detail.taxExemptSalesAmount,
    };
  }

  /**
   * Process Item Sales Movement (ISM)
   * SEC-006: Uses parameterized bulk insert for performance
   * DB-006: Store-scoped operations
   *
   * All ISM data is linked to shifts (not just Period 98) following
   * the AGKsoft pattern of Date+Shift linking.
   */
  private processItemSalesMovement(data: NAXMLItemSalesMovementData, _fileHash: string): number {
    const { movementHeader, ismDetails, salesMovementHeader } = data;

    // Get the ACTUAL business date (adjusted for overnight shifts)
    const businessDate = this.getActualBusinessDate(
      movementHeader.businessDate,
      movementHeader.beginTime,
      movementHeader.endDate
    );

    // SHIFT CLOSE DETECTION (SEC-014: Input validation)
    // Primary check: EndDate sentinel value (2100-01-01 = open, actual date = closed)
    // Secondary check: Period 98 (shift-level report)
    const isShiftClosedByDate = this.isShiftClosedByEndDate(movementHeader.endDate);
    const isShiftCloseFile = movementHeader.primaryReportPeriod === 98;
    const shouldCloseShift = isShiftClosedByDate || isShiftCloseFile;

    // Track external IDs from XML and their internal mappings
    let externalCashierId: string | undefined;
    let externalRegisterId: string | undefined;
    let _internalUserId: string | null = null;

    if (salesMovementHeader) {
      externalCashierId = salesMovementHeader.cashierId;
      externalRegisterId = salesMovementHeader.registerId;

      // Create/get cashier mapping - get internal_user_id if linked
      if (externalCashierId) {
        const cashierMapping = posCashierMappingsDAL.getOrCreate(this.storeId, externalCashierId);
        _internalUserId = cashierMapping.internal_user_id;
      }

      // Create/get terminal/register mapping (for reference tracking)
      if (externalRegisterId) {
        posTerminalMappingsDAL.getOrCreate(this.storeId, externalRegisterId, {
          source: 'xml:ItemSalesMovement',
        });
      }
    }

    // Get or create shift - ALWAYS link ISM data to shifts (not just Period 98)
    let shiftId: string | undefined;
    let existingShift: ReturnType<typeof shiftsDAL.findShiftByDateAndRegister> | undefined;
    if (salesMovementHeader) {
      if (shouldCloseShift) {
        // For shift close files, first check for ANY shift (open or closed)
        existingShift = shiftsDAL.findShiftByDateAndRegister(
          this.storeId,
          businessDate,
          externalRegisterId
        );
        if (existingShift) {
          shiftId = existingShift.shift_id;
          log.debug('ISM: Using existing shift', { businessDate, shiftId });
        } else {
          // Check adjacent dates for overnight shifts
          const openShiftToClose = shiftsDAL.findOpenShiftToClose(
            this.storeId,
            businessDate,
            externalRegisterId
          );
          if (openShiftToClose) {
            shiftId = openShiftToClose.shift_id;
            existingShift = openShiftToClose;
          } else {
            // CRITICAL: ISM files do NOT create shifts - only MSM files create shifts.
            // If no shift exists, log warning and continue without linking to shift.
            // DB-006: Store-scoped query ensures tenant isolation
            log.warn(
              'ISM: No existing shift found to close - MSM file may not have been processed',
              {
                businessDate,
                externalRegisterId,
                externalCashierId,
                hint: 'ISM data will be processed for mappings but not linked to a shift',
              }
            );
            // Continue processing without a shift - data will be captured in mappings
          }
        }
      } else {
        // Non-close file - find existing shift, don't create new ones
        // MSM files (processed first) should have already created shifts
        const existingShift2 = shiftsDAL.findShiftByDateAndRegister(
          this.storeId,
          businessDate,
          externalRegisterId
        );
        if (existingShift2) {
          shiftId = existingShift2.shift_id;
          log.debug('ISM: Linking to existing shift', {
            businessDate,
            externalRegisterId,
            shiftId,
          });
        } else {
          log.warn('ISM: No existing shift found to link (MSM may not have been processed)', {
            businessDate,
            externalRegisterId,
            externalCashierId,
          });
        }
      }
    } else {
      // No salesMovementHeader (day-level reports) - link to existing shift only
      // DB-006: Store-scoped query ensures tenant isolation
      const existingShifts = shiftsDAL.findByDate(this.storeId, businessDate);
      if (existingShifts.length > 0) {
        shiftId = existingShifts[0].shift_id;
        log.debug('ISM: Linking to existing shift (day-level report)', {
          businessDate,
          shiftId,
        });
      } else {
        log.warn('ISM: No existing shift found for day-level report', {
          businessDate,
        });
      }
    }

    // TODO: Create new schema table for item sales data if needed
    // For now, just count processed records (item-level sales detail is often
    // aggregated into shift_department_summaries via MCM)
    const count = ismDetails.length;

    // Close shift if this is a shift-close event
    if (shouldCloseShift && shiftId) {
      const endTime = `${movementHeader.endDate}T${movementHeader.endTime}`;
      shiftsDAL.closeShift(shiftId, endTime);
      log.info('Shift closed via ISM', { shiftId, businessDate, endTime });

      // Emit shift closed event for renderer notification
      this.emitShiftClosedEvent({
        shiftId,
        businessDate,
        endTime,
        shiftNumber: existingShift?.shift_number ?? 1,
        externalRegisterId,
        externalCashierId,
      });
    }

    log.debug('ISM records processed', { count, businessDate, shiftId });
    return count;
  }

  /**
   * Process Tank Product Movement (TPM) - ATG tank inventory data
   * SEC-006: Uses parameterized DAL methods
   */
  private processTenderProductMovement(
    data: NAXMLTankProductMovementData,
    fileHash: string
  ): number {
    const { movementHeader, tpmDetails } = data;

    // Get the ACTUAL business date (adjusted for overnight shifts)
    const businessDate = this.getActualBusinessDate(
      movementHeader.businessDate,
      movementHeader.beginTime,
      movementHeader.endDate
    );
    let count = 0;

    // TPM doesn't have salesMovementHeader - it's tank inventory data
    return withTransaction(() => {
      for (const detail of tpmDetails) {
        // Create tank reading from TPM data
        const tankReading = this.extractTankReadingFromTPM(detail);
        tankReadingsDAL.createFromNAXML(this.storeId, businessDate, tankReading, fileHash);
        count++;
      }

      log.debug('TPM tank readings created', { count, businessDate });
      return count;
    });
  }

  /**
   * Extract tank reading data from TPM detail
   */
  private extractTankReadingFromTPM(
    detail: NAXMLTPMDetail
  ): import('../dal').NAXMLTankReadingInput {
    return {
      tankId: parseInt(detail.tankId, 10) || 0,
      fuelProductId: detail.fuelProductId,
      tankVolume: detail.tankVolume,
    };
  }

  /**
   * Process POS Journal (PJR)
   * Creates shifts, transactions, line items, payments, and tax summaries
   * SEC-006: Uses parameterized DAL methods within transaction
   *
   * Complete PJR processing extracts:
   * - Transaction headers (register, cashier, timestamps, totals)
   * - Line items (fuel and merchandise)
   * - Payments/tenders with change amounts
   * - Tax summaries by tax level
   */
  private processPOSJournal(data: unknown, _fileHash: string): number {
    // Cast to properly typed POSJournal structure
    const pjrData = data as NAXMLPOSJournalDocument;

    const journalReport = pjrData.journalReport;
    if (!journalReport?.saleEvents || journalReport.saleEvents.length === 0) {
      log.warn('Invalid POS Journal structure or no sale events');
      return 0;
    }

    let count = 0;

    return withTransaction(() => {
      for (const saleEvent of journalReport.saleEvents) {
        // Get businessDate from the saleEvent itself
        const rawBusinessDate = saleEvent.businessDate;
        if (!rawBusinessDate) {
          log.warn('Sale event missing businessDate, skipping');
          continue;
        }

        // Determine the ACTUAL business date for overnight transactions.
        // For PJR transactions, use eventEndDate as the business date when:
        // - eventStartTime is at 23:xx (transaction started near midnight)
        // - eventEndDate > rawBusinessDate
        // This matches the MSM overnight shift logic where the actual business day
        // is the day the shift/transaction covers, not when it technically started.
        let businessDate = rawBusinessDate;
        if (saleEvent.eventStartTime && saleEvent.eventEndDate) {
          const startHour = parseInt(saleEvent.eventStartTime.split(':')[0], 10);
          if (startHour >= 23 && saleEvent.eventEndDate > rawBusinessDate) {
            businessDate = saleEvent.eventEndDate;
          }
        }

        // Ensure day summary exists
        daySummariesDAL.getOrCreateForDate(this.storeId, businessDate);

        // Create POS ID mappings for external IDs
        let _internalUserId: string | null = null;
        if (saleEvent.cashierId) {
          const cashierMapping = posCashierMappingsDAL.getOrCreate(
            this.storeId,
            saleEvent.cashierId
          );
          _internalUserId = cashierMapping.internal_user_id;
        }

        if (saleEvent.registerId) {
          posTerminalMappingsDAL.getOrCreate(this.storeId, saleEvent.registerId, {
            source: 'xml:POSJournal',
          });
        }

        if (saleEvent.tillId) {
          posTillMappingsDAL.getOrCreate(this.storeId, saleEvent.tillId, businessDate);
        }

        // CRITICAL: PJR files are TRANSACTION files - they NEVER create shifts.
        // Shifts are ONLY created by MSM files (Period 98 with SalesMovementHeader).
        // PJR transactions must link to an EXISTING shift created by MSM.
        //
        // DB-006: Store-scoped query ensures tenant isolation
        // SEC-006: Uses parameterized DAL methods
        //
        // Find existing shift for this business date to attach the transaction to.
        // If no shift exists, log warning - the MSM file hasn't been processed yet.
        const existingShifts = shiftsDAL.findByDate(this.storeId, businessDate);

        let shift;
        if (existingShifts.length > 0) {
          // Link to the most recent shift for this business date
          // For multi-shift days, transactions are linked to the latest shift
          // (MSM files define shift boundaries via their timestamps)
          shift = existingShifts[existingShifts.length - 1];
          log.debug('PJR: Linking transaction to existing shift', {
            businessDate,
            shiftId: shift.shift_id,
            shiftNumber: shift.shift_number,
            registerId: saleEvent.registerId,
            transactionId: saleEvent.transactionId,
          });
        } else {
          // NO SHIFT EXISTS - cannot create transaction without a shift
          // This should not happen in normal operation as MSM files are processed first
          log.warn('PJR: No existing shift found for business date - skipping transaction', {
            businessDate,
            registerId: saleEvent.registerId,
            cashierId: saleEvent.cashierId,
            transactionId: saleEvent.transactionId,
            eventEndDate: saleEvent.eventEndDate,
            eventEndTime: saleEvent.eventEndTime,
            hint: 'MSM file for this date may not have been processed yet',
          });
          continue; // Skip this transaction - no shift to attach to
        }

        // Extract line items from transactionDetailGroup
        const lineItems = this.extractPJRLineItems(saleEvent);

        // Extract payments from transactionDetailGroup
        const payments = this.extractPJRPayments(saleEvent);

        // Extract tax summaries from transactionDetailGroup
        const taxSummaries = this.extractPJRTaxSummaries(saleEvent);

        // Determine primary payment type from first payment
        const primaryPaymentType = payments.length > 0 ? payments[0].payment_type : undefined;

        // Get transaction totals from summary
        const summary = saleEvent.transactionSummary;
        const totalAmount = summary?.transactionTotalGrandAmount ?? 0;

        // Build linked transaction ID if present
        let linkedTransactionId: string | undefined;
        let linkReason: string | undefined;
        if (saleEvent.linkedTransactionInfo) {
          const linked = saleEvent.linkedTransactionInfo;
          linkedTransactionId = `${linked.originalStoreLocationId}-${linked.originalRegisterId}-${linked.originalTransactionId}`;
          linkReason = linked.transactionLinkReason;
        }

        // Construct event end timestamp from date and time components
        const eventEndTimestamp =
          saleEvent.eventEndDate && saleEvent.eventEndTime
            ? `${saleEvent.eventEndDate}T${saleEvent.eventEndTime}`
            : undefined;

        // Create transaction with all details
        const _created = transactionsDAL.createWithDetails({
          store_id: this.storeId,
          shift_id: shift.shift_id,
          business_date: businessDate,
          transaction_number: saleEvent.transactionId
            ? parseInt(saleEvent.transactionId, 10)
            : undefined,
          transaction_time: eventEndTimestamp,
          register_id: saleEvent.registerId,
          cashier_id: saleEvent.cashierId,
          total_amount: totalAmount,
          payment_type: primaryPaymentType,
          // PJR-specific fields
          event_sequence_id: saleEvent.eventSequenceId,
          training_mode: saleEvent.trainingModeFlag,
          outside_sale: saleEvent.outsideSalesFlag,
          offline: saleEvent.offlineFlag,
          suspended: saleEvent.suspendFlag,
          till_id: saleEvent.tillId,
          receipt_time:
            saleEvent.receiptDate && saleEvent.receiptTime
              ? `${saleEvent.receiptDate}T${saleEvent.receiptTime}`
              : undefined,
          event_start_time:
            saleEvent.eventStartDate && saleEvent.eventStartTime
              ? `${saleEvent.eventStartDate}T${saleEvent.eventStartTime}`
              : undefined,
          event_end_time: eventEndTimestamp,
          // Transaction totals from summary
          gross_amount: summary?.transactionTotalGrossAmount,
          net_amount: summary?.transactionTotalNetAmount,
          tax_amount: summary?.transactionTotalTaxSalesAmount,
          tax_exempt_amount: summary?.transactionTotalTaxExemptAmount,
          direction: summary?.transactionTotalGrandAmountDirection,
          // Linked transaction info
          linked_transaction_id: linkedTransactionId,
          link_reason: linkReason,
          // Line items, payments, and tax summaries
          lineItems,
          payments,
          taxSummaries,
        });

        // NOTE: No sync enqueue - transactions have no cloud push endpoint
        // Transactions are stored locally for offline POS operation
        count++;
      }

      const firstEvent = journalReport.saleEvents?.[0];
      log.debug('PJR transactions created', {
        count,
        businessDate: firstEvent?.businessDate,
        totalLineItems: journalReport.saleEvents.reduce(
          (sum, e) => sum + (e.transactionDetailGroup?.transactionLines?.length || 0),
          0
        ),
      });
      return count;
    });
  }

  /**
   * Extract line items (fuel + merchandise) from PJR sale event
   * Creates POS ID mappings for fuel grades, positions, and departments
   */
  private extractPJRLineItems(saleEvent: NAXMLSaleEvent): CreateLineItemData[] {
    const lineItems: CreateLineItemData[] = [];
    const transactionLines = saleEvent.transactionDetailGroup?.transactionLines || [];
    let lineNumber = 1;

    for (const line of transactionLines) {
      // Process fuel lines
      if (line.fuelLine) {
        const fuel = line.fuelLine;

        // Create fuel grade mapping
        if (fuel.fuelGradeId) {
          posFuelGradeMappingsDAL.getOrCreate(this.storeId, fuel.fuelGradeId);
        }

        // Create fuel position mapping
        if (fuel.fuelPositionId) {
          posFuelPositionMappingsDAL.getOrCreate(this.storeId, fuel.fuelPositionId);
        }

        // Create department mapping for fuel merchandise code
        if (fuel.merchandiseCode) {
          posDepartmentMappingsDAL.getOrCreate(this.storeId, fuel.merchandiseCode);
        }

        lineItems.push({
          line_number: lineNumber++,
          item_code: fuel.merchandiseCode || fuel.fuelGradeId,
          description: fuel.description,
          quantity: fuel.salesQuantity,
          unit_price: fuel.actualSalesPrice || fuel.regularSellPrice,
          total_price: fuel.salesAmount,
          department_id: fuel.merchandiseCode,
          // Fuel-specific fields
          line_type: 'fuel',
          line_status: this.mapLineStatus(line.status),
          fuel_grade_id: fuel.fuelGradeId,
          fuel_position_id: fuel.fuelPositionId,
          service_level: fuel.serviceLevelCode as 'self' | 'full' | 'mini' | undefined,
          actual_price: fuel.actualSalesPrice,
          entry_method: fuel.entryMethod,
          tax_level_id: fuel.itemTax?.taxLevelId,
        });
      }

      // Process fuel prepay lines
      if (line.fuelPrepayLine) {
        const prepay = line.fuelPrepayLine;

        // Create fuel position mapping
        if (prepay.fuelPositionId) {
          posFuelPositionMappingsDAL.getOrCreate(this.storeId, prepay.fuelPositionId);
        }

        lineItems.push({
          line_number: lineNumber++,
          item_code: `PREPAY-${prepay.fuelPositionId}`,
          description: `Fuel Prepay - Position ${prepay.fuelPositionId}`,
          quantity: 1,
          unit_price: prepay.salesAmount,
          total_price: prepay.salesAmount,
          // Fuel prepay fields
          line_type: 'prepay',
          line_status: this.mapLineStatus(line.status),
          fuel_position_id: prepay.fuelPositionId,
        });
      }

      // Process merchandise lines
      if (line.merchandiseLine) {
        const merch = line.merchandiseLine;

        // Create department mapping
        if (merch.departmentCode) {
          posDepartmentMappingsDAL.getOrCreate(this.storeId, merch.departmentCode, {
            externalDescription: merch.description,
          });
        }

        lineItems.push({
          line_number: lineNumber++,
          item_code: merch.itemCode,
          description: merch.description,
          quantity: merch.salesQuantity,
          unit_price: merch.unitPrice,
          total_price: merch.salesAmount,
          department_id: merch.departmentCode,
          // Merchandise-specific fields
          line_type: 'merchandise',
          line_status: this.mapLineStatus(line.status),
          entry_method: merch.entryMethod,
          tax_level_id: merch.itemTax?.taxLevelId,
        });
      }
    }

    return lineItems;
  }

  /**
   * Extract payments from PJR sale event
   * Creates POS ID mappings for tender codes
   */
  private extractPJRPayments(saleEvent: NAXMLSaleEvent): CreatePaymentData[] {
    const payments: CreatePaymentData[] = [];
    const transactionLines = saleEvent.transactionDetailGroup?.transactionLines || [];

    for (const line of transactionLines) {
      if (line.tenderInfo) {
        const tenderInfo = line.tenderInfo;
        const tender = tenderInfo.tender;

        // Create tender mapping
        if (tender.tenderCode) {
          posTenderMappingsDAL.getOrCreate(this.storeId, tender.tenderCode, {
            externalTenderSubcode: tender.tenderSubCode,
          });
        }

        payments.push({
          payment_type: tender.tenderCode,
          amount: tenderInfo.tenderAmount,
          tender_sub_code: tender.tenderSubCode,
          change_amount: tenderInfo.changeFlag ? tenderInfo.changeAmount || 0 : 0,
        });
      }
    }

    return payments;
  }

  /**
   * Extract tax summaries from PJR sale event
   * Creates POS ID mappings for tax level IDs
   */
  private extractPJRTaxSummaries(saleEvent: NAXMLSaleEvent): CreateTaxSummaryData[] {
    const taxSummaries: CreateTaxSummaryData[] = [];
    const transactionLines = saleEvent.transactionDetailGroup?.transactionLines || [];

    for (const line of transactionLines) {
      if (line.transactionTax) {
        const tax = line.transactionTax;

        // Create tax level mapping
        if (tax.taxLevelId) {
          posTaxLevelMappingsDAL.getOrCreate(this.storeId, tax.taxLevelId);
        }

        taxSummaries.push(this.mapPJRTaxToSummary(tax));
      }
    }

    return taxSummaries;
  }

  /**
   * Map PJR transaction tax to CreateTaxSummaryData
   */
  private mapPJRTaxToSummary(tax: NAXMLJournalTransactionTax): CreateTaxSummaryData {
    return {
      tax_level_id: tax.taxLevelId,
      taxable_sales_amount: tax.taxableSalesAmount || 0,
      tax_collected_amount: tax.taxCollectedAmount || 0,
      taxable_sales_refunded_amount: tax.taxableSalesRefundedAmount || 0,
      tax_refunded_amount: tax.taxRefundedAmount || 0,
      tax_exempt_sales_amount: tax.taxExemptSalesAmount || 0,
      tax_exempt_sales_refunded_amount: tax.taxExemptSalesRefundedAmount || 0,
      tax_forgiven_sales_amount: tax.taxForgivenSalesAmount || 0,
      tax_forgiven_sales_refunded_amount: tax.taxForgivenSalesRefundedAmount || 0,
      tax_forgiven_amount: tax.taxForgivenAmount || 0,
    };
  }

  /**
   * Map PJR line status to internal line status type
   */
  private mapLineStatus(status: string | undefined): 'normal' | 'void' | 'cancel' | 'refund' {
    if (!status) return 'normal';
    const normalized = status.toLowerCase();
    if (normalized === 'void') return 'void';
    if (normalized === 'cancel') return 'cancel';
    if (normalized === 'refund') return 'refund';
    return 'normal';
  }

  // NOTE: enqueueForSync method removed - no push endpoints for transactions/shifts
  // Sync queue is only used for lottery entities (pack, shift_opening, shift_closing, etc.)
  // See VALID_SYNC_ENTITY_TYPES in src/shared/types/sync.types.ts

  // ==========================================================================
  // Event Emission Helper
  // ==========================================================================

  /**
   * Emit shift closed event for renderer notification
   *
   * Determines the close type (SHIFT_CLOSE vs DAY_CLOSE) and emits
   * an event that can be forwarded to the renderer process.
   *
   * SEC-014: Event payload validated via Zod schema in shared types
   * LM-001: Structured logging with event context
   *
   * @param params - Shift close parameters
   */
  private emitShiftClosedEvent(params: {
    shiftId: string;
    businessDate: string;
    endTime: string;
    shiftNumber: number;
    externalRegisterId?: string;
    externalCashierId?: string;
  }): void {
    const { shiftId, businessDate, endTime, shiftNumber, externalRegisterId, externalCashierId } =
      params;

    // Determine if this is a shift close or day close
    const { closeType, remainingOpenShifts } = determineShiftCloseType(
      this.storeId,
      shiftId,
      businessDate
    );

    // Build event payload (SEC-014: matches ShiftClosedEventSchema)
    const eventPayload: ShiftClosedEvent = {
      closeType,
      shiftId,
      businessDate,
      externalRegisterId,
      externalCashierId,
      shiftNumber,
      closedAt: endTime,
      isLastShiftOfDay: remainingOpenShifts === 0,
      remainingOpenShifts,
    };

    // Emit event for main process listener to forward to renderer
    eventBus.emit(MainEvents.SHIFT_CLOSED, eventPayload);

    // LM-001: Structured logging with event context
    log.info('Shift closed event emitted', {
      shiftId,
      closeType,
      businessDate,
      isLastShiftOfDay: remainingOpenShifts === 0,
      remainingOpenShifts,
    });
  }

  /**
   * Save MSM discount summaries to the database
   * SEC-006: Uses parameterized queries via DAL
   * DB-006: Store-scoped operations
   *
   * Persists discount data extracted from MSM files. Supports both
   * Period 1 (daily) and Period 98 (shift) discount data.
   *
   * @param businessDate - Business date for the discounts
   * @param msmPeriod - MSM period (1=Daily, 98=Shift)
   * @param shiftId - Shift ID (null for Period 1 daily)
   * @param discounts - Extracted discount data from MSM parser
   * @param sourceFileHash - Source file hash for deduplication
   */
  private saveMSMDiscountSummaries(
    businessDate: string,
    msmPeriod: number,
    shiftId: string | null,
    discounts: MSMExtractedFuelData['discounts'],
    sourceFileHash: string
  ): void {
    // Map of discount property to database type
    // SEC-014: Type validation via allowlist
    // Note: Property names match MSMDiscountTotals interface from types.ts
    const discountTypeMap: Array<{
      property: keyof typeof discounts;
      dbType: MSMDiscountType;
    }> = [
      { property: 'statistics', dbType: 'statistics_discounts' },
      { property: 'amountFixed', dbType: 'discount_amount_fixed' },
      { property: 'amountPercentage', dbType: 'discount_amount_percentage' },
      { property: 'promotional', dbType: 'discount_promotional' },
      { property: 'fuel', dbType: 'discount_fuel' },
      { property: 'storeCoupons', dbType: 'discount_store_coupons' },
    ];

    let savedCount = 0;

    for (const mapping of discountTypeMap) {
      const amount = discounts[mapping.property];

      // Only save non-zero discounts
      if (amount !== 0) {
        msmDiscountSummariesDAL.upsert({
          store_id: this.storeId,
          business_date: businessDate,
          msm_period: msmPeriod,
          shift_id: shiftId ?? undefined,
          discount_type: mapping.dbType,
          discount_amount: amount,
          discount_count: 0, // Count not available from extracted data
          source_file_hash: sourceFileHash,
        });
        savedCount++;
      }
    }

    if (savedCount > 0) {
      log.debug('MSM discount summaries saved', {
        businessDate,
        msmPeriod,
        shiftId,
        savedCount,
        fuelDiscount: discounts.fuel,
        totalDiscounts: discounts.statistics,
      });
    }
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
