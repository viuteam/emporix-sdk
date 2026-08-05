/**
 * The languages this storefront serves, and the one an unprefixed URL means.
 *
 * A file with **no server imports** on purpose — the same split as
 * `category-walk.ts`. vitest can load this; it cannot load anything that pulls
 * in `@viu/emporix-sdk-next/session`.
 *
 * Not invented: `client.sites.get("main")` on the `viu` tenant returns
 * `languages: ["en", "de"], defaultLanguage: "de"` (measured 2026-08-04). It
 * stays a literal because these values decide the *route table* — a
 * `generateStaticParams` that asks Emporix at build time would make the build
 * depend on a network call for something that changes once a year.
 */
export const LANGUAGES = ["en", "de"] as const;

export type Language = (typeof LANGUAGES)[number];

/** Where an unprefixed URL redirects, and what the tenant would pick anyway. */
export const DEFAULT_LANGUAGE: Language = "de";

/**
 * A route param is attacker-controlled: `/xx/category/…` must 404 rather than
 * render. It matters beyond tidiness — the value ends up in `Accept-Language`
 * on every Emporix call this page makes.
 */
export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value);
}
