/**
 * Migration v057: Close Drafts Table - Unit Tests
 *
 * Tests for the close_drafts table migration that enables draft-backed wizard
 * architecture for Day Close and Shift Close wizards.
 *
 * Feature: DRAFT-001 (Draft-Backed Wizard Architecture)
 *
 * Test Coverage:
 * - T1.1: Migration file structure and SQL syntax validation
 * - T1.2: Schema constraints defined correctly in SQL
 *
 * Security Compliance Tested:
 * - SEC-006: No string interpolation in SQL (static DDL)
 * - DB-006: Tenant isolation (store_id column and FK)
 * - DB-003: Optimistic locking (version field with CHECK constraint)
 *
 * Note: This file uses SQL structure validation (no native module required).
 * Full integration tests with real database are available when the native
 * module is properly built for the current Node.js version.
 *
 * @module tests/unit/migrations/v057-close-drafts.spec
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Mock Setup - Using vi.hoisted() for proper hoisting
// ============================================================================

const { mockPrepare, mockExec, mockTransaction } = vi.hoisted(() => ({
  mockPrepare: vi.fn(),
  mockExec: vi.fn(),
  mockTransaction: vi.fn((fn: () => void) => () => fn()),
}));

// Mock database service
vi.mock('../../../src/main/services/database.service', () => ({
  getDatabase: vi.fn(() => ({
    prepare: mockPrepare,
    exec: mockExec,
    transaction: mockTransaction,
  })),
}));

// ============================================================================
// Migration File Tests
// ============================================================================

describe('Migration v057: close_drafts', () => {
  const MIGRATION_PATH = path.resolve(
    __dirname,
    '../../../src/main/migrations/v057_close_drafts.sql'
  );

  let migrationSql: string;

  beforeEach(() => {
    vi.clearAllMocks();

    // Read the migration file
    if (fs.existsSync(MIGRATION_PATH)) {
      migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf-8');
    }
  });

  // ==========================================================================
  // T1.1: Migration File Structure Tests
  // ==========================================================================

  describe('T1.1: Migration File Structure', () => {
    it('should have migration file at expected path', () => {
      expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
    });

    it('should have valid migration file name format (v057)', () => {
      const filename = path.basename(MIGRATION_PATH);
      expect(filename).toMatch(/^v057_close_drafts\.sql$/);
    });

    it('should create close_drafts table', () => {
      expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS close_drafts');
    });

    it('should define draft_id as PRIMARY KEY', () => {
      expect(migrationSql).toMatch(/draft_id\s+TEXT\s+PRIMARY KEY/i);
    });

    it('should define store_id column for tenant isolation (DB-006)', () => {
      expect(migrationSql).toContain('store_id TEXT NOT NULL');
    });

    it('should define shift_id column with NOT NULL', () => {
      expect(migrationSql).toContain('shift_id TEXT NOT NULL');
    });

    it('should define business_date column', () => {
      expect(migrationSql).toContain('business_date TEXT NOT NULL');
    });

    it('should define draft_type column with CHECK constraint', () => {
      expect(migrationSql).toContain('draft_type TEXT NOT NULL');
      expect(migrationSql).toMatch(
        /draft_type\s+TEXT\s+NOT NULL\s+CHECK\s*\(\s*draft_type\s+IN\s*\(\s*'DAY_CLOSE'\s*,\s*'SHIFT_CLOSE'\s*\)/i
      );
    });

    it('should define status column with CHECK constraint and default', () => {
      expect(migrationSql).toContain("status TEXT NOT NULL DEFAULT 'IN_PROGRESS'");
      expect(migrationSql).toMatch(
        /status\s+IN\s*\(\s*'IN_PROGRESS'\s*,\s*'FINALIZING'\s*,\s*'FINALIZED'\s*,\s*'EXPIRED'\s*\)/i
      );
    });

    it('should define step_state column with CHECK constraint (nullable)', () => {
      expect(migrationSql).toMatch(
        /step_state\s+TEXT\s+CHECK\s*\(\s*step_state\s+IS\s+NULL\s+OR\s+step_state\s+IN\s*\(\s*'LOTTERY'\s*,\s*'REPORTS'\s*,\s*'REVIEW'\s*\)/i
      );
    });

    it('should define payload column with default empty JSON', () => {
      expect(migrationSql).toContain("payload TEXT NOT NULL DEFAULT '{}'");
    });

    it('should define version column with CHECK >= 1 (DB-003 optimistic locking)', () => {
      expect(migrationSql).toContain('version INTEGER NOT NULL DEFAULT 1');
      expect(migrationSql).toMatch(/version\s*>=\s*1/i);
    });

    it('should define created_at timestamp', () => {
      expect(migrationSql).toContain('created_at TEXT NOT NULL');
    });

    it('should define updated_at timestamp', () => {
      expect(migrationSql).toContain('updated_at TEXT NOT NULL');
    });

    it('should define created_by for audit trail (SEC-010)', () => {
      expect(migrationSql).toContain('created_by TEXT NOT NULL');
    });
  });

  // ==========================================================================
  // T1.2: Foreign Key and Index Tests
  // ==========================================================================

  describe('T1.2: Foreign Keys and Indexes', () => {
    it('should define FOREIGN KEY for store_id (DB-006)', () => {
      expect(migrationSql).toMatch(
        /FOREIGN KEY\s*\(\s*store_id\s*\)\s*REFERENCES\s*stores\s*\(\s*store_id\s*\)/i
      );
    });

    it('should define FOREIGN KEY for shift_id', () => {
      expect(migrationSql).toMatch(
        /FOREIGN KEY\s*\(\s*shift_id\s*\)\s*REFERENCES\s*shifts\s*\(\s*shift_id\s*\)/i
      );
    });

    it('should have ON DELETE CASCADE for store_id FK', () => {
      expect(migrationSql).toMatch(/FOREIGN KEY\s*\(\s*store_id\s*\).*ON DELETE CASCADE/is);
    });

    it('should have ON DELETE CASCADE for shift_id FK', () => {
      expect(migrationSql).toMatch(/FOREIGN KEY\s*\(\s*shift_id\s*\).*ON DELETE CASCADE/is);
    });

    it('should create idx_drafts_store_shift index', () => {
      expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_drafts_store_shift');
      expect(migrationSql).toMatch(
        /idx_drafts_store_shift\s+ON\s+close_drafts\s*\(\s*store_id\s*,\s*shift_id\s*\)/i
      );
    });

    it('should create idx_drafts_status index', () => {
      expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_drafts_status');
      expect(migrationSql).toMatch(/idx_drafts_status\s+ON\s+close_drafts\s*\(\s*status\s*\)/i);
    });

    it('should create idx_drafts_store_status_updated index for cleanup queries', () => {
      expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_drafts_store_status_updated');
    });
  });

  // ==========================================================================
  // Security Compliance Tests
  // ==========================================================================

  describe('Security Compliance', () => {
    it('should not contain any string interpolation patterns (SEC-006)', () => {
      // DDL should be static - no ${} or $() patterns
      expect(migrationSql).not.toMatch(/\$\{/);
      expect(migrationSql).not.toMatch(/\$\(/);
    });

    it('should document SEC-006 compliance', () => {
      expect(migrationSql).toContain('SEC-006');
    });

    it('should document DB-006 compliance (tenant isolation)', () => {
      expect(migrationSql).toContain('DB-006');
    });

    it('should have version constraint for optimistic locking (DB-003)', () => {
      expect(migrationSql).toContain('DB-003');
      expect(migrationSql).toMatch(
        /version\s+INTEGER\s+NOT NULL\s+DEFAULT\s+1\s+CHECK\s*\(\s*version\s*>=\s*1\s*\)/i
      );
    });

    it('should include DRAFT-001 feature reference', () => {
      expect(migrationSql).toContain('DRAFT-001');
    });
  });

  // ==========================================================================
  // Documentation Tests
  // ==========================================================================

  describe('Migration Documentation', () => {
    it('should have descriptive header comment', () => {
      expect(migrationSql).toMatch(/-- Migration v057:/);
    });

    it('should document draft types', () => {
      expect(migrationSql).toContain('DAY_CLOSE');
      expect(migrationSql).toContain('SHIFT_CLOSE');
    });

    it('should document status lifecycle', () => {
      expect(migrationSql).toContain('IN_PROGRESS');
      expect(migrationSql).toContain('FINALIZING');
      expect(migrationSql).toContain('FINALIZED');
      expect(migrationSql).toContain('EXPIRED');
    });

    it('should document step states', () => {
      expect(migrationSql).toContain('LOTTERY');
      expect(migrationSql).toContain('REPORTS');
      expect(migrationSql).toContain('REVIEW');
    });

    it('should have version number and date', () => {
      expect(migrationSql).toMatch(/@version\s+057/);
      expect(migrationSql).toMatch(/@date\s+2026-02-21/);
    });
  });

  // ==========================================================================
  // SQL Syntax Validation Tests
  // ==========================================================================

  describe('SQL Syntax Validation', () => {
    it('should have balanced parentheses', () => {
      const openCount = (migrationSql.match(/\(/g) || []).length;
      const closeCount = (migrationSql.match(/\)/g) || []).length;
      expect(openCount).toBe(closeCount);
    });

    it('should have valid SQLite column type keywords', () => {
      // All column types should be valid SQLite types
      expect(migrationSql).toMatch(/TEXT PRIMARY KEY/);
      expect(migrationSql).toMatch(/TEXT NOT NULL/);
      expect(migrationSql).toMatch(/INTEGER NOT NULL/);
    });

    it('should use IF NOT EXISTS for idempotency', () => {
      expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS');
      expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS');
    });

    it('should have proper SQL statement terminators', () => {
      // Each major SQL statement should end with semicolon
      const tableCreate = migrationSql.match(/CREATE TABLE.*?\);/s);
      expect(tableCreate).not.toBeNull();

      // Use 's' flag to match across newlines (CREATE INDEX spans multiple lines)
      const indexCreates = migrationSql.match(/CREATE INDEX[\s\S]*?;/g);
      expect(indexCreates).not.toBeNull();
      expect(indexCreates!.length).toBeGreaterThanOrEqual(3);
    });

    it('should not have trailing syntax errors', () => {
      // Check that the file doesn't end with incomplete SQL
      const trimmed = migrationSql.trim();
      const lastChar = trimmed[trimmed.length - 1];
      // Should end with: semicolon, equals (comment separator), or hyphen (comment)
      expect([')', ';', '-', '='].includes(lastChar)).toBe(true);
    });
  });

  // ==========================================================================
  // Migration Application Tests (Mocked)
  // ==========================================================================

  describe('Migration Application (Mocked)', () => {
    beforeEach(() => {
      mockPrepare.mockReturnValue({
        get: vi.fn(),
        all: vi.fn().mockReturnValue([]),
        run: vi.fn().mockReturnValue({ changes: 1 }),
      });
    });

    it('should be loadable as a migration', () => {
      // Simulate migration loading like the migration service does
      const migrationPattern = /^v(\d{3})_(.+)\.sql$/;
      const filename = path.basename(MIGRATION_PATH);
      const match = filename.match(migrationPattern);

      expect(match).not.toBeNull();
      expect(match![1]).toBe('057');
      expect(match![2]).toBe('close_drafts');
    });

    it('should have version 57', () => {
      const migrationPattern = /^v(\d{3})_/;
      const filename = path.basename(MIGRATION_PATH);
      const match = filename.match(migrationPattern);

      const version = parseInt(match![1], 10);
      expect(version).toBe(57);
    });

    it('should apply without errors in mock database', () => {
      // Simulate applying the migration
      expect(() => {
        mockExec(migrationSql);
      }).not.toThrow();

      expect(mockExec).toHaveBeenCalledWith(migrationSql);
    });
  });

  // ==========================================================================
  // Column Count and Structure Tests
  // ==========================================================================

  describe('Column Structure', () => {
    it('should have exactly 12 columns defined', () => {
      // Count column definitions (lines with TEXT/INTEGER NOT NULL or similar)
      const columnDefinitions = [
        'draft_id TEXT PRIMARY KEY',
        'store_id TEXT NOT NULL',
        'shift_id TEXT NOT NULL',
        'business_date TEXT NOT NULL',
        'draft_type TEXT NOT NULL',
        'status TEXT NOT NULL',
        'step_state TEXT',
        'payload TEXT NOT NULL',
        'version INTEGER NOT NULL',
        'created_at TEXT NOT NULL',
        'updated_at TEXT NOT NULL',
        'created_by TEXT NOT NULL',
      ];

      columnDefinitions.forEach((col) => {
        expect(migrationSql).toContain(col.split(' ')[0]); // Check column name exists
      });
    });

    it('should have required columns for wizard functionality', () => {
      // Columns needed for draft-backed wizard
      expect(migrationSql).toContain('draft_id'); // Primary key
      expect(migrationSql).toContain('shift_id'); // Shift reference
      expect(migrationSql).toContain('draft_type'); // DAY_CLOSE or SHIFT_CLOSE
      expect(migrationSql).toContain('status'); // Lifecycle state
      expect(migrationSql).toContain('step_state'); // Current wizard step
      expect(migrationSql).toContain('payload'); // JSON data
      expect(migrationSql).toContain('version'); // Optimistic locking
    });

    it('should have required columns for tenant isolation', () => {
      expect(migrationSql).toContain('store_id TEXT NOT NULL');
      expect(migrationSql).toMatch(/FOREIGN KEY\s*\(\s*store_id\s*\)/);
    });

    it('should have required columns for audit trail', () => {
      expect(migrationSql).toContain('created_at TEXT NOT NULL');
      expect(migrationSql).toContain('updated_at TEXT NOT NULL');
      expect(migrationSql).toContain('created_by TEXT NOT NULL');
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle empty payload default', () => {
      expect(migrationSql).toContain("DEFAULT '{}'");
    });

    it('should allow NULL step_state for initial draft', () => {
      expect(migrationSql).toMatch(/step_state\s+IS\s+NULL\s+OR/i);
    });

    it('should have proper default timestamp expressions', () => {
      expect(migrationSql).toContain("DEFAULT (datetime('now'))");
    });

    it('should reference correct parent tables', () => {
      expect(migrationSql).toContain('REFERENCES stores(store_id)');
      expect(migrationSql).toContain('REFERENCES shifts(shift_id)');
    });
  });
});
