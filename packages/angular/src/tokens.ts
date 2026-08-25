import { InjectionToken } from "@angular/core";
import type { EmporixClient, EmporixStorage } from "@viu/emporix-sdk";
// Type-only import, so the tokens ↔ site cycle is erased at compile time:
// site.ts imports the VALUE `EMPORIX_SITE` from here, this file imports only
// TYPES from there. `verbatimModuleSyntax` guarantees `import type` emits
// nothing, so there is no runtime cycle. Do not "fix" this by turning it into a
// value import — that would create a real one.
import type { EmporixSiteState, SiteStateWritables } from "./site";

/**
 * The SDK client. A token rather than a service class because a class would
 * need `@Injectable()`, and a decorator would pull in the Angular compiler —
 * which is exactly what this package is built to avoid.
 */
export const EMPORIX_CLIENT = new InjectionToken<EmporixClient>("EMPORIX_CLIENT");

/** Persisted session state. Always present: `provideEmporix` supplies a memory fallback. */
export const EMPORIX_STORAGE = new InjectionToken<EmporixStorage>("EMPORIX_STORAGE");

/** Active site, currency and language. Always provided by `provideEmporix`. */
export const EMPORIX_SITE = new InjectionToken<EmporixSiteState>("EMPORIX_SITE");

/**
 * Writable handles for the same state, consumed only by `site-switch.ts`.
 *
 * Deliberately NOT exported from `src/index.ts`: a consumer who can write
 * `siteCode` directly bypasses the cart drop and the session-context patch that
 * make a site switch correct.
 */
export const EMPORIX_SITE_INTERNAL = new InjectionToken<SiteStateWritables>(
  "EMPORIX_SITE_INTERNAL",
);
