"use client";

import { usePathname } from "next/navigation";
import { LANGUAGES, isLanguage } from "../lib/languages";
import { swapLanguage } from "../lib/swap-language";

/**
 * Plain links, not a form — so switching the language works with JavaScript off
 * and, more importantly, so the header contains no Server Action and no session
 * read. It reads `usePathname()` and nothing else.
 *
 * Each link goes through `/api/session/language`, which writes the cookie the
 * session routes read and then redirects to the prefixed path. One writer for
 * two sources; see the route's comment.
 *
 * The active marker comes from the URL when there is one. On a session route
 * (`/cart`, `/account/…`) there is no language in the path, so nothing is marked
 * — claiming one would be a guess, and the cookie is not readable here on
 * purpose: everything `emporixSessionHandle` writes is `httpOnly`.
 */
export function LanguageSwitcher(): React.JSX.Element {
  const pathname = usePathname();
  const segment = pathname.split("/")[1] ?? "";
  const active = isLanguage(segment) ? segment : null;

  return (
    <span className="cluster" style={{ gap: "var(--s-2)" }} aria-label="Language">
      {LANGUAGES.map((l) => {
        const next = swapLanguage(pathname, l);
        const href = `/api/session/language?to=${l}&next=${encodeURIComponent(next)}`;
        return (
          <a key={l} href={href} className="u-underline" hrefLang={l}>
            {l === active ? `${l} ●` : l}
          </a>
        );
      })}
    </span>
  );
}
