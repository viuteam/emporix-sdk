# Site- und Locale-Erkennung im Proxy — Design

**Status:** approved
**Datum:** 2026-07-31
**Package:** `@viu/emporix-sdk-next`
**Vorgänger:** `2026-07-31-emporix-sdk-next-design.md` (Follow-up 2),
`2026-07-31-next-example-migration-design.md` (Follow-up 1),
`2026-07-31-react-key-normalization-design.md` (Follow-up 1)

## Problem

Eine Storefront, die mehr als eine Site oder Sprache bedient, muss `siteCode`
und `language` pro Request bestimmen, bevor gerendert wird. Beide Werte gehen an
zwei Stellen ein, die sich einig sein müssen:

- serverseitig in `getEmporixClient({ context })` und in die
  `prefetchEmporix`-Query-Keys,
- clientseitig in den `SiteContextProvider`, aus dem `useEmporixQuery` sie über
  `siteMeta` in denselben Key schreibt.

Weichen sie ab, wird aus dem Hydration-Cache-Hit ein Miss und jede Seite lädt
ihre Daten zweimal. Das ist derselbe Mechanismus, für den die `context`-Option
in `getEmporixClient` gebaut wurde (PR #187/#188) — hier nur pro Request statt
pro Prozess.

Ein `proxy.ts` ist die einzige Stelle, an der das vor dem Rendern passieren
kann.

## Gemessene Grundlagen

Alles an `next@16.2.12` im Repo nachgemessen, nicht aus dem Gedächtnis.

| Fakt | Quelle |
|---|---|
| Datei heisst `proxy`, im Root oder in `src/` | `next/dist/lib/constants.d.ts:32` — `PROXY_FILENAME = "proxy"`, `PROXY_LOCATION_REGEXP = "(?:src/)?proxy"` |
| Export als `default` **oder** benannt `proxy`; Typ `NextProxy` aus `next/server` | `next/dist/build/analysis/get-page-static-info.js:270-306`, Doku |
| **Node-Runtime erzwungen** — `export const runtime` wirft | «Route segment config is not allowed in Proxy file … Proxy always runs on Node.js runtime» (`get-page-static-info.js:587`) |
| Ohne `matcher` läuft der Proxy auf jedem Request, inkl. `_next/static`, `_next/image`, `public/` | Doku, Abschnitt «Matcher» |
| `matcher` muss ein statisch analysierbares Literal sein | Doku: «The matcher values need to be constants so they can be statically analyzed at build-time. Dynamic values such as variables will be ignored.» |
| `request.cookies.set(name, value)` schreibt den `cookie`-Header des Requests zurück | `next/dist/compiled/@edge-runtime/cookies/index.js:212-217` — `this._headers.set("cookie", …)` |
| Der Request-Header wird über `NextResponse.next({ request: { headers } })` weitergegeben, nicht über `{ headers }` | Doku, Abschnitt «Setting Headers» |
| `NextResponse.rewrite(dest)` validiert `dest` als absolute URL und legt sie in `x-middleware-rewrite` | `next/dist/server/web/spec-extension/response.js:116-118` |
| `next/root-params` existiert in 16.2.12 | `next/dist/server/request/root-params.js` |
| Next rät von Proxy ab | Doku: «We recommend users avoid relying on Middleware unless no other options exist» und «you should not attempt relying on shared modules or globals» |
| `next@^16.2.12` ist bereits devDependency in `packages/next` | `packages/next/package.json` |

Vier davon sind nicht nur nachgelesen, sondern in einem Spike ausgeführt und
danach wieder gelöscht — `Request.headers` ist im Web-Standard guarded, also
war «`request.cookies.set` ist erlaubt» eine tragende Annahme und keine
Selbstverständlichkeit:

| Gemessen | Ergebnis |
|---|---|
| `request.cookies.set` auf einem frischen `NextRequest` | erlaubt; `request.headers.get("cookie")` enthält danach `emporix.language=de` |
| bestehendes Cookie im eingehenden `cookie`-Header | bleibt erhalten, das neue kommt dazu |
| `NextResponse.next({ request: { headers } })` mit den mutierten Headern | funktioniert; `set-cookie` enthält **kein** `HttpOnly` |
| `NextResponse.rewrite(new URL("/x", request.url), …)` | `x-middleware-rewrite` ist `https://shop.test/x` |

Die `HttpOnly`-Assertion wurde mutiert (`httpOnly: true` gesetzt) und failt dann
genau einmal — der Guard aus Test 9 unten kann also wirklich failen.

Die bestehende Cookie-Kette, ebenfalls nachgelesen:

| Fakt | Quelle |
|---|---|
| Der `SiteContextProvider` liest `storage.getSiteCode()` / `getLanguage()` als **zweite** Präzedenzstufe, nach den `initial*`-Props und vor dem Client-Config-Kontext | `packages/react/src/site-context.tsx:55-68` |
| `useEmporixQuery` bezieht `siteCode`/`language` aus diesem Kontext und gibt sie über `siteMeta` in den Key | `packages/react/src/hooks/internal/use-emporix-query.ts:45,57` |
| `emporixSession()` liest dieselben Cookie-Namen serverseitig über `createServerStorage` | `packages/next/src/session.ts` |
| `COOKIE_NAMES` ist heute aus **keinem** Entry von `@viu/emporix-sdk-react` exportiert | `packages/react/src/storage/cookie-core.ts:12`, kein Re-Export in `index.ts` / `ssr.ts` / `storage/index.ts` |
| Der Entry `./storage` trägt den `"use client"`-Banner, `./ssr` bewusst nicht | `packages/react/tsup.config.ts`, `packages/react/scripts/check-dist.mjs` |

## Entscheidung: generisch, kein Policy-Anteil

Das Package besitzt ausschliesslich die Emporix-Mechanik. Welcher Host oder
Pfad auf welchen `siteCode`/`language` zeigt, schreibt die Storefront selbst.

Begründung: `@viu/emporix-sdk-next` ist publiziert und soll mehrere künftige
Storefronts tragen. Eine Host-Map oder Locale-Konvention im Package wäre die
Policy genau einer Storefront, eingebacken in eine npm-Version — und jede
weitere Storefront müsste sie umgehen statt nutzen.

Wo der Resolver liegt, hat eine Konsequenz, die ins README gehört: **wenn eine
aufgelöste Site vom bestehenden Cookie abweicht, überschreibt die Funktion es.**
Wer eine clientseitige Sprachwahl (`setLanguage`) nicht überfahren will, liest
im Resolver zuerst `request.cookies` und gibt den vorhandenen Wert zurück. Das
ist bewusst nicht im Package gelöst — ob die URL oder die Nutzerwahl gewinnt,
ist eine Produktentscheidung, keine Bibliotheksentscheidung.

Der Proxy darf ausserdem **keinen** Emporix-Aufruf machen und `getEmporixClient`
nicht importieren. Das ist nicht Vorsicht, sondern die Next-Doku: der Client
memoisiert in einer Modul-Map, und für Proxy gilt «you should not attempt
relying on shared modules or globals». Die Auflösung ist damit rein synchron aus
dem Request.

## Oberfläche

Ein neuer Entry `@viu/emporix-sdk-next/proxy` mit einem Export.

```ts
/**
 * Site und Sprache, die ein Proxy für einen Request aufgelöst hat.
 * Fehlende Felder werden nicht angetastet — es gibt kein Löschen.
 */
export interface EmporixSite {
  siteCode?: string;
  language?: string;
}

export function emporixSiteProxy(
  request: NextRequest,
  site: EmporixSite,
  rewriteTo?: string | URL,
): NextResponse;
```

`rewriteTo` weggelassen → `NextResponse.next(...)`. `rewriteTo` gesetzt →
`NextResponse.rewrite(...)`, relative Strings werden gegen `request.url`
aufgelöst. Beide Pfade laufen durch dieselbe Header-Injektion und denselben
Cookie-Write.

Redirect ist bewusst nicht abgedeckt: es findet kein Render statt, also braucht
es keine Header-Injektion, und das `Set-Cookie` reist mit dem Redirect zum
Folgerequest.

### Implementierung

```ts
const ENTRIES = [
  ["siteCode", COOKIE_NAMES.siteCode],
  ["language", COOKIE_NAMES.language],
] as const;

export function emporixSiteProxy(
  request: NextRequest,
  site: EmporixSite,
  rewriteTo?: string | URL,
): NextResponse {
  const changed: Array<[string, string]> = [];
  for (const [field, name] of ENTRIES) {
    const value = site[field];
    if (value === undefined) continue;
    if (request.cookies.get(name)?.value === value) continue;
    // Schreibt den `cookie`-Header zurück, damit `emporixSession()` den Wert
    // schon in DIESEM Render sieht.
    request.cookies.set(name, value);
    changed.push([name, value]);
  }

  const init = { request: { headers: request.headers } };
  const response =
    rewriteTo === undefined
      ? NextResponse.next(init)
      : NextResponse.rewrite(new URL(rewriteTo, request.url), init);

  for (const [name, value] of changed) {
    response.cookies.set(name, value, {
      path: "/",
      sameSite: "lax",
      // NICHT httpOnly: das browserseitige createCookieStorage muss lesen
      // können, sonst greift die Storage-Präzedenzstufe im
      // SiteContextProvider nie.
      httpOnly: false,
      secure: request.nextUrl.protocol === "https:",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}
```

Drei Details mit Begründung:

**`httpOnly: false` explizit**, obwohl es der Default von `ResponseCookies.set`
ist. Es ist die einzige sicherheitsrelevante Zeile der Datei; explizit
geschrieben dokumentiert sie sich selbst und übersteht eine Default-Änderung in
Next. Der Gegensatz zu `emporixSessionMutable` (`httpOnly: true`) ist
beabsichtigt: der Customer-Token darf der Browser nicht lesen, die
Site-Präferenz muss er.

**`secure` aus dem Protokoll abgeleitet**, nicht hart `true`. Hart `true`
liefert auf einem HTTP-Staging ein stillschweigend verworfenes Cookie —
fail-closed und mühsam zu diagnostizieren. Hinter einem TLS-terminierenden
Reverse Proxy sieht Next `http:` und setzt kein `Secure`; das ist fail-open und
gehört in die JSDoc.

**No-op-Guard**, wenn das eingehende Cookie schon passt. Für den
wiederkehrenden Besucher entsteht dann gar kein `Set-Cookie` — sonst wäre jede
Response bei manchen CDNs uncacheable. Wenn nichts geändert wurde, ist der
Aufruf eine reine Durchleitung.

### Eigener Entry, nicht aus Kosmetik

`src/session.ts` importiert `next/headers`, und `cookies()` ist im
Proxy-Kontext nicht verfügbar. Über den Barrel-Export würde eine `proxy.ts` das
mitziehen. Dieselbe Begründung wie beim bestehenden `webhook`-Entry.

Änderungen: `entry` in `packages/next/tsup.config.ts` um
`proxy: "src/proxy.ts"` erweitern, `"./proxy"` in die `exports`-Map von
`packages/next/package.json`.

## Datenfluss

```
proxy.ts  →  emporixSiteProxy
               ├─ request.cookies.set  →  cookie-Header  →  emporixSession()
               │                                          →  prefetchEmporix({ siteCode, language })
               └─ response.cookies.set →  Set-Cookie      →  createCookieStorage
                                                          →  SiteContextProvider
                                                          →  siteMeta  →  Query-Key
```

Beide Hälften münden in dasselbe `siteMeta`, also matchen Server-Prefetch und
Client-Hydration. Neuer Plumbing-Code entsteht nicht — die Kette existiert, der
Proxy hängt sich vorne dran.

Der Doppel-Write ist nicht redundant. Ohne den Request-Anteil sieht der laufende
Render den neuen Wert nicht und prefetcht mit dem alten. Ohne das `Set-Cookie`
hat der Browser den Wert beim ersten Besuch nie, der Client mountet ohne
`siteCode`, und genau der erste Seitenaufruf verfehlt den Key.

### Voraussetzung clientseitig

Die untere Hälfte funktioniert nur mit `createCookieStorage`. Mit
`createMemoryStorage` — was `examples/next-app-router` heute nutzt — ist sie
tot. Das gehört ins README, nicht in Code: es ist eine Entscheidung der
Storefront.

### Der eine nötige Export in `@viu/emporix-sdk-react`

`COOKIE_NAMES` wird aus `@viu/emporix-sdk-react/ssr` exportiert. Nicht aus
`./storage`: dieser Entry trägt den `"use client"`-Banner und hat in einer
`proxy.ts` nichts zu suchen. `./ssr` ist bannerfrei und der Entry, aus dem
`packages/next/src/session.ts` schon heute importiert.

Damit bleiben die acht Cookie-Namen in `cookie-core.ts` einfach gesourced,
statt dass `@viu/emporix-sdk-next` eine dritte Kopie der Literale anlegt.

Release-Folge: ein PR, ein Release. Changesets publiziert in topologischer
Ordnung, also `@viu/emporix-sdk-react` vor `@viu/emporix-sdk-next`; die
`workspace:^`-Peer-Range wird beim Packen auf die neue react-Version
umgeschrieben.

## Nicht-Ziele

- **Keine Host-Map, keine Locale-Liste, keine Konvention.** Policy gehört in die
  Storefront.
- **Kein exportierter `matcher`.** Ein importierter Wert ist für Next eine
  Variable und wird stillschweigend ignoriert. Das Package kann ihn nur
  dokumentieren; er muss inline in der `proxy.ts` stehen.
- **Kein Cookie-Löschen.** `undefined` heisst «unangetastet lassen». Wer löschen
  will, ruft `response.cookies.delete` selbst auf.
- **Kein Redirect-Pfad.** Siehe oben — er braucht die Funktion nicht.
- **Kein Emporix-Aufruf, kein `getEmporixClient`-Import.** Von der Next-Doku
  ausgeschlossen.
- **Keine Änderung an `examples/next-app-router`.** Das Example ist Single-Site
  CHF/`main`; ein Proxy dort wäre Demo-Zeremonie. Verifiziert wird gegen einen
  echten Server mit einer temporären, nicht committeten Datei (siehe unten).

## Tests

Zehn Unit-Tests in `packages/next/tests/proxy.test.ts`, gegen echte
`NextRequest`/`NextResponse` aus `next/server`:

| # | Fall | Erwartung |
|---|---|---|
| 1 | beide Felder gesetzt, keine Cookies vorhanden | zwei `Set-Cookie`, korrekte Werte |
| 2 | Header-Injektion | `request.headers.get("cookie")` enthält beide Namen nach dem Aufruf |
| 3 | beide eingehenden Cookies passen schon | `response.cookies.getAll()` ist leer |
| 4 | nur `language` | genau ein `Set-Cookie` |
| 5 | `{}` | kein `Set-Cookie`, Response ist eine Durchleitung |
| 6 | `rewriteTo` als relativer String | `x-middleware-rewrite` ist die absolute URL, Cookies trotzdem gesetzt |
| 7 | `rewriteTo` als absolute `URL` | dito |
| 8 | `http://` vs `https://` | `Secure` nur bei https |
| 9 | `httpOnly` | auf **keinem** der beiden Cookies gesetzt |
| 10 | eingehendes Cookie hat einen **anderen** Wert | wird überschrieben, im `Set-Cookie` und im weitergegebenen Header |

Test 9 ist der wichtigste — er ist die Regressionsbremse für die eine
sicherheitsrelevante Zeile. Test 10 fixiert die Überschreib-Semantik aus dem
Abschnitt «Entscheidung» und ist der Gegenpol zu Test 3: passt das Cookie, wird
nichts geschrieben; passt es nicht, gewinnt der Resolver.

Rewrite wird über `x-middleware-rewrite` geprüft, mit Quellenangabe
(`next/dist/server/web/spec-extension/response.js:118`) im Test, damit ein
Next-Bruch diagnostizierbar failt statt rätselhaft. `next/experimental/testing/server`
mit `getRewrittenUrl` wäre die sanktionierte Alternative, ist aber
`unstable_`-benannt; innerhalb von `next@^16` ist der Header stabil.

### Verifikation gegen einen echten Server

Unit-Tests beweisen die Header-Weitergabe nicht — nur, dass die Funktion die
richtigen Objekte baut. Ob Next die mutierten Header wirklich an den Render
weitergibt, zeigt erst ein laufender Server:

1. temporäre `proxy.ts` in `examples/next-app-router`, die `language` aus dem
   ersten Pfadsegment ableitet,
2. `next build` und `next start`,
3. `curl -sD- http://localhost:3000/de/ -o /dev/null` → erwartet `Set-Cookie`
   für beide Namen, **ohne** `Secure` (http),
4. derselbe Aufruf mit `-b "emporix.language=de"` → erwartet **kein**
   `Set-Cookie` für `language` (No-op-Guard),
5. temporäre Datei löschen.

Schritt 5 ist Teil der Aufgabe, nicht ein Nachgedanke: das Example bekommt
keine committete Änderung.

## Doku

Ein Abschnitt in `packages/next/README.md` mit einer copy-paste-fähigen
`proxy.ts`, inklusive **inline** geschriebenem `matcher` samt
Negativ-Lookahead, und der Notiz, warum der Matcher nicht importierbar ist.
Dazu die Voraussetzung `createCookieStorage`.

Kein `docs/nextjs.md` in diesem Zyklus — das bleibt der offene Follow-up für
`images.remotePatterns` und ist ein anderes Thema.

## Ehrliche Einordnung

Das ist der Follow-up mit dem schwächsten Nutzen der drei offenen. Next selbst
rät von Proxy ab, und für Sprache über Pfad-Prefix gibt es in 16 den besseren
Weg ohne Proxy: `app/[locale]/…` plus `await locale()` aus `next/root-params`.
Zwingend ist der Proxy nur, wenn der Diskriminator der Host ist oder wenn beim
ersten Besuch aus `Accept-Language` geraten und persistiert werden soll.

Der Umfang — rund 25 Zeilen plus ein Export in react — macht es vertretbar,
aber nicht dringend. Wer nur eine Site und eine Sprache hat, braucht davon
nichts; `getEmporixClient({ context })` reicht.

## Offene Follow-ups danach

1. `docs/nextjs.md` mit dem `images.remotePatterns`-Eintrag für `next/image`.
   Emporix-Media dokumentiert keine Transform-Parameter, also gibt es keinen
   Custom-Loader zu schreiben; `packages/next/README.md` nennt `remotePatterns`
   bereits.
2. Die acht Storage-Key-Literale zwischen
   `packages/react/src/storage/cookie-core.ts` und
   `packages/react/src/storage/web-storage.ts` teilen. Die Duplikation hat die
   `cookie-core`-Extraktion überlebt — web-storage nutzt sie als
   localStorage/sessionStorage-Keys, nicht als Cookie-Namen. Der hier
   hinzukommende `COOKIE_NAMES`-Export aus `./ssr` macht diese Aufgabe
   sichtbarer, löst sie aber nicht.
3. EUR/CHF-Divergenz im Example: `providers.tsx:24` bindet
   `{ currency: "EUR", siteCode: "main", targetLocation: "DE" }`,
   `app/emporix.ts:19` dagegen `{ siteCode: "main", currency: "CHF" }`. Als
   separate Aufgabe abgetrennt.
