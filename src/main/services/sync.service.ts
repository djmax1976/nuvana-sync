/**
 * Sync Service
 *
 * Handles uploading parsed NAXML data to the cloud backend.
 * Implements retry logic and error handling.
 *
 * @module main/services/sync
 * @security SEC-014: Payload validation, LM-001: Structured logging
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { createLogger } from '../utils/logger';
import { type NuvanaConfig } from '../../shared/types/config.types';
import {
  type UploadPayload,
  type UploadResponse,
  type TestConnectionResponse,
  safeValidateUploadPayload,
  validateUploadResponse,
  TestConnectionResponseSchema,
} from '../../shared/types/sync.types';

const log = createLogger('sync-service');

/**
 * Maximum number of retry attempts for failed uploads
 */
const MAX_RETRIES = 3;

/**
 * Base delay in milliseconds for exponential backoff
 */
const RETRY_DELAY_MS = 1000;

/**
 * Request timeout in milliseconds
 */
const REQUEST_TIMEOUT_MS = 30000;

export class SyncService {
  private client: AxiosInstance;
  private config: NuvanaConfig;

  constructor(config: NuvanaConfig) {
    this.config = config;

    this.client = axios.create({
      baseURL: config.apiUrl,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'X-Store-ID': config.storeId,
      },
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        log.debug('API response received', {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error: AxiosError) => {
        log.error('API request failed', {
          status: error.response?.status,
          url: error.config?.url,
          error: error.message,
        });
        return Promise.reject(error);
      }
    );

    log.info('SyncService initialized', {
      apiUrl: config.apiUrl,
      storeId: config.storeId,
    });
  }

  /**
   * Upload parsed NAXML data to cloud
   * SEC-014: Validates payload before sending
   */
  async upload(payload: UploadPayload): Promise<UploadResponse> {
    // SEC-014: Validate upload payload
    const validation = safeValidateUploadPayload(payload);
    if (!validation.success) {
      const errorMessages = validation.error.issues
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');

      log.error('Upload payload validation failed', {
        errors: validation.error.issues.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
        fileName: payload.fileName,
      });

      throw new Error(`Invalid upload payload: ${errorMessages}`);
    }

    const validatedPayload = validation.data;
    let lastError: Error | null = null;

    log.info('Starting upload', {
      fileName: validatedPayload.fileName,
      documentType: validatedPayload.documentType,
      fileHashPrefix: validatedPayload.fileHash.substring(0, 16) + '...',
    });

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        log.debug('Upload attempt', {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          fileName: validatedPayload.fileName,
        });

        const response = await this.client.post<unknown>('/api/sync/upload', {
          storeId: this.config.storeId,
          documentType: validatedPayload.documentType,
          data: validatedPayload.data,
          fileName: validatedPayload.fileName,
          fileHash: validatedPayload.fileHash,
        });

        // SEC-014: Validate response structure
        const validatedResponse = validateUploadResponse(response.data);

        log.info('Upload successful', {
          fileName: validatedPayload.fileName,
          syncLogId: validatedResponse.syncLogId,
          attempt: attempt + 1,
        });

        return validatedResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx)
        if (axios.isAxiosError(error) && error.response?.status) {
          const status = error.response.status;
          if (status >= 400 && status < 500) {
            log.error('Upload failed with client error - not retrying', {
              status,
              fileName: validatedPayload.fileName,
              error: error.response.data?.error || error.message,
            });

            throw new Error(`Upload failed: ${error.response.data?.error || error.message}`);
          }
        }

        // Wait before retry (exponential backoff)
        if (attempt < MAX_RETRIES - 1) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);

          log.warn('Upload failed, retrying', {
            attempt: attempt + 1,
            nextRetryDelayMs: delay,
            fileName: validatedPayload.fileName,
            error: lastError.message,
          });

          await this.sleep(delay);
        }
      }
    }

    log.error('Upload failed after all retries', {
      fileName: validatedPayload.fileName,
      maxRetries: MAX_RETRIES,
      error: lastError?.message,
    });

    throw lastError || new Error('Upload failed after retries');
  }

  /**
   * Test connection to the cloud backend
   */
  async testConnection(): Promise<TestConnectionResponse> {
    log.info('Testing connection', {
      apiUrl: this.config.apiUrl,
      storeId: this.config.storeId,
    });

    try {
      const response = await this.client.get<unknown>('/api/sync/status');

      // SEC-014: Validate response structure
      const parsed = TestConnectionResponseSchema.safeParse({
        success: true,
        message: 'Connected successfully',
        storeInfo: (response.data as Record<string, unknown>)?.storeInfo,
      });

      if (!parsed.success) {
        log.warn('Unexpected response structure from status endpoint', {
          errors: parsed.error.issues,
        });

        return {
          success: true,
          message: 'Connected successfully',
        };
      }

      log.info('Connection test successful', {
        storeInfo: parsed.data.storeInfo,
      });

      return parsed.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        if (status === 401) {
          log.warn('Connection test failed - invalid API key');
          return {
            success: false,
            message: 'Invalid API key',
          };
        }
        if (status === 403) {
          log.warn('Connection test failed - forbidden', {
            storeId: this.config.storeId,
          });
          return {
            success: false,
            message: 'API key does not have access to this store',
          };
        }
        if (status === 404) {
          log.warn('Connection test failed - store not found', {
            storeId: this.config.storeId,
          });
          return {
            success: false,
            message: 'Store not found',
          };
        }
        if (!error.response) {
          log.error('Connection test failed - cannot reach server', {
            apiUrl: this.config.apiUrl,
            error: error.message,
          });
          return {
            success: false,
            message: 'Cannot reach server. Check API URL.',
          };
        }
      }

      log.error('Connection test failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Sleep helper for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
