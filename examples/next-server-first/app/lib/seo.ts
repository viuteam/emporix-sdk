import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "./languages";

/**
 * The canonical URL of a page and its siblings in the other languages.
 *
 * One place, because the URL shape is a fact about this app that four routes would
 * otherwise each restate — and `hreflang` is only useful when every page agrees
 * about it.
 *
 * `suffix` is everything after the language: `/product/abc`, `/category/abc/3`, or
 * `""` for the language home. Relative on purpose; Next resolves both fields
 * against `metadataBase`, which is documented behaviour — unlike the sitemap, where
 * `lib/site-url.ts` builds absolute URLs itself for exactly that reason.
 *
 * `x-default` points at the **default** language rather than at the current one. A
 * visitor whose locale we do not serve should land on German, whichever page
 * happens to be emitting the tag.
 *
 * Pure and free of server imports so vitest can load it — same rule as
 * `swap-language.ts` and `safe-next.ts`.
 */
export function alternatesFor(
  lang: Language,
  suffix: string,
): { canonical: string; languages: Record<string, string> } {
  const at = (l: string): string => `/${l}${suffix}`;
  const languages: Record<string, string> = {};
  for (const l of LANGUAGES) languages[l] = at(l);
  languages["x-default"] = at(DEFAULT_LANGUAGE);
  return { canonical: at(lang), languages };
}
