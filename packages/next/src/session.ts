/**
 * Everything that binds an Emporix session to a request, server-side.
 *
 * Guarded by the `react-server` export condition: importing this from a Client
 * Component resolves to a file that throws. That is the whole point — the
 * session lives in httpOnly cookies and the browser must never reach it.
 *
 * The two families read as a pair, and belong together for that reason:
 *
 * - `emporixSession()` / `emporixSessionMutable()` — the session **values** for
 *   this request.
 * - `withEmporixSession()` / `withEmporixSessionMutable()` — run a callback
 *   **with** the session bound to a client and an `AuthContext`.
 *
 * Both `emporixSession` exports stay available from the package root as well,
 * where they shipped in 0.3.0.
 */
export {
  emporixSession,
  emporixSessionMutable,
  type EmporixServerSession,
} from "./server-session";

/**
 * Re-exported so a server-first storefront can name a session key without a
 * second import. The constant lives in `@viu/emporix-sdk` — it is the contract
 * between every backend (cookie, Web Storage, server store), not a React
 * concern, which is why this package no longer depends on the React bindings to
 * name a cookie.
 */
export { STORAGE_KEYS } from "@viu/emporix-sdk";
export {
  SESSION_MAX_AGE,
  emporixSessionHandle,
  type EmporixSessionHandle,
  // Deprecated in 0.5.0, removed in 0.6.0. A test pins that these are the same
  // function, so dropping them is a deliberate act rather than a silent break.
  sessionCookieJar,
  type SessionCookieJar,
} from "./session-cookies";
export {
  SESSION_GUEST_MAX,
  SESSION_SID,
  type EmporixSessionStore,
} from "./session-store";
export {
  withEmporixSession,
  withEmporixSessionMutable,
  type WithEmporixSessionOptions,
} from "./session-client";
export { emporixLogin, emporixLogout, emporixRefresh, assertSameOrigin } from "./session-auth";
export { emporixTokenProxy, type EmporixTokenProxyOptions } from "./token-proxy";
export { createEmporixPublicRoute } from "./public-route";
export {
  setEmporixErrorReporter,
  type EmporixErrorReporter,
  type EmporixErrorEvent,
  type EmporixErrorCode,
} from "./error-reporting";
