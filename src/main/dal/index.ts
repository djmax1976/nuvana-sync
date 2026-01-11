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

// Movement DALs (NAXML data)
export {
  FuelGradeMovementsDAL,
  fuelGradeMovementsDAL,
  type FuelGradeMovement,
  type CreateFuelGradeMovementData,
  type NAXMLFGMInput,
  type FuelGradeAggregation,
} from './fuel-grade-movements.dal';

export {
  FuelProductMovementsDAL,
  fuelProductMovementsDAL,
  type FuelProductMovement,
  type CreateFuelProductMovementData,
  type NAXMLFPMInput,
} from './fuel-product-movements.dal';

export {
  MiscellaneousSummariesDAL,
  miscellaneousSummariesDAL,
  type MiscellaneousSummary,
  type CreateMiscellaneousSummaryData,
  type NAXMLMSMInput,
  type SummaryTypeAggregation,
} from './miscellaneous-summaries.dal';

export {
  MerchandiseMovementsDAL,
  merchandiseMovementsDAL,
  type MerchandiseMovement,
  type CreateMerchandiseMovementData,
  type NAXMLMCMInput,
  type DepartmentAggregation,
} from './merchandise-movements.dal';

export {
  TaxLevelMovementsDAL,
  taxLevelMovementsDAL,
  type TaxLevelMovement,
  type CreateTaxLevelMovementData,
  type NAXMLTLMInput,
  type TaxLevelAggregation,
} from './tax-level-movements.dal';

export {
  ItemSalesMovementsDAL,
  itemSalesMovementsDAL,
  type ItemSalesMovement,
  type CreateItemSalesMovementData,
  type NAXMLISMInput,
  type TopSellingItem,
} from './item-sales-movements.dal';

export {
  TenderProductMovementsDAL,
  tenderProductMovementsDAL,
  type TenderProductMovement,
  type CreateTenderProductMovementData,
  type NAXMLTPMInput,
  type TenderAggregation,
} from './tender-product-movements.dal';
