"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { LANGUAGES, isLanguage, type Language } from "../lib/languages";
import { swapLanguage } from "../lib/swap-language";

/**
 * Plain links, not a form — so switching the language works with JavaScript off
 * and, more importantly, so the header contains no Server Action and no session
 * read. A `cookies()` call in the header would make every route dynamic; keeping
 * the switcher a client island is what lets the catalog stay cacheable.
 *
 * The active marker has two sources, mirroring the two the whole app has:
 *
 * - **Catalog routes** carry the language in the URL (`/de/category/…`). It is
 *   read from `usePathname()` — no request, and the cached pages pay nothing.
 * - **Session routes** (`/cart`, `/account/…`) carry it in an `httpOnly` cookie
 *   the client cannot read. So the switcher asks the server once, via the read
 *   mode of `/api/session/language`. This fetch runs only when the URL has no
 *   language — never on a catalog page.
 *
 * `useSearchParams()` is deliberately avoided: it would deopt the statically
 * rendered catalog pages out of ISR. The query string is read from
 * `window.location` in an effect instead, which never runs during prerender.
 */
export function LanguageSwitcher(): React.JSX.Element {
  const pathname = usePathname();
  const segment = pathname.split("/")[1] ?? "";
  const urlActive = isLanguage(segment) ? segment : null;

  // Filled only on a session route, and only after the page is interactive.
  const [cookieActive, setCookieActive] = useState<Language | null>(null);
  useEffect(() => {
    if (urlActive !== null) return; // catalog route — the URL already answers
    const abort = new AbortController();
    fetch("/api/session/language", { signal: abort.signal, cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ language: string | null }>) : null))
      .then((d) => {
        if (d !== null && d.language !== null && isLanguage(d.language)) {
          setCookieActive(d.language);
        }
      })
      .catch(() => {
        // A failed read just leaves both chips unframed. The links still work.
      });
    return () => abort.abort();
  }, [urlActive]);

  const active = urlActive ?? cookieActive;

  // Carry the query across a switch. `usePathname()` drops it, so without this a
  // switch on `/search?q=sso` would land on an empty `/search`. Read from the
  // browser, not `useSearchParams()`, to keep the catalog out of client-render.
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(window.location.search), [pathname]);

  return (
    <span className="cluster" style={{ gap: "var(--s-2)" }} aria-label="Language">
      {LANGUAGES.map((l) => {
        const next = swapLanguage(pathname, l) + query;
        const href = `/api/session/language?to=${l}&next=${encodeURIComponent(next)}`;
        // Die aktive Sprache ist umrahmt, nicht mit einem Punkt markiert. Auf einer
        // Zeichnung ist der geltende Stand eingerahmt, und ein Rahmen ist — anders
        // als eine Farbe allein — ein Unterschied, den auch sieht, wer Rot nicht von
        // Grau unterscheiden kann. `aria-current` sagt dasselbe fuer Screenreader.
        //
        // **Der einzige `<a>` dieser App, und er muss einer bleiben.** Das Ziel ist
        // ein Route-Handler, der mit 303 weiterleitet — keine Seite. Der Next-Router
        // kann dorthin nicht clientseitig navigieren, er erwartet eine RSC-Payload.
        // `<Link>` waere hier nicht unschoener, sondern kaputt.
        return (
          <a
            key={l}
            href={href}
            className={l === active ? "tag tag--accent" : "tag"}
            hrefLang={l}
            {...(l === active ? { "aria-current": "true" as const } : {})}
          >
            {l}
          </a>
        );
      })}
    </span>
  );
}
