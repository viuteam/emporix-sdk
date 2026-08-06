/**
 * The request context, in **one** place — because both sides of this example need it and
 * they drifted.
 *
 * A file with no imports on purpose. `app/emporix.ts` pulls in
 * `@viu/emporix-sdk-next`, which is server-only; `app/providers.tsx` is a Client
 * Component. Neither can import the other, so a shared constant has to live somewhere
 * that reaches both — the same split `examples/next-server-first/app/lib/languages.ts`
 * uses.
 *
 * What drifted, measured 2026-08-06 against the `viu` tenant:
 *
 * - The browser client bound `EUR`/`DE`, the server client `CHF` and **no**
 *   `targetLocation`. `useMatchPrices` sends only `items` and lets the bound
 *   anonymous-login context decide currency and country, so `/guest-checkout` answered
 *   «no price resolved for the product» and showed «Unit price: —». The same
 *   `matchByContext` call with CHF/main/CH returns three prices, so the products were
 *   never the problem.
 * - `language` was bound nowhere, which orphaned the SSR prefetch. See
 *   `app/product/[id]/page.tsx`.
 *
 * `emporix.ts` used to claim these were «bound on every server-side client so prefetch
 * keys match what the provider binds». They were not, and nothing made them. Now one
 * module is the only source and drift is a type error rather than a silent miss.
 *
 * The values are the `viu` tenant's own: `sites.get("main")` reports `main`, CHF,
 * `languages: ["en","de"]`, `defaultLanguage: "de"` (measured 2026-08-04).
 */
export const SITE_CODE = "main";
export const CURRENCY = "CHF";
export const TARGET_LOCATION = "CH";

/**
 * The active language, and it must be **explicit**.
 *
 * Left unset, `EmporixProvider` seeds it from the active site's `defaultLanguage` after
 * fetching the site — which changes the query key *after mount* and throws away every
 * prefetched entry. Pinning it here is what makes hydration a cache hit.
 */
export const LANGUAGE = "de";
