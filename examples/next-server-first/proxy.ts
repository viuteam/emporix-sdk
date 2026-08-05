import type { NextRequest } from "next/server";
import { emporixTokenProxy } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "./app/emporix";
import { pathLanguage } from "./app/lib/path-language";

/**
 * Rotates the customer token, pins the site — and **schliesst die Naht zwischen den
 * zwei Sprachquellen**.
 *
 * Der Katalog liest die Sprache aus seiner URL (`/de/category/…`), weil ein
 * Cookie-Zugriff die Route dynamisch und damit uncacheable machen wuerde. Die
 * Sitzungsrouten (`/cart`, `/checkout`, `/account/…`) lesen das Cookie, weil sie
 * ohnehin pro Besucher rendern. Zwei Quellen, und `/api/session/language` war als
 * einziger Schreiber dokumentiert.
 *
 * Diese Naht hatte ein Loch: **wer den Sprachumschalter nie anklickt, hat kein
 * Cookie.** `/` leitet auf `DEFAULT_LANGUAGE` um, ohne es zu schreiben, und wer
 * direkt auf `/de/product/x` landet, schreibt es auch nicht. Ohne Cookie sendet der
 * SDK kein `Accept-Language`, Emporix liefert die vollstaendige Sprachkarte, und
 * `localized()` in examples/shared nimmt daraus den ersten Treffer seiner Reihenfolge
 * — und die beginnt mit `en`.
 *
 * Gemessen am 2026-08-05 auf dem `viu`-Tenant: die Produktseite `/de/product/…`
 * zeigte «Just-in-Time Zugriff (JIT)», derselbe Artikel im Warenkorb «Just-in-Time
 * Access (JIT)». Ein Aufruf von `/api/session/language?to=de` drehte den Warenkorb
 * auf Deutsch, ohne dass sonst etwas geaendert wurde — damit ist das fehlende Cookie
 * die Ursache und nicht die Lage der Routen.
 *
 * Hier ist die Stelle, an der es zu beheben ist: ein Proxy darf Cookies schreiben,
 * ein Server Component nicht. `emporixSiteProxy` — an das `emporixTokenProxy`
 * delegiert — schreibt den Wert zweimal, in die weitergeleiteten Request-Cookies
 * (damit **dieser** Render ihn schon sieht) und als `Set-Cookie`. Genau dieser Fall
 * steht als Beispiel in seinem eigenen Doc-Kommentar.
 *
 * Warum das den Katalog-Cache nicht kaputt macht: der Wert ist eine Funktion des
 * Pfads, und der Pfad ist der Cache-Key — `/de/…` setzt immer `de`. Dazu
 * ueberspringt `emporixSiteProxy` den Schreibvorgang, wenn das eingehende Cookie
 * schon passt, sodass nur der erste Aufruf pro Sprache ein `Set-Cookie` traegt und
 * der Dauerzustand keines.
 *
 * Die Alternative waere, die Sitzungsrouten unter `/[lang]/…` zu ziehen und die
 * zweite Quelle ganz zu loeschen. Sie wuerde denselben Fehler beheben, aber acht
 * Routen und jeden internen Link bewegen — und cacheable werden diese Routen davon
 * nicht, sie lesen weiter das Sitzungscookie. Fuer die URL-Gestalt waere es die
 * schoenere Loesung, fuer den Fehler ist es die teurere.
 *
 * KANTE, die auf http nicht auffaellt und deshalb hier steht: dieses Cookie hat
 * jetzt zwei Schreiber mit verschiedenen Namensregeln. `emporixSiteProxy` schreibt
 * `emporix.language` immer unprefixed, `emporixSessionHandle` — und damit
 * `/api/session/language` — schreibt auf https `__Host-emporix.language`. Gelesen
 * wird ueber `readCookie`, das den prefixed Namen **bevorzugt** und auf den bare
 * zurueckfaellt. Auf https gewinnt darum eine frueher getroffene Wahl im Umschalter
 * dauerhaft gegen die URL: wer auf `/cart` DE waehlt und danach `/en/product/x`
 * oeffnet, sieht den Warenkorb weiter deutsch.
 *
 * Das bleibt bewusst so. Die Reihenfolge ist im Paket festgelegt und nicht in
 * diesem Beispiel korrigierbar, ohne an den Cookie-Namen zu greifen — und das
 * waere schlimmer als die Kante. Sie braucht https, eine vorherige Umschalter-Wahl
 * und danach einen Sprachwechsel per URL statt per Umschalter; auf einer
 * Sitzungsroute ist die Cookie-Wahl ausserdem die einzige, die es gibt, weil dort
 * keine Sprache in der URL steht.
 */
export async function proxy(request: NextRequest) {
  // `null` auf einer Sitzungsroute: dann bleibt das bestehende Cookie unberuehrt,
  // weil `emporixSiteProxy` ein fehlendes Feld in Ruhe laesst. Ein `/cart` darf die
  // Wahl des Besuchers nicht ueberschreiben — es sagt ueber Sprache nichts aus.
  const language = pathLanguage(request.nextUrl.pathname);

  return emporixTokenProxy(request, {
    site: {
      siteCode: "main",
      ...(language !== null ? { language } : {}),
    },
    ...STORE_OPT,
  });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
