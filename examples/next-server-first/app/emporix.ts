import { sessionStore } from "./session-store";

/** Site the proxy pins for every request. */
export const SITE = { siteCode: "main" } as const;

/**
 * The request context used to live here as a module constant, and the session
 * options with it. Both moved to `lib/site-context.ts` and are now **derived per
 * request** — a module constant cannot hold a visitor's language choice, and one
 * shared across visitors would be a bug rather than a shortcut.
 */

/**
 * The session store, when EMPORIX_SESSION_REDIS_URL is set. Undefined otherwise,
 * so both modes stay reachable without a code change.
 */
export const SESSION_STORE = sessionStore();

/** For the two callers that take their own options rather than the full
 *  WithEmporixSessionOptions: the proxy and emporixSession. */
export const STORE_OPT = SESSION_STORE !== undefined ? { store: SESSION_STORE } : {};

/** Category known to contain priced products on the `viu` tenant. */
export const PRICED_CATEGORY = "4a1a25bd-d828-476c-a481-925fcffe6f34";
