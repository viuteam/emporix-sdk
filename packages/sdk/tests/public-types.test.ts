import { describe, expect, it } from "vitest";
import type {
  AgenticCrudResource,
  AnalyticsResource,
  CartItemBatchEntry,
  CartItemsBatchResponse,
  CustomerTokenValidation,
  ImportHealthThresholds,
  ImportJobGroup,
  ImportLicense,
  ImportStats,
  ImportStatsQuery,
  JobsResource,
  LegalEntitySearchInput,
  LogsResource,
  QuoteReasonsResource,
  SegmentGroup,
  SegmentGroupInput,
  SessionContextData,
  SiteAddress,
  SiteHomeBase,
  TemplatesResource,
} from "../src/index";

/**
 * Every type a public method takes or returns is importable from the package
 * root, as the README promises. These were reachable only from a subpath or not
 * at all — `imports.getLicense()` returned an `ImportLicense` nobody could name.
 * The import above is the check: `pnpm typecheck` fails when one goes missing.
 */
type Named = {
  agenticCrud: AgenticCrudResource<unknown, unknown>;
  analytics: AnalyticsResource;
  cartItemBatchEntry: CartItemBatchEntry;
  cartItemsBatchResponse: CartItemsBatchResponse;
  customerTokenValidation: CustomerTokenValidation;
  importHealthThresholds: ImportHealthThresholds;
  importJobGroup: ImportJobGroup;
  importLicense: ImportLicense;
  importStats: ImportStats;
  importStatsQuery: ImportStatsQuery;
  jobs: JobsResource;
  legalEntitySearchInput: LegalEntitySearchInput;
  logs: LogsResource;
  quoteReasons: QuoteReasonsResource;
  segmentGroup: SegmentGroup;
  segmentGroupInput: SegmentGroupInput;
  sessionContextData: SessionContextData;
  siteAddress: SiteAddress;
  siteHomeBase: SiteHomeBase;
  templates: TemplatesResource;
};

describe("public types", () => {
  it("are importable from the package root", () => {
    const names: (keyof Named)[] = [];
    expect(names).toEqual([]);
  });
});
