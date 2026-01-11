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
