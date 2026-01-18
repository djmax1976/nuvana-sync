/**
 * Pack Status Error Messages Unit Tests
 *
 * Tests the `getPackStatusErrorMessage` helper function that provides
 * user-friendly error messages when a pack cannot be activated due to
 * its current status.
 *
 * Business Rule: A lottery pack can only be activated ONCE.
 * - ACTIVATED packs are currently in use and cannot be re-activated
 * - SETTLED packs have been fully sold and cannot be re-activated
 * - RETURNED packs were returned to distributor and cannot be activated
 *
 * SEC-BUSINESS: Critical business logic for preventing duplicate activations
 * FE-002: FORM_VALIDATION - User-facing error message requirements
 *
 * @module tests/unit/components/pack-status-error-messages
 */

// Uses vitest globals (configured in vitest.config.ts)

// ============================================================================
// Type Definitions (mirror production types)
// ============================================================================

type LotteryPackStatus = 'RECEIVED' | 'ACTIVATED' | 'SETTLED' | 'RETURNED';

interface PackStatusErrorMessage {
  title: string;
  description: string;
}

// ============================================================================
// Function Under Test (extracted from PackSearchCombobox.tsx)
// ============================================================================

/**
 * Get user-friendly error message based on pack status
 * Explains why the pack cannot be activated
 *
 * This is a pure function extracted for testing. In production,
 * it resides in PackSearchCombobox.tsx.
 */
function getPackStatusErrorMessage(
  status: LotteryPackStatus,
  packNumber: string,
  gameName?: string,
  binLabel?: string | null
): PackStatusErrorMessage {
  const gameInfo = gameName ? ` (${gameName})` : '';

  switch (status) {
    case 'ACTIVATED':
      return {
        title: 'Pack is already active',
        description: binLabel
          ? `Pack #${packNumber}${gameInfo} is currently active in ${binLabel}. A pack can only be activated once.`
          : `Pack #${packNumber}${gameInfo} is already activated. A pack can only be activated once.`,
      };
    case 'SETTLED':
      return {
        title: 'Pack has been sold/depleted',
        description: `Pack #${packNumber}${gameInfo} was previously activated and has been depleted. It cannot be activated again.`,
      };
    case 'RETURNED':
      return {
        title: 'Pack was returned',
        description: `Pack #${packNumber}${gameInfo} was returned to the distributor and cannot be activated.`,
      };
    case 'RECEIVED':
      // This shouldn't happen in this context, but handle it gracefully
      return {
        title: 'Pack not found in search',
        description: `Pack #${packNumber}${gameInfo} exists but was not found. Please try again.`,
      };
    default:
      return {
        title: 'Pack unavailable',
        description: `Pack #${packNumber}${gameInfo} has status "${status}" and cannot be activated.`,
      };
  }
}

// ============================================================================
// Test Suite
// ============================================================================

describe('getPackStatusErrorMessage', () => {
  // ==========================================================================
  // ACTIVATED Status Tests (Primary Use Case)
  // This is the most common scenario: user scans a pack that's already in a bin
  // ==========================================================================
  describe('ACTIVATED status (pack currently in use)', () => {
    it('should return correct message with bin label when pack is active in a specific bin', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Lucky 7s', 'Bin 1');

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toBe(
        'Pack #0103230 (Lucky 7s) is currently active in Bin 1. A pack can only be activated once.'
      );
    });

    it('should return correct message without bin label when bin is not provided', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Lucky 7s', null);

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toBe(
        'Pack #0103230 (Lucky 7s) is already activated. A pack can only be activated once.'
      );
    });

    it('should return correct message when bin label is undefined', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Lucky 7s', undefined);

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toBe(
        'Pack #0103230 (Lucky 7s) is already activated. A pack can only be activated once.'
      );
    });

    it('should return correct message without game name when not provided', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', undefined, 'Bin 1');

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toBe(
        'Pack #0103230 is currently active in Bin 1. A pack can only be activated once.'
      );
    });

    it('should return correct message with only pack number (minimal info)', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', undefined, null);

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toBe(
        'Pack #0103230 is already activated. A pack can only be activated once.'
      );
    });

    // Enterprise: Test with realistic game names and bin labels
    it('should handle game names with special characters', () => {
      const result = getPackStatusErrorMessage(
        'ACTIVATED',
        '0103230',
        '$100 Million Cash',
        'Register 3'
      );

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toContain('$100 Million Cash');
      expect(result.description).toContain('Register 3');
    });

    it('should handle long game names', () => {
      const longGameName = 'Super Lucky Winner Triple Jackpot Deluxe Edition';
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', longGameName, 'Bin 1');

      expect(result.description).toContain(longGameName);
    });

    it('should handle numeric bin labels', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Lucky 7s', '1');

      expect(result.description).toContain('currently active in 1');
    });
  });

  // ==========================================================================
  // SETTLED Status Tests (Pack was fully sold/depleted)
  // ==========================================================================
  describe('SETTLED status (pack was sold out)', () => {
    it('should return correct message with game name', () => {
      const result = getPackStatusErrorMessage('SETTLED', '0103230', 'Lucky 7s', null);

      expect(result.title).toBe('Pack has been sold/depleted');
      expect(result.description).toBe(
        'Pack #0103230 (Lucky 7s) was previously activated and has been depleted. It cannot be activated again.'
      );
    });

    it('should return correct message without game name', () => {
      const result = getPackStatusErrorMessage('SETTLED', '0103230', undefined, null);

      expect(result.title).toBe('Pack has been sold/depleted');
      expect(result.description).toBe(
        'Pack #0103230 was previously activated and has been depleted. It cannot be activated again.'
      );
    });

    // Business logic: Settled packs should never have bin info since they're removed
    it('should not include bin info even if provided (settled packs are removed from bins)', () => {
      const result = getPackStatusErrorMessage('SETTLED', '0103230', 'Lucky 7s', 'Bin 1');

      // The description should NOT mention the bin for settled packs
      expect(result.description).not.toContain('Bin 1');
      expect(result.description).toContain('depleted');
    });
  });

  // ==========================================================================
  // RETURNED Status Tests (Pack returned to distributor)
  // ==========================================================================
  describe('RETURNED status (pack returned to distributor)', () => {
    it('should return correct message with game name', () => {
      const result = getPackStatusErrorMessage('RETURNED', '0103230', 'Lucky 7s', null);

      expect(result.title).toBe('Pack was returned');
      expect(result.description).toBe(
        'Pack #0103230 (Lucky 7s) was returned to the distributor and cannot be activated.'
      );
    });

    it('should return correct message without game name', () => {
      const result = getPackStatusErrorMessage('RETURNED', '0103230', undefined, null);

      expect(result.title).toBe('Pack was returned');
      expect(result.description).toBe(
        'Pack #0103230 was returned to the distributor and cannot be activated.'
      );
    });

    // Business logic: Returned packs should never have bin info
    it('should not include bin info even if provided', () => {
      const result = getPackStatusErrorMessage('RETURNED', '0103230', 'Lucky 7s', 'Bin 1');

      expect(result.description).not.toContain('Bin 1');
      expect(result.description).toContain('returned to the distributor');
    });
  });

  // ==========================================================================
  // RECEIVED Status Tests (Edge case - should not happen in this context)
  // ==========================================================================
  describe('RECEIVED status (edge case)', () => {
    it('should return fallback message for RECEIVED status', () => {
      // This case shouldn't happen in practice because RECEIVED packs
      // should be found in the search. But we handle it gracefully.
      const result = getPackStatusErrorMessage('RECEIVED', '0103230', 'Lucky 7s', null);

      expect(result.title).toBe('Pack not found in search');
      expect(result.description).toBe(
        'Pack #0103230 (Lucky 7s) exists but was not found. Please try again.'
      );
    });

    it('should return fallback message without game name', () => {
      const result = getPackStatusErrorMessage('RECEIVED', '0103230', undefined, null);

      expect(result.title).toBe('Pack not found in search');
      expect(result.description).toBe('Pack #0103230 exists but was not found. Please try again.');
    });
  });

  // ==========================================================================
  // Unknown/Default Status Tests (Defensive programming)
  // ==========================================================================
  describe('Unknown status (defensive handling)', () => {
    it('should return generic message for unknown status', () => {
      // TypeScript would normally prevent this, but runtime could receive unexpected values
      const result = getPackStatusErrorMessage(
        'UNKNOWN' as LotteryPackStatus,
        '0103230',
        'Lucky 7s',
        null
      );

      expect(result.title).toBe('Pack unavailable');
      expect(result.description).toBe(
        'Pack #0103230 (Lucky 7s) has status "UNKNOWN" and cannot be activated.'
      );
    });

    it('should include unknown status value in message for debugging', () => {
      const result = getPackStatusErrorMessage(
        'INVALID_STATUS' as LotteryPackStatus,
        '0103230',
        undefined,
        null
      );

      expect(result.description).toContain('"INVALID_STATUS"');
    });
  });

  // ==========================================================================
  // Pack Number Format Tests (Edge cases)
  // ==========================================================================
  describe('Pack number formats', () => {
    it('should handle standard 7-digit pack numbers', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Lucky 7s', 'Bin 1');

      expect(result.description).toContain('Pack #0103230');
    });

    it('should handle pack numbers with leading zeros', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0000001', 'Lucky 7s', 'Bin 1');

      expect(result.description).toContain('Pack #0000001');
    });

    it('should handle short pack numbers', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '123', 'Lucky 7s', 'Bin 1');

      expect(result.description).toContain('Pack #123');
    });

    it('should handle empty pack number gracefully', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '', 'Lucky 7s', 'Bin 1');

      expect(result.description).toContain('Pack #');
    });
  });

  // ==========================================================================
  // Message Clarity Tests (UX requirements)
  // ==========================================================================
  describe('Message clarity and user experience', () => {
    it('should always include "pack can only be activated once" for ACTIVATED status', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Lucky 7s', 'Bin 1');

      expect(result.description).toContain('A pack can only be activated once.');
    });

    it('should always include "cannot be activated again" for SETTLED status', () => {
      const result = getPackStatusErrorMessage('SETTLED', '0103230', 'Lucky 7s', null);

      expect(result.description).toContain('It cannot be activated again.');
    });

    it('should always include "cannot be activated" for RETURNED status', () => {
      const result = getPackStatusErrorMessage('RETURNED', '0103230', 'Lucky 7s', null);

      expect(result.description).toContain('cannot be activated');
    });

    it('should have distinct titles for different statuses', () => {
      const activatedTitle = getPackStatusErrorMessage('ACTIVATED', '001', undefined, null).title;
      const settledTitle = getPackStatusErrorMessage('SETTLED', '001', undefined, null).title;
      const returnedTitle = getPackStatusErrorMessage('RETURNED', '001', undefined, null).title;

      expect(activatedTitle).not.toBe(settledTitle);
      expect(settledTitle).not.toBe(returnedTitle);
      expect(activatedTitle).not.toBe(returnedTitle);
    });
  });

  // ==========================================================================
  // Return Value Structure Tests (Contract validation)
  // ==========================================================================
  describe('Return value structure', () => {
    it('should always return an object with title and description properties', () => {
      const statuses: LotteryPackStatus[] = ['RECEIVED', 'ACTIVATED', 'SETTLED', 'RETURNED'];

      for (const status of statuses) {
        const result = getPackStatusErrorMessage(status, '0103230', 'Lucky 7s', null);

        expect(result).toHaveProperty('title');
        expect(result).toHaveProperty('description');
        expect(typeof result.title).toBe('string');
        expect(typeof result.description).toBe('string');
        expect(result.title.length).toBeGreaterThan(0);
        expect(result.description.length).toBeGreaterThan(0);
      }
    });

    it('should never return undefined or null for title', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '', undefined, undefined);

      expect(result.title).not.toBeUndefined();
      expect(result.title).not.toBeNull();
    });

    it('should never return undefined or null for description', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '', undefined, undefined);

      expect(result.description).not.toBeUndefined();
      expect(result.description).not.toBeNull();
    });
  });

  // ==========================================================================
  // Real-World Scenario Tests
  // ==========================================================================
  describe('Real-world scenarios', () => {
    it('Scenario: User scans pack already active in Bin 1 for game 1835', () => {
      // This is the original bug scenario from the user report
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Game 1835', 'Bin 1');

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toContain('Bin 1');
      expect(result.description).toContain('Game 1835');
      expect(result.description).not.toContain('not found');
    });

    it('Scenario: User scans pack that was sold out yesterday', () => {
      const result = getPackStatusErrorMessage('SETTLED', '0500123', 'Mega Millions', null);

      expect(result.title).toBe('Pack has been sold/depleted');
      expect(result.description).toContain('Mega Millions');
      expect(result.description).toContain('depleted');
    });

    it('Scenario: User scans pack that was returned due to damage', () => {
      const result = getPackStatusErrorMessage('RETURNED', '0700456', 'Cash Explosion', null);

      expect(result.title).toBe('Pack was returned');
      expect(result.description).toContain('returned to the distributor');
    });

    it('Scenario: User scans pack from another register that is still active', () => {
      const result = getPackStatusErrorMessage('ACTIVATED', '0103230', 'Lucky 7s', 'Register 3');

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toContain('Register 3');
    });
  });
});

// ============================================================================
// Additional Test Suite: checkPackExists API Response Mapping
// ============================================================================

describe('checkPackExists Response Handling', () => {
  // Simulated response structure from lottery:checkPackExists IPC handler
  interface CheckPackExistsResponse {
    exists: boolean;
    pack?: {
      pack_id: string;
      pack_number: string;
      status: LotteryPackStatus;
      game?: {
        game_code: string;
        name: string;
      };
      bin?: {
        bin_id: string;
        bin_number: number;
        label: string | null;
      } | null;
    };
  }

  describe('Response mapping to error messages', () => {
    it('should map ACTIVATED pack response to correct error message', () => {
      const response: CheckPackExistsResponse = {
        exists: true,
        pack: {
          pack_id: 'pack-uuid-123',
          pack_number: '0103230',
          status: 'ACTIVATED',
          game: { game_code: '1835', name: 'Lucky 7s' },
          bin: { bin_id: 'bin-uuid-1', bin_number: 1, label: 'Bin 1' },
        },
      };

      const result = getPackStatusErrorMessage(
        response.pack!.status,
        response.pack!.pack_number,
        response.pack!.game?.name,
        response.pack!.bin?.label
      );

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toContain('Lucky 7s');
      expect(result.description).toContain('Bin 1');
    });

    it('should map SETTLED pack response to correct error message', () => {
      const response: CheckPackExistsResponse = {
        exists: true,
        pack: {
          pack_id: 'pack-uuid-456',
          pack_number: '0200001',
          status: 'SETTLED',
          game: { game_code: '2001', name: 'Cash Blast' },
          bin: null,
        },
      };

      const result = getPackStatusErrorMessage(
        response.pack!.status,
        response.pack!.pack_number,
        response.pack!.game?.name,
        response.pack!.bin?.label
      );

      expect(result.title).toBe('Pack has been sold/depleted');
      expect(result.description).toContain('Cash Blast');
    });

    it('should map RETURNED pack response to correct error message', () => {
      const response: CheckPackExistsResponse = {
        exists: true,
        pack: {
          pack_id: 'pack-uuid-789',
          pack_number: '0300001',
          status: 'RETURNED',
          game: { game_code: '3001', name: 'Mega Winner' },
          bin: null,
        },
      };

      const result = getPackStatusErrorMessage(
        response.pack!.status,
        response.pack!.pack_number,
        response.pack!.game?.name,
        response.pack!.bin?.label
      );

      expect(result.title).toBe('Pack was returned');
      expect(result.description).toContain('Mega Winner');
    });

    it('should handle response with missing game info', () => {
      const response: CheckPackExistsResponse = {
        exists: true,
        pack: {
          pack_id: 'pack-uuid-000',
          pack_number: '0000001',
          status: 'ACTIVATED',
          // game is undefined
          bin: { bin_id: 'bin-uuid-1', bin_number: 1, label: 'Bin 1' },
        },
      };

      const result = getPackStatusErrorMessage(
        response.pack!.status,
        response.pack!.pack_number,
        response.pack!.game?.name, // undefined
        response.pack!.bin?.label
      );

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toContain('Pack #0000001');
      expect(result.description).not.toContain('undefined');
    });

    it('should handle response with null bin label', () => {
      const response: CheckPackExistsResponse = {
        exists: true,
        pack: {
          pack_id: 'pack-uuid-111',
          pack_number: '0111111',
          status: 'ACTIVATED',
          game: { game_code: '1001', name: 'Test Game' },
          bin: { bin_id: 'bin-uuid-2', bin_number: 2, label: null },
        },
      };

      const result = getPackStatusErrorMessage(
        response.pack!.status,
        response.pack!.pack_number,
        response.pack!.game?.name,
        response.pack!.bin?.label // null
      );

      expect(result.title).toBe('Pack is already active');
      expect(result.description).toContain('already activated');
      expect(result.description).not.toContain('null');
    });
  });
});
