/**
 * Dead Letter Queue IPC Channel Exposure Tests
 *
 * Verifies that DLQ IPC channels are correctly exposed in the preload script's
 * ALLOWED_INVOKE_CHANNELS allowlist. These tests ensure the fix for the
 * "IPC channel not allowed: sync:getDeadLetterItems" error remains in place.
 *
 * Traceability:
 * - MQ-002: Dead Letter Queue implementation
 * - SEC-014: Type-safe IPC communication with channel allowlists
 *
 * @module tests/unit/ipc/dlq-channels.spec
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Test Setup: Read and parse the preload script to extract channel allowlist
// ============================================================================

let preloadContent: string;
let allowedInvokeChannels: string[];

beforeAll(() => {
  // Read the preload script source
  const preloadPath = path.resolve(__dirname, '../../../src/preload/index.ts');
  preloadContent = fs.readFileSync(preloadPath, 'utf-8');

  // Extract the ALLOWED_INVOKE_CHANNELS array from the source
  // This regex captures the array content between [ and ] as const
  const match = preloadContent.match(
    /const ALLOWED_INVOKE_CHANNELS\s*=\s*\[([\s\S]*?)\]\s*as\s*const/
  );

  if (!match) {
    throw new Error('Could not find ALLOWED_INVOKE_CHANNELS in preload script');
  }

  // Parse individual channel strings from the array
  const channelMatches = match[1].matchAll(/'([^']+)'/g);
  allowedInvokeChannels = Array.from(channelMatches, (m) => m[1]);
});

// ============================================================================
// DLQ Channel Exposure Tests
// ============================================================================

describe('Dead Letter Queue IPC Channel Exposure', () => {
  describe('MQ-002: DLQ channels in ALLOWED_INVOKE_CHANNELS', () => {
    it('should include sync:getDeadLetterItems channel', () => {
      expect(allowedInvokeChannels).toContain('sync:getDeadLetterItems');
    });

    it('should include sync:getDeadLetterStats channel', () => {
      expect(allowedInvokeChannels).toContain('sync:getDeadLetterStats');
    });

    it('should include sync:restoreFromDeadLetter channel', () => {
      expect(allowedInvokeChannels).toContain('sync:restoreFromDeadLetter');
    });

    it('should include sync:restoreFromDeadLetterMany channel', () => {
      expect(allowedInvokeChannels).toContain('sync:restoreFromDeadLetterMany');
    });

    it('should include sync:deleteDeadLetterItem channel', () => {
      expect(allowedInvokeChannels).toContain('sync:deleteDeadLetterItem');
    });

    it('should include sync:cleanupDeadLetter channel', () => {
      expect(allowedInvokeChannels).toContain('sync:cleanupDeadLetter');
    });

    it('should include sync:manualDeadLetter channel', () => {
      expect(allowedInvokeChannels).toContain('sync:manualDeadLetter');
    });
  });

  describe('Complete DLQ channel set verification', () => {
    const REQUIRED_DLQ_CHANNELS = [
      'sync:getDeadLetterItems',
      'sync:getDeadLetterStats',
      'sync:restoreFromDeadLetter',
      'sync:restoreFromDeadLetterMany',
      'sync:deleteDeadLetterItem',
      'sync:cleanupDeadLetter',
      'sync:manualDeadLetter',
    ] as const;

    it('should include all required DLQ channels', () => {
      const missingChannels = REQUIRED_DLQ_CHANNELS.filter(
        (channel) => !allowedInvokeChannels.includes(channel)
      );

      expect(missingChannels).toHaveLength(0);
      if (missingChannels.length > 0) {
        throw new Error(
          `Missing DLQ channels in ALLOWED_INVOKE_CHANNELS: ${missingChannels.join(', ')}`
        );
      }
    });

    it('should have all DLQ channels in correct format (sync: prefix)', () => {
      REQUIRED_DLQ_CHANNELS.forEach((channel) => {
        expect(channel).toMatch(/^sync:/);
      });
    });
  });

  describe('SEC-014: Channel naming conventions', () => {
    it('should follow namespace:action naming convention for DLQ channels', () => {
      const dlqChannels = allowedInvokeChannels.filter(
        (channel) =>
          channel.includes('DeadLetter') ||
          channel.includes('deadLetter') ||
          channel.includes('dead_letter')
      );

      dlqChannels.forEach((channel) => {
        // Should be in format namespace:action
        expect(channel).toMatch(/^[a-z]+:[a-zA-Z]+$/);
      });
    });

    it('should use camelCase for DLQ action names', () => {
      const dlqChannels = [
        'sync:getDeadLetterItems',
        'sync:getDeadLetterStats',
        'sync:restoreFromDeadLetter',
        'sync:restoreFromDeadLetterMany',
        'sync:deleteDeadLetterItem',
        'sync:cleanupDeadLetter',
        'sync:manualDeadLetter',
      ];

      dlqChannels.forEach((channel) => {
        const action = channel.split(':')[1];
        // Should start with lowercase and use camelCase
        expect(action[0]).toMatch(/[a-z]/);
        // Should not contain underscores or hyphens
        expect(action).not.toMatch(/[_-]/);
      });
    });
  });

  describe('Preload script structure verification', () => {
    it('should have DLQ channels commented with MQ-002 reference', () => {
      // Verify the comment block exists for documentation
      expect(preloadContent).toContain('Dead Letter Queue');
      expect(preloadContent).toContain('MQ-002');
    });

    it('should have DLQ channels grouped together', () => {
      // Find the DLQ section and verify channels are consecutive
      const dlqSectionMatch = preloadContent.match(
        /\/\/ Dead Letter Queue[\s\S]*?sync:manualDeadLetter/
      );

      expect(dlqSectionMatch).not.toBeNull();
    });
  });

  describe('Non-DLQ channel exclusion (negative tests)', () => {
    it('should NOT include arbitrary sync channels', () => {
      const invalidChannels = [
        'sync:deleteAllData',
        'sync:dropDatabase',
        'sync:executeRawSQL',
        'sync:internalDebug',
      ];

      invalidChannels.forEach((channel) => {
        expect(allowedInvokeChannels).not.toContain(channel);
      });
    });

    it('should NOT include dead letter channels with wrong prefixes', () => {
      const invalidChannels = [
        'dlq:getItems', // Wrong prefix
        'deadLetter:get', // Wrong prefix
        'admin:getDeadLetterItems', // Wrong namespace
      ];

      invalidChannels.forEach((channel) => {
        expect(allowedInvokeChannels).not.toContain(channel);
      });
    });
  });
});

// ============================================================================
// Handler-Channel Alignment Tests
// Verifies that channels in preload match handlers in sync.handlers.ts
// ============================================================================

describe('Handler-Channel Alignment', () => {
  let handlersContent: string;

  beforeAll(() => {
    const handlersPath = path.resolve(__dirname, '../../../src/main/ipc/sync.handlers.ts');
    handlersContent = fs.readFileSync(handlersPath, 'utf-8');
  });

  it('should have handler registered for each DLQ channel', () => {
    const dlqChannels = [
      'sync:getDeadLetterItems',
      'sync:getDeadLetterStats',
      'sync:restoreFromDeadLetter',
      'sync:restoreFromDeadLetterMany',
      'sync:deleteDeadLetterItem',
      'sync:cleanupDeadLetter',
      'sync:manualDeadLetter',
    ];

    dlqChannels.forEach((channel) => {
      // Check that registerHandler is called with this channel
      // eslint-disable-next-line security/detect-non-literal-regexp -- test validation only
      const handlerPattern = new RegExp(`registerHandler\\(\\s*['"]${channel}['"]`);
      expect(handlersContent).toMatch(handlerPattern);
    });
  });

  it('should have all registered DLQ handlers exposed in preload', () => {
    // Find all DLQ handler registrations in handlers file
    const handlerMatches = handlersContent.matchAll(
      /registerHandler\(\s*['"]sync:((?:get|restore|delete|cleanup|manual)(?:DeadLetter|FromDeadLetter)[A-Za-z]*)['"]/g
    );

    const registeredChannels = Array.from(handlerMatches, (m) => `sync:${m[1]}`);

    // Each registered handler should be in the preload allowlist
    registeredChannels.forEach((channel) => {
      expect(allowedInvokeChannels).toContain(channel);
    });
  });
});
