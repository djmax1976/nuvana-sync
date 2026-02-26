/**
 * Close Draft Hook
 *
 * React hook for managing Day Close and Shift Close wizard drafts.
 * Provides autosave, crash recovery, optimistic locking, and atomic finalization.
 *
 * @module renderer/hooks/useCloseDraft
 * @feature DRAFT-001: Draft-Backed Wizard Architecture
 * @security SEC-010: All operations require authentication (backend enforced)
 * @security DB-006: Store-scoped via backend handlers
 * @security API-001: Zod validation on all inputs (backend)
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ipc,
  type CloseDraft,
  type DraftPayload,
  type LotteryPayload,
  type DraftType,
  type StepState,
  type FinalizeResponse,
  type VersionConflictResponse,
  type DraftResponse,
  type DraftErrorResponse,
} from '../lib/transport';

// ============================================================================
// Constants
// ============================================================================

/**
 * Debounce delay for autosave (milliseconds)
 * PERF-002: 500ms debounce prevents excessive IPC calls while maintaining responsiveness
 */
const AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * Query key factory for draft queries
 * Namespaced under 'draft' for cache management
 */
export const draftKeys = {
  all: ['draft'] as const,
  byShift: (shiftId: string) => [...draftKeys.all, 'shift', shiftId] as const,
  byId: (draftId: string) => [...draftKeys.all, 'id', draftId] as const,
};

// ============================================================================
// Types
// ============================================================================

/**
 * Version conflict error details
 */
interface VersionConflictInfo {
  currentVersion: number;
  expectedVersion: number;
}

/**
 * Draft state for the hook
 */
interface _DraftState {
  /** Current draft data (from cache/local state) */
  draft: CloseDraft | null;
  /** Whether initial load is in progress */
  isLoading: boolean;
  /** Whether a save operation is in progress */
  isSaving: boolean;
  /** Whether finalization is in progress */
  isFinalizing: boolean;
  /** Current version for optimistic locking */
  version: number;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Last error that occurred */
  error: Error | null;
  /** Whether version conflict occurred */
  hasVersionConflict: boolean;
  /** Version conflict details */
  versionConflictInfo: VersionConflictInfo | null;
}

/**
 * Crash recovery information
 */
export interface CrashRecoveryInfo {
  /** Whether an existing draft was found */
  hasDraft: boolean;
  /** The existing draft (if found) */
  draft: CloseDraft | null;
  /** Last saved step state for navigation */
  stepState: StepState;
  /** When the draft was last updated */
  lastUpdated: string | null;
}

/**
 * Hook return type
 */
export interface UseCloseDraftReturn {
  // State
  /** Current draft state */
  draft: CloseDraft | null;
  /** Parsed payload from draft */
  payload: DraftPayload;
  /** Whether initial load is in progress */
  isLoading: boolean;
  /** Whether save operation is in progress */
  isSaving: boolean;
  /** Whether finalization is in progress */
  isFinalizing: boolean;
  /** Current version for display/debugging */
  version: number;
  /** Whether there are unsaved changes */
  isDirty: boolean;
  /** Last error */
  error: Error | null;
  /** Whether a version conflict occurred */
  hasVersionConflict: boolean;

  // Lottery step methods
  /** Update lottery data (Step 1) - auto-saves with debounce */
  updateLottery: (lotteryData: LotteryPayload) => void;

  // Reports step methods (placeholder for future)
  /** Update reports data (Step 2) - local state only for now */
  updateReports: (reportsData: DraftPayload['reports']) => void;

  // Step state management
  /** Update step state for crash recovery navigation */
  updateStepState: (stepState: StepState) => Promise<void>;

  // Finalize
  /** Finalize draft and commit to final tables */
  finalize: (closingCash: number) => Promise<FinalizeResponse>;

  // Manual controls
  /** Force immediate save of pending changes */
  save: () => Promise<void>;
  /** Discard draft and reset (expire) */
  discard: () => Promise<void>;
  /** Retry after version conflict - refetches and resets state */
  retryAfterConflict: () => Promise<void>;

  // Crash recovery
  /** Information about existing draft for recovery UI */
  recoveryInfo: CrashRecoveryInfo | null;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing close wizard drafts
 *
 * Provides comprehensive draft lifecycle management:
 * - Creates or resumes existing draft on mount
 * - Autosaves changes with 500ms debounce
 * - Handles optimistic locking conflicts
 * - Supports crash recovery
 * - Atomic finalization to final tables
 *
 * @param shiftId - UUID of the shift to create/manage draft for
 * @param draftType - Type of wizard (DAY_CLOSE or SHIFT_CLOSE)
 * @param options - Optional configuration
 * @returns Draft state and methods
 *
 * @security DB-006: All operations scoped to configured store via backend
 * @security SEC-010: Authentication required for all IPC calls
 *
 * @example
 * ```tsx
 * const {
 *   draft,
 *   payload,
 *   isLoading,
 *   isSaving,
 *   updateLottery,
 *   finalize,
 * } = useCloseDraft(shiftId, 'DAY_CLOSE');
 *
 * // Update lottery data (auto-saves)
 * updateLottery({ bins_scans: [...], totals: {...}, entry_method: 'SCAN' });
 *
 * // Finalize when ready
 * await finalize(closingCash);
 * ```
 */
export function useCloseDraft(
  shiftId: string | null | undefined,
  draftType: DraftType,
  options?: {
    /** Skip auto-loading on mount (for testing) */
    skipAutoLoad?: boolean;
    /** Callback when crash recovery draft is found */
    onRecoveryDraftFound?: (info: CrashRecoveryInfo) => void;
  }
): UseCloseDraftReturn {
  const queryClient = useQueryClient();

  // ========================================================================
  // Local State
  // ========================================================================

  /** Local payload state for immediate UI updates (optimistic) */
  const [localPayload, setLocalPayload] = useState<DraftPayload>({});

  /** Dirty flag to track unsaved changes */
  const [isDirty, setIsDirty] = useState(false);

  /** Version conflict state */
  const [hasVersionConflict, setHasVersionConflict] = useState(false);
  const [_versionConflictInfo, setVersionConflictInfo] = useState<VersionConflictInfo | null>(null);

  /** Error state */
  const [error, setError] = useState<Error | null>(null);

  /** Recovery info for UI */
  const [recoveryInfo, setRecoveryInfo] = useState<CrashRecoveryInfo | null>(null);

  // ========================================================================
  // Refs for Debouncing
  // ========================================================================

  /** Debounce timer ref */
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Pending payload to save */
  const pendingPayloadRef = useRef<Partial<DraftPayload> | null>(null);

  /** Flag to track if component is mounted */
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // ========================================================================
  // Query: Load Draft
  // ========================================================================

  const {
    data: queryDraft,
    isLoading: isQueryLoading,
    error: queryError,
    refetch,
  } = useQuery({
    queryKey: shiftId ? draftKeys.byShift(shiftId) : draftKeys.all,
    queryFn: async (): Promise<CloseDraft | null> => {
      if (!shiftId) return null;

      // First, check for existing active draft
      const existingResponse = await ipc.drafts.getActive(shiftId);

      // Check for error in getActive response
      if ('error' in existingResponse) {
        console.error('[useCloseDraft] getActive failed:', existingResponse);
        // Continue to create - getActive returning error just means no existing draft
      }

      if (existingResponse.draft) {
        // Found existing draft - set up recovery info
        const existingDraft = existingResponse.draft;
        const info: CrashRecoveryInfo = {
          hasDraft: true,
          draft: existingDraft,
          stepState: existingDraft.step_state,
          lastUpdated: existingDraft.updated_at,
        };
        setRecoveryInfo(info);
        options?.onRecoveryDraftFound?.(info);
        return existingDraft;
      }

      // No existing draft - create new one
      const createResponse = await ipc.drafts.create(shiftId, draftType);

      // Check for error in create response
      // Type guard: IPC error responses have { success: false, error: string, message: string }
      if ('error' in createResponse && 'message' in createResponse) {
        const errorResponse = createResponse as unknown as DraftErrorResponse;
        console.error('[useCloseDraft] create failed:', errorResponse);
        throw new Error(`Failed to create draft: ${errorResponse.message || errorResponse.error}`);
      }

      if (!createResponse.draft) {
        throw new Error('Draft creation returned empty response');
      }

      return createResponse.draft;
    },
    enabled: !!shiftId && !options?.skipAutoLoad,
    staleTime: Infinity, // Draft doesn't become stale during session
    gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
    retry: 2,
    refetchOnMount: true,
    refetchOnWindowFocus: false, // Don't refetch on focus - we manage state locally
  });

  // Sync local payload when draft loads
  // Use queueMicrotask to avoid synchronous setState in effect (react-compiler rule)
  useEffect(() => {
    if (queryDraft?.payload) {
      queueMicrotask(() => {
        setLocalPayload(queryDraft.payload);
        setIsDirty(false);
        setHasVersionConflict(false);
        setVersionConflictInfo(null);
        setError(null);
      });
    }
  }, [queryDraft]);

  // ========================================================================
  // Mutation: Save Draft
  // ========================================================================

  const saveMutation = useMutation({
    mutationFn: async ({
      payload,
      version,
    }: {
      payload: Partial<DraftPayload>;
      version: number;
    }): Promise<CloseDraft> => {
      if (!queryDraft) {
        throw new Error('No draft to save');
      }

      const response = await ipc.drafts.update(queryDraft.draft_id, payload, version);

      // Check for version conflict
      if ('error' in response && response.error === 'VERSION_CONFLICT') {
        const conflictResponse = response as VersionConflictResponse;
        const conflictError = new Error(conflictResponse.message);
        (conflictError as Error & { isVersionConflict: boolean }).isVersionConflict = true;
        (conflictError as Error & { currentVersion: number }).currentVersion =
          conflictResponse.current_version;
        (conflictError as Error & { expectedVersion: number }).expectedVersion =
          conflictResponse.expected_version;
        throw conflictError;
      }

      return (response as DraftResponse).draft;
    },
    onSuccess: (updatedDraft) => {
      // Update cache with new draft
      if (shiftId) {
        queryClient.setQueryData(draftKeys.byShift(shiftId), updatedDraft);
      }
      setIsDirty(false);
      setHasVersionConflict(false);
      setVersionConflictInfo(null);
      setError(null);
    },
    onError: (
      err: Error & {
        isVersionConflict?: boolean;
        currentVersion?: number;
        expectedVersion?: number;
      }
    ) => {
      if (err.isVersionConflict) {
        setHasVersionConflict(true);
        setVersionConflictInfo({
          currentVersion: err.currentVersion ?? -1,
          expectedVersion: err.expectedVersion ?? -1,
        });
      }
      setError(err);
    },
  });

  // ========================================================================
  // Mutation: Save Lottery
  // ========================================================================

  const saveLotteryMutation = useMutation({
    mutationFn: async ({
      lotteryData,
      version,
    }: {
      lotteryData: LotteryPayload;
      version: number;
    }): Promise<CloseDraft> => {
      if (!queryDraft) {
        throw new Error('No draft to save');
      }

      const response = await ipc.drafts.updateLottery(queryDraft.draft_id, lotteryData, version);

      // Check for version conflict
      if ('error' in response && response.error === 'VERSION_CONFLICT') {
        const conflictResponse = response as VersionConflictResponse;
        const conflictError = new Error(conflictResponse.message);
        (conflictError as Error & { isVersionConflict: boolean }).isVersionConflict = true;
        (conflictError as Error & { currentVersion: number }).currentVersion =
          conflictResponse.current_version;
        (conflictError as Error & { expectedVersion: number }).expectedVersion =
          conflictResponse.expected_version;
        throw conflictError;
      }

      return (response as DraftResponse).draft;
    },
    onSuccess: (updatedDraft) => {
      if (shiftId) {
        queryClient.setQueryData(draftKeys.byShift(shiftId), updatedDraft);
      }
      setIsDirty(false);
      setHasVersionConflict(false);
      setVersionConflictInfo(null);
      setError(null);
    },
    onError: (
      err: Error & {
        isVersionConflict?: boolean;
        currentVersion?: number;
        expectedVersion?: number;
      }
    ) => {
      if (err.isVersionConflict) {
        setHasVersionConflict(true);
        setVersionConflictInfo({
          currentVersion: err.currentVersion ?? -1,
          expectedVersion: err.expectedVersion ?? -1,
        });
      }
      setError(err);
    },
  });

  // ========================================================================
  // Mutation: Update Step State
  // ========================================================================

  const stepStateMutation = useMutation({
    mutationFn: async (stepState: StepState): Promise<CloseDraft> => {
      if (!queryDraft) {
        throw new Error('No draft to update');
      }
      const response = await ipc.drafts.updateStepState(queryDraft.draft_id, stepState);
      return response.draft;
    },
    onSuccess: (updatedDraft) => {
      if (shiftId) {
        queryClient.setQueryData(draftKeys.byShift(shiftId), updatedDraft);
      }
    },
  });

  // ========================================================================
  // Mutation: Finalize
  // ========================================================================

  const finalizeMutation = useMutation({
    mutationFn: async (closingCash: number): Promise<FinalizeResponse> => {
      if (!queryDraft) {
        throw new Error('No draft to finalize');
      }

      // First, flush any pending saves
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      if (pendingPayloadRef.current && isDirty) {
        // BUG-FIX: Save pending changes with retry on version conflict
        // Previously, clearing pendingPayloadRef before await caused data loss
        const payload = pendingPayloadRef.current;
        try {
          await saveMutation.mutateAsync({ payload, version: queryDraft.version });
          pendingPayloadRef.current = null;
        } catch (error) {
          // On version conflict, refetch and retry once
          if (
            error instanceof Error &&
            'isVersionConflict' in error &&
            (error as Error & { isVersionConflict: boolean }).isVersionConflict
          ) {
            const latestDraft = await refetch();
            if (latestDraft.data) {
              await saveMutation.mutateAsync({
                payload,
                version: latestDraft.data.version,
              });
              pendingPayloadRef.current = null;
            }
          } else {
            throw error;
          }
        }
      }

      // Now finalize
      return ipc.drafts.finalize(queryDraft.draft_id, closingCash);
    },
    onSuccess: () => {
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: draftKeys.all });
      queryClient.invalidateQueries({ queryKey: ['local', 'shifts'] });
      queryClient.invalidateQueries({ queryKey: ['lottery', 'dayBins'] });
    },
    onError: (err) => {
      setError(err);
    },
  });

  // ========================================================================
  // Mutation: Expire (Discard)
  // ========================================================================

  const expireMutation = useMutation({
    mutationFn: async (): Promise<CloseDraft> => {
      if (!queryDraft) {
        throw new Error('No draft to expire');
      }
      const response = await ipc.drafts.expire(queryDraft.draft_id);
      return response.draft;
    },
    onSuccess: () => {
      // Clear local state
      setLocalPayload({});
      setIsDirty(false);
      setRecoveryInfo(null);

      // Invalidate cache
      if (shiftId) {
        queryClient.removeQueries({ queryKey: draftKeys.byShift(shiftId) });
      }
    },
  });

  // ========================================================================
  // Debounced Save Implementation
  // ========================================================================

  /**
   * Execute debounced save
   * SEC-006: Safe to call frequently - debounced to prevent IPC flooding
   */
  const executeDebouncedSave = useCallback(() => {
    if (!queryDraft || !pendingPayloadRef.current) return;

    const payload = pendingPayloadRef.current;
    pendingPayloadRef.current = null;

    // Check if this is lottery-specific update
    if (payload.lottery && Object.keys(payload).length === 1) {
      saveLotteryMutation.mutate({
        lotteryData: payload.lottery,
        version: queryDraft.version,
      });
    } else {
      saveMutation.mutate({
        payload,
        version: queryDraft.version,
      });
    }
  }, [queryDraft, saveMutation, saveLotteryMutation]);

  /**
   * Schedule a debounced save
   */
  const scheduleDebouncedSave = useCallback(
    (payload: Partial<DraftPayload>) => {
      // Merge with any pending payload
      pendingPayloadRef.current = {
        ...pendingPayloadRef.current,
        ...payload,
      };

      // Clear existing timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Schedule new save
      debounceTimerRef.current = setTimeout(() => {
        if (isMountedRef.current) {
          executeDebouncedSave();
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [executeDebouncedSave]
  );

  // ========================================================================
  // Public Methods
  // ========================================================================

  /**
   * Update lottery data (Step 1)
   * Immediately updates local state and schedules debounced save
   */
  const updateLottery = useCallback(
    (lotteryData: LotteryPayload) => {
      // Update local state immediately (optimistic)
      setLocalPayload((prev) => ({
        ...prev,
        lottery: lotteryData,
      }));
      setIsDirty(true);

      // Schedule debounced save
      scheduleDebouncedSave({ lottery: lotteryData });
    },
    [scheduleDebouncedSave]
  );

  /**
   * Update reports data (Step 2)
   * Currently local state only - database persistence is future work
   */
  const updateReports = useCallback((reportsData: DraftPayload['reports']) => {
    // Update local state only (reports persistence is out of scope)
    setLocalPayload((prev) => ({
      ...prev,
      reports: reportsData,
    }));
    // Note: Not marking dirty because we're not persisting reports yet
  }, []);

  /**
   * Update step state for crash recovery navigation
   */
  const updateStepState = useCallback(
    async (stepState: StepState): Promise<void> => {
      // First flush any pending saves
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      // Note: We check pendingPayloadRef.current directly (synchronous ref)
      // instead of isDirty (async state) to avoid race conditions when
      // updateLottery and updateStepState are called in sequence
      if (pendingPayloadRef.current && queryDraft) {
        const payload = pendingPayloadRef.current;
        pendingPayloadRef.current = null;
        await saveMutation.mutateAsync({ payload, version: queryDraft.version });
        setIsDirty(false); // Sync isDirty state after successful save
      }

      // Then update step state
      await stepStateMutation.mutateAsync(stepState);
    },
    [queryDraft, saveMutation, stepStateMutation]
  );

  /**
   * Finalize draft and commit to final tables
   */
  const finalize = useCallback(
    async (closingCash: number): Promise<FinalizeResponse> => {
      return finalizeMutation.mutateAsync(closingCash);
    },
    [finalizeMutation]
  );

  /**
   * Force immediate save of pending changes
   *
   * BUG-FIX: Only clear pendingPayloadRef AFTER successful save.
   * Previously, clearing before await caused data loss on version conflicts.
   */
  const save = useCallback(async (): Promise<void> => {
    // Clear debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    // Save pending changes
    if (pendingPayloadRef.current && queryDraft) {
      const payload = pendingPayloadRef.current;
      // BUG-FIX: Don't clear yet - wait for success
      try {
        await saveMutation.mutateAsync({ payload, version: queryDraft.version });
        // Only clear after successful save
        pendingPayloadRef.current = null;
      } catch (error) {
        // On version conflict, refetch and retry once
        if (
          error instanceof Error &&
          'isVersionConflict' in error &&
          (error as Error & { isVersionConflict: boolean }).isVersionConflict
        ) {
          // Refetch to get latest version
          const latestDraft = await refetch();
          if (latestDraft.data) {
            // Retry with latest version
            await saveMutation.mutateAsync({
              payload,
              version: latestDraft.data.version,
            });
            pendingPayloadRef.current = null;
          }
        } else {
          // Re-throw non-conflict errors
          throw error;
        }
      }
    }
  }, [queryDraft, saveMutation, refetch]);

  /**
   * Discard draft and reset
   */
  const discard = useCallback(async (): Promise<void> => {
    // Clear any pending saves
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    pendingPayloadRef.current = null;

    await expireMutation.mutateAsync();
  }, [expireMutation]);

  /**
   * Retry after version conflict - refetch and reset state
   */
  const retryAfterConflict = useCallback(async (): Promise<void> => {
    setHasVersionConflict(false);
    setVersionConflictInfo(null);
    setError(null);

    // Refetch to get latest version
    await refetch();
  }, [refetch]);

  // ========================================================================
  // Computed Values
  // ========================================================================

  const draft = queryDraft ?? null;
  const version = queryDraft?.version ?? 0;
  const payload = useMemo(() => localPayload, [localPayload]);
  const isSaving = saveMutation.isPending || saveLotteryMutation.isPending;
  const isFinalizing = finalizeMutation.isPending;
  const isLoading = isQueryLoading;

  // Sync query error to local state
  // Use queueMicrotask to avoid synchronous setState in effect (react-compiler rule)
  useEffect(() => {
    if (queryError) {
      queueMicrotask(() => {
        setError(queryError);
      });
    }
  }, [queryError]);

  // ========================================================================
  // Return
  // ========================================================================

  return {
    // State
    draft,
    payload,
    isLoading,
    isSaving,
    isFinalizing,
    version,
    isDirty,
    error,
    hasVersionConflict,

    // Lottery step
    updateLottery,

    // Reports step
    updateReports,

    // Step state
    updateStepState,

    // Finalize
    finalize,

    // Manual controls
    save,
    discard,
    retryAfterConflict,

    // Crash recovery
    recoveryInfo,
  };
}

export default useCloseDraft;
