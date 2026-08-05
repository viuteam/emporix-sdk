import { isLanguage, type Language } from "./languages";

/**
 * The language a path announces — or `null` when it announces none.
 *
 * Its own file because `proxy.ts` needs it and tests have to load it: the same split
 * as `swap-language.ts` and `category-index.ts`. A proxy runs in an environment
 * without `cookies()`, and vitest cannot load anything that pulls in
 * `@viu/emporix-sdk-next/session`.
 *
 * `null` rather than `DEFAULT_LANGUAGE`: the difference between "this path says `de`"
 * and "this path says nothing" is the whole point of the function. `emporixSiteProxy`
 * leaves an absent field alone — there is no delete — so `/cart` must not overwrite
 * the visitor's choice, while `/de/cart` would be allowed to.
 */
export function pathLanguage(pathname: string): Language | null {
  const segment = pathname.split("/")[1] ?? "";
  return isLanguage(segment) ? segment : null;
}
