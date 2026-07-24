import { describe, it, expectTypeOf } from "vitest";
import type { Quote, QuoteDraft, QuoteCreated, QuoteUpdate, ListQuotesQuery } from "../../src/services/quote-types";

describe("quote types", () => {
  it("aliases the generated quote types", () => {
    expectTypeOf<Quote>().not.toBeNever();
    expectTypeOf<QuoteDraft>().not.toBeNever();
    expectTypeOf<QuoteCreated>().not.toBeNever();
    expectTypeOf<QuoteUpdate>().not.toBeNever();
    expectTypeOf<ListQuotesQuery["pageSize"]>().toEqualTypeOf<number | undefined>();
  });
});
