/**
 * Data Access Layer Index
 *
 * Central export point for all DAL classes and utilities.
 *
 * @module main/dal
 */

// Base DAL
export {
  BaseDAL,
  StoreBasedDAL,
  type PaginationOptions,
  type SortOptions,
  type PaginatedResult,
  type BaseEntity,
  type StoreEntity,
} from './base.dal';

// Stores DAL
export {
  StoresDAL,
  storesDAL,
  type Store,
  type CreateStoreData,
  type UpdateStoreData,
} from './stores.dal';

// Users DAL
export {
  UsersDAL,
  usersDAL,
  type User,
  type UserRole,
  type CreateUserData,
  type UpdateUserData,
  type CloudUserData,
  type SafeUser,
} from './users.dal';

// Shifts DAL
export {
  ShiftsDAL,
  shiftsDAL,
  type Shift,
  type ShiftStatus,
  type CreateShiftData,
  type UpdateShiftData,
} from './shifts.dal';

// Day Summaries DAL
export {
  DaySummariesDAL,
  daySummariesDAL,
  type DaySummary,
  type DaySummaryStatus,
  type CreateDaySummaryData,
  type UpdateDaySummaryData,
} from './day-summaries.dal';

// Transactions DAL
export {
  TransactionsDAL,
  transactionsDAL,
  type Transaction,
  type TransactionLineItem,
  type TransactionPayment,
  type TransactionWithDetails,
  type CreateTransactionData,
  type CreateLineItemData,
  type CreatePaymentData,
  type CreateTaxSummaryData,
  type LineType,
  type LineStatus,
  type ServiceLevel,
} from './transactions.dal';

// Sync Queue DAL
export {
  SyncQueueDAL,
  syncQueueDAL,
  type SyncQueueItem,
  type SyncOperation,
  type CreateSyncQueueItemData,
  type SyncBatch,
} from './sync-queue.dal';

// Processed Files DAL
export {
  ProcessedFilesDAL,
  processedFilesDAL,
  type ProcessedFile,
  type ProcessedFileStatus,
  type CreateProcessedFileData,
  type FileProcessingStats,
} from './processed-files.dal';

// POS ID Mappings DAL (External POS IDs → Internal UUIDs)
export {
  // DAL Classes
  POSCashierMappingsDAL,
  POSTerminalMappingsDAL,
  POSFuelPositionMappingsDAL,
  POSTillMappingsDAL,
  POSFuelGradeMappingsDAL,
  POSFuelProductMappingsDAL,
  POSDepartmentMappingsDAL,
  POSTaxLevelMappingsDAL,
  POSTenderMappingsDAL,
  POSPriceTierMappingsDAL,
  // Singleton Instances
  posCashierMappingsDAL,
  posTerminalMappingsDAL,
  posFuelPositionMappingsDAL,
  posTillMappingsDAL,
  posFuelGradeMappingsDAL,
  posFuelProductMappingsDAL,
  posDepartmentMappingsDAL,
  posTaxLevelMappingsDAL,
  posTenderMappingsDAL,
  posPriceTierMappingsDAL,
  // Types
  type POSSystemType,
  type TerminalType,
  type FuelType,
  type TenderType,
  type PriceTierType,
  type POSCashierMapping,
  type POSTerminalMapping,
  type POSFuelPositionMapping,
  type POSTillMapping,
  type POSFuelGradeMapping,
  type POSFuelProductMapping,
  type POSDepartmentMapping,
  type POSTaxLevelMapping,
  type POSTenderMapping,
  type POSPriceTierMapping,
} from './pos-id-mappings.dal';

// ============================================================================
// New Schema-Aligned DALs (v010 migration)
// ============================================================================

// Shift Summaries DAL (Parent for shift-level data)
export {
  ShiftSummariesDAL,
  shiftSummariesDAL,
  type ShiftSummary,
  type CreateShiftSummaryData,
  type UpdateShiftSummaryData,
} from './shift-summaries.dal';

// Shift Fuel Summaries DAL (Replaces fuel_grade_movements)
export {
  ShiftFuelSummariesDAL,
  shiftFuelSummariesDAL,
  type ShiftFuelSummary,
  type CreateShiftFuelSummaryData,
  type NAXMLShiftFuelInput,
  type FuelTenderType,
  type FuelGradeAggregation as ShiftFuelGradeAggregation,
} from './shift-fuel-summaries.dal';

// Shift Department Summaries DAL (Replaces merchandise_movements)
export {
  ShiftDepartmentSummariesDAL,
  shiftDepartmentSummariesDAL,
  type ShiftDepartmentSummary,
  type CreateShiftDepartmentSummaryData,
  type NAXMLDepartmentInput,
  type DepartmentAggregation as ShiftDepartmentAggregation,
} from './shift-department-summaries.dal';

// Shift Tender Summaries DAL (Payment totals by tender type)
export {
  ShiftTenderSummariesDAL,
  shiftTenderSummariesDAL,
  type ShiftTenderSummary,
  type CreateShiftTenderSummaryData,
  type TenderAggregation as ShiftTenderAggregation,
} from './shift-tender-summaries.dal';

// Shift Tax Summaries DAL (Replaces tax_level_movements)
export {
  ShiftTaxSummariesDAL,
  shiftTaxSummariesDAL,
  type ShiftTaxSummary,
  type CreateShiftTaxSummaryData,
  type NAXMLTaxInput,
  type TaxAggregation as ShiftTaxAggregation,
} from './shift-tax-summaries.dal';

// Meter Readings DAL (Replaces fuel_product_movements - pump totalizers)
export {
  MeterReadingsDAL,
  meterReadingsDAL,
  type MeterReading,
  type CreateMeterReadingData,
  type NAXMLMeterReadingInput,
  type MeterReadingType,
  type MeterVariance,
} from './meter-readings.dal';

// Tank Readings DAL (Replaces tender_product_movements - ATG tank data)
export {
  TankReadingsDAL,
  tankReadingsDAL,
  type TankReading,
  type CreateTankReadingData,
  type NAXMLTankReadingInput,
  type TankInventorySummary,
} from './tank-readings.dal';

// ============================================================================
// MSM Fuel Data DALs (v014 migration)
// ============================================================================

// Day Fuel Summaries DAL (Daily fuel data by grade)
export {
  DayFuelSummariesDAL,
  dayFuelSummariesDAL,
  type DayFuelSummary,
  type CreateDayFuelSummaryData,
  type MSMDayFuelInput,
  type DayFuelTotals,
  type DayFuelByGrade,
  type DayFuelSource,
} from './day-fuel-summaries.dal';

// Additional MSM exports from shift-fuel-summaries.dal.ts (v014)
export {
  type FuelSource,
  type MSMShiftFuelInput,
  type MSMFuelTotals,
  type MSMFuelByGrade,
} from './shift-fuel-summaries.dal';

// MSM Discount Summaries DAL (Discount data from MSM files)
export {
  MSMDiscountSummariesDAL,
  msmDiscountSummariesDAL,
  type MSMDiscountSummary,
  type CreateMSMDiscountData,
  type MSMDiscountType,
  type DiscountTotals,
} from './msm-discount-summaries.dal';

// MSM Outside Dispenser Records DAL (Period 98 outside fuel)
export {
  MSMOutsideDispenserRecordsDAL,
  msmOutsideDispenserRecordsDAL,
  type MSMOutsideDispenserRecord,
  type CreateOutsideDispenserData,
  type OutsideTenderType,
  type OutsideFuelTotals,
} from './msm-outside-dispenser-records.dal';
