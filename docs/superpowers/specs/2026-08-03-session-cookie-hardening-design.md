# Session-Cookie-Härtung — Design

**Status:** approved (2026-08-03) — absolute Obergrenze auf 90 Tage entschieden
**Datum:** 2026-08-03
**Betroffen:** `packages/next` (`session-cookies.ts`, `session-auth.ts`, `token-proxy.ts`)
**Vorgänger:** Security-Review vom 2026-07-30, Findings **F-02** und **F-03**

## Ziel

Drei Massnahmen an denselben Cookies, in einem Zug, weil zwei davon dieselben
Sessions invalidieren und niemand zweimal ausgeloggt werden soll:

1. Eine **absolute Obergrenze** für die Session-Dauer.
2. Das **`__Host-`-Präfix** auf allen Session-Cookies.
3. **Optionale Verschlüsselung** der Cookie-Inhalte.

## Gemessene Grundlagen

### Die Session läuft heute nie ab

Das ist der Befund, der die Reihenfolge bestimmt.

`SESSION_MAX_AGE.refreshToken` steht auf 30 Tagen
([session-cookies.ts:10](../../../packages/next/src/session-cookies.ts#L10)),
aber `persistSession` schreibt das Cookie bei **jedem** Refresh neu — und
`emporixRefresh` ruft `persistSession`
([session-auth.ts:162](../../../packages/next/src/session-auth.ts#L162)), während
der Proxy `emporixRefresh` bei jedem abgelaufenen Access-Token ruft
([token-proxy.ts:63](../../../packages/next/src/token-proxy.ts#L63)).

Die 30 Tage sind also **30 Tage Inaktivität**, nicht 30 Tage Session. Wer alle
paar Tage vorbeischaut, bleibt unbegrenzt angemeldet. Ein gestohlenes Cookie,
das jemand aktiv nutzt, verfällt nie von selbst.

### Der Cookie-Jar muss synchron bleiben

`AnonymousSessionStore` ist synchron deklariert
([core/auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42)):

```ts
read(): { refreshToken: string; sessionId: string } | null;
write(session: { refreshToken: string; sessionId: string } | null): void;
```

Die SDK ruft ihn mitten im Token-Refresh auf (`auth.ts:195`, `:322`, `:379`),
synchron. `session-client.ts` bedient ihn aus dem Cookie-Jar. Ein `async`
`get`/`set` wäre damit nicht mehr anschliessbar.

**Folge: WebCrypto scheidet aus.** `crypto.subtle` ist ausschliesslich
asynchron. Es muss `node:crypto` mit `createCipheriv`/`createDecipheriv` sein —
synchron, und damit ohne jede Signaturänderung.

Das ist tragfähig, nicht nur zulässig:

- `webhook.ts:1` importiert **bereits** `node:crypto` (`createHmac`,
  `timingSafeEqual`). Der Präzedenzfall steht im Package.
- Der Proxy ist Node-Runtime-only, seit Next 16 `middleware` zu `proxy`
  umbenannt hat — `export const runtime = "edge"` wirft dort
  ([README:441-444](../../../packages/next/README.md)).
- Das Package bleibt bei **null Runtime-Dependencies**; `node:crypto` ist
  eingebaut.

### Was im Jar steht

| Cookie | Inhalt | Wer vertraut ihm |
|---|---|---|
| `emporix.customerToken` | opakes Emporix-Token | Emporix validiert |
| `emporix.refreshToken` | Refresh-Token | Emporix validiert |
| `emporix.saasToken` | **JWT** — Payload von Bauart lesbar | Emporix validiert |
| `emporix.customerTokenExpiresAt` | Epoch-Sekunden | **die App** (Proxy-Entscheidung) |
| `emporix.cartId` | Cart-Id | **die App** |
| `emporix.anonymousSession` | `{refreshToken, sessionId}` | Emporix validiert |
| `emporix.activeLegalEntityId` | Legal-Entity-Id | **die App** — geht an `customers.refresh({legalEntityId})` ([session-auth.ts:150](../../../packages/next/src/session-auth.ts#L150)) |
| `emporix.siteCode`, `emporix.language` | Site/Sprache | browserlesbar **mit Absicht** |

Die drei mit «die App» sind der Grund, warum Integritätsschutz hier nicht
vakuum ist: es sind app-eigene Werte, die der Server glaubt, keine von Emporix
gegengeprüften Tokens.

## 1. Absolute Session-Obergrenze

Das gleitende Fenster bleibt — es ist das UX-Versprechen «du bleibst
angemeldet». Dazu kommt eine Decke, die nicht mitgleitet.

- `emporixLogin` schreibt `emporix.sessionStartedAt` (Epoch-Sekunden).
- `emporixRefresh` prüft sie zuerst. Ist die Decke überschritten, räumt es die
  Session ab wie `emporixLogout` und gibt `null` zurück — der Proxy behandelt
  das bereits als «nicht angemeldet».
- `emporixLogout` löscht sie mit.

Kein neuer Mechanismus: `SESSION_EXPIRES_AT` ist exakt dasselbe Muster, und der
Durchsetzungspunkt existiert schon.

**Vorgeschlagene Werte, brauchen deine Freigabe:**

| Fenster | Vorschlag | Heute |
|---|---|---|
| Leerlauf (gleitend) | 30 Tage | 30 Tage |
| **Absolut (neu)** | **90 Tage** — entschieden | unbegrenzt |

90 Tage ist keine Ableitung, sondern eine Abwägung. Für einen B2C-Storefront ist das
bequem und begrenzt die Ausbeute eines gestohlenen Cookies auf ein Quartal. Wenn
viu B2B-Kunden mit Legal-Entity-Wechsel bedient, wäre 30 Tage angemessener —
dort hängt an der Session mehr als ein Warenkorb. Sollte viu diesen Fall
ernsthaft bedienen, gehört der Wert nochmals angeschaut — die Mechanik ist vom
Wert unabhängig, es ist eine Konstante.

## 2. `__Host-`-Präfix

`__Host-emporix.customerToken` statt `emporix.customerToken`. Der Browser
erzwingt dann `Secure`, `Path=/` und **kein `Domain`** — eine kompromittierte
Subdomain kann kein Cookie für die Parent-Domain unterschieben.

Wir erfüllen alle drei Bedingungen bereits
([session-cookies.ts:78-86](../../../packages/next/src/session-cookies.ts#L78)),
nutzen das Präfix aber nicht.

**Ausnahme, die es braucht:** auf `http://localhost` verweigert der Browser
`__Host-`-Cookies, weil `Secure` fehlt. Das Präfix hängt deshalb an derselben
Ableitung wie `secure` heute — kein zweiter Schalter, sonst driften die beiden
auseinander.

**Die browserlesbaren bleiben ohne Präfix.** `emporix.siteCode` und
`emporix.language` werden vom Site-Proxy geschrieben und sind absichtlich
JS-lesbar; `__Host-` würde daran nichts ändern, aber der Name steht in
`STORAGE_KEYS` und wird auch vom React-Package gelesen. Eine Umbenennung dort
wäre eine Änderung an einem anderen Package für null Sicherheitsgewinn.

## 3. Verschlüsselung — opt-in

### Warum optional

Der Nutzen ist real, aber eng: Verschlüsselung verhindert **keinen**
Session-Hijack. Wer das Cookie hat, ist drin, Chiffretext hin oder her. Was sie
bringt:

- Ein Klartext-`refreshToken` aus einem Log oder einer HAR-Datei ist direkt
  gegen `api.emporix.io` einlösbar — an deinem Rate-Limiting und deinen Logs
  vorbei. Chiffretext funktioniert nur gegen deine App.
- **Massen-Logout ohne Store:** Schlüssel aus der Liste entfernen, alle Sessions
  sofort tot. Das kann das zustandslose Design heute überhaupt nicht.
- Integrität für die drei app-vertrauten Werte oben.
- Der `saasToken`-JWT ist sonst lesbar, auch nach Ablauf.

Das rechtfertigt ein Angebot, keinen Zwang.

### Aktivierung

`EMPORIX_COOKIE_SECRET` gesetzt → verschlüsselt. Nicht gesetzt → wie heute.

Wert ist eine **kommaseparierte Liste** base64url-kodierter 32-Byte-Schlüssel.
Der erste verschlüsselt, alle entschlüsseln — ohne das loggt jede Rotation
alle aus, was die Rotation praktisch verhindert.

```
EMPORIX_COOKIE_SECRET="<neu>,<alt>"
```

Ein zu kurzer oder nicht dekodierbarer Schlüssel wirft beim ersten Zugriff mit
dem Befehl zum Erzeugen in der Meldung. **Keine Passphrasen und keine KDF:** wer
eine Passphrase eingeben darf, gibt eine schwache ein, und die KDF-Parameter
wären eine weitere Sache, die falsch sein kann.

### Format

```
v1.<base64url(iv ‖ ciphertext ‖ tag)>
```

- **AES-256-GCM**, 12-Byte-IV aus `randomBytes`, 16-Byte-Tag. AEAD, nicht
  Verschlüsselung allein — CBC ohne MAC wäre hier der klassische Fehler.
- Das `v1.`-Präfix erlaubt einen späteren Algorithmuswechsel und macht
  erkennbar, ob ein Wert überhaupt verschlüsselt ist.
- **AAD ist der Cookie-Name.** Ohne das liesse sich ein `saasToken`-Chiffretext
  ins `customerToken`-Cookie umhängen.

### Was verschlüsselt wird

Alle httpOnly-Cookies aus der Tabelle oben, inklusive
`customerTokenExpiresAt`. Der Zeitstempel ist kein Geheimnis, aber der Proxy
*vertraut* ihm, und eine einheitliche Regel ist weniger fehleranfällig als eine
Ausnahmeliste, die jemand pflegen muss.

`siteCode` und `language` bleiben Klartext — sie sind der Zweck des
Site-Proxys.

### Migration: alle werden ausgeloggt

Kein Klartext-Fallback. Wer die Verschlüsselung einschaltet, loggt jede laufende
Session aus.

Die Alternative wäre ein Übergangsfenster, in dem auch Klartext akzeptiert wird
— und weil das Refresh-Cookie 30 Tage lebt, müsste dieses Fenster 30 Tage offen
bleiben. In dieser ganzen Zeit wäre der Integritätsschutz für `cartId` und
`activeLegalEntityId` wirkungslos, und der Schalter wäre etwas, das jemand
danach entfernen muss. Ein einmaliger Logout ist billiger als beides.

Dasselbe gilt für das `__Host-`-Präfix: es ändert Cookie-**Namen**, die alten
werden nicht mehr gefunden. **Deshalb landen alle drei Punkte in einem Release**
— ein Logout, nicht zwei.

## Nicht-Ziele

- **Serverseitige Sessions** (opake Id im Cookie, Tokens im Store). Strikt
  stärker, weil sie *einzelne* Sessions widerrufen können. Kostet Infrastruktur,
  die das Package heute nicht braucht, und ist eine eigene Entscheidung.
- **Refresh-Token-Reuse-Detection.** Braucht Unterstützung von Emporix. Wir
  haben im Server-First-Zyklus gemessen, dass Emporix *anonyme* Reuse toleriert
  — was dagegen spricht, aber für Kunden-Tokens nicht geprüft ist. Erst messen,
  dann planen.
- **Änderungen am React-Package.** Dessen Storage-Adapter schreiben Cookies im
  Browser und können per Definition kein serverseitiges Geheimnis halten. F-01
  bleibt für den SPA-Weg offen.

## Tests

**Krypto** — `packages/next/tests/cookie-crypto.test.ts`, neu:

| # | Erwartung |
|---|---|
| 1 | Round-Trip: `decrypt(encrypt(x)) === x` |
| 2 | Chiffretext ist bei gleichem Klartext **verschieden** (frisches IV) |
| 3 | Verändertes Byte im Chiffretext → wirft (Tag-Prüfung) |
| 4 | Chiffretext von Cookie A unter Namen B → wirft (AAD) |
| 5 | Zweiter Schlüssel in der Liste entschlüsselt, was der erste nicht kann |
| 6 | Schlüssel nicht mehr in der Liste → wirft |
| 7 | Klartextwert ohne `v1.`-Präfix → wirft, nicht «gibt Müll zurück» |
| 8 | Schlüssel kürzer als 32 Byte → wirft beim Laden, mit Erzeugungsbefehl |

Test 4 ist der wertvollste: ohne AAD besteht er trotzdem, und genau das ist die
Vertauschbarkeit, die er verhindern soll. Er gehört mutationsgeprüft.

**Jar und Auth** — Ergänzungen an `session-client.test.ts` / `session-auth.test.ts`:

| # | Erwartung |
|---|---|
| 9 | Ohne `EMPORIX_COOKIE_SECRET` steht Klartext im Cookie — Abwärtspfad |
| 10 | Mit Secret steht **nicht** der Token-Wert im Cookie |
| 11 | `siteCode` bleibt in beiden Fällen Klartext |
| 12 | `__Host-`-Präfix gesetzt, wenn `secure` abgeleitet wahr ist |
| 13 | Kein `__Host-`-Präfix über plain http |
| 14 | Refresh nach Überschreiten der Decke gibt `null` und räumt ab |
| 15 | Refresh knapp unter der Decke rotiert normal |
| 16 | Die Decke gleitet **nicht** — zehn Refreshes verschieben sie nicht |

Test 16 ist der Test für den Befund ganz oben. Ohne ihn wäre die Decke genauso
gleitend wie das Fenster, das sie begrenzen soll.

## Offene Punkte

1. ~~**Passt der verschlüsselte `saasToken` ins Cookie-Limit?**~~ **Im
   Store-Modus gegenstandslos** (`2026-08-03-server-side-sessions-design.md`):
   der Token liegt im Store, wo es keine Grössenbeschränkung gibt. **Im
   Cookie-Modus weiterhin offen** — dort gilt die Rechnung `1.34 × (n + 28)` und
   ab etwa 2,9 KB Klartext ist Schluss. Wer den Cookie-Modus mit Verschlüsselung
   fährt, sollte es einmal messen.
2. ~~**Was steht im `saasToken`-JWT?**~~ **Im Store-Modus gegenstandslos** — er
   erreicht den Browser nicht mehr, also ist es unerheblich, was ein Angreifer
   aus der Payload lesen könnte. Im Cookie-Modus mit Verschlüsselung ebenfalls
   erledigt; nur im unverschlüsselten Cookie-Modus bleibt die Frage offen.
