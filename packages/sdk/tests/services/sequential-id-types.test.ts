import { describe, it, expectTypeOf } from "vitest";
import type {
  SequenceSchema,
  SequenceSchemaCreate,
  NextIdCommandRequest,
  NextIdResponse,
  NextIdOptions,
  BatchNextIdEntry,
  NextIdsBatchRequest,
  NextIdsBatchResponse,
} from "../../src/services/sequential-id-types";

describe("sequential id types", () => {
  it("SequenceSchemaCreate carries the required counter fields", () => {
    const c: SequenceSchemaCreate = {
      name: "order",
      startValue: 1,
      maxValue: 999999,
      numberOfDigits: 6,
    };
    expectTypeOf(c.name).toEqualTypeOf<string>();
    expectTypeOf(c.startValue).toEqualTypeOf<number>();
  });

  it("SequenceSchema is assignable from a server response with id + active", () => {
    const s: SequenceSchema = {
      id: "sch_1",
      name: "order",
      startValue: 1,
      maxValue: 999999,
      numberOfDigits: 6,
      active: true,
    } as SequenceSchema;
    expectTypeOf(s.id).toEqualTypeOf<string | undefined>(); // generated response `id` is optional

  });

  it("NextIdCommandRequest and NextIdResponse have the expected shapes", () => {
    const req: NextIdCommandRequest = { sequenceKey: "store-1", placeholders: { yy: "26" } };
    const res: NextIdResponse = { id: "ORD-000123" };
    expectTypeOf(req.placeholders).toEqualTypeOf<Record<string, string> | undefined>();
    expectTypeOf(res.id).toEqualTypeOf<string>();
  });

  it("NextIdOptions.siteCode is optional string", () => {
    const o: NextIdOptions = { siteCode: "main" };
    expectTypeOf(o.siteCode).toEqualTypeOf<string | undefined>();
  });

  it("batch request/response are keyed maps", () => {
    const entry: BatchNextIdEntry = { numberOfIds: 3, sequenceKey: "store-1" };
    const req: NextIdsBatchRequest = { order: entry };
    const res: NextIdsBatchResponse = { order: { ids: ["ORD-1", "ORD-2", "ORD-3"] } };
    // Record index access includes `undefined` under noUncheckedIndexedAccess
    expectTypeOf(req.order).toEqualTypeOf<BatchNextIdEntry | undefined>();
    expectTypeOf(res.order?.ids).toEqualTypeOf<string[] | undefined>();
  });
});
