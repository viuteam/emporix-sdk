import type { EmporixStorageKey } from "./index";

/**
 * The eight persisted session keys, as the strings each backend actually uses:
 * cookie names in `./cookie` and `./server`, Web Storage keys in
 * `./local-storage` and `./session-storage`. Same strings on purpose — a value
 * written by one backend must be readable by the next, and the cookie set by a
 * Next `proxy.ts` has to be the one `createCookieStorage` looks for.
 *
 * The `satisfies` is the point, not the deduplication: a ninth
 * {@link EmporixStorageKey} without an entry here is a compile error, and an
 * entry here without a union member is too. `as const` stays in front of it so
 * the literal types survive for consumers.
 */
export const STORAGE_KEYS = {
  customerToken: "emporix.customerToken",
  cartId: "emporix.cartId",
  anonymousSession: "emporix.anonymousSession",
  siteCode: "emporix.siteCode",
  language: "emporix.language",
  activeLegalEntityId: "emporix.activeLegalEntityId",
  refreshToken: "emporix.refreshToken",
  saasToken: "emporix.saasToken",
} as const satisfies Record<EmporixStorageKey, string>;
