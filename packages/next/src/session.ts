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
 * Re-exported so a server-first storefront never has to import
 * `@viu/emporix-sdk-react` just to name a cookie. The constant lives in the
 * react package because the browser backends share it; a Next app in this mode
 * writes no client-side storage at all and should not reach into it.
 */
export { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
export { SESSION_MAX_AGE, sessionCookieJar, type SessionCookieJar } from "./session-cookies";
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
