import type { WithEmporixSessionOptions } from "@viu/emporix-sdk-next/session";
import { sessionStore } from "./session-store";

/** Site the proxy pins for every request. */
export const SITE = { siteCode: "main" } as const;

/**
 * The context every server-side client binds. One place, so the catalog client
 * and the session helper cannot drift.
 */
/** Separate const so it can be passed without an `| undefined` under
 *  `exactOptionalPropertyTypes`. */
export const CONTEXT = { siteCode: "main", currency: "CHF", targetLocation: "CH" };

/**
 * The session store, when EMPORIX_SESSION_REDIS_URL is set. Undefined otherwise,
 * so both modes stay reachable without a code change.
 */
export const SESSION_STORE = sessionStore();

export const EMPORIX: WithEmporixSessionOptions = {
  context: CONTEXT,
  ...(SESSION_STORE !== undefined ? { store: SESSION_STORE } : {}),
};

/** For the two callers that take their own options rather than the full
 *  WithEmporixSessionOptions: the proxy and emporixSession. */
export const STORE_OPT = SESSION_STORE !== undefined ? { store: SESSION_STORE } : {};

/** Category known to contain priced products on the `viu` tenant. */
export const PRICED_CATEGORY = "4a1a25bd-d828-476c-a481-925fcffe6f34";
