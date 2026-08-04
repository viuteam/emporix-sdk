/**
 * Moved to `@viu/emporix-sdk` (`core/session-storage.ts`).
 *
 * `createServerStorage` never touched React: it builds an {@link EmporixStorage}
 * over a caller-supplied cookie jar, which fits Next, Remix, SvelteKit, Nitro or
 * a plain Node handler. It living here is the reason `@viu/emporix-sdk-next` had
 * to depend on this package, so it moved to where both consumers already look.
 *
 * Re-exported unchanged — `@viu/emporix-sdk-react/ssr` keeps exporting all three
 * names, so no import anywhere needs to change.
 */
export { createServerStorage, serverAuth } from "@viu/emporix-sdk";
export type { ServerCookieJar } from "@viu/emporix-sdk";
