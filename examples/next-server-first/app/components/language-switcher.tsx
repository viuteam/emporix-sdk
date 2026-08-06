"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LANGUAGES, isLanguage } from "../lib/languages";
import { swapLanguage } from "../lib/swap-language";

/**
 * Two links, and that is all it is now.
 *
 * It used to have three jobs beyond this: write a cookie through
 * `/api/session/language`, read that cookie back to know which chip to box, and be an
 * `<a>` rather than a `<Link>` because its target was a route handler. All three went
 * away with the cookie — the language is in the URL, so the active chip comes from
 * `usePathname()` and the target is a page.
 *
 * Still a client island, and only for `usePathname()`: a Server Component would need
 * `headers()` to learn the current path, and that would make every route dynamic — which
 * is the thing this whole demo is arranged to avoid.
 *
 * `useSearchParams()` is deliberately avoided for the same reason: it would deopt the
 * statically rendered catalog pages out of ISR. The query is read from `window.location`
 * in an effect instead, which never runs during prerender.
 */
export function LanguageSwitcher(): React.JSX.Element {
  const pathname = usePathname();
  const segment = pathname.split("/")[1] ?? "";
  const active = isLanguage(segment) ? segment : null;

  // Carry the query across a switch. `usePathname()` drops it, so without this a switch
  // on `/de/search?q=sso` would land on an empty search page.
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(window.location.search), [pathname]);

  return (
    <span className="cluster" style={{ gap: "var(--s-2)" }} aria-label="Language">
      {LANGUAGES.map((l) => (
        // The active language is boxed, not marked with a dot. On a drawing the current
        // revision is boxed, and a box is — unlike colour alone — a difference that also
        // reads for someone who cannot tell red from grey. `aria-current` says the same
        // thing for screen readers.
        <Link
          key={l}
          href={swapLanguage(pathname, l) + query}
          className={l === active ? "tag tag--accent" : "tag"}
          hrefLang={l}
          {...(l === active ? { "aria-current": "true" as const } : {})}
        >
          {l}
        </Link>
      ))}
    </span>
  );
}
