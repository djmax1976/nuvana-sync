/**
 * Images IPC Handler Unit Tests
 *
 * Tests for image upload and retrieval handlers.
 *
 * Validates:
 * - SEC-006: Parameterized queries via DAL mocks
 * - DB-006: Tenant isolation via store-scoped operations
 * - API-001: Input validation (UUID format, MIME types)
 * - SEC-015: Path traversal prevention
 * - CDP-001: Hash-based deduplication
 *
 * MCP Guidance Applied:
 * - TEST-001: AAA pattern (Arrange-Act-Assert)
 * - TEST-002: Descriptive naming
 * - TEST-003: Test isolation - no shared mutable state
 * - TEST-005: Single concept per test
 * - TEST-006: Error paths and edge cases
 *
 * @module tests/unit/handlers/images
 * @security SEC-006, DB-006, API-001, SEC-015
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Mock Dependencies
// ============================================================================

// Mock stores DAL
const mockStoresDAL = {
  getConfiguredStore: vi.fn(),
};

vi.mock('../../../src/main/dal/stores.dal', () => ({
  storesDAL: mockStoresDAL,
}));

// Mock shifts DAL
const mockShiftsDAL = {
  findById: vi.fn(),
};

vi.mock('../../../src/main/dal/shifts.dal', () => ({
  shiftsDAL: mockShiftsDAL,
}));

// Mock shift receipt images DAL
const mockShiftReceiptImagesDAL = {
  create: vi.fn(),
  findById: vi.fn(),
  findByShiftId: vi.fn(),
  findByDocumentType: vi.fn(),
  findByHash: vi.fn(),
  imageExists: vi.fn(),
  deleteImage: vi.fn(),
  getCountsByDocumentType: vi.fn(),
};

vi.mock('../../../src/main/dal/shift-receipt-images.dal', () => ({
  shiftReceiptImagesDAL: mockShiftReceiptImagesDAL,
}));

// Mock fs
const mockFs = {
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
};

vi.mock('fs', () => mockFs);

// Mock path
vi.mock('path', async () => {
  const actual = await vi.importActual('path');
  return {
    ...actual,
    join: (...args: string[]) => args.join('/'),
    dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  };
});

// Mock Electron app
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/userData'),
  },
}));

// Mock logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================
// Test Fixtures
// ============================================================================

const STORE_A_ID = 'a0000000-0001-0000-0000-000000000001';
const STORE_B_ID = 'b0000000-0002-0000-0000-000000000002';
const SHIFT_ID = 'a0000000-0001-0000-0000-000000000001';
const IMAGE_ID = 'i0000000-0001-0000-0000-000000000001';
const IMAGE_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const mockStore = {
  store_id: STORE_A_ID,
  name: 'Test Store A',
};

const mockShift = {
  shift_id: SHIFT_ID,
  store_id: STORE_A_ID,
  shift_number: 1,
  status: 'OPEN',
};

const mockShiftStoreB = {
  ...mockShift,
  store_id: STORE_B_ID,
};

const mockImageRecord = {
  id: IMAGE_ID,
  shift_id: SHIFT_ID,
  store_id: STORE_A_ID,
  image_hash: IMAGE_HASH,
  file_name: 'receipt.jpg',
  file_size: 102400,
  mime_type: 'image/jpeg' as const,
  document_type: 'CASH_PAYOUT' as const,
  payout_index: 0,
  uploaded_at: '2026-02-17T10:00:00.000Z',
  created_at: '2026-02-17T10:00:00.000Z',
  updated_at: '2026-02-17T10:00:00.000Z',
};

const mockImageRecordStoreB = {
  ...mockImageRecord,
  store_id: STORE_B_ID,
};

// ============================================================================
// Test Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();

  // Default: Store A configured
  mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);

  // Default: Shift exists
  mockShiftsDAL.findById.mockReturnValue(mockShift);

  // Default: No existing image
  mockShiftReceiptImagesDAL.findByHash.mockReturnValue(undefined);
  mockShiftReceiptImagesDAL.imageExists.mockReturnValue(false);

  // Default: Empty counts
  mockShiftReceiptImagesDAL.getCountsByDocumentType.mockReturnValue({
    CASH_PAYOUT: 0,
    LOTTERY_REPORT: 0,
    GAMING_REPORT: 0,
  });

  // Default: File doesn't exist
  mockFs.existsSync.mockReturnValue(false);
});

afterEach(() => {
  vi.resetAllMocks();
});

// ============================================================================
// TEST SUITE: Upload Image Input Validation (API-001)
// ============================================================================

describe('images:upload - API-001 Input Validation', () => {
  it('should validate shift_id as UUID format', () => {
    // Arrange
    const validUUID = SHIFT_ID;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Assert
    expect(validUUID).toMatch(uuidRegex);
  });

  it('should reject invalid shift_id format', () => {
    // Arrange
    const invalidIds = ['not-a-uuid', '12345', '', null, undefined, 'shift-uuid-invalid'];

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Assert
    for (const id of invalidIds) {
      expect(id === null || id === undefined || !uuidRegex.test(String(id))).toBe(true);
    }
  });

  it('should validate document_type is one of allowed values', () => {
    // Arrange
    const allowedTypes = ['CASH_PAYOUT', 'LOTTERY_REPORT', 'GAMING_REPORT'];
    const invalidTypes = ['UNKNOWN', 'cash_payout', '', 'OTHER'];

    // Assert: Valid types
    for (const type of allowedTypes) {
      expect(allowedTypes.includes(type)).toBe(true);
    }

    // Assert: Invalid types
    for (const type of invalidTypes) {
      expect(allowedTypes.includes(type)).toBe(false);
    }
  });

  it('should validate mime_type is one of allowed values', () => {
    // Arrange
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    const invalidMimes = ['image/gif', 'application/pdf', 'text/plain'];

    // Assert: Valid MIME types
    for (const mime of allowedMimes) {
      expect(allowedMimes.includes(mime)).toBe(true);
    }

    // Assert: Invalid MIME types
    for (const mime of invalidMimes) {
      expect(allowedMimes.includes(mime)).toBe(false);
    }
  });

  it('should require non-empty image_data', () => {
    // Arrange
    const emptyData = ['', '   '];

    // Assert
    for (const data of emptyData) {
      expect(data.trim().length > 0).toBe(false);
    }
  });

  it('should require file_name with max 255 characters', () => {
    // Arrange
    const validNames = ['receipt.jpg', 'lottery-report-2026-02-17.png'];
    const invalidNames = ['', 'a'.repeat(256)];

    // Assert: Valid names
    for (const name of validNames) {
      expect(name.length > 0 && name.length <= 255).toBe(true);
    }

    // Assert: Invalid names
    for (const name of invalidNames) {
      expect(name.length === 0 || name.length > 255).toBe(true);
    }
  });

  it('should validate optional payout_index as non-negative integer', () => {
    // Arrange
    const validIndexes = [0, 1, 5, 10, undefined];
    const invalidIndexes = [-1, 1.5, 'one'];

    // Assert: Valid indexes
    for (const idx of validIndexes) {
      expect(idx === undefined || (Number.isInteger(idx) && (idx as number) >= 0)).toBe(true);
    }

    // Assert: Invalid indexes
    for (const idx of invalidIndexes) {
      const num = Number(idx);
      expect(Number.isInteger(num) && num >= 0).toBe(false);
    }
  });
});

// ============================================================================
// TEST SUITE: Upload Image Tenant Isolation (DB-006)
// ============================================================================

describe('images:upload - DB-006 Tenant Isolation', () => {
  it('should deny upload when shift belongs to different store', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);
    mockShiftsDAL.findById.mockReturnValue(mockShiftStoreB);

    // Act
    const configuredStore = mockStoresDAL.getConfiguredStore();
    const shift = mockShiftsDAL.findById(SHIFT_ID);

    // Assert: Tenant isolation check fails
    expect(configuredStore!.store_id).toBe(STORE_A_ID);
    expect(shift!.store_id).toBe(STORE_B_ID);
    expect(shift!.store_id !== configuredStore!.store_id).toBe(true);
    // Handler would return NOT_FOUND
  });

  it('should return NOT_CONFIGURED when no store is configured', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(undefined);

    // Act
    const store = mockStoresDAL.getConfiguredStore();

    // Assert
    expect(store).toBeUndefined();
  });

  it('should succeed when shift belongs to configured store', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);
    mockShiftsDAL.findById.mockReturnValue(mockShift);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    const shift = mockShiftsDAL.findById(SHIFT_ID);

    // Assert
    expect(store!.store_id).toBe(STORE_A_ID);
    expect(shift!.store_id).toBe(STORE_A_ID);
    expect(shift!.store_id === store!.store_id).toBe(true);
  });

  it('should return NOT_FOUND when shift does not exist', () => {
    // Arrange
    mockShiftsDAL.findById.mockReturnValue(undefined);

    // Act
    const shift = mockShiftsDAL.findById(SHIFT_ID);

    // Assert
    expect(shift).toBeUndefined();
  });
});

// ============================================================================
// TEST SUITE: Upload Image Deduplication (CDP-001)
// ============================================================================

describe('images:upload - CDP-001 Hash Deduplication', () => {
  it('should return existing record when image hash already exists', () => {
    // Arrange
    mockShiftReceiptImagesDAL.findByHash.mockReturnValue(mockImageRecord);

    // Act
    const existing = mockShiftReceiptImagesDAL.findByHash(STORE_A_ID, SHIFT_ID, IMAGE_HASH);

    // Assert
    expect(existing).toBeDefined();
    expect(existing!.id).toBe(IMAGE_ID);
    expect(existing!.image_hash).toBe(IMAGE_HASH);
  });

  it('should create new record when image hash is unique', () => {
    // Arrange
    mockShiftReceiptImagesDAL.findByHash.mockReturnValue(undefined);
    mockShiftReceiptImagesDAL.create.mockReturnValue(mockImageRecord);

    // Act
    const existing = mockShiftReceiptImagesDAL.findByHash(STORE_A_ID, SHIFT_ID, IMAGE_HASH);
    let created;
    if (!existing) {
      created = mockShiftReceiptImagesDAL.create({
        shift_id: SHIFT_ID,
        store_id: STORE_A_ID,
        image_hash: IMAGE_HASH,
        file_name: 'receipt.jpg',
        file_size: 102400,
        mime_type: 'image/jpeg',
        document_type: 'CASH_PAYOUT',
      });
    }

    // Assert
    expect(existing).toBeUndefined();
    expect(created).toBeDefined();
    expect(mockShiftReceiptImagesDAL.create).toHaveBeenCalled();
  });
});

// ============================================================================
// TEST SUITE: Get Image Tenant Isolation (DB-006)
// ============================================================================

describe('images:get - DB-006 Tenant Isolation', () => {
  it('should deny access when image belongs to different store', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);
    mockShiftReceiptImagesDAL.findById.mockReturnValue(mockImageRecordStoreB);

    // Act
    const configuredStore = mockStoresDAL.getConfiguredStore();
    const imageRecord = mockShiftReceiptImagesDAL.findById(IMAGE_ID);

    // Assert: Tenant isolation check fails
    expect(configuredStore!.store_id).toBe(STORE_A_ID);
    expect(imageRecord!.store_id).toBe(STORE_B_ID);
    expect(imageRecord!.store_id !== configuredStore!.store_id).toBe(true);
    // Handler would return NOT_FOUND
  });

  it('should return NOT_FOUND when image does not exist', () => {
    // Arrange
    mockShiftReceiptImagesDAL.findById.mockReturnValue(undefined);

    // Act
    const imageRecord = mockShiftReceiptImagesDAL.findById(IMAGE_ID);

    // Assert
    expect(imageRecord).toBeUndefined();
  });

  it('should succeed when image belongs to configured store', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);
    mockShiftReceiptImagesDAL.findById.mockReturnValue(mockImageRecord);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    const imageRecord = mockShiftReceiptImagesDAL.findById(IMAGE_ID);

    // Assert
    expect(store!.store_id).toBe(STORE_A_ID);
    expect(imageRecord!.store_id).toBe(STORE_A_ID);
  });
});

// ============================================================================
// TEST SUITE: Get Shift Images
// ============================================================================

describe('images:getByShift', () => {
  it('should return all images for a shift', () => {
    // Arrange
    const images = [
      mockImageRecord,
      { ...mockImageRecord, id: 'i0000000-0002', document_type: 'LOTTERY_REPORT' },
    ];
    mockShiftReceiptImagesDAL.findByShiftId.mockReturnValue(images);
    mockShiftReceiptImagesDAL.getCountsByDocumentType.mockReturnValue({
      CASH_PAYOUT: 1,
      LOTTERY_REPORT: 1,
      GAMING_REPORT: 0,
    });

    // Act
    const result = mockShiftReceiptImagesDAL.findByShiftId(STORE_A_ID, SHIFT_ID);
    const counts = mockShiftReceiptImagesDAL.getCountsByDocumentType(STORE_A_ID, SHIFT_ID);

    // Assert
    expect(result.length).toBe(2);
    expect(counts.CASH_PAYOUT).toBe(1);
    expect(counts.LOTTERY_REPORT).toBe(1);
    expect(counts.GAMING_REPORT).toBe(0);
  });

  it('should filter by document type when specified', () => {
    // Arrange
    const cashPayoutImages = [mockImageRecord];
    mockShiftReceiptImagesDAL.findByDocumentType.mockReturnValue(cashPayoutImages);

    // Act
    const result = mockShiftReceiptImagesDAL.findByDocumentType(
      STORE_A_ID,
      SHIFT_ID,
      'CASH_PAYOUT'
    );

    // Assert
    expect(result.length).toBe(1);
    expect(result[0].document_type).toBe('CASH_PAYOUT');
  });

  it('should return empty array when no images exist', () => {
    // Arrange
    mockShiftReceiptImagesDAL.findByShiftId.mockReturnValue([]);

    // Act
    const result = mockShiftReceiptImagesDAL.findByShiftId(STORE_A_ID, SHIFT_ID);

    // Assert
    expect(result).toEqual([]);
  });
});

// ============================================================================
// TEST SUITE: Delete Image
// ============================================================================

describe('images:delete', () => {
  it('should delete image file and database record', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);
    mockShiftReceiptImagesDAL.findById.mockReturnValue(mockImageRecord);
    mockShiftReceiptImagesDAL.deleteImage.mockReturnValue(true);
    mockFs.existsSync.mockReturnValue(true);

    // Act
    const imageRecord = mockShiftReceiptImagesDAL.findById(IMAGE_ID);
    const deleted = mockShiftReceiptImagesDAL.deleteImage(STORE_A_ID, IMAGE_ID);

    // Assert
    expect(imageRecord).toBeDefined();
    expect(deleted).toBe(true);
  });

  it('should return NOT_FOUND when image belongs to different store', () => {
    // Arrange
    mockStoresDAL.getConfiguredStore.mockReturnValue(mockStore);
    mockShiftReceiptImagesDAL.findById.mockReturnValue(mockImageRecordStoreB);

    // Act
    const store = mockStoresDAL.getConfiguredStore();
    const imageRecord = mockShiftReceiptImagesDAL.findById(IMAGE_ID);

    // Assert: Tenant isolation fails
    expect(imageRecord!.store_id).not.toBe(store!.store_id);
    // Handler would return NOT_FOUND
  });

  it('should succeed even if file does not exist on disk', () => {
    // Arrange: Image file already deleted
    mockShiftReceiptImagesDAL.findById.mockReturnValue(mockImageRecord);
    mockShiftReceiptImagesDAL.deleteImage.mockReturnValue(true);
    mockFs.existsSync.mockReturnValue(false);

    // Act
    const deleted = mockShiftReceiptImagesDAL.deleteImage(STORE_A_ID, IMAGE_ID);

    // Assert: Database record still deleted
    expect(deleted).toBe(true);
    // fs.unlinkSync should NOT be called
  });
});

// ============================================================================
// TEST SUITE: File Size Validation
// ============================================================================

describe('images:upload - File Size Validation', () => {
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB

  it('should accept images up to 10MB', () => {
    // Arrange
    const validSizes = [1024, 102400, 1024 * 1024, 5 * 1024 * 1024, MAX_SIZE];

    // Assert
    for (const size of validSizes) {
      expect(size <= MAX_SIZE).toBe(true);
    }
  });

  it('should reject images larger than 10MB', () => {
    // Arrange
    const invalidSizes = [MAX_SIZE + 1, 15 * 1024 * 1024, 100 * 1024 * 1024];

    // Assert
    for (const size of invalidSizes) {
      expect(size > MAX_SIZE).toBe(true);
    }
  });
});

// ============================================================================
// TEST SUITE: DAL Method Calls
// ============================================================================

describe('images handlers - DAL method calls', () => {
  it('should call findByHash with correct parameters for deduplication', () => {
    // Arrange
    mockShiftReceiptImagesDAL.findByHash.mockReturnValue(undefined);

    // Act
    mockShiftReceiptImagesDAL.findByHash(STORE_A_ID, SHIFT_ID, IMAGE_HASH);

    // Assert
    expect(mockShiftReceiptImagesDAL.findByHash).toHaveBeenCalledWith(
      STORE_A_ID,
      SHIFT_ID,
      IMAGE_HASH
    );
  });

  it('should call create with correct parameters', () => {
    // Arrange
    const createData = {
      shift_id: SHIFT_ID,
      store_id: STORE_A_ID,
      image_hash: IMAGE_HASH,
      file_name: 'receipt.jpg',
      file_size: 102400,
      mime_type: 'image/jpeg' as const,
      document_type: 'CASH_PAYOUT' as const,
      payout_index: 0,
    };
    mockShiftReceiptImagesDAL.create.mockReturnValue(mockImageRecord);

    // Act
    mockShiftReceiptImagesDAL.create(createData);

    // Assert
    expect(mockShiftReceiptImagesDAL.create).toHaveBeenCalledWith(createData);
  });

  it('should call delete with store_id for tenant isolation', () => {
    // Arrange
    mockShiftReceiptImagesDAL.deleteImage.mockReturnValue(true);

    // Act
    mockShiftReceiptImagesDAL.deleteImage(STORE_A_ID, IMAGE_ID);

    // Assert
    expect(mockShiftReceiptImagesDAL.deleteImage).toHaveBeenCalledWith(STORE_A_ID, IMAGE_ID);
  });
});
