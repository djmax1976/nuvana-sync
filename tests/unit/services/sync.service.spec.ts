/**
 * Sync Service Unit Tests
 *
 * Tests for cloud sync upload functionality.
 * Validates SEC-014: Payload validation
 * Validates retry logic and error handling
 *
 * @module tests/unit/services/sync.service
 */

// Using vitest globals (configured in vitest.config.ts)

// Mock axios with internal instance
vi.mock('axios', () => {
  const instance = {
    post: vi.fn(),
    get: vi.fn(),
    interceptors: {
      response: {
        use: vi.fn(),
      },
    },
  };
  const mockIsAxiosError = (error: unknown) => {
    return error && typeof error === 'object' && 'isAxiosError' in error;
  };
  return {
    default: {
      create: vi.fn(() => instance),
      isAxiosError: mockIsAxiosError,
      __instance: instance,
    },
    isAxiosError: mockIsAxiosError,
  };
});

// Mock the logger
vi.mock('../../../src/main/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import axios from 'axios';
import { SyncService } from '../../../src/main/services/sync.service';
import type { NuvanaConfig } from '../../../src/shared/types/config.types';
import type { UploadPayload } from '../../../src/shared/types/sync.types';

// Get access to the mocked instance
const mockAxiosCreate = axios.create as ReturnType<typeof vi.fn>;
const mockAxiosInstance = (
  axios as unknown as {
    __instance: {
      post: ReturnType<typeof vi.fn>;
      get: ReturnType<typeof vi.fn>;
      interceptors: { response: { use: ReturnType<typeof vi.fn> } };
    };
  }
).__instance;

describe('SyncService', () => {
  let syncService: SyncService;

  const mockConfig: NuvanaConfig = {
    apiUrl: 'https://api.example.com',
    apiKey: 'test-api-key',
    storeId: 'store-123',
    watchPath: 'C:/watch',
    archivePath: 'C:/archive',
    errorPath: 'C:/errors',
    pollInterval: 5,
    enabledFileTypes: {
      pjr: true,
      fgm: true,
      msm: true,
      fpm: true,
      mcm: false,
      tlm: false,
    },
    startOnLogin: true,
    minimizeToTray: true,
    showNotifications: true,
    processInOrder: false,
    isConfigured: true,
  };

  const validPayload: UploadPayload = {
    documentType: 'POSJournal',
    data: { transactions: [] },
    fileName: 'test-file.xml',
    fileHash: 'a'.repeat(64), // Valid 64-char hex hash
  };

  beforeEach(() => {
    vi.clearAllMocks();
    syncService = new SyncService(mockConfig);
  });

  describe('constructor', () => {
    it('should create axios client with correct configuration', () => {
      expect(mockAxiosCreate).toHaveBeenCalledWith({
        baseURL: 'https://api.example.com',
        timeout: 30000,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-api-key',
          'X-Store-ID': 'store-123',
        },
      });
    });

    it('should set up response interceptor', () => {
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('upload', () => {
    it('should successfully upload valid payload', async () => {
      const mockResponse = {
        data: {
          success: true,
          syncLogId: '550e8400-e29b-41d4-a716-446655440000',
          message: 'Uploaded successfully',
        },
      };
      mockAxiosInstance.post.mockResolvedValue(mockResponse);

      const result = await syncService.upload(validPayload);

      expect(result.success).toBe(true);
      expect(result.syncLogId).toBe('550e8400-e29b-41d4-a716-446655440000');
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/api/sync/upload', {
        storeId: 'store-123',
        documentType: 'POSJournal',
        data: { transactions: [] },
        fileName: 'test-file.xml',
        fileHash: 'a'.repeat(64),
      });
    });

    it('should throw error for invalid payload - missing required fields', async () => {
      const invalidPayload = {
        documentType: 'POSJournal',
        // Missing data, fileName, fileHash
      } as unknown as UploadPayload;

      await expect(syncService.upload(invalidPayload)).rejects.toThrow('Invalid upload payload');
    });

    it('should throw error for invalid file hash format', async () => {
      const invalidPayload: UploadPayload = {
        ...validPayload,
        fileHash: 'invalid-hash',
      };

      await expect(syncService.upload(invalidPayload)).rejects.toThrow('Invalid upload payload');
    });

    it('should throw error for invalid document type', async () => {
      const invalidPayload = {
        ...validPayload,
        documentType: 'InvalidType',
      } as unknown as UploadPayload;

      await expect(syncService.upload(invalidPayload)).rejects.toThrow('Invalid upload payload');
    });

    it('should throw error for invalid file name format', async () => {
      const invalidPayload: UploadPayload = {
        ...validPayload,
        fileName: 'no-extension',
      };

      await expect(syncService.upload(invalidPayload)).rejects.toThrow('Invalid upload payload');
    });

    it('should retry on server error (5xx)', async () => {
      const serverError = {
        isAxiosError: true,
        response: { status: 500, data: { error: 'Internal server error' } },
        message: 'Request failed',
        config: {},
      };
      mockAxiosInstance.post.mockRejectedValueOnce(serverError).mockResolvedValueOnce({
        data: { success: true, syncLogId: '550e8400-e29b-41d4-a716-446655440000' },
      });

      // Mock the sleep to be instant using Object.defineProperty
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (syncService as any).sleep = () => Promise.resolve();

      const result = await syncService.upload(validPayload);

      expect(result.success).toBe(true);
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it('should not retry on client error (4xx)', async () => {
      const clientError = {
        isAxiosError: true,
        response: { status: 400, data: { error: 'Bad request' } },
        message: 'Request failed',
        config: {},
      };
      mockAxiosInstance.post.mockRejectedValue(clientError);

      await expect(syncService.upload(validPayload)).rejects.toThrow('Upload failed: Bad request');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('should not retry on 401 unauthorized', async () => {
      const authError = {
        isAxiosError: true,
        response: { status: 401, data: { error: 'Unauthorized' } },
        message: 'Request failed',
        config: {},
      };
      mockAxiosInstance.post.mockRejectedValue(authError);

      await expect(syncService.upload(validPayload)).rejects.toThrow('Upload failed: Unauthorized');
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(1);
    });

    it('should fail after max retries', async () => {
      const serverError = {
        isAxiosError: true,
        response: { status: 503, data: { error: 'Service unavailable' } },
        message: 'Service unavailable',
        config: {},
      };
      mockAxiosInstance.post.mockRejectedValue(serverError);

      // Mock the sleep to be instant
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (syncService as any).sleep = () => Promise.resolve();

      await expect(syncService.upload(validPayload)).rejects.toThrow();
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(3);
    });

    it('should handle non-axios errors', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network failure'));

      // Mock the sleep to be instant
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (syncService as any).sleep = () => Promise.resolve();

      await expect(syncService.upload(validPayload)).rejects.toThrow('Network failure');
    });

    it('should accept all valid document types', async () => {
      const documentTypes = [
        'POSJournal',
        'FuelGradeMovement',
        'MiscellaneousSummaryMovement',
        'FuelProductMovement',
        'MerchandiseCodeMovement',
        'TaxLevelMovement',
        'ItemSalesMovement',
        'TankProductMovement',
        'Unknown',
      ] as const;

      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, syncLogId: '550e8400-e29b-41d4-a716-446655440000' },
      });

      for (const docType of documentTypes) {
        const payload: UploadPayload = { ...validPayload, documentType: docType };
        const result = await syncService.upload(payload);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('testConnection', () => {
    it('should return success for valid connection', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          storeInfo: { name: 'Test Store', id: 'store-123' },
        },
      });

      const result = await syncService.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Connected successfully');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/sync/status');
    });

    it('should return store info when available', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          storeInfo: { name: 'My Store', id: 'store-456' },
        },
      });

      const result = await syncService.testConnection();

      expect(result.success).toBe(true);
      expect(result.storeInfo).toEqual({ name: 'My Store', id: 'store-456' });
    });

    it('should handle 401 unauthorized', async () => {
      const authError = {
        isAxiosError: true,
        response: { status: 401 },
        message: 'Unauthorized',
      };
      mockAxiosInstance.get.mockRejectedValue(authError);

      const result = await syncService.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid API key');
    });

    it('should handle 403 forbidden', async () => {
      const forbiddenError = {
        isAxiosError: true,
        response: { status: 403 },
        message: 'Forbidden',
      };
      mockAxiosInstance.get.mockRejectedValue(forbiddenError);

      const result = await syncService.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('API key does not have access to this store');
    });

    it('should handle 404 store not found', async () => {
      const notFoundError = {
        isAxiosError: true,
        response: { status: 404 },
        message: 'Not found',
      };
      mockAxiosInstance.get.mockRejectedValue(notFoundError);

      const result = await syncService.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Store not found');
    });

    it('should handle network error (no response)', async () => {
      const networkError = {
        isAxiosError: true,
        response: undefined,
        message: 'Network Error',
      };
      mockAxiosInstance.get.mockRejectedValue(networkError);

      const result = await syncService.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Cannot reach server. Check API URL.');
    });

    it('should handle unexpected server error', async () => {
      const serverError = {
        isAxiosError: true,
        response: { status: 500 },
        message: 'Internal Server Error',
      };
      mockAxiosInstance.get.mockRejectedValue(serverError);

      const result = await syncService.testConnection();

      expect(result.success).toBe(false);
      // Falls through to the generic error handler
      expect(result.message).toBe('Connection failed');
    });

    it('should handle non-axios errors', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Unknown error'));

      const result = await syncService.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('Unknown error');
    });

    it('should handle unexpected response structure gracefully', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { unexpectedField: 'value' },
      });

      const result = await syncService.testConnection();

      // Should still succeed but without store info
      expect(result.success).toBe(true);
      expect(result.message).toBe('Connected successfully');
    });
  });
});
