/**
 * Shared API Client
 *
 * Enterprise-grade HTTP client using Axios with:
 * - Global 401/session expiration handling via interceptors
 * - Automatic token refresh (future enhancement)
 * - Request/response logging in development
 * - Consistent timeout and retry configuration
 * - Cross-tab session synchronization
 *
 * All API domain files (lottery.ts, shifts.ts, stores.ts, etc.)
 * should use this client instead of raw fetch or local apiRequest functions.
 *
 * @example
 * ```typescript
 * import apiClient from './client';
 *
 * // GET request
 * const { data } = await apiClient.get<PacksResponse>('/api/lottery/packs', {
 *   params: { store_id: storeId }
 * });
 *
 * // POST request
 * const { data } = await apiClient.post<Pack>('/api/lottery/packs/receive', {
 *   pack_number: '123',
 *   game_id: 'abc'
 * });
 * ```
 */

import axios, { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { handleUnauthorizedError, dispatchSessionExpiredEvent } from '@/lib/auth-error-handler';

// Configuration
const API_BASE_URL = 'http://localhost:3001';
const DEFAULT_TIMEOUT = 30000; // 30 seconds

/**
 * Custom error class for API errors with additional context
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public correlationId?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Create and configure the Axios instance
 */
function createApiClient(): AxiosInstance {
  const client = axios.create({
    baseURL: API_BASE_URL,
    timeout: DEFAULT_TIMEOUT,
    withCredentials: true, // Send httpOnly cookies with every request
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor - minimal logging in development
  // Enterprise practice: never log request bodies (even sanitized) to avoid PII exposure
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      return config;
    },
    (error: AxiosError) => {
      return Promise.reject(error);
    }
  );

  // Response interceptor - handle 401 and transform errors
  client.interceptors.response.use(
    (response: AxiosResponse) => {
      return response;
    },
    async (error: AxiosError) => {
      // Handle 401 Unauthorized
      if (error.response?.status === 401) {
        const requestUrl = error.config?.url || '';

        // SEC-010: AUTHZ - Distinguish between session expiration and credential verification failures
        // These endpoints verify OTHER users' credentials (not the current session).
        // A 401 from these means "invalid credentials for the user being verified",
        // NOT "the current logged-in user's session expired".
        // Do NOT trigger global session expiration for these endpoints.
        const isCredentialVerificationEndpoint =
          requestUrl.includes('/auth/verify-management') ||
          requestUrl.includes('/auth/verify-user-permission') ||
          requestUrl.includes('/auth/verify-cashier-permission') ||
          requestUrl.includes('/auth/verify-elevated-access') ||
          requestUrl.includes('/cashiers/authenticate-pin') ||
          requestUrl.includes('/cashiers/authenticate');

        if (isCredentialVerificationEndpoint) {
          // Extract error details for proper error message display
          const responseData = error.response?.data as {
            success?: boolean;
            error?: { code?: string; message?: string };
            message?: string;
          };

          const errorCode = responseData?.error?.code || 'AUTHENTICATION_FAILED';
          const errorMessage =
            responseData?.error?.message || responseData?.message || 'Authentication failed';

          // Return credential verification error WITHOUT triggering session expiration
          return Promise.reject(new ApiError(errorMessage, 401, errorCode));
        }

        // For all other 401s, this is a session expiration
        // Dispatch event for React Query to clear cache
        dispatchSessionExpiredEvent('api_401');

        // Handle the redirect
        handleUnauthorizedError();

        // Return a rejected promise with ApiError
        return Promise.reject(
          new ApiError('Session expired. Please log in again.', 401, 'SESSION_EXPIRED')
        );
      }

      // Handle 403 Forbidden
      if (error.response?.status === 403) {
        return Promise.reject(new ApiError('Access denied.', 403, 'FORBIDDEN'));
      }

      // Extract error details from response
      const responseData = error.response?.data as {
        message?: string;
        error?: { message?: string; code?: string } | string;
        code?: string;
        correlationId?: string;
      };

      // Build error message from various response formats
      let errorMessage = 'An unexpected error occurred';
      let errorCode: string | undefined;

      if (responseData) {
        if (responseData.message) {
          errorMessage = responseData.message;
        } else if (typeof responseData.error === 'object' && responseData.error?.message) {
          errorMessage = responseData.error.message;
          errorCode = responseData.error.code;
        } else if (typeof responseData.error === 'string') {
          errorMessage = responseData.error;
        }
        errorCode = errorCode || responseData.code;
      }

      // Network error (no response)
      if (!error.response) {
        if (error.code === 'ECONNABORTED') {
          return Promise.reject(new ApiError('Request timeout', 408, 'TIMEOUT'));
        }
        return Promise.reject(
          new ApiError(
            error.message || 'Network error - please check your connection',
            0,
            'NETWORK_ERROR'
          )
        );
      }

      // Return ApiError with full context
      return Promise.reject(
        new ApiError(errorMessage, error.response.status, errorCode, responseData?.correlationId)
      );
    }
  );

  return client;
}

/**
 * The shared API client instance
 *
 * Use this for all API calls to ensure consistent:
 * - 401 handling and session expiration
 * - Error formatting
 * - Timeout configuration
 * - Credential handling (httpOnly cookies)
 */
const apiClient = createApiClient();

export default apiClient;

/**
 * Helper type for API responses
 * Most endpoints return { success: true, data: T } or { success: true, ...T }
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Helper to extract data from standard API response format
 */
export function extractData<T>(response: AxiosResponse<ApiResponse<T>>): T {
  if (response.data.data !== undefined) {
    return response.data.data;
  }
  // Some endpoints return data directly without wrapper
  return response.data as unknown as T;
}
