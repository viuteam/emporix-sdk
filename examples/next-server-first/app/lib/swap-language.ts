import { isLanguage } from "./languages";

/**
 * The path a visitor should land on after switching the language.
 *
 * Three cases, and the second is the one worth writing down:
 *
 * 1. A catalog path already carries a language — `/de/category/x` → `/en/category/x`.
 * 2. A path with no language is a **session route** (`/cart`, `/account/orders`).
 *    Those read the cookie, not the URL, so the path stays exactly as it is and
 *    only the cookie changes. Prefixing them would 404.
 * 3. The bare root redirects to the default language anyway, so going straight
 *    to `/en` saves a hop.
 *
 * Pure and free of server imports so vitest can load it — same rule as
 * `safe-next.ts`.
 */
export function swapLanguage(pathname: string, to: string): string {
  if (pathname === "/" || pathname === "") return `/${to}`;

  const parts = pathname.split("/");
  if (isLanguage(parts[1] ?? "")) {
    parts[1] = to;
    return parts.join("/");
  }
  return pathname;
}
