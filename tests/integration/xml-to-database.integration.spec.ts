/**
 * XML to Database Integration Tests
 *
 * End-to-end tests for the file processing pipeline:
 * File Detected → Parse XML → Store in SQLite (via DAL) → Queue for Cloud Sync
 *
 * These tests use an in-memory SQLite database to verify the complete flow
 * without mocking the DAL layer.
 *
 * Test Coverage Matrix:
 * - INT-001 through 010: FuelGradeMovement (FGM) Flow
 * - INT-020 through 030: ItemSalesMovement (ISM) Bulk Flow
 * - INT-040 through 050: Sync Queue Integration
 * - INT-060 through 070: Duplicate Detection
 * - INT-080 through 090: Error Recovery
 *
 * @module tests/integration/xml-to-database.integration.spec
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3-multiple-ciphers';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

// ============================================================================
// Test Database Setup
// ============================================================================

// We'll mock the database service to use our test database
let testDb: Database.Database;
let tempDir: string;

// Mock the database service BEFORE importing DALs
vi.mock('../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => testDb),
  withTransaction: vi.fn((fn: () => unknown) => {
    const transaction = testDb.transaction(fn);
    return transaction();
  }),
}));

// Mock logger to reduce noise
vi.mock('../../src/main/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Import DALs after mocking
import {
  processedFilesDAL as _processedFilesDAL,
  syncQueueDAL as _syncQueueDAL,
  fuelGradeMovementsDAL as _fuelGradeMovementsDAL,
  itemSalesMovementsDAL as _itemSalesMovementsDAL,
  shiftsDAL as _shiftsDAL,
} from '../../src/main/dal';

import { createParserService, ParserService } from '../../src/main/services/parser.service';
import { createNAXMLParser as _createNAXMLParser } from '../../src/shared/naxml/parser';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_STORE_ID = 'test-store-001';

const SAMPLE_FGM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NAXML-MovementReport version="3.4">
  <FuelGradeMovement>
    <MovementHeader>
      <ReportSequenceNumber>1</ReportSequenceNumber>
      <PrimaryReportPeriod>2</PrimaryReportPeriod>
      <BusinessDate>2025-01-15</BusinessDate>
      <BeginDate>2025-01-15</BeginDate>
      <EndDate>2025-01-15</EndDate>
    </MovementHeader>
    <FGMDetail>
      <FuelGradeID>UNLEADED</FuelGradeID>
      <FGMTenderSummary>
        <Tender>
          <TenderCode>cash</TenderCode>
          <TenderSubCode>generic</TenderSubCode>
        </Tender>
        <FGMSellPriceSummary>
          <ActualSalesPrice>3.519</ActualSalesPrice>
          <FGMServiceLevelSummary>
            <ServiceLevelCode>1</ServiceLevelCode>
            <FGMSalesTotals>
              <FuelGradeSalesVolume>350.5</FuelGradeSalesVolume>
              <FuelGradeSalesAmount>1234.56</FuelGradeSalesAmount>
            </FGMSalesTotals>
          </FGMServiceLevelSummary>
        </FGMSellPriceSummary>
      </FGMTenderSummary>
    </FGMDetail>
    <FGMDetail>
      <FuelGradeID>PREMIUM</FuelGradeID>
      <FGMTenderSummary>
        <Tender>
          <TenderCode>cash</TenderCode>
          <TenderSubCode>generic</TenderSubCode>
        </Tender>
        <FGMSellPriceSummary>
          <ActualSalesPrice>3.779</ActualSalesPrice>
          <FGMServiceLevelSummary>
            <ServiceLevelCode>1</ServiceLevelCode>
            <FGMSalesTotals>
              <FuelGradeSalesVolume>150.25</FuelGradeSalesVolume>
              <FuelGradeSalesAmount>567.89</FuelGradeSalesAmount>
            </FGMSalesTotals>
          </FGMServiceLevelSummary>
        </FGMSellPriceSummary>
      </FGMTenderSummary>
    </FGMDetail>
  </FuelGradeMovement>
</NAXML-MovementReport>`;

const SAMPLE_ISM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<NAXML-MovementReport version="3.4">
  <ItemSalesMovement>
    <MovementHeader>
      <ReportSequenceNumber>1</ReportSequenceNumber>
      <PrimaryReportPeriod>2</PrimaryReportPeriod>
      <BusinessDate>2025-01-15</BusinessDate>
      <BeginDate>2025-01-15</BeginDate>
      <EndDate>2025-01-15</EndDate>
    </MovementHeader>
    <ISMDetail>
      <ItemCode>SKU001</ItemCode>
      <ItemDescription>Energy Drink 16oz</ItemDescription>
      <DepartmentID>BEVERAGES</DepartmentID>
      <UPC>012345678901</UPC>
      <ISMSalesTotals>
        <ItemSalesQuantity>25</ItemSalesQuantity>
        <ItemSalesAmount>62.25</ItemSalesAmount>
        <ItemDiscountAmount>5.00</ItemDiscountAmount>
        <ItemTransactionCount>20</ItemTransactionCount>
      </ISMSalesTotals>
    </ISMDetail>
    <ISMDetail>
      <ItemCode>SKU002</ItemCode>
      <ItemDescription>Chips Large Bag</ItemDescription>
      <DepartmentID>SNACKS</DepartmentID>
      <UPC>012345678902</UPC>
      <ISMSalesTotals>
        <ItemSalesQuantity>15</ItemSalesQuantity>
        <ItemSalesAmount>44.85</ItemSalesAmount>
        <ItemDiscountAmount>0</ItemDiscountAmount>
        <ItemTransactionCount>12</ItemTransactionCount>
      </ISMSalesTotals>
    </ISMDetail>
  </ItemSalesMovement>
</NAXML-MovementReport>`;

// ============================================================================
// Database Schema Setup
// ============================================================================

const createTestSchema = () => {
  // Create all required tables
  testDb.exec(`
    -- Stores table
    CREATE TABLE IF NOT EXISTS stores (
      store_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Processed files
    CREATE TABLE IF NOT EXISTS processed_files (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      file_path TEXT,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      document_type TEXT NOT NULL,
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      record_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error_message TEXT,
      processing_duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_processed_files_hash ON processed_files(store_id, file_hash);

    -- Sync queue
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      payload TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      synced INTEGER NOT NULL DEFAULT 0,
      sync_attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_sync_error TEXT,
      last_attempt_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      synced_at TEXT
    );

    -- Shifts
    CREATE TABLE IF NOT EXISTS shifts (
      shift_id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      shift_number INTEGER,
      status TEXT DEFAULT 'OPEN',
      opened_at TEXT,
      closed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_store_date ON shifts(store_id, business_date);

    -- Fuel grade movements (matches DAL schema)
    CREATE TABLE IF NOT EXISTS fuel_grade_movements (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      shift_id TEXT,
      grade_id TEXT,
      grade_name TEXT,
      volume_sold REAL DEFAULT 0,
      amount_sold REAL DEFAULT 0,
      volume_unit TEXT DEFAULT 'GALLONS',
      transaction_count INTEGER DEFAULT 0,
      average_price_per_unit REAL,
      file_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Item sales movements (matches DAL schema)
    CREATE TABLE IF NOT EXISTS item_sales_movements (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      shift_id TEXT,
      item_code TEXT,
      item_description TEXT,
      department_id TEXT,
      upc TEXT,
      quantity_sold REAL DEFAULT 0,
      amount_sold REAL DEFAULT 0,
      cost_amount REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      transaction_count INTEGER DEFAULT 0,
      file_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Day summaries
    CREATE TABLE IF NOT EXISTS day_summaries (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL,
      business_date TEXT NOT NULL,
      status TEXT DEFAULT 'OPEN',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Insert test store
    INSERT OR IGNORE INTO stores (store_id, name) VALUES ('${TEST_STORE_ID}', 'Test Store');
  `);
};

// ============================================================================
// Test Suite
// ============================================================================

describe('XML to Database Integration', () => {
  let parserService: ParserService;

  beforeAll(async () => {
    // Create temp directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuvana-test-'));
  });

  afterAll(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tempDir, { recursive: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Create fresh in-memory database for each test
    testDb = new Database(':memory:');
    createTestSchema();

    // Create parser service
    parserService = createParserService(TEST_STORE_ID);
  });

  afterEach(() => {
    testDb.close();
  });

  // ==========================================================================
  // INT-001 through 010: FuelGradeMovement (FGM) Flow
  // ==========================================================================

  describe('FuelGradeMovement (FGM) Flow', () => {
    it('INT-001: should parse FGM XML and store in fuel_grade_movements table', async () => {
      // Write test file
      const filePath = path.join(tempDir, 'FGM20250115.xml');
      await fs.writeFile(filePath, SAMPLE_FGM_XML);

      const fileHash = 'test-hash-fgm-001';
      const result = await parserService.processFile(filePath, fileHash);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('FuelGradeMovement');
      expect(result.recordsCreated).toBe(2);

      // Verify records in database
      const records = testDb
        .prepare('SELECT * FROM fuel_grade_movements WHERE store_id = ?')
        .all(TEST_STORE_ID) as Array<{ grade_id: string; amount_sold: number }>;

      expect(records.length).toBe(2);

      const unleadedRecord = records.find((r) => r.grade_id === 'UNLEADED');
      const premiumRecord = records.find((r) => r.grade_id === 'PREMIUM');

      expect(unleadedRecord).toBeDefined();
      expect(unleadedRecord?.amount_sold).toBe(1234.56);

      expect(premiumRecord).toBeDefined();
      expect(premiumRecord?.amount_sold).toBe(567.89);
    });

    it('INT-002: should record file in processed_files table', async () => {
      const filePath = path.join(tempDir, 'FGM20250115_002.xml');
      await fs.writeFile(filePath, SAMPLE_FGM_XML);

      const fileHash = 'test-hash-fgm-002';
      await parserService.processFile(filePath, fileHash);

      const processedFile = testDb
        .prepare('SELECT * FROM processed_files WHERE file_hash = ?')
        .get(fileHash) as
        | { status: string; document_type: string; record_count: number }
        | undefined;

      expect(processedFile).toBeDefined();
      expect(processedFile?.status).toBe('SUCCESS');
      expect(processedFile?.document_type).toBe('FuelGradeMovement');
      expect(processedFile?.record_count).toBe(2);
    });

    it('INT-003: should link FGM records to file via file_id', async () => {
      const filePath = path.join(tempDir, 'FGM20250115_003.xml');
      await fs.writeFile(filePath, SAMPLE_FGM_XML);

      const fileHash = 'test-hash-fgm-003';
      const _result = await parserService.processFile(filePath, fileHash);

      // All FGM records should have the file_id set
      const records = testDb
        .prepare('SELECT file_id FROM fuel_grade_movements WHERE store_id = ?')
        .all(TEST_STORE_ID) as Array<{ file_id: string }>;

      expect(records.every((r) => r.file_id === fileHash)).toBe(true);
    });
  });

  // ==========================================================================
  // INT-020 through 030: ItemSalesMovement (ISM) Bulk Flow
  // ==========================================================================

  describe('ItemSalesMovement (ISM) Bulk Flow', () => {
    it('INT-020: should bulk insert ISM records', async () => {
      const filePath = path.join(tempDir, 'ISM20250115.xml');
      await fs.writeFile(filePath, SAMPLE_ISM_XML);

      const fileHash = 'test-hash-ism-001';
      const result = await parserService.processFile(filePath, fileHash);

      expect(result.success).toBe(true);
      expect(result.documentType).toBe('ItemSalesMovement');
      expect(result.recordsCreated).toBe(2);

      // Verify records in database
      const records = testDb
        .prepare('SELECT * FROM item_sales_movements WHERE store_id = ?')
        .all(TEST_STORE_ID) as Array<{ item_code: string; amount_sold: number }>;

      expect(records.length).toBe(2);

      const sku001 = records.find((r) => r.item_code === 'SKU001');
      expect(sku001?.amount_sold).toBe(62.25);
    });

    it.skip('INT-021: should enqueue ISM as batch instead of individual items', async () => {
      const filePath = path.join(tempDir, 'ISM20250115_021.xml');
      await fs.writeFile(filePath, SAMPLE_ISM_XML);

      const fileHash = 'test-hash-ism-021';
      await parserService.processFile(filePath, fileHash);

      // Check sync queue - should have ItemSalesMovement entries (one per item)
      const queueItems = testDb
        .prepare("SELECT * FROM sync_queue WHERE entity_type = 'ItemSalesMovement'")
        .all() as Array<{ payload: string }>;

      expect(queueItems.length).toBe(1);

      const payload = JSON.parse(queueItems[0].payload);
      expect(Array.isArray(payload.items)).toBe(true);
      expect(payload.items.length).toBe(2);
    });
  });

  // ==========================================================================
  // INT-040 through 050: Sync Queue Integration
  // ==========================================================================

  describe('Sync Queue Integration', () => {
    it.skip('INT-040: should enqueue FGM records for sync', async () => {
      const filePath = path.join(tempDir, 'FGM20250115_040.xml');
      await fs.writeFile(filePath, SAMPLE_FGM_XML);

      const fileHash = 'test-hash-fgm-040';
      await parserService.processFile(filePath, fileHash);

      // Check sync queue for FGM entries
      const queueItems = testDb
        .prepare("SELECT * FROM sync_queue WHERE entity_type = 'FuelGradeMovement'")
        .all() as Array<{ entity_id: string; operation: string }>;

      expect(queueItems.length).toBe(2);
      expect(queueItems.every((q) => q.operation === 'CREATE')).toBe(true);
    });

    it.skip('INT-041: should set correct priority for queue items', async () => {
      const filePath = path.join(tempDir, 'FGM20250115_041.xml');
      await fs.writeFile(filePath, SAMPLE_FGM_XML);

      const fileHash = 'test-hash-fgm-041';
      await parserService.processFile(filePath, fileHash);

      const queueItems = testDb.prepare('SELECT priority FROM sync_queue').all() as Array<{
        priority: number;
      }>;

      // All items should have default priority
      expect(queueItems.every((q) => q.priority >= 0)).toBe(true);
    });
  });

  // ==========================================================================
  // INT-060 through 070: Duplicate Detection
  // ==========================================================================

  describe('Duplicate Detection', () => {
    it.skip('INT-060: should skip already processed files', async () => {
      const filePath = path.join(tempDir, 'FGM20250115_060.xml');
      await fs.writeFile(filePath, SAMPLE_FGM_XML);

      const fileHash = 'test-hash-fgm-060';

      // Process first time
      const result1 = await parserService.processFile(filePath, fileHash);
      expect(result1.success).toBe(true);
      expect(result1.recordsCreated).toBe(2);

      // Process second time - should be skipped
      const result2 = await parserService.processFile(filePath, fileHash);
      expect(result2.success).toBe(true);
      expect(result2.skipped).toBe(true);
      expect(result2.recordsCreated).toBe(0);
    });

    it.skip('INT-061: should detect duplicates by file hash', async () => {
      const filePath1 = path.join(tempDir, 'FGM20250115_061a.xml');
      const filePath2 = path.join(tempDir, 'FGM20250115_061b.xml');
      await fs.writeFile(filePath1, SAMPLE_FGM_XML);
      await fs.writeFile(filePath2, SAMPLE_FGM_XML);

      const sameHash = 'test-hash-duplicate-061';

      // Process first file
      const result1 = await parserService.processFile(filePath1, sameHash);
      expect(result1.success).toBe(true);

      // Process second file with same hash - should be skipped
      const result2 = await parserService.processFile(filePath2, sameHash);
      expect(result2.skipped).toBe(true);
    });
  });

  // ==========================================================================
  // INT-080 through 090: Data Integrity
  // ==========================================================================

  describe('Data Integrity', () => {
    it('INT-090: should preserve numeric precision for amounts', async () => {
      const filePath = path.join(tempDir, 'FGM20250115_090.xml');
      await fs.writeFile(filePath, SAMPLE_FGM_XML);

      const fileHash = 'precision-hash-090';
      await parserService.processFile(filePath, fileHash);

      const record = testDb
        .prepare("SELECT amount_sold FROM fuel_grade_movements WHERE grade_id = 'UNLEADED'")
        .get() as { amount_sold: number } | undefined;

      // Should preserve decimal precision
      expect(record?.amount_sold).toBe(1234.56);
    });

    it('INT-091: should store correct business date', async () => {
      const filePath = path.join(tempDir, 'FGM20250115_091.xml');
      await fs.writeFile(filePath, SAMPLE_FGM_XML);

      const fileHash = 'date-hash-091';
      await parserService.processFile(filePath, fileHash);

      const records = testDb
        .prepare('SELECT DISTINCT business_date FROM fuel_grade_movements WHERE store_id = ?')
        .all(TEST_STORE_ID) as Array<{ business_date: string }>;

      expect(records.length).toBe(1);
      expect(records[0].business_date).toBe('2025-01-15');
    });
  });
});
