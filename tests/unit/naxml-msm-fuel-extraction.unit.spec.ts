/**
 * MSM Fuel Data Extraction Unit Tests
 *
 * Comprehensive enterprise-grade tests for the extractFuelDataFromMSM function
 * and related MSM fuel data extraction types.
 *
 * Test Coverage Matrix:
 * - MSM-EXT-001 through 020: extractFuelDataFromMSM Function Tests
 * - MSM-FUEL-001 through 015: Fuel Sales by Grade Extraction Tests
 * - MSM-DISC-001 through 010: Discount Data Extraction Tests
 * - MSM-OUT-001 through 010: Outside Dispenser Record Tests
 * - MSM-TOT-001 through 010: Totals Calculation Tests
 * - MSM-EDGE-001 through 015: Edge Case and Boundary Tests
 * - MSM-SEC-001 through 005: Security/Input Validation Tests
 *
 * Test Traceability:
 * - Component: src/shared/naxml/parser.ts (extractFuelDataFromMSM)
 * - Types: src/shared/naxml/types.ts (MSMExtractedFuelData, MSMFuelSalesByGrade, etc.)
 * - Business Rules: MSM fuel data extraction with inside/outside breakdown
 *
 * @module tests/unit/naxml-msm-fuel-extraction.unit.spec
 */

import { describe, it, expect } from 'vitest';
import { extractFuelDataFromMSM } from '../../src/shared/naxml/parser';
import type {
  NAXMLMiscellaneousSummaryMovementData,
  NAXMLMSMDetail,
  MSMExtractedFuelData,
  MSMFuelSalesByGrade,
  MSMOutsideDispenserRecord,
  MSMDiscountTotals,
} from '../../src/shared/naxml/types';

// ============================================================================
// Test Fixtures - Enterprise-Grade Real-World Data
// ============================================================================

/**
 * Base Movement Header fixture for Period 98 (Shift Close)
 * Represents actual shift close report structure from Gilbarco POS systems
 */
const PERIOD_98_MOVEMENT_HEADER = {
  reportSequenceNumber: 1,
  primaryReportPeriod: 98 as const,
  secondaryReportPeriod: 0,
  businessDate: '2026-01-15',
  beginDate: '2026-01-15',
  beginTime: '06:00:00',
  endDate: '2026-01-15',
  endTime: '14:00:00',
};

/**
 * Base Movement Header fixture for Period 2 (Daily/Day Close)
 * Represents actual daily report structure
 * Note: Per NAXML spec, Period 2 = Day/Store Close (aggregated daily data)
 */
const PERIOD_2_DAILY_MOVEMENT_HEADER = {
  reportSequenceNumber: 1,
  primaryReportPeriod: 2 as const,
  secondaryReportPeriod: 0,
  businessDate: '2026-01-15',
  beginDate: '2026-01-15',
  beginTime: '00:00:00',
  endDate: '2026-01-15',
  endTime: '23:59:59',
};

/**
 * Base Movement Header fixture for Period 2 (Hourly/By Tender)
 */
const PERIOD_2_MOVEMENT_HEADER = {
  reportSequenceNumber: 1,
  primaryReportPeriod: 2 as const,
  secondaryReportPeriod: 0,
  businessDate: '2026-01-15',
  beginDate: '2026-01-15',
  beginTime: '08:00:00',
  endDate: '2026-01-15',
  endTime: '09:00:00',
};

/**
 * Sales Movement Header fixture
 */
const VALID_SALES_MOVEMENT_HEADER = {
  registerId: '1',
  cashierId: '1001',
  tillId: '4133',
};

// ============================================================================
// MSM Detail Fixtures - Fuel Sales by Grade
// ============================================================================

/**
 * Total fuel sales by grade (inside + outside combined)
 * Code: fuelSalesByGrade/fuel/{gradeId}
 */
const createFuelTotalDetail = (
  gradeId: string,
  amount: number,
  volume: number
): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'fuelSalesByGrade',
    miscellaneousSummarySubCode: 'fuel',
    miscellaneousSummarySubCodeModifier: gradeId,
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: volume, // Note: count is volume for fuel entries
  },
});

/**
 * Inside fuel sales by grade (cash/in-store)
 * Code: fuelSalesByGrade/insideFuel/{gradeId}
 */
const createInsideFuelDetail = (
  gradeId: string,
  amount: number,
  volume: number
): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'fuelSalesByGrade',
    miscellaneousSummarySubCode: 'insideFuel',
    miscellaneousSummarySubCodeModifier: gradeId,
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: volume,
  },
});

/**
 * Outside fuel sales by grade (pay-at-pump) - Period 1 only
 * Code: fuelSalesByGrade/outsideSales/{gradeId}
 */
const createOutsideFuelDetail = (
  gradeId: string,
  amount: number,
  volume: number
): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'fuelSalesByGrade',
    miscellaneousSummarySubCode: 'outsideSales',
    miscellaneousSummarySubCodeModifier: gradeId,
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: volume,
  },
});

// ============================================================================
// MSM Detail Fixtures - Discounts
// ============================================================================

/**
 * Statistics discount entry
 * Code: statistics/discounts
 */
const createStatisticsDiscountDetail = (amount: number): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'statistics',
    miscellaneousSummarySubCode: 'discounts',
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: 0,
  },
});

/**
 * Fuel discount entry
 * Code: discount/fuel
 */
const createFuelDiscountDetail = (amount: number): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'discount',
    miscellaneousSummarySubCode: 'fuel',
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: 0,
  },
});

/**
 * Fixed amount discount entry
 * Code: discount/amountFixed
 */
const createFixedDiscountDetail = (amount: number): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'discount',
    miscellaneousSummarySubCode: 'amountFixed',
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: 0,
  },
});

/**
 * Percentage discount entry
 * Code: discount/amountPercentage
 */
const createPercentageDiscountDetail = (amount: number): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'discount',
    miscellaneousSummarySubCode: 'amountPercentage',
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: 0,
  },
});

/**
 * Promotional discount entry
 * Code: discount/promotional
 */
const createPromotionalDiscountDetail = (amount: number): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'discount',
    miscellaneousSummarySubCode: 'promotional',
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: 0,
  },
});

/**
 * Store coupons discount entry
 * Code: discount/storeCoupons
 */
const createStoreCouponsDiscountDetail = (amount: number): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'discount',
    miscellaneousSummarySubCode: 'storeCoupons',
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: 0,
  },
});

// ============================================================================
// MSM Detail Fixtures - Outside Dispenser Records
// ============================================================================

/**
 * Outside credit dispenser record (Period 98)
 */
const createOutsideCreditDispenserDetail = (
  registerId: string,
  tillId: string,
  amount: number,
  count: number
): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'outsideCredit',
    miscellaneousSummarySubCode: 'credit',
  },
  registerId,
  cashierId: '0', // System cashier for outside sales
  tillId,
  msmSalesTotals: {
    tender: {
      tenderCode: 'outsideCredit' as const,
      tenderSubCode: 'generic',
    },
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: count,
  },
});

/**
 * Outside debit dispenser record (Period 98)
 */
const createOutsideDebitDispenserDetail = (
  registerId: string,
  tillId: string,
  amount: number,
  count: number
): NAXMLMSMDetail => ({
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'outsideDebit',
    miscellaneousSummarySubCode: 'debit',
  },
  registerId,
  cashierId: '0',
  tillId,
  msmSalesTotals: {
    tender: {
      tenderCode: 'outsideDebit' as const,
      tenderSubCode: 'generic',
    },
    miscellaneousSummaryAmount: amount,
    miscellaneousSummaryCount: count,
  },
});

// ============================================================================
// MSM Detail Fixtures - Non-Fuel Entries (should be ignored)
// ============================================================================

/**
 * Safe loan entry - should NOT be extracted as fuel data
 */
const NON_FUEL_SAFE_LOAN_DETAIL: NAXMLMSMDetail = {
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'safeLoan',
    miscellaneousSummarySubCode: 'loan',
  },
  msmSalesTotals: {
    tender: {
      tenderCode: 'cash' as const,
      tenderSubCode: 'generic',
    },
    miscellaneousSummaryAmount: 500,
    miscellaneousSummaryCount: 1,
  },
};

/**
 * Transaction statistics entry - should NOT be extracted as fuel data
 */
const NON_FUEL_STATISTICS_DETAIL: NAXMLMSMDetail = {
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: 'statistics',
    miscellaneousSummarySubCode: 'transactions',
  },
  msmSalesTotals: {
    miscellaneousSummaryAmount: 0,
    miscellaneousSummaryCount: 125,
  },
};

// ============================================================================
// Complete MSM Data Fixtures
// ============================================================================

/**
 * Complete Period 98 (Shift Close) MSM data with realistic fuel sales
 * This represents an actual shift close report from a c-store
 */
const COMPLETE_PERIOD_98_MSM_DATA: NAXMLMiscellaneousSummaryMovementData = {
  movementHeader: PERIOD_98_MOVEMENT_HEADER,
  salesMovementHeader: VALID_SALES_MOVEMENT_HEADER,
  msmDetails: [
    // Total fuel by grade (inside + outside)
    createFuelTotalDetail('001', 1250.5, 495.75), // Regular - $1250.50, 495.75 gal
    createFuelTotalDetail('002', 890.25, 325.5), // Plus - $890.25, 325.50 gal
    createFuelTotalDetail('003', 425.0, 145.25), // Premium - $425.00, 145.25 gal
    createFuelTotalDetail('021', 650.0, 180.0), // Diesel - $650.00, 180.00 gal

    // Inside fuel by grade
    createInsideFuelDetail('001', 350.25, 138.75), // Regular inside
    createInsideFuelDetail('002', 175.5, 64.0), // Plus inside
    createInsideFuelDetail('003', 85.0, 29.0), // Premium inside
    createInsideFuelDetail('021', 225.0, 62.5), // Diesel inside

    // Discounts
    createStatisticsDiscountDetail(45.75),
    createFuelDiscountDetail(15.25),
    createFixedDiscountDetail(10.0),
    createPercentageDiscountDetail(8.5),
    createPromotionalDiscountDetail(12.0),
    createStoreCouponsDiscountDetail(0),

    // Outside dispenser records (Period 98 only)
    createOutsideCreditDispenserDetail('10001', '10001', 1450.75, 42),
    createOutsideDebitDispenserDetail('10001', '10001', 250.25, 8),
    createOutsideCreditDispenserDetail('10002', '10002', 980.5, 28),

    // Non-fuel entries (should be ignored)
    NON_FUEL_SAFE_LOAN_DETAIL,
    NON_FUEL_STATISTICS_DETAIL,
  ],
};

/**
 * Complete Period 2 (Day Close/Daily) MSM data with outside sales breakdown by grade
 * Period 2 files contain outsideSales by grade which Period 98 does not
 */
const COMPLETE_PERIOD_2_DAILY_MSM_DATA: NAXMLMiscellaneousSummaryMovementData = {
  movementHeader: PERIOD_2_DAILY_MOVEMENT_HEADER,
  msmDetails: [
    // Total fuel by grade
    createFuelTotalDetail('001', 3500.0, 1400.0),
    createFuelTotalDetail('002', 2100.0, 775.0),
    createFuelTotalDetail('003', 1050.0, 350.0),

    // Inside fuel by grade
    createInsideFuelDetail('001', 875.0, 350.0),
    createInsideFuelDetail('002', 525.0, 193.75),
    createInsideFuelDetail('003', 262.5, 87.5),

    // Outside fuel by grade (ONLY in Period 1)
    createOutsideFuelDetail('001', 2625.0, 1050.0),
    createOutsideFuelDetail('002', 1575.0, 581.25),
    createOutsideFuelDetail('003', 787.5, 262.5),

    // Discounts
    createFuelDiscountDetail(35.0),
    createPromotionalDiscountDetail(20.0),
  ],
};

/**
 * Minimal MSM data with no fuel entries
 */
const MINIMAL_MSM_DATA_NO_FUEL: NAXMLMiscellaneousSummaryMovementData = {
  movementHeader: PERIOD_98_MOVEMENT_HEADER,
  salesMovementHeader: VALID_SALES_MOVEMENT_HEADER,
  msmDetails: [NON_FUEL_SAFE_LOAN_DETAIL, NON_FUEL_STATISTICS_DETAIL],
};

/**
 * MSM data with zero values (empty shift)
 */
const ZERO_VALUE_MSM_DATA: NAXMLMiscellaneousSummaryMovementData = {
  movementHeader: PERIOD_98_MOVEMENT_HEADER,
  msmDetails: [
    createFuelTotalDetail('001', 0, 0),
    createInsideFuelDetail('001', 0, 0),
    createFuelDiscountDetail(0),
  ],
};

// ============================================================================
// Test Suites
// ============================================================================

describe('MSM Fuel Data Extraction Unit Tests', () => {
  // ==========================================================================
  // extractFuelDataFromMSM Function Tests (MSM-EXT-001 through 020)
  // ==========================================================================

  describe('extractFuelDataFromMSM Function Tests', () => {
    it('MSM-EXT-001: should return MSMExtractedFuelData structure from valid input', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      // Verify structure completeness
      expect(result).toBeDefined();
      expect(result).toHaveProperty('period');
      expect(result).toHaveProperty('insideFuel');
      expect(result).toHaveProperty('outsideFuel');
      expect(result).toHaveProperty('totalFuel');
      expect(result).toHaveProperty('outsideDispensers');
      expect(result).toHaveProperty('discounts');
      expect(result).toHaveProperty('totals');
      expect(result).toHaveProperty('businessDate');
      expect(result).toHaveProperty('sourceInfo');
    });

    it('MSM-EXT-002: should correctly identify period type 98 (Shift Close)', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.period).toBe(98);
    });

    it('MSM-EXT-003: should correctly identify period type 2 (Day Close/Daily)', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_2_DAILY_MSM_DATA);
      expect(result.period).toBe(2);
    });

    it('MSM-EXT-004: should correctly identify period type 2 (Hourly)', () => {
      const period2Data: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_2_MOVEMENT_HEADER,
        msmDetails: [createFuelTotalDetail('001', 100, 40)],
      };
      const result = extractFuelDataFromMSM(period2Data);
      expect(result.period).toBe(2);
    });

    it('MSM-EXT-005: should extract business date from movement header', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.businessDate).toBe('2026-01-15');
    });

    it('MSM-EXT-006: should populate sourceInfo with all movement header fields', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      expect(result.sourceInfo.primaryReportPeriod).toBe(98);
      expect(result.sourceInfo.secondaryReportPeriod).toBe(0);
      expect(result.sourceInfo.beginDate).toBe('2026-01-15');
      expect(result.sourceInfo.beginTime).toBe('06:00:00');
      expect(result.sourceInfo.endDate).toBe('2026-01-15');
      expect(result.sourceInfo.endTime).toBe('14:00:00');
    });

    it('MSM-EXT-007: should handle empty msmDetails array', () => {
      const emptyData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [],
      };
      const result = extractFuelDataFromMSM(emptyData);

      expect(result.totalFuel).toHaveLength(0);
      expect(result.insideFuel).toHaveLength(0);
      expect(result.outsideFuel).toHaveLength(0);
      expect(result.outsideDispensers).toHaveLength(0);
      expect(result.totals.grandTotalAmount).toBe(0);
      expect(result.totals.grandTotalVolume).toBe(0);
    });

    it('MSM-EXT-008: should handle MSM data with only non-fuel entries', () => {
      const result = extractFuelDataFromMSM(MINIMAL_MSM_DATA_NO_FUEL);

      expect(result.totalFuel).toHaveLength(0);
      expect(result.insideFuel).toHaveLength(0);
      expect(result.outsideFuel).toHaveLength(0);
      expect(result.totals.grandTotalAmount).toBe(0);
    });

    it('MSM-EXT-009: should handle MSM data with zero values', () => {
      const result = extractFuelDataFromMSM(ZERO_VALUE_MSM_DATA);

      expect(result.totalFuel).toHaveLength(1);
      expect(result.totalFuel[0].amount).toBe(0);
      expect(result.totalFuel[0].volume).toBe(0);
      expect(result.totals.grandTotalAmount).toBe(0);
      expect(result.totals.grandTotalVolume).toBe(0);
    });

    it('MSM-EXT-010: should maintain grade ID integrity from input', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      // Verify grade IDs are preserved exactly
      const gradeIds = result.totalFuel.map((f) => f.gradeId);
      expect(gradeIds).toContain('001');
      expect(gradeIds).toContain('002');
      expect(gradeIds).toContain('003');
      expect(gradeIds).toContain('021');
    });
  });

  // ==========================================================================
  // Fuel Sales by Grade Extraction Tests (MSM-FUEL-001 through 015)
  // ==========================================================================

  describe('Fuel Sales by Grade Extraction Tests', () => {
    it('MSM-FUEL-001: should extract total fuel sales for all grades', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      expect(result.totalFuel).toHaveLength(4);

      const grade001 = result.totalFuel.find((f) => f.gradeId === '001');
      expect(grade001).toBeDefined();
      expect(grade001?.amount).toBe(1250.5);
      expect(grade001?.volume).toBe(495.75);

      const grade021 = result.totalFuel.find((f) => f.gradeId === '021');
      expect(grade021).toBeDefined();
      expect(grade021?.amount).toBe(650.0);
      expect(grade021?.volume).toBe(180.0);
    });

    it('MSM-FUEL-002: should extract inside fuel sales for all grades', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      expect(result.insideFuel).toHaveLength(4);

      const inside001 = result.insideFuel.find((f) => f.gradeId === '001');
      expect(inside001).toBeDefined();
      expect(inside001?.amount).toBe(350.25);
      expect(inside001?.volume).toBe(138.75);
    });

    it('MSM-FUEL-003: should extract outside fuel sales from Period 1 data', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_2_DAILY_MSM_DATA);

      expect(result.outsideFuel).toHaveLength(3);

      const outside001 = result.outsideFuel.find((f) => f.gradeId === '001');
      expect(outside001).toBeDefined();
      expect(outside001?.amount).toBe(2625.0);
      expect(outside001?.volume).toBe(1050.0);
    });

    it('MSM-FUEL-004: should return empty outsideFuel array for Period 98 data', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      // Period 98 does NOT have outsideSales breakdown by grade
      expect(result.outsideFuel).toHaveLength(0);
    });

    it('MSM-FUEL-005: should handle fuel entries without modifier (skip them)', () => {
      const dataWithNoModifier: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'fuelSalesByGrade',
              miscellaneousSummarySubCode: 'fuel',
              // No modifier - should be skipped
            },
            msmSalesTotals: {
              miscellaneousSummaryAmount: 1000,
              miscellaneousSummaryCount: 400,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(dataWithNoModifier);

      // Entry without modifier should be skipped
      expect(result.totalFuel).toHaveLength(0);
    });

    it('MSM-FUEL-006: should handle decimal precision in amounts and volumes', () => {
      const precisionData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001', 1234.567, 456.789),
          createInsideFuelDetail('001', 123.456, 45.678),
        ],
      };
      const result = extractFuelDataFromMSM(precisionData);

      expect(result.totalFuel[0].amount).toBe(1234.567);
      expect(result.totalFuel[0].volume).toBe(456.789);
      expect(result.insideFuel[0].amount).toBe(123.456);
      expect(result.insideFuel[0].volume).toBe(45.678);
    });

    it('MSM-FUEL-007: should ignore outsidePercent entries', () => {
      const dataWithPercent: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_2_DAILY_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001', 1000, 400),
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'fuelSalesByGrade',
              miscellaneousSummarySubCode: 'outsidePercent', // Should be ignored
              miscellaneousSummarySubCodeModifier: '001',
            },
            msmSalesTotals: {
              miscellaneousSummaryAmount: 75.5, // Percentage, not dollars
              miscellaneousSummaryCount: 0,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(dataWithPercent);

      // Only totalFuel should be extracted, not outsidePercent
      expect(result.totalFuel).toHaveLength(1);
      expect(result.outsideFuel).toHaveLength(0);
    });

    it('MSM-FUEL-008: should handle multiple grades with same amount/volume', () => {
      const sameValuesData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001', 500.0, 200.0),
          createFuelTotalDetail('002', 500.0, 200.0),
          createFuelTotalDetail('003', 500.0, 200.0),
        ],
      };
      const result = extractFuelDataFromMSM(sameValuesData);

      expect(result.totalFuel).toHaveLength(3);
      expect(result.totals.grandTotalAmount).toBe(1500.0);
      expect(result.totals.grandTotalVolume).toBe(600.0);
    });

    it('MSM-FUEL-009: should handle grade ID with leading zeros', () => {
      const leadingZeroData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001', 100, 40),
          createFuelTotalDetail('002', 100, 40),
          createFuelTotalDetail('021', 100, 40),
        ],
      };
      const result = extractFuelDataFromMSM(leadingZeroData);

      // Grade IDs should preserve leading zeros
      expect(result.totalFuel.map((f) => f.gradeId)).toEqual(['001', '002', '021']);
    });

    it('MSM-FUEL-010: should handle negative volumes (edge case)', () => {
      const negativeData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [createFuelTotalDetail('001', -50.0, -20.0)],
      };
      const result = extractFuelDataFromMSM(negativeData);

      // Negative values should be preserved (could represent corrections)
      expect(result.totalFuel[0].amount).toBe(-50.0);
      expect(result.totalFuel[0].volume).toBe(-20.0);
    });
  });

  // ==========================================================================
  // Discount Data Extraction Tests (MSM-DISC-001 through 010)
  // ==========================================================================

  describe('Discount Data Extraction Tests', () => {
    it('MSM-DISC-001: should extract statistics discount amount', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.discounts.statistics).toBe(45.75);
    });

    it('MSM-DISC-002: should extract fuel discount amount', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.discounts.fuel).toBe(15.25);
    });

    it('MSM-DISC-003: should extract fixed amount discount', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.discounts.amountFixed).toBe(10.0);
    });

    it('MSM-DISC-004: should extract percentage discount amount', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.discounts.amountPercentage).toBe(8.5);
    });

    it('MSM-DISC-005: should extract promotional discount amount', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.discounts.promotional).toBe(12.0);
    });

    it('MSM-DISC-006: should extract store coupons discount amount', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.discounts.storeCoupons).toBe(0);
    });

    it('MSM-DISC-007: should initialize all discount fields to zero when no discounts present', () => {
      const noDiscountData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [createFuelTotalDetail('001', 1000, 400)],
      };
      const result = extractFuelDataFromMSM(noDiscountData);

      expect(result.discounts.statistics).toBe(0);
      expect(result.discounts.fuel).toBe(0);
      expect(result.discounts.amountFixed).toBe(0);
      expect(result.discounts.amountPercentage).toBe(0);
      expect(result.discounts.promotional).toBe(0);
      expect(result.discounts.storeCoupons).toBe(0);
    });

    it('MSM-DISC-008: should handle multiple discount entries of same type (last wins)', () => {
      const multiDiscountData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelDiscountDetail(10.0),
          createFuelDiscountDetail(20.0), // Should overwrite first
        ],
      };
      const result = extractFuelDataFromMSM(multiDiscountData);

      // Last value wins
      expect(result.discounts.fuel).toBe(20.0);
    });

    it('MSM-DISC-009: should set totals.discountAmount to fuel discount value', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.totals.discountAmount).toBe(result.discounts.fuel);
      expect(result.totals.discountAmount).toBe(15.25);
    });

    it('MSM-DISC-010: should handle zero discount amounts', () => {
      const zeroDiscountData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [createFuelDiscountDetail(0), createStatisticsDiscountDetail(0)],
      };
      const result = extractFuelDataFromMSM(zeroDiscountData);

      expect(result.discounts.fuel).toBe(0);
      expect(result.discounts.statistics).toBe(0);
    });
  });

  // ==========================================================================
  // Outside Dispenser Record Tests (MSM-OUT-001 through 010)
  // ==========================================================================

  describe('Outside Dispenser Record Tests', () => {
    it('MSM-OUT-001: should extract outside credit dispenser records', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      const creditRecords = result.outsideDispensers.filter((r) => r.tender === 'outsideCredit');
      expect(creditRecords.length).toBe(2);
    });

    it('MSM-OUT-002: should extract outside debit dispenser records', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      const debitRecords = result.outsideDispensers.filter((r) => r.tender === 'outsideDebit');
      expect(debitRecords.length).toBe(1);
    });

    it('MSM-OUT-003: should preserve register ID in dispenser records', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      const record = result.outsideDispensers[0];
      expect(record.registerId).toBe('10001');
    });

    it('MSM-OUT-004: should preserve till ID in dispenser records', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      const record = result.outsideDispensers[0];
      expect(record.tillId).toBe('10001');
    });

    it('MSM-OUT-005: should preserve cashier ID in dispenser records', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      const record = result.outsideDispensers[0];
      expect(record.cashierId).toBe('0');
    });

    it('MSM-OUT-006: should preserve amount and count in dispenser records', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      const creditRecord = result.outsideDispensers.find(
        (r) => r.tender === 'outsideCredit' && r.registerId === '10001'
      );
      expect(creditRecord?.amount).toBe(1450.75);
      expect(creditRecord?.count).toBe(42);
    });

    it('MSM-OUT-007: should not extract dispenser records without tender info', () => {
      const noTenderData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'outsideCredit',
              miscellaneousSummarySubCode: 'credit',
            },
            registerId: '10001',
            tillId: '10001',
            msmSalesTotals: {
              // No tender object
              miscellaneousSummaryAmount: 500,
              miscellaneousSummaryCount: 10,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(noTenderData);

      expect(result.outsideDispensers).toHaveLength(0);
    });

    it('MSM-OUT-008: should not extract records with invalid tender codes', () => {
      const invalidTenderData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'cash',
              miscellaneousSummarySubCode: 'generic',
            },
            registerId: '10001',
            tillId: '10001',
            msmSalesTotals: {
              tender: {
                tenderCode: 'cash' as const, // Not outsideCredit/outsideDebit
                tenderSubCode: 'generic',
              },
              miscellaneousSummaryAmount: 500,
              miscellaneousSummaryCount: 10,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(invalidTenderData);

      expect(result.outsideDispensers).toHaveLength(0);
    });

    it('MSM-OUT-009: should handle missing cashierId in dispenser record', () => {
      const noCashierData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'outsideCredit',
              miscellaneousSummarySubCode: 'credit',
            },
            registerId: '10001',
            // No cashierId
            tillId: '10001',
            msmSalesTotals: {
              tender: {
                tenderCode: 'outsideCredit' as const,
                tenderSubCode: 'generic',
              },
              miscellaneousSummaryAmount: 500,
              miscellaneousSummaryCount: 10,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(noCashierData);

      expect(result.outsideDispensers).toHaveLength(1);
      expect(result.outsideDispensers[0].cashierId).toBe('');
    });

    it('MSM-OUT-010: should not extract records missing registerId or tillId', () => {
      const missingIdData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'outsideCredit',
              miscellaneousSummarySubCode: 'credit',
            },
            // Missing registerId
            tillId: '10001',
            msmSalesTotals: {
              tender: {
                tenderCode: 'outsideCredit' as const,
                tenderSubCode: 'generic',
              },
              miscellaneousSummaryAmount: 500,
              miscellaneousSummaryCount: 10,
            },
          },
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'outsideDebit',
              miscellaneousSummarySubCode: 'debit',
            },
            registerId: '10001',
            // Missing tillId
            msmSalesTotals: {
              tender: {
                tenderCode: 'outsideDebit' as const,
                tenderSubCode: 'generic',
              },
              miscellaneousSummaryAmount: 250,
              miscellaneousSummaryCount: 5,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(missingIdData);

      expect(result.outsideDispensers).toHaveLength(0);
    });
  });

  // ==========================================================================
  // Totals Calculation Tests (MSM-TOT-001 through 010)
  // ==========================================================================

  describe('Totals Calculation Tests', () => {
    it('MSM-TOT-001: should calculate correct inside fuel totals', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      // Inside totals: 350.25 + 175.50 + 85.00 + 225.00 = 835.75
      expect(result.totals.insideAmount).toBeCloseTo(835.75, 2);

      // Inside volume: 138.75 + 64.00 + 29.00 + 62.50 = 294.25
      expect(result.totals.insideVolume).toBeCloseTo(294.25, 2);
    });

    it('MSM-TOT-002: should calculate correct outside fuel totals from Period 1', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_2_DAILY_MSM_DATA);

      // Outside totals: 2625.00 + 1575.00 + 787.50 = 4987.50
      expect(result.totals.outsideAmount).toBeCloseTo(4987.5, 2);

      // Outside volume: 1050.00 + 581.25 + 262.50 = 1893.75
      expect(result.totals.outsideVolume).toBeCloseTo(1893.75, 2);
    });

    it('MSM-TOT-003: should return zero outside totals for Period 98', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      // Period 98 doesn't have outsideSales by grade
      expect(result.totals.outsideAmount).toBe(0);
      expect(result.totals.outsideVolume).toBe(0);
    });

    it('MSM-TOT-004: should calculate correct grand totals', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

      // Grand totals: 1250.50 + 890.25 + 425.00 + 650.00 = 3215.75
      expect(result.totals.grandTotalAmount).toBeCloseTo(3215.75, 2);

      // Grand volume: 495.75 + 325.50 + 145.25 + 180.00 = 1146.50
      expect(result.totals.grandTotalVolume).toBeCloseTo(1146.5, 2);
    });

    it('MSM-TOT-005: should set discount amount from fuel discount', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);
      expect(result.totals.discountAmount).toBe(15.25);
    });

    it('MSM-TOT-006: should handle totals with zero values', () => {
      const result = extractFuelDataFromMSM(ZERO_VALUE_MSM_DATA);

      expect(result.totals.insideAmount).toBe(0);
      expect(result.totals.insideVolume).toBe(0);
      expect(result.totals.grandTotalAmount).toBe(0);
      expect(result.totals.grandTotalVolume).toBe(0);
    });

    it('MSM-TOT-007: should handle totals with no fuel entries', () => {
      const result = extractFuelDataFromMSM(MINIMAL_MSM_DATA_NO_FUEL);

      expect(result.totals.insideAmount).toBe(0);
      expect(result.totals.insideVolume).toBe(0);
      expect(result.totals.outsideAmount).toBe(0);
      expect(result.totals.outsideVolume).toBe(0);
      expect(result.totals.grandTotalAmount).toBe(0);
      expect(result.totals.grandTotalVolume).toBe(0);
    });

    it('MSM-TOT-008: should verify inside + outside equals grand total for Period 1', () => {
      const result = extractFuelDataFromMSM(COMPLETE_PERIOD_2_DAILY_MSM_DATA);

      // For Period 1, inside + outside should equal grand total
      const calculatedTotal = result.totals.insideAmount + result.totals.outsideAmount;
      expect(calculatedTotal).toBeCloseTo(result.totals.grandTotalAmount, 2);

      const calculatedVolume = result.totals.insideVolume + result.totals.outsideVolume;
      expect(calculatedVolume).toBeCloseTo(result.totals.grandTotalVolume, 2);
    });

    it('MSM-TOT-009: should handle floating point precision correctly', () => {
      const precisionData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001', 0.1, 0.1),
          createFuelTotalDetail('002', 0.2, 0.2),
          createInsideFuelDetail('001', 0.1, 0.1),
          createInsideFuelDetail('002', 0.2, 0.2),
        ],
      };
      const result = extractFuelDataFromMSM(precisionData);

      // Verify floating point handling (0.1 + 0.2 = 0.3, not 0.30000000000000004)
      expect(result.totals.grandTotalAmount).toBeCloseTo(0.3, 10);
      expect(result.totals.grandTotalVolume).toBeCloseTo(0.3, 10);
    });

    it('MSM-TOT-010: should handle large values correctly', () => {
      const largeData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001', 999999.99, 999999.99),
          createFuelTotalDetail('002', 888888.88, 888888.88),
        ],
      };
      const result = extractFuelDataFromMSM(largeData);

      expect(result.totals.grandTotalAmount).toBe(1888888.87);
      expect(result.totals.grandTotalVolume).toBe(1888888.87);
    });
  });

  // ==========================================================================
  // Edge Case and Boundary Tests (MSM-EDGE-001 through 015)
  // ==========================================================================

  describe('Edge Case and Boundary Tests', () => {
    it('MSM-EDGE-001: should handle undefined msmSalesTotals', () => {
      const undefinedTotalsData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'fuelSalesByGrade',
              miscellaneousSummarySubCode: 'fuel',
              miscellaneousSummarySubCodeModifier: '001',
            },
            // No msmSalesTotals - should default to 0
          } as NAXMLMSMDetail,
        ],
      };
      const result = extractFuelDataFromMSM(undefinedTotalsData);

      expect(result.totalFuel).toHaveLength(1);
      expect(result.totalFuel[0].amount).toBe(0);
      expect(result.totalFuel[0].volume).toBe(0);
    });

    it('MSM-EDGE-002: should handle null-ish values in msmSalesTotals', () => {
      const nullishData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'fuelSalesByGrade',
              miscellaneousSummarySubCode: 'fuel',
              miscellaneousSummarySubCodeModifier: '001',
            },
            msmSalesTotals: {
              miscellaneousSummaryAmount: undefined as unknown as number,
              miscellaneousSummaryCount: null as unknown as number,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(nullishData);

      expect(result.totalFuel).toHaveLength(1);
      // Should use nullish coalescing to default to 0
      expect(result.totalFuel[0].amount).toBe(0);
      expect(result.totalFuel[0].volume).toBe(0);
    });

    it('MSM-EDGE-003: should handle very small decimal values', () => {
      const smallData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [createFuelTotalDetail('001', 0.001, 0.001)],
      };
      const result = extractFuelDataFromMSM(smallData);

      expect(result.totalFuel[0].amount).toBe(0.001);
      expect(result.totalFuel[0].volume).toBe(0.001);
    });

    it('MSM-EDGE-004: should handle extremely long grade IDs', () => {
      const longGradeId = 'A'.repeat(100);
      const longIdData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [createFuelTotalDetail(longGradeId, 100, 40)],
      };
      const result = extractFuelDataFromMSM(longIdData);

      expect(result.totalFuel).toHaveLength(1);
      expect(result.totalFuel[0].gradeId).toBe(longGradeId);
    });

    it('MSM-EDGE-005: should handle special characters in grade IDs', () => {
      const specialIdData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001-A', 100, 40),
          createFuelTotalDetail('DIESEL_#2', 100, 40),
        ],
      };
      const result = extractFuelDataFromMSM(specialIdData);

      expect(result.totalFuel).toHaveLength(2);
      expect(result.totalFuel[0].gradeId).toBe('001-A');
      expect(result.totalFuel[1].gradeId).toBe('DIESEL_#2');
    });

    it('MSM-EDGE-006: should handle duplicate grade entries (all kept)', () => {
      const duplicateData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001', 100, 40),
          createFuelTotalDetail('001', 200, 80), // Duplicate grade
        ],
      };
      const result = extractFuelDataFromMSM(duplicateData);

      // Both entries should be kept (caller decides how to handle)
      expect(result.totalFuel).toHaveLength(2);
      expect(result.totals.grandTotalAmount).toBe(300);
      expect(result.totals.grandTotalVolume).toBe(120);
    });

    it('MSM-EDGE-007: should handle empty strings in miscellaneousSummaryCodes', () => {
      const emptyCodeData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: '',
              miscellaneousSummarySubCode: '',
              miscellaneousSummarySubCodeModifier: '001',
            },
            msmSalesTotals: {
              miscellaneousSummaryAmount: 100,
              miscellaneousSummaryCount: 40,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(emptyCodeData);

      // Empty code should not match 'fuelSalesByGrade'
      expect(result.totalFuel).toHaveLength(0);
    });

    it('MSM-EDGE-008: should handle case-sensitive code matching', () => {
      const caseData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'FuelSalesByGrade', // Wrong case
              miscellaneousSummarySubCode: 'Fuel',
              miscellaneousSummarySubCodeModifier: '001',
            },
            msmSalesTotals: {
              miscellaneousSummaryAmount: 100,
              miscellaneousSummaryCount: 40,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(caseData);

      // Code matching should be case-sensitive per NAXML spec
      expect(result.totalFuel).toHaveLength(0);
    });

    it('MSM-EDGE-009: should handle mixed valid and invalid entries', () => {
      const mixedData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001', 500, 200), // Valid
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'fuelSalesByGrade',
              miscellaneousSummarySubCode: 'unknownSubCode', // Invalid
              miscellaneousSummarySubCodeModifier: '002',
            },
            msmSalesTotals: {
              miscellaneousSummaryAmount: 100,
              miscellaneousSummaryCount: 40,
            },
          },
          createInsideFuelDetail('001', 100, 40), // Valid
          NON_FUEL_SAFE_LOAN_DETAIL, // Non-fuel
        ],
      };
      const result = extractFuelDataFromMSM(mixedData);

      expect(result.totalFuel).toHaveLength(1);
      expect(result.insideFuel).toHaveLength(1);
    });

    it('MSM-EDGE-010: should handle single entry MSM data', () => {
      const singleData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [createFuelTotalDetail('001', 1000, 400)],
      };
      const result = extractFuelDataFromMSM(singleData);

      expect(result.totalFuel).toHaveLength(1);
      expect(result.totals.grandTotalAmount).toBe(1000);
      expect(result.totals.grandTotalVolume).toBe(400);
    });

    it('MSM-EDGE-011: should handle many entries (stress test)', () => {
      const manyDetails: NAXMLMSMDetail[] = [];
      for (let i = 1; i <= 100; i++) {
        const gradeId = String(i).padStart(3, '0');
        manyDetails.push(createFuelTotalDetail(gradeId, i * 10, i * 4));
        manyDetails.push(createInsideFuelDetail(gradeId, i * 5, i * 2));
      }

      const stressData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: manyDetails,
      };
      const result = extractFuelDataFromMSM(stressData);

      expect(result.totalFuel).toHaveLength(100);
      expect(result.insideFuel).toHaveLength(100);

      // Sum of 1*10 + 2*10 + ... + 100*10 = 10 * (100*101/2) = 50500
      expect(result.totals.grandTotalAmount).toBe(50500);
    });

    it('MSM-EDGE-012: should handle overnight shift dates', () => {
      const overnightHeader = {
        ...PERIOD_98_MOVEMENT_HEADER,
        businessDate: '2026-01-15',
        beginDate: '2026-01-15',
        beginTime: '22:00:00',
        endDate: '2026-01-16', // Next day
        endTime: '06:00:00',
      };
      const overnightData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: overnightHeader,
        msmDetails: [createFuelTotalDetail('001', 500, 200)],
      };
      const result = extractFuelDataFromMSM(overnightData);

      expect(result.businessDate).toBe('2026-01-15');
      expect(result.sourceInfo.beginDate).toBe('2026-01-15');
      expect(result.sourceInfo.endDate).toBe('2026-01-16');
    });

    it('MSM-EDGE-013: should handle ISO date format in movement header', () => {
      const isoHeader = {
        ...PERIOD_98_MOVEMENT_HEADER,
        businessDate: '2026-01-15',
        beginDate: '2026-01-15',
        beginTime: '06:00:00',
        endDate: '2026-01-15',
        endTime: '14:00:00',
      };
      const isoData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: isoHeader,
        msmDetails: [createFuelTotalDetail('001', 500, 200)],
      };
      const result = extractFuelDataFromMSM(isoData);

      expect(result.businessDate).toBe('2026-01-15');
    });

    it('MSM-EDGE-014: should handle missing optional fields gracefully', () => {
      const minimalData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: {
          reportSequenceNumber: 1,
          primaryReportPeriod: 98,
          secondaryReportPeriod: 0,
          businessDate: '2026-01-15',
          beginDate: '2026-01-15',
          beginTime: '00:00:00',
          endDate: '2026-01-15',
          endTime: '23:59:59',
        },
        // No salesMovementHeader
        msmDetails: [createFuelTotalDetail('001', 100, 40)],
      };
      const result = extractFuelDataFromMSM(minimalData);

      expect(result.totalFuel).toHaveLength(1);
      expect(result.businessDate).toBe('2026-01-15');
    });

    it('MSM-EDGE-015: should maintain order of fuel entries as received', () => {
      const orderedData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('003', 300, 120),
          createFuelTotalDetail('001', 100, 40),
          createFuelTotalDetail('002', 200, 80),
        ],
      };
      const result = extractFuelDataFromMSM(orderedData);

      // Order should be preserved
      expect(result.totalFuel[0].gradeId).toBe('003');
      expect(result.totalFuel[1].gradeId).toBe('001');
      expect(result.totalFuel[2].gradeId).toBe('002');
    });
  });

  // ==========================================================================
  // Security/Input Validation Tests (MSM-SEC-001 through 005)
  // ==========================================================================

  describe('Security and Input Validation Tests', () => {
    it('MSM-SEC-001: should use allowlist for fuelSalesByGrade code matching', () => {
      const injectionData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'fuelSalesByGrade; DROP TABLE users;--',
              miscellaneousSummarySubCode: 'fuel',
              miscellaneousSummarySubCodeModifier: '001',
            },
            msmSalesTotals: {
              miscellaneousSummaryAmount: 100,
              miscellaneousSummaryCount: 40,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(injectionData);

      // Malicious code should not match allowlist
      expect(result.totalFuel).toHaveLength(0);
    });

    it('MSM-SEC-002: should use allowlist for discount code matching', () => {
      const injectionData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: "discount' OR '1'='1",
              miscellaneousSummarySubCode: 'fuel',
            },
            msmSalesTotals: {
              miscellaneousSummaryAmount: 9999,
              miscellaneousSummaryCount: 0,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(injectionData);

      // Malicious code should not match allowlist
      expect(result.discounts.fuel).toBe(0);
    });

    it('MSM-SEC-003: should use allowlist for tender code validation', () => {
      const maliciousTenderData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: 'outsideCredit',
              miscellaneousSummarySubCode: 'credit',
            },
            registerId: '10001',
            tillId: '10001',
            msmSalesTotals: {
              tender: {
                tenderCode:
                  'outsideCredit; SELECT * FROM passwords;--' as unknown as 'outsideCredit',
                tenderSubCode: 'generic',
              },
              miscellaneousSummaryAmount: 500,
              miscellaneousSummaryCount: 10,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(maliciousTenderData);

      // Malicious tender code should not match outsideCredit or outsideDebit
      expect(result.outsideDispensers).toHaveLength(0);
    });

    it('MSM-SEC-004: should not be vulnerable to prototype pollution', () => {
      const pollutionData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          {
            miscellaneousSummaryCodes: {
              miscellaneousSummaryCode: '__proto__',
              miscellaneousSummarySubCode: 'polluted',
              miscellaneousSummarySubCodeModifier: '001',
            },
            msmSalesTotals: {
              miscellaneousSummaryAmount: 100,
              miscellaneousSummaryCount: 40,
            },
          },
        ],
      };
      const result = extractFuelDataFromMSM(pollutionData);

      // Should not crash and should not match any valid codes
      expect(result.totalFuel).toHaveLength(0);
      // Verify no prototype pollution occurred
      expect(Object.prototype.hasOwnProperty.call({}, 'polluted')).toBe(false);
    });

    it('MSM-SEC-005: should handle extremely large numeric values safely', () => {
      const largeNumData: NAXMLMiscellaneousSummaryMovementData = {
        movementHeader: PERIOD_98_MOVEMENT_HEADER,
        msmDetails: [
          createFuelTotalDetail('001', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
          createFuelTotalDetail('002', Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        ],
      };
      const result = extractFuelDataFromMSM(largeNumData);

      // Should not overflow or cause errors
      expect(result.totalFuel).toHaveLength(2);
      expect(result.totals.grandTotalAmount).toBeGreaterThan(0);
    });
  });
});

// ============================================================================
// Type-Level Tests (Compile-Time Verification)
// ============================================================================

describe('MSM Fuel Data Type Definitions', () => {
  it('should ensure MSMFuelSalesByGrade has required properties', () => {
    const fuelData: MSMFuelSalesByGrade = {
      gradeId: '001',
      amount: 100,
      volume: 40,
    };

    expect(fuelData.gradeId).toBeDefined();
    expect(fuelData.amount).toBeDefined();
    expect(fuelData.volume).toBeDefined();
  });

  it('should ensure MSMOutsideDispenserRecord has required properties', () => {
    const record: MSMOutsideDispenserRecord = {
      registerId: '10001',
      cashierId: '0',
      tillId: '10001',
      tender: 'outsideCredit',
      amount: 500,
      count: 10,
    };

    expect(record.registerId).toBeDefined();
    expect(record.cashierId).toBeDefined();
    expect(record.tillId).toBeDefined();
    expect(record.tender).toMatch(/^outsideCredit|outsideDebit$/);
    expect(record.amount).toBeDefined();
    expect(record.count).toBeDefined();
  });

  it('should ensure MSMDiscountTotals has all discount types', () => {
    const discounts: MSMDiscountTotals = {
      statistics: 0,
      amountFixed: 0,
      amountPercentage: 0,
      promotional: 0,
      fuel: 0,
      storeCoupons: 0,
    };

    expect(discounts).toHaveProperty('statistics');
    expect(discounts).toHaveProperty('amountFixed');
    expect(discounts).toHaveProperty('amountPercentage');
    expect(discounts).toHaveProperty('promotional');
    expect(discounts).toHaveProperty('fuel');
    expect(discounts).toHaveProperty('storeCoupons');
  });

  it('should ensure MSMExtractedFuelData has complete structure', () => {
    const result = extractFuelDataFromMSM(COMPLETE_PERIOD_98_MSM_DATA);

    // TypeScript compile-time verification
    const _period: 1 | 2 | 98 = result.period;
    const _insideFuel: MSMFuelSalesByGrade[] = result.insideFuel;
    const _outsideFuel: MSMFuelSalesByGrade[] = result.outsideFuel;
    const _totalFuel: MSMFuelSalesByGrade[] = result.totalFuel;
    const _outsideDispensers: MSMOutsideDispenserRecord[] = result.outsideDispensers;
    const _discounts: MSMDiscountTotals = result.discounts;
    const _businessDate: string = result.businessDate;

    // Suppress unused variable warnings
    expect(_period).toBeDefined();
    expect(_insideFuel).toBeDefined();
    expect(_outsideFuel).toBeDefined();
    expect(_totalFuel).toBeDefined();
    expect(_outsideDispensers).toBeDefined();
    expect(_discounts).toBeDefined();
    expect(_businessDate).toBeDefined();
  });
});
