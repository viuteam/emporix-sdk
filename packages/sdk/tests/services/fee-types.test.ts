import { describe, it, expectTypeOf } from "vitest";
import type {
  Fee,
  ItemFee,
  FeeDraft,
  ItemFeeDraft,
  ItemFeeSearch,
  ListFeesQuery,
  SetItemFeesOptions,
} from "../../src/services/fee-types";

describe("fee types", () => {
  it("Fee carries the core fee fields", () => {
    const f: Fee = {
      id: "fee_1",
      name: { en: "Small order fee" },
      code: "small-order",
      feeType: "PERCENT",
      feePercentage: 2.5,
      siteCode: "main",
      active: true,
      yrn: "urn:yaas:...:fee:fee_1",
    };
    expectTypeOf(f.code).toEqualTypeOf<string>();
    expectTypeOf(f.feeType).toEqualTypeOf<"PERCENT" | "ABSOLUTE" | "ABSOLUTE_MULTIPLY_ITEMQUANTITY">();
  });

  it("ItemFee carries itemYrn + feeIds + siteCode", () => {
    const i: ItemFee = { id: "if_1", itemYrn: "urn:...:product:p1", feeIds: ["fee_1"], siteCode: "main" };
    expectTypeOf(i.itemYrn).toEqualTypeOf<string>();
    expectTypeOf(i.feeIds).toEqualTypeOf<string[]>();
  });

  it("FeeDraft omits server-managed id/yrn", () => {
    const d: FeeDraft = {
      name: { en: "Fee" },
      code: "fee",
      feeType: "ABSOLUTE",
      feeAbsolute: { amount: 5, currency: "CHF" },
      siteCode: "main",
      active: true,
    };
    expectTypeOf(d.code).toEqualTypeOf<string>();
    // @ts-expect-error `id` is server-assigned and not part of the draft
    const withId: FeeDraft = { ...d, id: "x" };
    void withId;
  });

  it("ItemFeeDraft has the create body shape", () => {
    const d: ItemFeeDraft = { itemYrn: "urn:...:product:p1", feeIds: ["fee_1"], siteCode: "main" };
    expectTypeOf(d.feeIds).toEqualTypeOf<string[]>();
  });

  it("ItemFeeSearch is itemYrns + siteCode", () => {
    const s: ItemFeeSearch = { itemYrns: ["a", "b"], siteCode: "main" };
    expectTypeOf(s.itemYrns).toEqualTypeOf<string[]>();
  });

  it("ListFeesQuery has page params and an open index signature", () => {
    const q: ListFeesQuery = { pageNumber: 1, pageSize: 60, q: "code:small-order" };
    expectTypeOf(q.pageNumber).toEqualTypeOf<number | undefined>();
  });

  it("SetItemFeesOptions.partial is boolean", () => {
    const o: SetItemFeesOptions = { partial: true };
    expectTypeOf(o.partial).toEqualTypeOf<boolean | undefined>();
  });
});
