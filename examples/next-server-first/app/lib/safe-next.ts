/**
 * Own paths only.
 *
 * An open redirect is a trust boundary, demo or not: `?next=https://evil.com`
 * would hand a visitor who has just typed their password to somebody else's
 * site. The second check is the one that is easy to miss — `//evil.com` begins
 * with a slash and is still an absolute URL, because the browser reads it as
 * protocol-relative.
 *
 * In its own module, with no imports, and that is deliberate: it is the one thing
 * in these examples with unit tests, and importing
 * `@viu/emporix-sdk-next/session` next to it makes them impossible. That entry is
 * server-only and its guard throws the moment vitest resolves it outside the
 * `react-server` condition — correctly so. A pure function does not need the
 * company.
 */
export function safeNext(raw: string | undefined): string {
  if (raw === undefined || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
