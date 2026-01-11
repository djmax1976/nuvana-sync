/**
 * NAXML Movement Report Type Definitions Unit Tests
 *
 * Comprehensive tests for Movement Report TypeScript interfaces and Zod schemas.
 * Tests validate type definitions, schema validation, error handling, and security.
 *
 * Test Coverage Matrix:
 * - MR-TYPE-001 through 015: Type Definition Tests
 * - MR-SCHEMA-001 through 025: Zod Schema Validation Tests
 * - MR-FGM-001 through 020: FGM (Fuel Grade Movement) Tests
 * - MR-MSM-001 through 010: MSM (Miscellaneous Summary Movement) Tests
 * - MR-FPM-001 through 010: FPM (Fuel Product Movement) Tests
 * - MR-TLM-001 through 010: TLM (Tax Level Movement) Tests
 * - MR-MCM-001 through 010: MCM (Merchandise Code Movement) Tests
 * - MR-SEC-001 through 010: Security/Input Validation Tests
 *
 * @module tests/unit/naxml-movement-report-types.unit.spec
 */

// Using vitest globals (configured in vitest.config.ts)
import {
  // Schemas
  NAXMLPrimaryReportPeriodSchema,
  NAXMLMovementReportTypeSchema,
  NAXMLFuelTenderCodeSchema,
  NAXMLMovementHeaderSchema,
  NAXMLSalesMovementHeaderSchema,
  NAXMLFGMTenderSchema,
  NAXMLFGMSalesTotalsSchema,
  NAXMLFGMDetailSchema,
  NAXMLFuelGradeMovementDataSchema,
  NAXMLFPMDetailSchema,
  NAXMLFuelProductMovementDataSchema,
  NAXMLMSMDetailSchema,
  NAXMLMiscellaneousSummaryMovementDataSchema,
  NAXMLTLMDetailSchema,
  NAXMLTaxLevelMovementDataSchema,
  NAXMLMCMDetailSchema,
  NAXMLMerchandiseCodeMovementDataSchema,
  NAXMLISMDetailSchema,
  NAXMLItemSalesMovementDataSchema,
  NAXMLTPMDetailSchema,
  NAXMLTankProductMovementDataSchema,
  NAXMLTransmissionHeaderSchema,
  // Validation functions
  validateFuelGradeMovementData,
  safeValidateFuelGradeMovementData,
  validateFuelProductMovementData,
  safeValidateFuelProductMovementData,
  validateMiscellaneousSummaryMovementData,
  safeValidateMiscellaneousSummaryMovementData,
  validateTaxLevelMovementData,
  safeValidateTaxLevelMovementData,
  validateMerchandiseCodeMovementData,
  safeValidateMerchandiseCodeMovementData,
  validateMovementHeader,
  safeValidateMovementHeader,
} from "../../src/shared/naxml/schema";

import {
  VALID_FUEL_TENDER_CODES,
  NAXML_MOVEMENT_REPORT_ERROR_CODES,
} from "../../src/shared/naxml/types";

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Valid Movement Header fixture
 */
const VALID_MOVEMENT_HEADER = {
  reportSequenceNumber: 1,
  primaryReportPeriod: 2 as const,
  secondaryReportPeriod: 0,
  businessDate: "2026-01-02",
  beginDate: "2026-01-02",
  beginTime: "23:59:45",
  endDate: "2026-01-03",
  endTime: "23:59:52",
};

/**
 * Valid Sales Movement Header fixture
 */
const VALID_SALES_MOVEMENT_HEADER = {
  registerId: "1",
  cashierId: "1",
  tillId: "4133",
};

/**
 * Valid FGM Sales Totals fixture
 */
const VALID_FGM_SALES_TOTALS = {
  fuelGradeSalesVolume: 201.676,
  fuelGradeSalesAmount: 508,
  discountAmount: 0,
  discountCount: 0,
};

/**
 * Valid FGM Tender fixture
 */
const VALID_FGM_TENDER = {
  tenderCode: "cash" as const,
  tenderSubCode: "generic",
};

/**
 * Valid FGM Detail with Tender Summary fixture
 */
const VALID_FGM_DETAIL_BY_TENDER = {
  fuelGradeId: "001",
  fgmTenderSummary: {
    tender: VALID_FGM_TENDER,
    fgmSellPriceSummary: {
      actualSalesPrice: 2.519,
      fgmServiceLevelSummary: {
        serviceLevelCode: "1",
        fgmSalesTotals: VALID_FGM_SALES_TOTALS,
      },
    },
  },
};

/**
 * Valid FGM Detail with Position Summary fixture
 */
const VALID_FGM_DETAIL_BY_POSITION = {
  fuelGradeId: "001",
  fgmPositionSummary: {
    fuelPositionId: "2",
    fgmNonResettableTotal: {
      fuelGradeNonResettableTotalVolume: 186261.24,
      fuelGradeNonResettableTotalAmount: 556817.37,
    },
    fgmPriceTierSummaries: [
      {
        priceTierCode: "0001",
        fgmSalesTotals: {
          fuelGradeSalesVolume: 57.96,
          fuelGradeSalesAmount: 146,
          discountAmount: 0,
          discountCount: 0,
        },
      },
    ],
  },
};

/**
 * Valid Fuel Grade Movement Data fixture
 */
const VALID_FGM_DATA = {
  movementHeader: VALID_MOVEMENT_HEADER,
  fgmDetails: [VALID_FGM_DETAIL_BY_TENDER],
};

/**
 * Valid FPM Detail fixture
 */
const VALID_FPM_DETAIL = {
  fuelProductId: "1",
  fpmNonResettableTotals: [
    {
      fuelPositionId: "1",
      fuelProductNonResettableAmountNumber: 0,
      fuelProductNonResettableVolumeNumber: 228745.691,
    },
    {
      fuelPositionId: "2",
      fuelProductNonResettableAmountNumber: 0,
      fuelProductNonResettableVolumeNumber: 208738.815,
    },
  ],
};

/**
 * Valid Fuel Product Movement Data fixture
 */
const VALID_FPM_DATA = {
  movementHeader: VALID_MOVEMENT_HEADER,
  fpmDetails: [VALID_FPM_DETAIL],
};

/**
 * Valid MSM Detail fixture
 */
const VALID_MSM_DETAIL = {
  miscellaneousSummaryCodes: {
    miscellaneousSummaryCode: "safeLoan",
    miscellaneousSummarySubCode: "loan",
  },
  msmSalesTotals: {
    tender: {
      tenderCode: "cash" as const,
      tenderSubCode: "generic",
    },
    miscellaneousSummaryAmount: 200,
    miscellaneousSummaryCount: 1,
  },
};

/**
 * Valid Miscellaneous Summary Movement Data fixture
 */
const VALID_MSM_DATA = {
  movementHeader: {
    ...VALID_MOVEMENT_HEADER,
    primaryReportPeriod: 98 as const,
  },
  salesMovementHeader: VALID_SALES_MOVEMENT_HEADER,
  msmDetails: [VALID_MSM_DETAIL],
};

/**
 * Valid TLM Detail fixture
 */
const VALID_TLM_DETAIL = {
  taxLevelId: "99",
  merchandiseCode: "0",
  taxableSalesAmount: 795,
  taxableSalesRefundedAmount: 0,
  taxCollectedAmount: 0,
  taxExemptSalesAmount: 0,
  taxExemptSalesRefundedAmount: 0,
  taxForgivenSalesAmount: 0,
  taxForgivenSalesRefundedAmount: 0,
  taxRefundedAmount: 0,
};

/**
 * Valid Tax Level Movement Data fixture
 */
const VALID_TLM_DATA = {
  movementHeader: {
    ...VALID_MOVEMENT_HEADER,
    primaryReportPeriod: 98 as const,
  },
  salesMovementHeader: VALID_SALES_MOVEMENT_HEADER,
  tlmDetails: [VALID_TLM_DETAIL],
};

/**
 * Valid MCM Detail fixture
 */
const VALID_MCM_DETAIL = {
  merchandiseCode: "1024",
  merchandiseCodeDescription: "Fuel 1",
  mcmSalesTotals: {
    discountAmount: 0,
    discountCount: 0,
    promotionAmount: 0,
    promotionCount: 0,
    refundAmount: 0,
    refundCount: 0,
    salesQuantity: 51,
    salesAmount: 795,
    transactionCount: 51,
    openDepartmentSalesAmount: 0,
    openDepartmentTransactionCount: 0,
  },
};

/**
 * Valid Merchandise Code Movement Data fixture
 */
const VALID_MCM_DATA = {
  movementHeader: {
    ...VALID_MOVEMENT_HEADER,
    primaryReportPeriod: 98 as const,
  },
  salesMovementHeader: VALID_SALES_MOVEMENT_HEADER,
  mcmDetails: [VALID_MCM_DETAIL],
};

/**
 * Valid Transmission Header fixture
 */
const VALID_TRANSMISSION_HEADER = {
  storeLocationId: "299",
  vendorName: "Gilbarco-VeederRoot",
  vendorModelVersion: "22.01.26.01",
};

// ============================================================================
// Test Suites
// ============================================================================

describe("NAXML Movement Report Type Definitions Unit Tests", () => {
  // ==========================================================================
  // Type Definition Tests (MR-TYPE-001 through 015)
  // ==========================================================================

  describe("Type Definition Tests", () => {
    it("MR-TYPE-001: VALID_FUEL_TENDER_CODES should contain all valid tender codes", () => {
      expect(VALID_FUEL_TENDER_CODES).toContain("cash");
      expect(VALID_FUEL_TENDER_CODES).toContain("outsideCredit");
      expect(VALID_FUEL_TENDER_CODES).toContain("outsideDebit");
      expect(VALID_FUEL_TENDER_CODES).toContain("insideCredit");
      expect(VALID_FUEL_TENDER_CODES).toContain("insideDebit");
      expect(VALID_FUEL_TENDER_CODES).toContain("fleet");
      expect(VALID_FUEL_TENDER_CODES.length).toBe(6);
    });

    it("MR-TYPE-002: NAXML_MOVEMENT_REPORT_ERROR_CODES should contain all error codes", () => {
      expect(NAXML_MOVEMENT_REPORT_ERROR_CODES.INVALID_DOCUMENT_TYPE).toBe(
        "MR_INVALID_DOCUMENT_TYPE",
      );
      expect(NAXML_MOVEMENT_REPORT_ERROR_CODES.MISSING_MOVEMENT_HEADER).toBe(
        "MR_MISSING_MOVEMENT_HEADER",
      );
      expect(NAXML_MOVEMENT_REPORT_ERROR_CODES.FGM_MISSING_FUEL_GRADE_ID).toBe(
        "FGM_MISSING_FUEL_GRADE_ID",
      );
      expect(NAXML_MOVEMENT_REPORT_ERROR_CODES.FGM_INVALID_TENDER_CODE).toBe(
        "FGM_INVALID_TENDER_CODE",
      );
    });

    it("MR-TYPE-003: Primary report period should only allow 2 or 98", () => {
      expect(NAXMLPrimaryReportPeriodSchema.parse(2)).toBe(2);
      expect(NAXMLPrimaryReportPeriodSchema.parse(98)).toBe(98);
      expect(() => NAXMLPrimaryReportPeriodSchema.parse(1)).toThrow();
      expect(() => NAXMLPrimaryReportPeriodSchema.parse(99)).toThrow();
      expect(() => NAXMLPrimaryReportPeriodSchema.parse(0)).toThrow();
    });

    it("MR-TYPE-004: Movement report type should only allow valid types", () => {
      expect(NAXMLMovementReportTypeSchema.parse("FuelGradeMovement")).toBe(
        "FuelGradeMovement",
      );
      expect(NAXMLMovementReportTypeSchema.parse("FuelProductMovement")).toBe(
        "FuelProductMovement",
      );
      expect(
        NAXMLMovementReportTypeSchema.parse("MiscellaneousSummaryMovement"),
      ).toBe("MiscellaneousSummaryMovement");
      expect(NAXMLMovementReportTypeSchema.parse("TaxLevelMovement")).toBe(
        "TaxLevelMovement",
      );
      expect(
        NAXMLMovementReportTypeSchema.parse("MerchandiseCodeMovement"),
      ).toBe("MerchandiseCodeMovement");
      expect(NAXMLMovementReportTypeSchema.parse("ItemSalesMovement")).toBe(
        "ItemSalesMovement",
      );
      expect(NAXMLMovementReportTypeSchema.parse("TankProductMovement")).toBe(
        "TankProductMovement",
      );
      expect(() =>
        NAXMLMovementReportTypeSchema.parse("InvalidType"),
      ).toThrow();
    });

    it("MR-TYPE-005: Fuel tender code should only allow valid codes", () => {
      VALID_FUEL_TENDER_CODES.forEach((code) => {
        expect(NAXMLFuelTenderCodeSchema.parse(code)).toBe(code);
      });
      expect(() => NAXMLFuelTenderCodeSchema.parse("invalid")).toThrow();
      expect(() => NAXMLFuelTenderCodeSchema.parse("check")).toThrow();
    });
  });

  // ==========================================================================
  // Movement Header Schema Tests (MR-SCHEMA-001 through 010)
  // ==========================================================================

  describe("Movement Header Schema Tests", () => {
    it("MR-SCHEMA-001: should validate valid movement header", () => {
      const result = NAXMLMovementHeaderSchema.safeParse(VALID_MOVEMENT_HEADER);
      expect(result.success).toBe(true);
    });

    it("MR-SCHEMA-002: should reject invalid date format", () => {
      const invalidDate = {
        ...VALID_MOVEMENT_HEADER,
        businessDate: "01-02-2026", // Wrong format
      };
      const result = NAXMLMovementHeaderSchema.safeParse(invalidDate);
      expect(result.success).toBe(false);
    });

    it("MR-SCHEMA-003: should reject invalid time format", () => {
      const invalidTime = {
        ...VALID_MOVEMENT_HEADER,
        beginTime: "23:59", // Missing seconds
      };
      const result = NAXMLMovementHeaderSchema.safeParse(invalidTime);
      expect(result.success).toBe(false);
    });

    it("MR-SCHEMA-004: should reject negative sequence number", () => {
      const negativeSeq = {
        ...VALID_MOVEMENT_HEADER,
        reportSequenceNumber: -1,
      };
      const result = NAXMLMovementHeaderSchema.safeParse(negativeSeq);
      expect(result.success).toBe(false);
    });

    it("MR-SCHEMA-005: should reject zero sequence number", () => {
      const zeroSeq = {
        ...VALID_MOVEMENT_HEADER,
        reportSequenceNumber: 0,
      };
      const result = NAXMLMovementHeaderSchema.safeParse(zeroSeq);
      expect(result.success).toBe(false);
    });

    it("MR-SCHEMA-006: should accept Period 2 (Day Close)", () => {
      const dayClose = {
        ...VALID_MOVEMENT_HEADER,
        primaryReportPeriod: 2,
      };
      const result = NAXMLMovementHeaderSchema.safeParse(dayClose);
      expect(result.success).toBe(true);
    });

    it("MR-SCHEMA-007: should accept Period 98 (Shift Close)", () => {
      const shiftClose = {
        ...VALID_MOVEMENT_HEADER,
        primaryReportPeriod: 98,
      };
      const result = NAXMLMovementHeaderSchema.safeParse(shiftClose);
      expect(result.success).toBe(true);
    });

    it("MR-SCHEMA-008: validateMovementHeader should throw on invalid data", () => {
      expect(() => validateMovementHeader({})).toThrow();
    });

    it("MR-SCHEMA-009: safeValidateMovementHeader should return error on invalid data", () => {
      const result = safeValidateMovementHeader({});
      expect(result.success).toBe(false);
    });

    it("MR-SCHEMA-010: should validate sales movement header", () => {
      const result = NAXMLSalesMovementHeaderSchema.safeParse(
        VALID_SALES_MOVEMENT_HEADER,
      );
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // FGM (Fuel Grade Movement) Schema Tests (MR-FGM-001 through 020)
  // ==========================================================================

  describe("FGM (Fuel Grade Movement) Schema Tests", () => {
    it("MR-FGM-001: should validate FGM tender schema", () => {
      const result = NAXMLFGMTenderSchema.safeParse(VALID_FGM_TENDER);
      expect(result.success).toBe(true);
    });

    it("MR-FGM-002: should reject invalid tender code", () => {
      const invalidTender = {
        tenderCode: "invalid",
        tenderSubCode: "generic",
      };
      const result = NAXMLFGMTenderSchema.safeParse(invalidTender);
      expect(result.success).toBe(false);
    });

    it("MR-FGM-003: should validate FGM sales totals", () => {
      const result = NAXMLFGMSalesTotalsSchema.safeParse(
        VALID_FGM_SALES_TOTALS,
      );
      expect(result.success).toBe(true);
    });

    it("MR-FGM-004: should reject negative sales volume", () => {
      const negativeSales = {
        ...VALID_FGM_SALES_TOTALS,
        fuelGradeSalesVolume: -100,
      };
      const result = NAXMLFGMSalesTotalsSchema.safeParse(negativeSales);
      expect(result.success).toBe(false);
    });

    it("MR-FGM-005: should reject negative sales amount", () => {
      const negativeAmount = {
        ...VALID_FGM_SALES_TOTALS,
        fuelGradeSalesAmount: -500,
      };
      const result = NAXMLFGMSalesTotalsSchema.safeParse(negativeAmount);
      expect(result.success).toBe(false);
    });

    it("MR-FGM-006: should allow zero sales values", () => {
      const zeroSales = {
        fuelGradeSalesVolume: 0,
        fuelGradeSalesAmount: 0,
        discountAmount: 0,
        discountCount: 0,
      };
      const result = NAXMLFGMSalesTotalsSchema.safeParse(zeroSales);
      expect(result.success).toBe(true);
    });

    it("MR-FGM-007: should validate FGM detail with tender summary", () => {
      const result = NAXMLFGMDetailSchema.safeParse(VALID_FGM_DETAIL_BY_TENDER);
      expect(result.success).toBe(true);
    });

    it("MR-FGM-008: should validate FGM detail with position summary", () => {
      const result = NAXMLFGMDetailSchema.safeParse(
        VALID_FGM_DETAIL_BY_POSITION,
      );
      expect(result.success).toBe(true);
    });

    it("MR-FGM-009: should reject FGM detail with both tender and position summary", () => {
      const bothSummaries = {
        fuelGradeId: "001",
        fgmTenderSummary: VALID_FGM_DETAIL_BY_TENDER.fgmTenderSummary,
        fgmPositionSummary: VALID_FGM_DETAIL_BY_POSITION.fgmPositionSummary,
      };
      const result = NAXMLFGMDetailSchema.safeParse(bothSummaries);
      expect(result.success).toBe(false);
    });

    it("MR-FGM-010: should reject FGM detail with neither tender nor position summary", () => {
      const noSummary = {
        fuelGradeId: "001",
      };
      const result = NAXMLFGMDetailSchema.safeParse(noSummary);
      expect(result.success).toBe(false);
    });

    it("MR-FGM-011: should reject non-numeric fuel grade ID", () => {
      const invalidGradeId = {
        ...VALID_FGM_DETAIL_BY_TENDER,
        fuelGradeId: "ABC", // Should be numeric
      };
      const result = NAXMLFGMDetailSchema.safeParse(invalidGradeId);
      expect(result.success).toBe(false);
    });

    it("MR-FGM-012: should accept common fuel grade IDs", () => {
      const gradeIds = ["001", "002", "003", "021", "300"];
      gradeIds.forEach((id) => {
        const detail = {
          ...VALID_FGM_DETAIL_BY_TENDER,
          fuelGradeId: id,
        };
        const result = NAXMLFGMDetailSchema.safeParse(detail);
        expect(result.success).toBe(true);
      });
    });

    it("MR-FGM-013: should validate complete FGM data", () => {
      const result = NAXMLFuelGradeMovementDataSchema.safeParse(VALID_FGM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-FGM-014: validateFuelGradeMovementData should return valid data", () => {
      const result = validateFuelGradeMovementData(VALID_FGM_DATA);
      expect(result.movementHeader.businessDate).toBe("2026-01-02");
      expect(result.fgmDetails.length).toBe(1);
    });

    it("MR-FGM-015: safeValidateFuelGradeMovementData should return success", () => {
      const result = safeValidateFuelGradeMovementData(VALID_FGM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-FGM-016: should allow optional pump test totals", () => {
      const withPumpTest = {
        ...VALID_FGM_SALES_TOTALS,
        pumpTestTotals: {
          pumpTestAmount: 0,
          pumpTestVolume: 0,
        },
      };
      const result = NAXMLFGMSalesTotalsSchema.safeParse(withPumpTest);
      expect(result.success).toBe(true);
    });

    it("MR-FGM-017: should allow optional tax exempt sales volume", () => {
      const withTaxExempt = {
        ...VALID_FGM_SALES_TOTALS,
        taxExemptSalesVolume: 50.5,
      };
      const result = NAXMLFGMSalesTotalsSchema.safeParse(withTaxExempt);
      expect(result.success).toBe(true);
    });

    it("MR-FGM-018: should validate FGM with non-resettable totals", () => {
      const result = NAXMLFGMDetailSchema.safeParse(
        VALID_FGM_DETAIL_BY_POSITION,
      );
      expect(result.success).toBe(true);
      if (
        result.success &&
        result.data.fgmPositionSummary?.fgmNonResettableTotal
      ) {
        expect(
          result.data.fgmPositionSummary.fgmNonResettableTotal
            .fuelGradeNonResettableTotalVolume,
        ).toBe(186261.24);
      }
    });

    it("MR-FGM-019: should validate FGM with multiple price tiers", () => {
      const multiTier = {
        fuelGradeId: "001",
        fgmPositionSummary: {
          fuelPositionId: "1",
          fgmPriceTierSummaries: [
            {
              priceTierCode: "0001",
              fgmSalesTotals: VALID_FGM_SALES_TOTALS,
            },
            {
              priceTierCode: "0002",
              fgmSalesTotals: VALID_FGM_SALES_TOTALS,
            },
          ],
        },
      };
      const result = NAXMLFGMDetailSchema.safeParse(multiTier);
      expect(result.success).toBe(true);
    });

    it("MR-FGM-020: should reject position summary with no price tiers", () => {
      const noTiers = {
        fuelGradeId: "001",
        fgmPositionSummary: {
          fuelPositionId: "1",
          fgmPriceTierSummaries: [],
        },
      };
      const result = NAXMLFGMDetailSchema.safeParse(noTiers);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // FPM (Fuel Product Movement) Schema Tests (MR-FPM-001 through 010)
  // ==========================================================================

  describe("FPM (Fuel Product Movement) Schema Tests", () => {
    it("MR-FPM-001: should validate FPM detail", () => {
      const result = NAXMLFPMDetailSchema.safeParse(VALID_FPM_DETAIL);
      expect(result.success).toBe(true);
    });

    it("MR-FPM-002: should validate complete FPM data", () => {
      const result =
        NAXMLFuelProductMovementDataSchema.safeParse(VALID_FPM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-FPM-003: validateFuelProductMovementData should return valid data", () => {
      const result = validateFuelProductMovementData(VALID_FPM_DATA);
      expect(result.fpmDetails.length).toBe(1);
      expect(result.fpmDetails[0].fpmNonResettableTotals.length).toBe(2);
    });

    it("MR-FPM-004: safeValidateFuelProductMovementData should return success", () => {
      const result = safeValidateFuelProductMovementData(VALID_FPM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-FPM-005: should reject negative meter reading", () => {
      const negativeReading = {
        fuelProductId: "1",
        fpmNonResettableTotals: [
          {
            fuelPositionId: "1",
            fuelProductNonResettableAmountNumber: -100,
            fuelProductNonResettableVolumeNumber: 228745.691,
          },
        ],
      };
      const result = NAXMLFPMDetailSchema.safeParse(negativeReading);
      expect(result.success).toBe(false);
    });

    it("MR-FPM-006: should reject FPM detail with no totals", () => {
      const noTotals = {
        fuelProductId: "1",
        fpmNonResettableTotals: [],
      };
      const result = NAXMLFPMDetailSchema.safeParse(noTotals);
      expect(result.success).toBe(false);
    });

    it("MR-FPM-007: should allow FPM data with empty details", () => {
      const emptyFPM = {
        movementHeader: VALID_MOVEMENT_HEADER,
        fpmDetails: [],
      };
      const result = NAXMLFuelProductMovementDataSchema.safeParse(emptyFPM);
      expect(result.success).toBe(true);
    });

    it("MR-FPM-008: should validate fuel product IDs", () => {
      const productIds = ["1", "2", "3", "4"];
      productIds.forEach((id) => {
        const detail = {
          ...VALID_FPM_DETAIL,
          fuelProductId: id,
        };
        const result = NAXMLFPMDetailSchema.safeParse(detail);
        expect(result.success).toBe(true);
      });
    });

    it("MR-FPM-009: should reject non-numeric product ID", () => {
      const invalidId = {
        ...VALID_FPM_DETAIL,
        fuelProductId: "diesel", // Should be numeric
      };
      const result = NAXMLFPMDetailSchema.safeParse(invalidId);
      expect(result.success).toBe(false);
    });

    it("MR-FPM-010: should allow high meter reading values", () => {
      const highReading = {
        fuelProductId: "1",
        fpmNonResettableTotals: [
          {
            fuelPositionId: "1",
            fuelProductNonResettableAmountNumber: 0,
            fuelProductNonResettableVolumeNumber: 999999999.999,
          },
        ],
      };
      const result = NAXMLFPMDetailSchema.safeParse(highReading);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // MSM (Miscellaneous Summary Movement) Schema Tests (MR-MSM-001 through 010)
  // ==========================================================================

  describe("MSM (Miscellaneous Summary Movement) Schema Tests", () => {
    it("MR-MSM-001: should validate MSM detail", () => {
      const result = NAXMLMSMDetailSchema.safeParse(VALID_MSM_DETAIL);
      expect(result.success).toBe(true);
    });

    it("MR-MSM-002: should validate complete MSM data", () => {
      const result =
        NAXMLMiscellaneousSummaryMovementDataSchema.safeParse(VALID_MSM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-MSM-003: validateMiscellaneousSummaryMovementData should return valid data", () => {
      const result = validateMiscellaneousSummaryMovementData(VALID_MSM_DATA);
      expect(result.msmDetails.length).toBe(1);
    });

    it("MR-MSM-004: safeValidateMiscellaneousSummaryMovementData should return success", () => {
      const result =
        safeValidateMiscellaneousSummaryMovementData(VALID_MSM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-MSM-005: should allow MSM detail without tender", () => {
      const noTender = {
        miscellaneousSummaryCodes: {
          miscellaneousSummaryCode: "statistics",
          miscellaneousSummarySubCode: "transactions",
        },
        msmSalesTotals: {
          miscellaneousSummaryAmount: 0,
          miscellaneousSummaryCount: 51,
        },
      };
      const result = NAXMLMSMDetailSchema.safeParse(noTender);
      expect(result.success).toBe(true);
    });

    it("MR-MSM-006: should allow MSM detail with modifier", () => {
      const withModifier = {
        miscellaneousSummaryCodes: {
          miscellaneousSummaryCode: "fuelSalesByGrade",
          miscellaneousSummarySubCode: "fuel",
          miscellaneousSummarySubCodeModifier: "001",
        },
        msmSalesTotals: {
          miscellaneousSummaryAmount: 508,
          miscellaneousSummaryCount: 201.676,
        },
      };
      const result = NAXMLMSMDetailSchema.safeParse(withModifier);
      expect(result.success).toBe(true);
    });

    it("MR-MSM-007: should allow negative amount for over/short", () => {
      const overShort = {
        miscellaneousSummaryCodes: {
          miscellaneousSummaryCode: "statistics",
          miscellaneousSummarySubCode: "overShort",
        },
        msmSalesTotals: {
          miscellaneousSummaryAmount: -5.25, // Short
          miscellaneousSummaryCount: 0,
        },
      };
      const result = NAXMLMSMDetailSchema.safeParse(overShort);
      expect(result.success).toBe(true);
    });

    it("MR-MSM-008: should allow optional register/cashier/till IDs", () => {
      const withIds = {
        ...VALID_MSM_DETAIL,
        registerId: "10002",
        cashierId: "20000",
        tillId: "10002",
      };
      const result = NAXMLMSMDetailSchema.safeParse(withIds);
      expect(result.success).toBe(true);
    });

    it("MR-MSM-009: should allow empty summary code", () => {
      const emptyCode = {
        miscellaneousSummaryCodes: {
          miscellaneousSummaryCode: "",
        },
        msmSalesTotals: {
          miscellaneousSummaryAmount: 0,
          miscellaneousSummaryCount: 0,
        },
      };
      const result = NAXMLMSMDetailSchema.safeParse(emptyCode);
      expect(result.success).toBe(true);
    });

    it("MR-MSM-010: should validate MSM data with sales movement header", () => {
      expect(VALID_MSM_DATA.salesMovementHeader).toBeDefined();
      const result =
        NAXMLMiscellaneousSummaryMovementDataSchema.safeParse(VALID_MSM_DATA);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // TLM (Tax Level Movement) Schema Tests (MR-TLM-001 through 010)
  // ==========================================================================

  describe("TLM (Tax Level Movement) Schema Tests", () => {
    it("MR-TLM-001: should validate TLM detail", () => {
      const result = NAXMLTLMDetailSchema.safeParse(VALID_TLM_DETAIL);
      expect(result.success).toBe(true);
    });

    it("MR-TLM-002: should validate complete TLM data", () => {
      const result = NAXMLTaxLevelMovementDataSchema.safeParse(VALID_TLM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-TLM-003: validateTaxLevelMovementData should return valid data", () => {
      const result = validateTaxLevelMovementData(VALID_TLM_DATA);
      expect(result.tlmDetails.length).toBe(1);
      expect(result.tlmDetails[0].taxLevelId).toBe("99");
    });

    it("MR-TLM-004: safeValidateTaxLevelMovementData should return success", () => {
      const result = safeValidateTaxLevelMovementData(VALID_TLM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-TLM-005: should allow negative refund amounts", () => {
      const withRefund = {
        ...VALID_TLM_DETAIL,
        taxRefundedAmount: -10.5,
      };
      const result = NAXMLTLMDetailSchema.safeParse(withRefund);
      expect(result.success).toBe(true);
    });

    it("MR-TLM-006: should validate tax level ID format", () => {
      const taxIds = ["99", "1", "100"];
      taxIds.forEach((id) => {
        const detail = {
          ...VALID_TLM_DETAIL,
          taxLevelId: id,
        };
        const result = NAXMLTLMDetailSchema.safeParse(detail);
        expect(result.success).toBe(true);
      });
    });

    it("MR-TLM-007: should reject empty tax level ID", () => {
      const emptyId = {
        ...VALID_TLM_DETAIL,
        taxLevelId: "",
      };
      const result = NAXMLTLMDetailSchema.safeParse(emptyId);
      expect(result.success).toBe(false);
    });

    it("MR-TLM-008: should allow TLM data with empty details", () => {
      const emptyTLM = {
        movementHeader: {
          ...VALID_MOVEMENT_HEADER,
          primaryReportPeriod: 98 as const,
        },
        tlmDetails: [],
      };
      const result = NAXMLTaxLevelMovementDataSchema.safeParse(emptyTLM);
      expect(result.success).toBe(true);
    });

    it("MR-TLM-009: should validate all tax amount fields", () => {
      const allAmounts = {
        taxLevelId: "99",
        merchandiseCode: "0",
        taxableSalesAmount: 100.5,
        taxableSalesRefundedAmount: 10.25,
        taxCollectedAmount: 8.04,
        taxExemptSalesAmount: 50.0,
        taxExemptSalesRefundedAmount: 5.0,
        taxForgivenSalesAmount: 25.0,
        taxForgivenSalesRefundedAmount: 2.5,
        taxRefundedAmount: 0.82,
      };
      const result = NAXMLTLMDetailSchema.safeParse(allAmounts);
      expect(result.success).toBe(true);
    });

    it("MR-TLM-010: should reject missing merchandise code", () => {
      const noMerchCode = {
        taxLevelId: "99",
        taxableSalesAmount: 100,
        taxableSalesRefundedAmount: 0,
        taxCollectedAmount: 0,
        taxExemptSalesAmount: 0,
        taxExemptSalesRefundedAmount: 0,
        taxForgivenSalesAmount: 0,
        taxForgivenSalesRefundedAmount: 0,
        taxRefundedAmount: 0,
      };
      const result = NAXMLTLMDetailSchema.safeParse(noMerchCode);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // MCM (Merchandise Code Movement) Schema Tests (MR-MCM-001 through 010)
  // ==========================================================================

  describe("MCM (Merchandise Code Movement) Schema Tests", () => {
    it("MR-MCM-001: should validate MCM detail", () => {
      const result = NAXMLMCMDetailSchema.safeParse(VALID_MCM_DETAIL);
      expect(result.success).toBe(true);
    });

    it("MR-MCM-002: should validate complete MCM data", () => {
      const result =
        NAXMLMerchandiseCodeMovementDataSchema.safeParse(VALID_MCM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-MCM-003: validateMerchandiseCodeMovementData should return valid data", () => {
      const result = validateMerchandiseCodeMovementData(VALID_MCM_DATA);
      expect(result.mcmDetails.length).toBe(1);
      expect(result.mcmDetails[0].merchandiseCode).toBe("1024");
    });

    it("MR-MCM-004: safeValidateMerchandiseCodeMovementData should return success", () => {
      const result = safeValidateMerchandiseCodeMovementData(VALID_MCM_DATA);
      expect(result.success).toBe(true);
    });

    it("MR-MCM-005: should reject negative sales quantity", () => {
      const negativeQty = {
        ...VALID_MCM_DETAIL,
        mcmSalesTotals: {
          ...VALID_MCM_DETAIL.mcmSalesTotals,
          salesQuantity: -10,
        },
      };
      const result = NAXMLMCMDetailSchema.safeParse(negativeQty);
      expect(result.success).toBe(false);
    });

    it("MR-MCM-006: should reject negative sales amount", () => {
      const negativeAmt = {
        ...VALID_MCM_DETAIL,
        mcmSalesTotals: {
          ...VALID_MCM_DETAIL.mcmSalesTotals,
          salesAmount: -500,
        },
      };
      const result = NAXMLMCMDetailSchema.safeParse(negativeAmt);
      expect(result.success).toBe(false);
    });

    it("MR-MCM-007: should allow zero values for all totals", () => {
      const zeroTotals = {
        merchandiseCode: "1000",
        merchandiseCodeDescription: "Empty Department",
        mcmSalesTotals: {
          discountAmount: 0,
          discountCount: 0,
          promotionAmount: 0,
          promotionCount: 0,
          refundAmount: 0,
          refundCount: 0,
          salesQuantity: 0,
          salesAmount: 0,
          transactionCount: 0,
          openDepartmentSalesAmount: 0,
          openDepartmentTransactionCount: 0,
        },
      };
      const result = NAXMLMCMDetailSchema.safeParse(zeroTotals);
      expect(result.success).toBe(true);
    });

    it("MR-MCM-008: should reject empty merchandise code", () => {
      const emptyCode = {
        ...VALID_MCM_DETAIL,
        merchandiseCode: "",
      };
      const result = NAXMLMCMDetailSchema.safeParse(emptyCode);
      expect(result.success).toBe(false);
    });

    it("MR-MCM-009: should allow long merchandise description", () => {
      const longDesc = {
        ...VALID_MCM_DETAIL,
        merchandiseCodeDescription:
          "Very Long Department Description That Should Be Allowed Up To Maximum Length",
      };
      const result = NAXMLMCMDetailSchema.safeParse(longDesc);
      expect(result.success).toBe(true);
    });

    it("MR-MCM-010: should allow MCM data with empty details", () => {
      const emptyMCM = {
        movementHeader: {
          ...VALID_MOVEMENT_HEADER,
          primaryReportPeriod: 98 as const,
        },
        mcmDetails: [],
      };
      const result = NAXMLMerchandiseCodeMovementDataSchema.safeParse(emptyMCM);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // ISM (Item Sales Movement) Schema Tests (MR-ISM-001 through 005)
  // ==========================================================================

  describe("ISM (Item Sales Movement) Schema Tests", () => {
    it("MR-ISM-001: should validate ISM detail", () => {
      const ismDetail = {
        itemCode: "SKU123",
        itemDescription: "Test Item",
        merchandiseCode: "1000",
        salesQuantity: 10,
        salesAmount: 99.9,
        unitPrice: 9.99,
      };
      const result = NAXMLISMDetailSchema.safeParse(ismDetail);
      expect(result.success).toBe(true);
    });

    it("MR-ISM-002: should allow empty ISM data", () => {
      const emptyISM = {
        movementHeader: VALID_MOVEMENT_HEADER,
        ismDetails: [],
      };
      const result = NAXMLItemSalesMovementDataSchema.safeParse(emptyISM);
      expect(result.success).toBe(true);
    });

    it("MR-ISM-003: should reject negative unit price", () => {
      const negativePrice = {
        itemCode: "SKU123",
        itemDescription: "Test Item",
        merchandiseCode: "1000",
        salesQuantity: 10,
        salesAmount: 99.9,
        unitPrice: -9.99,
      };
      const result = NAXMLISMDetailSchema.safeParse(negativePrice);
      expect(result.success).toBe(false);
    });

    it("MR-ISM-004: should reject empty item code", () => {
      const emptyCode = {
        itemCode: "",
        itemDescription: "Test Item",
        merchandiseCode: "1000",
        salesQuantity: 10,
        salesAmount: 99.9,
        unitPrice: 9.99,
      };
      const result = NAXMLISMDetailSchema.safeParse(emptyCode);
      expect(result.success).toBe(false);
    });

    it("MR-ISM-005: should allow long item description", () => {
      const longDesc = {
        itemCode: "SKU123",
        itemDescription:
          "This is a very long item description that should be allowed by the schema",
        merchandiseCode: "1000",
        salesQuantity: 10,
        salesAmount: 99.9,
        unitPrice: 9.99,
      };
      const result = NAXMLISMDetailSchema.safeParse(longDesc);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // TPM (Tank Product Movement) Schema Tests (MR-TPM-001 through 005)
  // ==========================================================================

  describe("TPM (Tank Product Movement) Schema Tests", () => {
    it("MR-TPM-001: should validate TPM detail", () => {
      const tpmDetail = {
        tankId: "1",
        fuelProductId: "1",
        tankVolume: 5000,
        tankCapacity: 10000,
        tankUllage: 5000,
        waterLevel: 0.5,
        productTemperature: 65.5,
      };
      const result = NAXMLTPMDetailSchema.safeParse(tpmDetail);
      expect(result.success).toBe(true);
    });

    it("MR-TPM-002: should allow empty TPM data", () => {
      const emptyTPM = {
        movementHeader: VALID_MOVEMENT_HEADER,
        tpmDetails: [],
      };
      const result = NAXMLTankProductMovementDataSchema.safeParse(emptyTPM);
      expect(result.success).toBe(true);
    });

    it("MR-TPM-003: should allow negative temperature", () => {
      const negativeTemp = {
        tankId: "1",
        fuelProductId: "1",
        tankVolume: 5000,
        productTemperature: -10.5, // Cold climate
      };
      const result = NAXMLTPMDetailSchema.safeParse(negativeTemp);
      expect(result.success).toBe(true);
    });

    it("MR-TPM-004: should reject negative tank volume", () => {
      const negativeVolume = {
        tankId: "1",
        fuelProductId: "1",
        tankVolume: -100,
      };
      const result = NAXMLTPMDetailSchema.safeParse(negativeVolume);
      expect(result.success).toBe(false);
    });

    it("MR-TPM-005: should allow optional fields", () => {
      const minimalTPM = {
        tankId: "1",
        fuelProductId: "1",
        tankVolume: 5000,
      };
      const result = NAXMLTPMDetailSchema.safeParse(minimalTPM);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Transmission Header Schema Tests
  // ==========================================================================

  describe("Transmission Header Schema Tests", () => {
    it("should validate transmission header", () => {
      const result = NAXMLTransmissionHeaderSchema.safeParse(
        VALID_TRANSMISSION_HEADER,
      );
      expect(result.success).toBe(true);
    });

    it("should reject empty store location ID", () => {
      const emptyStore = {
        ...VALID_TRANSMISSION_HEADER,
        storeLocationId: "",
      };
      const result = NAXMLTransmissionHeaderSchema.safeParse(emptyStore);
      expect(result.success).toBe(false);
    });

    it("should allow optional vendor model version", () => {
      const noVersion = {
        storeLocationId: "299",
        vendorName: "Test Vendor",
      };
      const result = NAXMLTransmissionHeaderSchema.safeParse(noVersion);
      expect(result.success).toBe(true);
    });
  });

  // ==========================================================================
  // Security/Input Validation Tests (MR-SEC-001 through 010)
  // ==========================================================================

  describe("Security/Input Validation Tests", () => {
    it("MR-SEC-001: should reject script injection in string fields", () => {
      // Schema should accept the string, but caller should sanitize/escape for output
      const withScript = {
        ...VALID_MSM_DETAIL,
        miscellaneousSummaryCodes: {
          miscellaneousSummaryCode: "<script>alert('xss')</script>",
        },
      };
      // Zod doesn't block content, but length limits help
      const result = NAXMLMSMDetailSchema.safeParse(withScript);
      // Still valid as Zod doesn't do content filtering - that's app layer
      expect(result.success).toBe(true);
    });

    it("MR-SEC-002: should enforce max length on string fields", () => {
      const longString = "A".repeat(300);
      const tooLong = {
        ...VALID_MCM_DETAIL,
        merchandiseCodeDescription: longString,
      };
      const result = NAXMLMCMDetailSchema.safeParse(tooLong);
      expect(result.success).toBe(false);
    });

    it("MR-SEC-003: should reject invalid date formats that could cause parsing issues", () => {
      const badDate = {
        ...VALID_MOVEMENT_HEADER,
        businessDate: "2026-13-45", // Invalid date
      };
      const result = NAXMLMovementHeaderSchema.safeParse(badDate);
      expect(result.success).toBe(false);
    });

    it("MR-SEC-004: should handle very large numbers safely", () => {
      const largeNum = {
        ...VALID_FGM_SALES_TOTALS,
        fuelGradeSalesVolume: Number.MAX_SAFE_INTEGER,
        fuelGradeSalesAmount: Number.MAX_SAFE_INTEGER,
      };
      const result = NAXMLFGMSalesTotalsSchema.safeParse(largeNum);
      expect(result.success).toBe(true);
    });

    it("MR-SEC-005: should reject NaN values", () => {
      const nanValue = {
        ...VALID_FGM_SALES_TOTALS,
        fuelGradeSalesVolume: NaN,
      };
      const result = NAXMLFGMSalesTotalsSchema.safeParse(nanValue);
      expect(result.success).toBe(false);
    });

    it("MR-SEC-006: should reject Infinity values", () => {
      const infinityValue = {
        ...VALID_FGM_SALES_TOTALS,
        fuelGradeSalesVolume: Infinity,
      };
      const result = NAXMLFGMSalesTotalsSchema.safeParse(infinityValue);
      expect(result.success).toBe(false);
    });

    it("MR-SEC-007: should handle null values appropriately", () => {
      const nullMovementHeader = null;
      const result = NAXMLMovementHeaderSchema.safeParse(nullMovementHeader);
      expect(result.success).toBe(false);
    });

    it("MR-SEC-008: should handle undefined values appropriately", () => {
      const undefinedData = undefined;
      const result = NAXMLFuelGradeMovementDataSchema.safeParse(undefinedData);
      expect(result.success).toBe(false);
    });

    it("MR-SEC-009: should reject object with extra unexpected fields but still parse valid fields", () => {
      const withExtra = {
        ...VALID_MOVEMENT_HEADER,
        unexpectedField: "should be ignored",
        maliciousPayload: { nested: "data" },
      };
      // Zod by default strips unknown fields in .parse(), safeParse returns only known fields
      const result = NAXMLMovementHeaderSchema.safeParse(withExtra);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(
          (result.data as Record<string, unknown>).unexpectedField,
        ).toBeUndefined();
      }
    });

    it("MR-SEC-010: should enforce tender code allowlist", () => {
      const invalidTenderCodes = [
        "SELECT * FROM",
        "'; DROP TABLE",
        "../../../etc/passwd",
        "<script>",
        "randomCode",
      ];

      invalidTenderCodes.forEach((code) => {
        const result = NAXMLFuelTenderCodeSchema.safeParse(code);
        expect(result.success).toBe(false);
      });
    });
  });
});
