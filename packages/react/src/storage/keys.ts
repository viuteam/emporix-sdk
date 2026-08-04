/**
 * The eight persisted session keys.
 *
 * Moved to `@viu/emporix-sdk` (`core/session-keys.ts`): the same strings are
 * cookie names on a server, Web Storage keys in a browser, and record fields in
 * a session store, so the contract does not belong to the React bindings. This
 * re-export keeps every existing import — including `@viu/emporix-sdk-react/ssr`
 * — working, and there is deliberately only ONE definition. A copy here would be
 * a second source of truth for the one thing that must not drift.
 */
export { STORAGE_KEYS } from "@viu/emporix-sdk";
