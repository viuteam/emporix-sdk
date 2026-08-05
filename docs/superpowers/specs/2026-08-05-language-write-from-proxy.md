# Darf die Middleware das Sprach-Cookie aus dem Pfad schreiben?

**Status:** Analyse, Entscheid offen
**Datum:** 2026-08-05
**Betrifft:** `packages/next/src/proxy.ts` (`emporixSiteProxy`), `examples/next-server-first/proxy.ts`
**Anlass:** Beim Messen für den verworfenen Prefetch-Guard (siehe `../plans/2026-08-05-prefetch-guard-proxy.md`) ist ein eigenständiger Defekt aufgefallen.

## Der Defekt

`emporixSiteProxy` schreibt `emporix.language` aus dem ersten Pfadsegment — auf **jedem** Request, der die Middleware erreicht. Ein Prefetch ist ein solcher Request. Also gilt:

> Ein Link in die andere Sprache, der prefetchbar ist, stellt die Sprache des Besuchers um, sobald er ins Blickfeld gerät. Ohne Klick.

Die Sitzungsrouten (`/cart`, `/checkout`, `/account/…`) lesen genau dieses Cookie. Sie rendern danach in einer Sprache, die niemand gewählt hat, und es heilt nicht von selbst — erst der Besuch einer Seite in der beabsichtigten Sprache setzt es zurück.

### Belegt, nicht vermutet

Gemessen am 2026-08-05 gegen `next start`, mit einem echten `<Link prefetch>` in Chrome (kein curl-Kunstprodukt). Der Prefetch-Request auf `/en/product/…` von einer `/de`-Seite aus, mit `cookie: emporix.language=de`:

```
Request-Header (vom Browser gesendet):
  next-router-prefetch: 1
  rsc: 1
  next-router-segment-prefetch: /_tree

Antwort:
  set-cookie: emporix.language=en; Max-Age=31536000
  x-nextjs-cache: MISS
```

Die Sprache kippte auf `en`. Der Besucher hatte nichts angeklickt.

## Warum kein Guard hilft

Der naheliegende Fix — «auf einem Prefetch nichts schreiben» — ist in der Middleware **nicht umsetzbar**. Eine Sonde, die die eingehenden Header als Antwort-Header ausgibt, zeigt:

| Header / Signal | Dokument-Navigation | fetch-/RSC-Request (Prefetch **und** clientseitige Navigation) |
|---|---|---|
| `next-router-prefetch` | `null` | `null` |
| `rsc` | `null` | `null` |
| `next-router-segment-prefetch` | `null` | `null` |
| `_rsc`-Query-Parameter | `false` | `false` |
| `sec-purpose` | `null` | `null` |
| **`sec-fetch-mode`** | **`navigate`** | **`cors`** |
| **`sec-fetch-dest`** | **`document`** | **`empty`** |

**Next entfernt jedes eigene Router-Signal, bevor die Middleware läuft** — auch den `_rsc`-Query-Parameter, obwohl er in der URL steht. Im `Vary`-Header der Antwort steht `next-router-prefetch` trotzdem: Next benutzt ihn intern, gibt ihn der Middleware aber nicht.

Damit kann die Middleware einen Prefetch **nicht** von einer echten clientseitigen Navigation unterscheiden. Ein Guard auf «ist RSC-Request» würde beide treffen.

Was sie **kann**: eine echte Top-Level-Navigation von allem anderen unterscheiden. `sec-fetch-mode` ist browsergesetzt, Next hat keinen Grund es zu entfernen, und die Messung bestätigt, dass es ankommt.

## Wie es dazu kam

Vor PR #230 schrieb nur `/api/session/language` (der Umschalter) das Cookie. Die Lücke: wer den Umschalter nie anklickt, hat kein Cookie, und dann greift in `examples/shared/src/adapters.ts` die `LOCALE_ORDER` — die mit `en` beginnt. Ergebnis: deutscher Katalog, englischer Warenkorb.

\#230 hat das geschlossen, indem der Proxy das Cookie aus dem Pfad schreibt. Der Tausch war «Cookie fehlt manchmal» gegen «Cookie ist manchmal falsch». Netto eine Verbesserung — der häufige Fall ist jetzt richtig —, aber der neue Fehlerfall ist nichtdeterministisch und überraschend, und das ist die unangenehmere Sorte.

**Heute ist der Defekt latent:** das Beispiel hat keinen prefetchbaren Link in die andere Sprache. Der Umschalter zeigt auf `/api/session/language`, und der Matcher schliesst `api` aus. Er wird scharf, sobald jemand `<Link>` einbaut — also **genau dann, wenn E2 kommt**.

## Vier Optionen

### A — Nur bei echter Dokument-Navigation schreiben

Gate auf `sec-fetch-mode === "navigate"`.

| Fall | Verhalten |
|---|---|
| Frischer Einstieg auf `/de/x` | Dokument → schreibt ✓ (die Lücke von #230 bleibt geschlossen) |
| Prefetch von `/en/y` | kein Dokument → schreibt nicht ✓ (Defekt behoben) |
| Clientseitige Navigation zu `/en/y` | kein Dokument → schreibt nicht |

Die dritte Zeile ist der Preis, und er ist kleiner als er aussieht: die **einzige** beabsichtigte Sprachänderung in dieser App läuft über den Umschalter, und der schreibt sein Cookie selbst über den Route-Handler. Der Middleware-Schreibvorgang zählt nur für den *Erstkontakt* — und ein Erstkontakt ist immer eine Dokument-Navigation.

Offen zu entscheiden: was gilt, wenn `sec-fetch-mode` fehlt (alte Browser, curl, Bots)? «Fehlt = nicht navigate» ist fail-closed in Richtung der #230-Lücke; «fehlt = navigate» ist fail-open in Richtung des Prefetch-Defekts. Ich würde fail-open nehmen, weil der fehlende Header bei einem Bot auftritt, dessen Cookie niemanden interessiert.

**Aufwand:** klein, im Paket, mit Unit-Tests abbildbar. **Risiko:** eine weitere Header-Annahme — diesmal gemessen.

### B — Sitzungsrouten nach `/[lang]/…` ziehen

Dann liest **jede** Route die Sprache aus der URL, und das Cookie wird für die Sprache überhaupt nicht mehr gebraucht. Der Schreibvorgang in der Middleware entfällt, die Fehlerklasse verschwindet vollständig.

**Aufwand:** acht Routen plus jeder interne Link, `safeNext`, die Login-Weiterleitungskette, `swapLanguage`, die e2e-Specs. **Risiko:** gross im Diff, klein im Konzept.

Anmerkung: die CMS-Analyse in dieser Session hat unabhängig davon für diese Option argumentiert — ein CMS besitzt auch die Hülle (Navigation, Footer, Labels), und die ist pro Sprache und auf jeder Route nötig. Wenn ein CMS kommt, ist B ohnehin fällig.

### C — `LOCALE_ORDER` nach Tenant-Default sortieren

`examples/shared/src/adapters.ts` beginnt mit `["en", "en-US", "de", …]`. Der `viu`-Tenant hat `defaultLanguage: "de"` (gemessen 2026-08-04). Eine cookielose Anfrage fällt also auf Englisch, obwohl der Tenant Deutsch sagt.

Behebt den Prefetch-Defekt **nicht** — ein falsch gesetztes Cookie bleibt falsch. Aber es ist ein eigenständiger Fehler in geteiltem Code und macht den cookielosen Zustand harmlos genug, dass A ohne Not fail-closed sein darf.

**Aufwand:** eine Zeile. Sollte unabhängig vom Rest passieren.

### D — Nichts tun, dokumentieren

Regel: «Nie einen prefetchbaren Link in eine andere Sprache legen.» Zerbrechlich — genau die Art Regel, an die sich in sechs Monaten niemand erinnert, und E2 ist der erste Anlass, sie zu brechen.

## Empfehlung

1. **C sofort** — eine Zeile, eigenständiger Fehler, unabhängig richtig.
2. **A als nächstes** — behebt den gemessenen Defekt im Paket, kleiner Diff, testbar. Damit ist E2 (`<Link>`) gefahrlos.
3. **B als Architekturentscheid vertagen** — nicht wegen dieses Fehlers, sondern wenn das CMS kommt. A und B schliessen sich nicht aus; A ist auch dann richtig, wenn B später folgt.

**Nicht empfohlen:** D, und ein Prefetch-Guard in jeder Form — der ist gemessen unmöglich.

## Was vor der Umsetzung von A noch zu prüfen ist

- Verhält sich `sec-fetch-mode` hinter einem TLS-terminierenden Reverse-Proxy und auf Vercel gleich? Die Messung war `next start` auf localhost.
- Betrifft der Gate auch `emporix.siteCode`? Beide Werte stehen in `PUBLIC_KEYS` und beide sind Besucherzustand — ich würde sie gleich behandeln, aber `siteCode` kommt in diesem Beispiel aus einer Konstante und nicht aus dem Pfad, ist also nie «falsch».
- Schreiben die 238 next-Tests eine Zusicherung fest, die der Gate bricht? `proxy.test.ts` baut seine Requests ohne `sec-fetch-mode` — mit fail-open bleiben sie grün, mit fail-closed müssten zehn Tests den Header setzen. Das ist ein Argument mehr für fail-open.
