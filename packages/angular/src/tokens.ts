import { InjectionToken } from "@angular/core";
import type { EmporixClient, EmporixStorage } from "@viu/emporix-sdk";
// Type-only import, so the tokens ↔ site cycle is erased at compile time:
// site.ts imports the VALUE `EMPORIX_SITE` from here, this file imports only
// TYPES from there. `verbatimModuleSyntax` guarantees `import type` emits
// nothing, so there is no runtime cycle. Do not "fix" this by turning it into a
// value import — that would create a real one.
import type { EmporixSiteState, SiteStateWritables } from "./site";
// Same type-only arrangement as `./site` above, for the same reason.
import type { EmporixCompanyInternal, EmporixCompanyState } from "./company";

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

/** The active-company context. Read-only; `injectEmporixCompany()` resolves it. */
export const EMPORIX_COMPANY = new InjectionToken<EmporixCompanyState>("EMPORIX_COMPANY");

/**
 * The company state with its writable handles and the injector's single
 * serialized rescope.
 *
 * Deliberately NOT exported from `src/index.ts`: a consumer who can set
 * `activeCompany` directly bypasses the token rescope and the cart drop that make
 * a company switch correct — and bypasses the queue that keeps two switches from
 * spending the same refresh token.
 */
export const EMPORIX_COMPANY_INTERNAL = new InjectionToken<EmporixCompanyInternal>(
  "EMPORIX_COMPANY_INTERNAL",
);
