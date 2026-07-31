# Server-First-Modus im next-Package — Design

**Status:** approved
**Datum:** 2026-07-31
**Package:** `@viu/emporix-sdk-next`
**Anlass:** Finding F-01 aus dem Session-Security-Review (Refresh-Token in
JS-lesbaren Cookies), verschärft durch F-13 (Tokens als URL-Query-Parameter)
**Verwandt:** `2026-07-31-next-service-account-design.md` (der `exports`-Guard),
`2026-07-31-next-proxy-site-detection-design.md` (der Proxy-Entry)

## Ziel

Ein Next-Storefront soll **keinen Emporix-Token im Browser** halten — auch
keinen anonymen. Das react-Package bleibt unverändert als SPA-Weg bestehen; wer
nur eine SPA will, nutzt es weiter mit dem heutigen Sicherheitsprofil.

## Die harte Randbedingung

Jeder Emporix-Call braucht einen Bearer-Token dort, wo der Call entsteht
([http.ts:86](../../../packages/sdk/src/core/http.ts#L86)). Daraus folgt
zwingend:

> «Kein Token im Browser» ist gleichbedeutend mit «der Browser macht keine
> Emporix-Calls».

Es gibt keine dritte Möglichkeit. Der Modus besteht deshalb darin, alle Calls
serverseitig zu verlagern — nicht darin, Tokens besser zu verstecken.

Zwei Wege wurden verworfen:

**Catch-all-Proxy mit Sentinel-Token.** Der Browser behält die react-Hooks, ein
umschreibendes `fetch` leitet alles auf eine eigene Route. Scheitert daran, dass
die Token-Beschaffung das injizierte `fetch` **umgeht**
([auth.ts:252](../../../packages/sdk/src/core/auth.ts#L252) nutzt das globale
`fetch`) — ein anonymer Token landet also doch im Browser. Ausserdem umgeht SSE
es ebenfalls ([http.ts:321](../../../packages/sdk/src/core/http.ts#L321)) und
bricht.

**Die SDK ändern, damit Token-Requests das injizierte `fetch` nutzen.** Würde
den Sentinel-Weg vervollständigen, kehrt aber die dokumentierte Eigenschaft um,
dass Token-Antworten nicht cachebar *sein können* (Kommentar an
`EmporixConfig.fetch`). Eine belegte Eigenschaft gegen eine neue tauschen, und
am Ende bleiben alle Nachteile des Proxys.

## Gemessene Grundlagen

Alles im Repo nachgemessen. **Keine SDK-Änderung nötig** — jeder benötigte
Einhängepunkt ist schon öffentlich.

| Fakt | Quelle |
|---|---|
| `client.tokenProvider` ist public, ausdrücklich «Exposed so React/Next hosts can call `attachAnonymousStore`» | [client.ts:105-110](../../../packages/sdk/src/client.ts#L105) |
| `attachAnonymousStore(store)` bootstrappt mit `expiresAt = 0` → der nächste Aufruf macht ein **Refresh mit erhaltener sessionId**, keinen neuen Login | [auth.ts:189-196](../../../packages/sdk/src/core/auth.ts#L189) |
| `AnonymousSessionStore` ist `{ read(), write() }`, **synchron** | [auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42) |
| `EmporixConfig.tokenProvider` ist eine öffentliche Option, `create-core.ts` nutzt sie statt des Defaults | [config.ts:46](../../../packages/sdk/src/core/config.ts#L46), [create-core.ts:61](../../../packages/sdk/src/core/create-core.ts#L61) |
| `EmporixConfig.fetch` ersetzt das Request-`fetch` an zwei Stellen | [http.ts:149](../../../packages/sdk/src/core/http.ts#L149), [:285](../../../packages/sdk/src/core/http.ts#L285) |
| `emporixTagsForUrl` gibt `[]` für «a different tenant, a non-catalog service, a personalized resource» | [tags.ts:36-42](../../../packages/next/src/tags.ts#L36) |
| Getaggt werden genau fünf Services: `product`, `category`, `price`, `availability`, `site` | [tags.ts:55,62,77,79,81](../../../packages/next/src/tags.ts#L55) |
| Der Session-Store spiegelt externe `setCustomerToken`-Writes in den React-Baum | [customer-session-store.ts:70-72](../../../packages/react/src/hooks/internal/customer-session-store.ts#L70) |
| Ein Server-Component-Render kann keine Cookies schreiben | Next-Doku, und `emporixSession()` ist deshalb read-only |
| Der Proxy **kann** Cookies schreiben und läuft vor jedem Render | heute verifiziert, `2026-07-31-next-proxy-site-detection-design.md` |
| Cart-, Order- und Customer-Endpoints sind nie getaggt | [tags.ts:41](../../../packages/next/src/tags.ts#L41) |

### Vom Tenant bestätigt

**Emporix bindet den Gast-Warenkorb an die anonyme Session.** Beim Anlegen eines
Carts wird die `session-id` des anonymen Tokens auf den Cart gemappt (bestätigt
für den `viu`-Tenant).

Das ist die wichtigste Randbedingung des ganzen Entwurfs. Sie schliesst die
naheliegende Vereinfachung aus, der prozessweit memoisierte anonyme Token des
Servers könne alle Gäste bedienen und `cartId` im Cookie genüge. Jeder Gast
braucht seine **eigene** anonyme Session, serverseitig verwaltet.

## Die vier Bausteine

### 1. Auth-Server-Funktionen

Neuer Entry `@viu/emporix-sdk-next/bff`, mit demselben `exports`-Guard wie
`./service`: er verarbeitet Refresh-Tokens, ein Client-Import muss den Build
brechen. `types` steht dabei ausserhalb der Conditions — TypeScript versteht
`react-server` nicht (im Service-Zyklus gemessen).

```ts
export async function emporixLogin(creds: { email: string; password: string }): Promise<void>;
export async function emporixLogout(): Promise<void>;
export async function emporixRefresh(): Promise<string | null>;
export function assertSameOrigin(request: Request): void;
```

Der Consumer wrappt sie in seiner **eigenen** `"use server"`-Datei:

```ts
// app/actions/auth.ts — die Datei des Consumers trägt "use server"
"use server";
import { emporixLogin, emporixLogout } from "@viu/emporix-sdk-next/bff";

export async function login(formData: FormData): Promise<void> {
  await emporixLogin({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
}
export async function logout(): Promise<void> {
  await emporixLogout();
}
```

Drei Zeilen Boilerplate pro Storefront — dafür braucht das Package **keinen**
`"use server"`-Banner und keine zweite tsup-Config. Server Actions aus einer
Fabrik zu exportieren ist bei Next fragil; die Wrapper-Variante ist robust.

`emporixLogin` fädelt den anonymen Token des Gastes durch, damit der Warenkorb
den Login überlebt (`customers.login` erwartet das,
[customer.ts:122-133](../../../packages/sdk/src/services/customer.ts#L122)). Er
kommt aus dem httpOnly-Cookie, nicht vom Client.

### 2. Token-Rotation ausschliesslich im Proxy

Eine Server Component kann keine Cookies schreiben. Ein Refresh während des
Renders ist damit unmöglich — und ein Refresh, dessen rotierter Token nicht
geschrieben wird, ist wertlos.

Der Proxy ist der einzige Ort, der beides kann: Cookies lesen **und** schreiben,
vor jedem Render. Er wird deshalb der einzige Rotationspunkt, für **beide**
Token-Arten:

```ts
// proxy.ts des Consumers
export async function proxy(request: NextRequest) {
  return emporixTokenProxy(request, { siteCode: "main" });
}
```

`emporixTokenProxy` dekodiert das `exp` des Access-Tokens (base64, ohne
Signaturprüfung — die macht Emporix), refresht bei Nähe zum Ablauf, rotiert die
anonyme Session wenn nötig, schreibt alle betroffenen Cookies und delegiert für
Site/Sprache an das bestehende `emporixSiteProxy`.

Damit ist eine Frage gleichgültig, die sonst blockierend wäre: ob Emporix den
anonymen Refresh-Token bei Benutzung invalidiert. Der rotierte wird immer
geschrieben.

### 3. `withEmporixSession` — ein Helper statt 49 Wrapper

Die Inventur unten zählt **49 Mutationen in 18 Hook-Dateien**. Für jede einen
Server-Action-Wrapper zu liefern wäre «ein Wrapper pro Operation» — dieselbe
Zeremonie, die beim Service-Client verworfen wurde.

Stattdessen zwei Funktionen, die die Session binden:

```ts
/** Für Server Components. Cookie-Writes sind no-ops (Render darf nicht schreiben). */
export async function withEmporixSession<T>(
  fn: (client: EmporixClient, auth: AuthContext) => Promise<T>,
): Promise<T>;

/** Für Server Actions und Route Handlers. Schreibt Cookies. */
export async function withEmporixSessionMutable<T>(
  fn: (client: EmporixClient, auth: AuthContext) => Promise<T>,
): Promise<T>;
```

Die Server Action des Consumers wird zweizeilig, mit voller SDK-Typisierung:

```ts
"use server";
import { withEmporixSessionMutable } from "@viu/emporix-sdk-next/bff";

export async function addToCart(cartId: string, item: CartItemInput) {
  return withEmporixSessionMutable((client, auth) =>
    client.carts.addItem(cartId, item, auth),
  );
}
```

**Die Verzweigung im Inneren ist der eigentliche Wert** und der Grund, warum das
nicht in 19 Consumer-Dateien gehört:

| Fall | Client | AuthContext |
|---|---|---|
| Customer-Token im Cookie | memoisiert, `getEmporixClient({ tagged: false })` | `auth.customer(token)` |
| Gast | **pro Request**, mit `attachAnonymousStore` über den Cookie-Jar | `auth.anonymous()` |

Der Gast-Pfad braucht einen Client pro Request, weil `getEmporixClient()`
prozessweit memoisiert ist — ein Request-Store daran würde die Session von Gast A
zu Gast B durchschlagen lassen. Das ist die direkte Folge der
Session-Bindung des Warenkorbs.

Nebeneffekt, der zählt: `withEmporixSession*` kann gar keinen getaggten Client
liefern. Die Regel «ein Kundencall nie über den getaggten Client» — heute «the
one rule» im README — wird damit wieder **strukturell** statt dokumentiert.

### 4. Katalog-Proxy für clientseitige Katalog-Interaktion

Typeahead, Infinite Scroll und Filter ohne vollen Seitenwechsel wollen
clientseitige Reads. Für Katalogdaten ist ein Proxy die **bessere** Lösung, nicht
nur eine erlaubte:

- Die Daten sind öffentlich — es gibt kein Privileg zu eskalieren.
- Sie sind cachebar — Nexts Fetch-Cache absorbiert den zweiten Hop nach dem
  ersten Request, **einmal für alle Besucher** statt einmal pro Browser. Netto
  schneller als der direkte Weg.
- Die Allowlist existiert bereits: `emporixTagsForUrl(url, tenant).length === 0`
  → 403. Eine Zeile, aufsetzend auf 22 bestehende Tests. Dieselbe Funktion
  definiert die Cache-Grenze und die Proxy-Grenze, weil beide dasselbe brauchen:
  die Unterscheidung öffentlich/personalisiert.

Clientseitig ohne jeden Token:

```ts
new EmporixClient({
  tenant,
  credentials: { storefront: { clientId: "proxied" } },
  tokenProvider: createProxyTokenProvider(),  // Platzhalter, kein Netzwerkaufruf
  fetch: createProxyFetch({ base: "/api/emporix" }),
});
```

`createProxyTokenProvider().getAnonymousToken()` gibt eine Platzhalter-Session
zurück, **ohne** Netzwerkaufruf. Damit wird im Browser nie ein anonymer Token
geprägt — der Blocker des verworfenen Sentinel-Wegs entfällt, weil gar kein
Token-Request stattfindet. Die Route streicht den Platzhalter-Header und setzt
den echten anonymen Token des Servers ein.

Die react-Hooks der Gruppe A unten bleiben damit unverändert clientseitig
nutzbar.

## Cookie-Kontrakt

| Cookie | `httpOnly` | Begründung |
|---|---|---|
| `emporix.customerToken` | **ja** | nur Server Components lesen ihn |
| `emporix.refreshToken` | **ja** | erreicht den Browser nie |
| `emporix.saasToken` | **ja** | der Checkout läuft serverseitig, der `saas-token`-Header wird dort gesetzt |
| `emporix.cartId` | **ja** | nichts clientseitiges braucht ihn |
| `emporix.anonymousSession` | **ja** | enthält einen Refresh-Token ([storage/index.ts:54](../../../packages/react/src/storage/index.ts#L54)); pro Gast, vom Server verwaltet |
| `emporix.activeLegalEntityId` | **ja** | der B2B-Switch ist eine Server Action |
| `emporix.siteCode`, `emporix.language` | nein | keine Geheimnisse; der Proxy schreibt sie schon so, und ein Consumer darf den Provider für anonymes Katalog-Browsing weiter mounten |

Damit sind **alle** Geheimnisse httpOnly, und alle funktionieren — im Unterschied
zu jedem Teilentwurf, bei dem der `saasToken` clientseitig lesbar bleiben musste.
F-01 ist vollständig geschlossen, F-13 clientseitig vollständig.

Attribute: `path=/`, `sameSite=lax`, `secure` aus dem Request-Protokoll
abgeleitet (nicht hart `true` — siehe F-04/F-05), `maxAge` für den
Customer-Token begrenzt.

## CSRF

Exponiert sind nur die eigenen Routen und Server Actions, weil sie als einzige
cookie-authentifiziert sind. Die Emporix-Calls tragen `Authorization: Bearer` und
**kein** Cookie (kein `credentials`-Feld in `http.ts`, Default `same-origin`,
Emporix ist ein anderer Origin) — ein CSRF gegen `addToCart` bei Emporix ist
strukturell unmöglich.

Gewählt: **`sameSite=lax` + POST-only + `Origin`/`Sec-Fetch-Site`-Prüfung in der
Factory.** Abgelehnt wird bei `Sec-Fetch-Site: cross-site` und wenn *weder*
`Sec-Fetch-Site` *noch* `Origin` vorhanden ist — sonst liesse ein Angreifer den
Header einfach weg. Non-Browser-Clients werden damit abgelehnt; für diese Routen
ist das korrekt und wird dokumentiert.

`sameSite=strict` wurde verworfen: eine Top-Level-Rückkehr von einem
Payment-Provider würde das Cookie nicht senden und die Nutzerin erschiene
ausgeloggt. Ein Double-Submit-Token wurde verworfen, weil es hier nichts löst,
was die Origin-Prüfung nicht schon löst.

`assertSameOrigin(request)` wird exportiert, damit Consumer ihre eigenen
state-changing Route Handler damit schützen können. Das schliesst F-07 ab.
Server Actions bringen Nexts eigenen Origin-Check mit; Route Handlers nicht.

## Hook-Inventur: 41 Dateien, vier Gruppen

Vollständig, nicht exemplarisch. Klassifiziert nach Auth-Modus, Read/Mutation und
ob `emporixTagsForUrl` die URL taggt.

### Gruppe A — proxybar, bleiben clientseitig nutzbar (8)

Anonym lesbar **und** getaggt.

`use-products` · `use-variant-children` · `use-categories` · `use-availability` ·
`use-availabilities` · `use-match-prices` · `use-match-prices-chunked` ·
`use-sites`

### Gruppe B — anonym lesbar, aber **nicht** proxybar (3)

Der überraschendste Befund der Inventur: kein Kundentoken nötig, aber nicht
cachebar und damit nicht proxybar. Müssen trotzdem in Server Components.

| Hook | Service | warum `[]` |
|---|---|---|
| `use-cart` (Read-Teil) | `carts` | pro Shopper mutabel |
| `use-checkout` (Read-Teil) | `checkout` | pro Shopper |
| `use-shipping` | `shipping` | nicht in der Tag-Liste |

### Gruppe C — kundengebundene Reads → Server Components (11)

`use-company` · `use-company-contacts` · `use-company-groups` ·
`use-company-locations` · `use-my-companies` · `use-my-orders` ·
`use-my-orders-infinite` · `use-order` · `use-my-segments` · `use-sales-order` ·
`use-customer-addresses` (Read-Teil)

### Gruppe D — Mutationen → Server Actions (49 in 18 Dateien)

Gemessen über `mutationFn`-Vorkommen, nicht über `useMutation`-Zeilen (die den
Import mitzählen).

| Datei | Mutationen |
|---|---|
| `use-company-mutations` | 12 |
| `use-customer-addresses` | 5 |
| `use-shopping-lists` | 5 |
| `use-customer-credentials` | 4 |
| `use-cart` | 3 |
| `use-checkout` | 3 |
| `use-approvals`, `use-coupons`, `use-customer-profile`, `use-password-reset`, `use-session-context` | je 2 |
| `use-cancel-order`, `use-cloud-functions`, `use-order-transition`, `use-reorder`, `use-returns`, `use-reward-points`, `use-update-sales-order` | je 1 |

### Gruppe E — kein Emporix-Call, unverändert nutzbar (4)

`use-company-switcher` · `use-site-context` · `use-customer-session` (orchestriert
nur) · `use-product-media` (reine Ableitung)

### Der ehrliche Preis für den Consumer

Eine typische B2C-Storefront schreibt rund **19 Server Actions**: Cart 3,
Checkout 3, Profil 2, Adressen 5, Session-Context 2, Coupons 2,
Passwort-Reset 2. B2B legt die 12 Company-Mutationen drauf.

Das ist echte Arbeit, aber sie fällt beim **Consumer** an, nicht im Package, und
jede Action ist zwei Zeilen. Niemand braucht alle 49 — man schreibt die, die die
Storefront benutzt.

## Nicht-Ziele

- **Keine Änderung an `packages/react`.** Es bleibt vollständig als SPA-Weg
  bestehen, mit dem Sicherheitsprofil, das der Review beschreibt.
- **Keine Änderung an der SDK.** Jeder Einhängepunkt ist schon öffentlich.
- **Kein Client-Entry im next-Package** für Session-Zwecke. Der
  Katalog-Proxy-Client (`createProxyTokenProvider`, `createProxyFetch`) ist
  browsertauglich und braucht deshalb einen Entry mit `"use client"`-Banner —
  das ist der einzige neue Build-Aufwand.
- **Kein Wrapper pro Operation.** Zwei Helper decken 49 Mutationen und 14 Reads
  ab.
- **Kein Catch-all-Proxy.** Nur Katalog, mit `emporixTagsForUrl` als Allowlist.
- **Keine Migration des Examples in dieser Spec.** Das Example zeigt heute den
  SPA-Weg; ein zweites Example für den Server-First-Modus ist ein eigener
  Folgezyklus.

## Tests

**Auth-Funktionen** (gestubbtes `globalThis.fetch`): Login setzt die
httpOnly-Cookies und gibt **nie** einen Refresh-Token im Body zurück (der
sicherheitsrelevante Test) · Login fädelt den anonymen Token durch · Refresh
rotiert · Logout ruft `customers.logout` und löscht alle Geheimnis-Cookies ·
`assertSameOrigin` lehnt `cross-site` ab · und lehnt ab, wenn beide Header
fehlen.

**Token-Proxy:** refresht bei ablaufendem `exp` · lässt einen frischen Token
unangetastet · rotiert die anonyme Session · schreibt keine Cookies, wenn nichts
zu tun ist (No-op-Guard wie bei `emporixSiteProxy`) · delegiert Site/Sprache
korrekt.

**`withEmporixSession`:** Kunde → memoisierter Client und `auth.customer` · Gast
→ Client pro Request mit angehängtem Store und `auth.anonymous` · zwei
gleichzeitige Gäste bekommen **verschiedene** Clients (die Kernaussage der
Session-Bindung) · `config.fetch` ist `undefined`, also nie getaggt · die
read-only-Variante schreibt keine Cookies.

**Katalog-Proxy:** getaggte URL wird durchgelassen · Cart-, Order- und
Customer-URLs geben 403 · der Platzhalter-Header wird ersetzt, nie
weitergereicht · `createProxyTokenProvider` macht **keinen** Netzwerkaufruf (der
Test, der «kein Token im Browser» belegt) · fremder Tenant gibt 403.

**Guard:** wie im Service-Zyklus — die Guard-Datei wirft, die `exports`-Map hat
`react-server` und `default`, `files` enthält sie, plus die Build-Verifikation in
beide Richtungen.

### Was kein Unit-Test deckt

Die Bundler-Condition selbst, und die Frage, ob Emporix den anonymen
Refresh-Token bei Benutzung invalidiert. Letzteres ist für diesen Entwurf
gleichgültig (der Proxy schreibt den rotierten immer), sollte aber im Plan gegen
den `viu`-Tenant einmal beobachtet werden, damit die Annahme belegt ist.

## Offene Fragen

1. **Rotiert Emporix den anonymen Refresh-Token bei Benutzung, und invalidiert
   es den alten?** Nicht entscheidungsrelevant, siehe oben, aber zu beobachten.
2. **Wie oft refresht der Gast-Pfad?** Der Store bootstrappt mit
   `expiresAt = 0`, also macht der erste `getAnonymousToken()` pro
   Client-Instanz ein Refresh. Bei einem Client pro Request heisst das ein
   zusätzlicher Emporix-Roundtrip pro Request, der den Warenkorb berührt. Ob das
   in der Praxis stört, ist zu messen — der Access-Token liesse sich später mit
   seiner Ablaufzeit im Cookie mitführen, um die meisten Refreshes zu sparen.
   Nicht vorab optimieren.
3. **`maxAge` für den Customer-Token.** F-02 hält fest, dass es heute keinen
   applikationsseitigen Timeout gibt. Dieser Modus ist die Gelegenheit, einen zu
   setzen; der konkrete Wert (8 h?) ist eine Produktentscheidung.

## Verhältnis zu den Review-Findings

| Finding | Status nach diesem Modus |
|---|---|
| F-01 Tokens im JS-lesbaren Cookie | **geschlossen** für Next-Storefronts; bleibt offen für den SPA-Weg, dort strukturell nicht lösbar |
| F-13 Tokens in URLs | clientseitig **geschlossen**; Emporix' eigene Logs bleiben |
| F-07 CSRF in Consumer-Routen | **geschlossen** über `assertSameOrigin` |
| F-02 keine Session-Lebensdauer | adressierbar, konkreter Wert offen (Frage 3) |
| F-03 kein Tenant-Namespace | **unberührt** — eigener Zyklus |
| F-04/F-05 divergierende Cookie-Attribute | teilweise: dieser Modus leitet `secure` ab und vereinheitlicht die Attribute für die neuen Writes. Die Konsolidierung über alle drei Schreibpfade bleibt ein eigener Zyklus. |
