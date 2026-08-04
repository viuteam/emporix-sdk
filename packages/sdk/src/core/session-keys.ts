/**
 * The persisted session-state contract, shared by every host.
 *
 * It lives in the core SDK rather than in `@viu/emporix-sdk-react` because it is
 * not a React concern: the same eight keys are cookie names in a Next
 * `proxy.ts`, Web Storage keys in a browser adapter, and record fields in a
 * server-side session store. Keeping it here is what let
 * `@viu/emporix-sdk-next` drop its dependency on the React package — it needed
 * these strings, not React.
 *
 * `@viu/emporix-sdk-react` re-exports both from `./storage` and `/ssr`, so
 * existing imports keep working.
 */

/** Keys that participate in {@link EmporixStorage.subscribeAll}. */
export type EmporixStorageKey =
  | "customerToken"
  | "cartId"
  | "siteCode"
  | "language"
  | "anonymousSession"
  | "activeLegalEntityId"
  | "refreshToken"
  | "saasToken";

/**
 * The eight persisted session keys, as the strings each backend actually uses.
 * Same strings on purpose — a value written by one backend must be readable by
 * the next, and the cookie set by a Next `proxy.ts` has to be the one
 * `createCookieStorage` looks for.
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
