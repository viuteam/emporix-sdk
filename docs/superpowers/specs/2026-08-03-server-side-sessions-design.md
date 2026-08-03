# Serverseitige Sessions mit Store-Adapter — Design

**Status:** approved (2026-08-03)
**Datum:** 2026-08-03
**Betroffen:** `packages/next`, `examples/next-server-first`
**Vorgänger:** `2026-08-03-session-cookie-hardening-design.md` — dort als
Nicht-Ziel geführt, mit dem Vermerk «strikt stärker, kostet Infrastruktur»

## Ziel

Die Session-Werte wandern aus dem Browser in einen vom Consumer gestellten
Store. Im Cookie bleibt eine opake Id. Das gibt die eine Fähigkeit, die
verschlüsselte Cookies prinzipiell nicht haben: eine **einzelne** Session
löschen.

Der Store ist ein Adapter mit drei Methoden. Das Package bringt **keine**
Store-Implementierung mit und bleibt bei null Runtime-Dependencies; der
Redis-Adapter lebt im Example.

## Die zentrale Mechanik

Ein Store ist async. `AnonymousSessionStore` ist synchron deklariert
([core/auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42)) und wird
mitten im Token-Refresh gerufen. Dieselbe Wand wie bei der Cookie-Verschlüsselung
— diesmal aber sauber lösbar, weil `sessionCookieJar()` **schon** async ist:

1. Session-Id aus dem Cookie lesen.
2. `await store.read(id)` → ein flaches `Record<string, string>`.
3. Einen **synchronen** Jar über diesem Record zurückgeben.
4. Änderungen im Record markieren, am Ende einmal `await flush()`.

**Oberhalb des Jars ändert sich nichts.** `session-auth.ts` und
`session-client.ts` bleiben unverändert. Der Store ist eine *Implementierung*
des Jars, kein zweiter Codepfad — dieselbe Form, die bei der Verschlüsselung
funktioniert hat.

### Wer flusht

Vier Stellen rufen `sessionCookieJar()`, alle im Package, alle async:

| Stelle | Flush? |
|---|---|
| `emporixLogin` ([session-auth.ts:66](../../../packages/next/src/session-auth.ts#L66)) | ja |
| `emporixRefresh` ([session-auth.ts:150](../../../packages/next/src/session-auth.ts#L150)) | ja |
| `emporixLogout` ([session-auth.ts:224](../../../packages/next/src/session-auth.ts#L224)) | ja, plus `destroy` |
| `run` in `session-client.ts:93` | nur die **mutable** Variante |

Die read-only Variante flusht nie — das halbiert die Stellen, an denen ein
vergessener Flush möglich ist. Pro Einstiegspunkt kommt ein Test, der belegt,
dass geschrieben wurde; das ist die einzige Absicherung gegen eine fünfte
Stelle, die es später vergisst.

## Der Adapter

```ts
export interface EmporixSessionStore {
  /** The record, or `null` when the id is unknown or expired. */
  read(id: string): Promise<Record<string, string> | null>;
  /** Replaces the record and sets its expiry. */
  write(id: string, record: Record<string, string>, ttlSeconds: number): Promise<void>;
  /** Removes the record. Must not throw when the id is unknown. */
  destroy(id: string): Promise<void>;
}
```

Drei Methoden. `ttlSeconds` pro Write, damit der Store das Ablaufen übernimmt
(bei Redis `SET … EX`). Kein `touch`, kein `list`, kein `keys` — was niemand
braucht, kann auch nicht falsch implementiert werden.

`write` **ersetzt** den Record vollständig statt zu mergen. Ein Merge bräuchte
Konfliktregeln für zwei parallele Requests derselben Session; ein Ersetzen macht
den letzten Schreiber zum Gewinner, was für Session-Zustand die richtige und
erwartbare Semantik ist.

### Verdrahtung

`store?: EmporixSessionStore` in `WithEmporixSessionOptions`
([session-client.ts:11-25](../../../packages/next/src/session-client.ts#L11)).
Kein globaler Zustand: wer ihn vergisst, bekommt keinen Laufzeitfehler, sondern
schlicht den Cookie-Modus — und wer ihn im Typ vergisst, einen Typfehler.

`emporixTokenProxy` und `emporixSession` bekommen die Option ebenfalls; beide
lesen Cookies heute direkt und finden im Store-Modus nur eine Id. Das sind
**dieselben zwei Stellen**, die schon bei der Cookie-Härtung übersehen worden
waren — diesmal stehen sie vorher im Plan.

## Was im Cookie bleibt

| Cookie | Store-Modus |
|---|---|
| `emporix.sid` (**neu**) | 32 Zufallsbytes base64url, httpOnly, `__Host-`, `maxAge` = Rest-Lebensdauer |
| `emporix.siteCode` | **bleibt Cookie** — absichtlich browserlesbar |
| `emporix.language` | **bleibt Cookie** — absichtlich browserlesbar |
| die anderen sechs | im Store |

Die sechs, die wandern: `customerToken`, `refreshToken`, `saasToken`, `cartId`,
`activeLegalEntityId`, `anonymousSession` — dazu die zwei package-eigenen
`customerTokenExpiresAt` und `sessionStartedAt`.

`siteCode` und `language` **müssen** Cookies bleiben: der Site-Proxy schreibt
sie browserlesbar, damit ein Client-seitiger Sprachwechsel funktioniert. Sie in
den Store zu ziehen würde den Zweck von `emporixSiteProxy` zerstören.

### Drei Probleme lösen sich dabei von selbst

- Das **4-KB-Limit pro Cookie** beim `saasToken` — offener Punkt 2 der
  Härtungs-Spec. Im Store gibt es keine Grössenbeschränkung.
- **Was im `saasToken`-JWT steht** — offener Punkt 3. Irrelevant, sobald er den
  Browser nie erreicht.
- **Integrität für `cartId` und `activeLegalEntityId`** — die app-eigenen Werte,
  denen der Server vertraut. Sie stehen gar nicht mehr im Browser, also gibt es
  nichts zu manipulieren.

### `EMPORIX_COOKIE_SECRET` wird im Store-Modus nicht angewandt

Eine Zufalls-Id zu verschlüsseln bringt nichts — sie ist bereits
bedeutungsfrei ohne den Store. Der Cookie-Modus behält die Verschlüsselung
unverändert; sie wird nicht entfernt, nur nicht auf die `sid` angewandt. Das
gehört ausdrücklich in die README, sonst setzt jemand beides und rechnet mit
Wirkung.

## Lebensdauern

Die Store-TTL ist die **Restzeit**, nicht ein fixes Fenster. Damit stirbt der
Key genau dann, wenn die Session stirbt, und es gibt keinen Widerspruch zwischen
einer gleitenden TTL und einer nicht gleitenden Decke.

| Session | TTL beim Schreiben |
|---|---|
| Kundin (Stempel vorhanden) | `SESSION_ABSOLUTE_MAX - (jetzt - sessionStartedAt)` |
| Gast (kein Kundentoken) | `SESSION_GUEST_MAX`, gleitend |

**Gast: 7 Tage, gleitend.** Bei einer anonymen Session gibt es kein Konto zu
schützen, also auch keinen Grund für eine harte Decke. Gemessen relevant ist,
dass Emporix' anonymer Access-Token **1 Stunde** gültig ist und über den
Refresh-Token erneuert wird — die Gast-Erfahrung hängt also am Refresh-Token,
nicht an dieser TTL. Sieben Tage decken einen liegengelassenen Warenkorb
komfortabel ab und reduzieren die Key-Retention gegenüber den heutigen 30 Tagen
im Cookie um mehr als das Vierfache.

**Warum das zählt:** heute kostet ein Gast nur Cookies. Im Store-Modus erzeugt
**jeder** Besucher einen Key. Bei Bot-Traffic ist das ein echter operativer
Posten, und 7 statt 30 Tage ist der billigste Hebel dagegen.

## Was «Widerruf» hier heisst — und was nicht

Der Store *kann* eine Session löschen, und `emporixLogout` tut es via
`destroy`. Das ist die Fähigkeit, die verschlüsselte Cookies nicht haben.

**Es gibt keine Admin-API.** Ein Operator kennt die `sid` nicht, er kennt die
Kundin. «Alle Sessions von Kundin X killen» bräuchte einen Index
`customerId → sid[]`, und der ist **nicht Teil dieser Arbeit**: der Record
enthält die Kunden-Id, ein Consumer kann sich den Index in seinem eigenen Store
bauen und dann `destroy` rufen. Das hier zu bauen hiesse, eine
Index-Invalidierung samt Aufräumlogik zu erfinden, die niemand angefragt hat.

Der ehrliche Satz für die README: der Store macht Widerruf **möglich**, das
Package liefert ihn nicht als Feature.

## Der Redis-Adapter im Example

`examples/next-server-first/app/session-store.ts`, gegen `redis` (node-redis).
Als Dependency des **Examples**, nicht des Packages.

Ein selbstgeschriebener RESP-Client über `node:net` wäre machbar und
dependency-frei, aber das Example soll zeigen, was ein Consumer wirklich
schreibt — und das ist ein echter Client mit Reconnect und Fehlerbehandlung.

```ts
// Memoized like getEmporixClient: a module-level connection would leak one
// socket per HMR reload in dev.
export function redisSessionStore(): EmporixSessionStore
```

Konfiguration über `EMPORIX_SESSION_REDIS_URL`. Fehlt sie, bleibt der Store
`undefined` und das Example läuft im Cookie-Modus — beide Modi bleiben so
jederzeit ausprobierbar, ohne Code zu ändern.

## Nicht-Ziele

- **Kein Index `customerId → sid[]`.** Siehe oben.
- **Kein Store im Package.** Das Interface ja, eine Implementierung nein. Sonst
  fällt die Null-Dependency-Zusage.
- **Kein Merge in `write`.** Letzter Schreiber gewinnt.
- **Keine Änderung am Cookie-Modus.** Er bleibt vollständig funktionsfähig,
  inklusive Verschlüsselung, für Consumer ohne Store.
- **Keine Änderung am React-Package.** Ein Browser-Storage-Adapter kann keinen
  serverseitigen Store ansprechen. F-01 bleibt für den SPA-Weg offen.

## Tests

**Store-Jar** — `packages/next/tests/session-store.test.ts`, neu, gegen einen
`Map`-basierten Fake-Store (im Testfile, nicht exportiert):

| # | Erwartung |
|---|---|
| 1 | Ohne `store` verhält sich alles wie heute — Werte landen in Cookies |
| 2 | Mit `store` steht im Cookie nur `emporix.sid`, kein Token |
| 3 | Die `sid` ist httpOnly und `__Host-`-präfixiert über https |
| 4 | Ein Wert, der über den Jar geschrieben wurde, liegt nach dem Flush im Store |
| 5 | Ein zweiter Request mit derselben `sid` liest ihn zurück |
| 6 | Eine unbekannte `sid` verhält sich wie eine leere Session, nicht als Fehler |
| 7 | `emporixLogout` ruft `destroy` und löscht das `sid`-Cookie |
| 8 | `siteCode` bleibt auch im Store-Modus ein Cookie |
| 9 | Die read-only Variante schreibt **nicht** in den Store |
| 10 | Ein Store, dessen `read` wirft, ergibt eine leere Session statt eines 500 |

**Lebensdauern**:

| # | Erwartung |
|---|---|
| 11 | Kunden-TTL ist die Restzeit bis zur Decke, nicht `SESSION_ABSOLUTE_MAX` |
| 12 | Gast-TTL ist `SESSION_GUEST_MAX` und gleitet über mehrere Writes |
| 13 | Eine Session jenseits der Decke wird abgeräumt, `destroy` inklusive |

**Alle drei Leser**:

| # | Erwartung |
|---|---|
| 14 | `emporixTokenProxy` findet den Token im Store, nicht im Cookie |
| 15 | `emporixSession` liest die Session aus dem Store |
| 16 | `withEmporixSession` löst customer/anonymous korrekt aus dem Store auf |

Test 9 ist der wertvollste: ohne ihn schreibt ein Server-Component-Render
womöglich in den Store, was Next bei Cookies verhindert, bei einem Store aber
nicht — der Fehler wäre unsichtbar und würde stillschweigend Zustand
verschieben. Er gehört mutationsgeprüft.

Test 1 ist der zweitwichtigste: er ist der Beleg, dass der Cookie-Modus
unangetastet bleibt.

**Live gegen Redis** — läuft in Podman auf 6379, mit `+PONG` verifiziert:

1. Gast: Warenkorb füllen, `redis-cli KEYS 'emporix:*'` zeigt **einen** Key.
2. Der Cookie-Jar im Browser enthält **nur** `emporix.sid` und
   `emporix.siteCode`.
3. `/debug` bleibt grün.
4. Denselben Key von Hand löschen → `/cart` sagt «No cart yet». Das ist der
   Widerruf einer *einzelnen* Session, live.
5. `redis-cli TTL <key>` liegt bei ~7 Tagen für den Gast.
6. Eingeloggt: derselbe Ablauf, TTL bei ~90 Tagen, `saasToken` im Record und
   nicht im Browser.

Punkt 4 ist der eigentliche Beleg dieser ganzen Arbeit. Punkt 6 verlangt einen
Login und damit die Hand der Nutzerin am Passwortfeld.

## Offene Punkte

1. **Ein Read pro Session-Operation.** `emporixLogin` und `emporixRefresh` rufen
   `sessionCookieJar()` je einmal, `withEmporixSession*` ebenfalls. Eine Seite,
   die zweimal `withEmporixSession` ruft, liest also zweimal aus dem Store. Eine
   Memoisierung pro Request wäre über `cache()` aus React möglich, funktioniert
   aber nicht im Proxy, der kein React-Kontext ist. Erst messen, ob es weh tut.
2. **Kein Locking.** Zwei parallele Requests derselben Session können sich
   überschreiben. Für Session-Zustand ist das akzeptabel; für den Token-Refresh
   heisst es, dass zwei gleichzeitige Refreshes denselben Refresh-Token
   einlösen. Wir haben gemessen, dass Emporix das bei anonymen Tokens toleriert;
   für Kunden-Tokens ist es ungeprüft und gehört beobachtet.
