import { describe, expect, it } from "vitest";
import {
  emporixKey as keyFromSdk,
  siteMeta as metaFromSdk,
  getCustomerSessionStore as storeFromSdk,
  createMemoryStorage as memoryFromSdk,
  createListenerSet as listenersFromSdk,
} from "@viu/emporix-sdk";
import { emporixKey, siteMeta } from "../src/hooks/internal/query-keys";
import { getCustomerSessionStore } from "../src/hooks/internal/customer-session-store";
import { createMemoryStorage, createListenerSet } from "../src/storage/index";

/**
 * Three more pieces moved down to `@viu/emporix-sdk` so `@viu/emporix-sdk-angular`
 * could use them without depending on the React bindings — the same move
 * `STORAGE_KEYS` and `EmporixStorage` already made.
 *
 * Identity, not deep equality. `toEqual` would pass on a duplicated
 * implementation, which is exactly the failure this guards: two query-key
 * builders that agree today and drift in six months, splitting every cache
 * entry in half.
 */
describe("the agnostic layer has exactly one definition", () => {
  it("re-exports the same function objects the SDK defines", () => {
    expect(emporixKey).toBe(keyFromSdk);
    expect(siteMeta).toBe(metaFromSdk);
    expect(getCustomerSessionStore).toBe(storeFromSdk);
    expect(createMemoryStorage).toBe(memoryFromSdk);
    expect(createListenerSet).toBe(listenersFromSdk);
  });

  it("still produces the key shape the React hooks assert", () => {
    // Pinned because a shape change invalidates every cached entry in every
    // deployed browser at once.
    expect(emporixKey("product", ["p1"], { tenant: "acme", authKind: "anonymous" })).toEqual([
      "emporix",
      "product",
      "p1",
      { tenant: "acme", authKind: "anonymous" },
    ]);
  });
});
