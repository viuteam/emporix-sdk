import type { WithEmporixSessionOptions } from "@viu/emporix-sdk-next/session";

/** Site the proxy pins for every request. */
export const SITE = { siteCode: "main" } as const;

/**
 * The context every server-side client binds. One place, so the catalog client
 * and the session helper cannot drift.
 */
/** Separate const so it can be passed without an `| undefined` under
 *  `exactOptionalPropertyTypes`. */
export const CONTEXT = { siteCode: "main", currency: "CHF", targetLocation: "CH" };

export const EMPORIX: WithEmporixSessionOptions = { context: CONTEXT };

/** Category known to contain priced products on the `viu` tenant. */
export const PRICED_CATEGORY = "4a1a25bd-d828-476c-a481-925fcffe6f34";
