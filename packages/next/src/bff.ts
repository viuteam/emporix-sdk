/**
 * Re-exported so a server-first storefront never has to import
 * `@viu/emporix-sdk-react` just to name a cookie. The constant lives in the
 * react package because the browser backends share it; a Next app in this mode
 * writes no client-side storage at all and should not reach into it.
 */
export { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
export { BFF_MAX_AGE, bffCookieJar, type BffCookieJar } from "./bff-cookies";
export {
  withEmporixSession,
  withEmporixSessionMutable,
  type WithEmporixSessionOptions,
} from "./bff-session";
export { emporixLogin, emporixLogout, emporixRefresh, assertSameOrigin } from "./bff-auth";
export { emporixTokenProxy, type EmporixTokenProxyOptions } from "./token-proxy";
export { createEmporixCatalogRoute } from "./catalog-proxy";
