import { isLanguage } from "./languages";

/**
 * The path to land on after switching the language.
 *
 * Every route carries its language now, so this is one substitution. The third case this
 * function used to have — «a path with no language is a session route, leave it alone» —
 * described a shape that no longer exists: `/cart` moved to `/[lang]/cart` with the rest.
 *
 * Pure and free of server imports so vitest can load it — same rule as `safe-next.ts`.
 */
export function swapLanguage(pathname: string, to: string): string {
  const parts = pathname.split("/");
  if (isLanguage(parts[1] ?? "")) {
    parts[1] = to;
    return parts.join("/");
  }
  // `/` and anything unprefixed: the language home is the honest answer, and it is what
  // the switcher renders on a 404 page.
  return `/${to}`;
}
