/**
 * Where this storefront lives, and what it is called.
 *
 * Absolute, and that is why this module exists: **`robots.txt` and `sitemap.xml`
 * have to carry absolute URLs.** The sitemaps protocol requires it, and whether
 * Next resolves a relative entry against `metadataBase` is not documented — so
 * this builds them itself rather than relying on it. `alternates` on a page is the
 * opposite case: there the resolution against `metadataBase` is documented, and the
 * relative form keeps the pages readable.
 *
 * The fallback is localhost rather than a guess at a production host. A wrong
 * absolute canonical points crawlers at somebody else's site; an obviously local
 * one is the lesser failure. Set `SITE_BASE_URL` for a deployment.
 *
 * No server imports, so vitest and `generateStaticParams` can both load it — the
 * same rule as `languages.ts` and `safe-next.ts`.
 */
export const SITE_BASE_URL = new URL(process.env.SITE_BASE_URL ?? "http://localhost:3000");

/** The name in the tab, and the second half of every page title. */
export const SITE_NAME = "Server/First";

/** An absolute URL for a path — what `robots.txt` and `sitemap.xml` need. */
export function absoluteUrl(path: string): string {
  return new URL(path, SITE_BASE_URL).href;
}
