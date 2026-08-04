import { describe, expect, it } from "vitest";
import { STORAGE_KEYS as fromSdk } from "@viu/emporix-sdk";
import { STORAGE_KEYS as fromKeys } from "../src/storage/keys";
import { STORAGE_KEYS as fromSsr } from "../src/ssr";

/**
 * The eight session keys moved to `@viu/emporix-sdk` so `@viu/emporix-sdk-next`
 * could stop depending on this package for them. Two paths in this package still
 * export them (`storage/keys` internally, `/ssr` publicly), and a copy in either
 * would be the one drift that silently breaks a session: a cookie written under
 * one name and read under another.
 *
 * Identity, not deep equality — `toEqual` would pass on a duplicated literal,
 * which is exactly the failure this guards.
 */
describe("STORAGE_KEYS has exactly one definition", () => {
  it("is the same object through every entry point", () => {
    expect(fromKeys).toBe(fromSdk);
    expect(fromSsr).toBe(fromSdk);
  });

  it("still names all eight keys with the `emporix.` prefix", () => {
    // A rename is a session-losing change for every deployed browser, so the
    // strings themselves are pinned, not just their count.
    expect(fromSdk).toEqual({
      customerToken: "emporix.customerToken",
      cartId: "emporix.cartId",
      anonymousSession: "emporix.anonymousSession",
      siteCode: "emporix.siteCode",
      language: "emporix.language",
      activeLegalEntityId: "emporix.activeLegalEntityId",
      refreshToken: "emporix.refreshToken",
      saasToken: "emporix.saasToken",
    });
  });
});
