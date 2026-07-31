# Service Account im next-Package — Design

**Status:** approved
**Datum:** 2026-07-31
**Package:** `@viu/emporix-sdk-next`
**Verwandt:** `2026-07-31-emporix-sdk-next-design.md` (die `tagged`-Regel),
`2026-07-31-next-proxy-site-detection-design.md` (die Entry-Trennung)

## Problem

Eine Storefront braucht serverseitige Schreibzugriffe mit einem eigenen Service
Account — Produkt anlegen, Preis setzen, Bestellung nachpflegen — mit `clientId`
und `secret` und nur den dafür vergebenen Scopes.

Die SDK kann das vollständig: `credentials.custom` nimmt beliebig viele benannte
`ServiceCredentials`, `auth.service("name")` wählt einen davon aus, und das
Token-Caching ist eingebaut. Das next-Package kann es **nicht**:
`getEmporixClient` baut ausschliesslich `credentials.storefront` und kennt weder
`secret` noch `custom`.

Wer es heute selbst baut, trägt zwei Dinge, die still falsch sein können:

1. **Der Token-Cache hängt an der Client-Instanz.** Ein `new EmporixClient(...)`
   im Body eines Route Handlers wird pro Request neu gebaut, holt pro Request
   einen Token und macht das Caching wirkungslos.
2. **Ein Service-Client darf niemals `createTaggingFetch` bekommen.** Nexts
   Fetch-Cache schlüsselt nicht auf `Authorization`; eine gecachte Antwort auf
   einen privilegierten GET landet bei anderen Besuchern.

Und ein drittes Risiko, das der Auslöser dieser Spec ist: **das Secret darf
nicht ins Frontend-Bundle geraten.** `getEmporixClient` liegt im Root-Entry.
Reicht man dort ein `secret` durch, sitzt es in einem Modul, das eine Client
Component versehentlich importieren kann — und Next schreibt es beim Build ins
Browser-Bundle. Kein Fehler, kein Warning, nur ein publiziertes Secret.

## Gemessene Grundlagen

Alles an `next@16.2.12` und der SDK im Repo nachgemessen.

### Die SDK-Seite

| Fakt | Quelle |
|---|---|
| `credentials.custom?: Record<string, ServiceCredentials>` existiert | `packages/sdk/src/core/config.ts` |
| `ServiceCredentials = { clientId, secret, scope? }` | dito |
| `auth.service(name?)` wählt den Set, Default `"backend"` | [auth.ts:95](../../../packages/sdk/src/core/auth.ts#L95), [auth.ts:109](../../../packages/sdk/src/core/auth.ts#L109) |
| `scope` geht als `scope`-Feld in den `client_credentials`-Body | [auth.ts:270](../../../packages/sdk/src/core/auth.ts#L270) |
| Token-Cache pro Set, Ablauf `expires_in − expirationBufferSeconds` | [auth.ts:282-286](../../../packages/sdk/src/core/auth.ts#L282) |
| Buffer-Default 60 s, harte Obergrenze `maxLifetimeSeconds` 3600 s | `config.ts`, [auth.ts:226](../../../packages/sdk/src/core/auth.ts#L226) |
| Single-Flight-Lock pro Set — N parallele Aufrufe holen **einen** Token | [auth.ts:235-239](../../../packages/sdk/src/core/auth.ts#L235) |
| Unbekannter Set wirft `Unknown credential set "x"` vor dem Cache-Pfad | [auth.ts:219](../../../packages/sdk/src/core/auth.ts#L219), [auth.ts:231](../../../packages/sdk/src/core/auth.ts#L231) |
| Token-Requests nutzen bewusst das globale `fetch`, nicht das injizierte | `config.ts`, Kommentar an `EmporixConfig.fetch` |
| `client.config` ist public (`readonly config: ResolvedConfig`) | `packages/sdk/src/client.ts:117` |
| `context` hängt an `StorefrontCredentials`, **nicht** an `ServiceCredentials` | `config.ts` |
| Admin-Writes haben `auth: AuthContext = SERVICE` als Default | `packages/sdk/src/services/product.ts:295-299` |

### Die Bundler-Grenze

Der Mechanismus stammt von `client-only@0.0.1`, aus dem pnpm-Store gelesen:

```json
"exports": { ".": { "react-server": "./error.js", "default": "./index.js" } }
```

`index.js` ist leer, `error.js` wirft. `server-only` ist die Spiegelung davon.
`server-only` liegt **nicht** im Store, und `packages/next` hat gar keine
`dependencies`-Sektion.

Ob die Condition `react-server` in den relevanten Kontexten gesetzt ist, war die
tragende Unbekannte. Nexts Webpack-Config legt `reactServerConditionNames` nur
auf drei Layer — RSC, `middleware`, `instrument` — und **nicht** auf `apiNode`,
also nicht auf Route Handlers. Daraus liesse sich schliessen, der Guard würde
genau dort brechen, wo man ein Produkt anlegt.

Das ist falsch. Gemessen mit einem Spike (temporäre `exports`-Condition auf
`packages/next`, zwei Dateien in `dist/`, danach alles gelöscht) gegen einen
echten `next build` mit Turbopack, dem Default in Next 16:

| Kontext | Auflösung | Ergebnis |
|---|---|---|
| Route Handler (`app/*/route.ts`) | `react-server` | Import gelingt, Route liefert den Marker |
| Server Action (`"use server"`, von einer Client Component importiert) | `react-server` | Build kompiliert, also aufgelöst auf die gültige Datei |
| Client Component (`"use client"`) | `default` | **Build failt** mit zwei Fehlern, Layer `[app-client]` und `[app-ssr]` |

Der Client-Fall scheitert damit zur **Build-Zeit**, nicht erst zur Laufzeit im
Browser. Das ist stärker als eine Laufzeitprüfung: das Secret kann gar nicht
erst in ein Bundle geschrieben werden.

Die Webpack-Config war die falsche Quelle — Next 16 nutzt Turbopack, und dessen
Auflösung folgt der Layer-Aufteilung der Webpack-Config nicht.

## Entscheidung: eigener Entry mit `exports`-Guard

Neuer Entry `@viu/emporix-sdk-next/service`, dessen Auflösung ausserhalb des
Server-Graphen auf eine werfende Datei zeigt.

```json
"./service": {
  "react-server": {
    "types": "./dist/service.d.ts",
    "import": "./dist/service.js",
    "require": "./dist/service.cjs"
  },
  "default": "./service-is-server-only.js"
}
```

`service-is-server-only.js` liegt im Package-Root, nicht in `dist/`. Der Grund
ist kein Verdacht gegen Treeshaking, sondern `clean: true` in
`packages/next/tsup.config.ts`: eine handgelegte Datei in `dist/` wäre nach dem
nächsten Build weg. Sie braucht deshalb einen eigenen Eintrag im `files`-Array.

```js
// service-is-server-only.js
throw new Error(
  "@viu/emporix-sdk-next/service is server-only: it carries a client secret. " +
    "It was resolved outside the server graph — most likely imported from a " +
    '"use client" module. Move the import into a Route Handler, a Server ' +
    "Action, or a Server Component.",
);
```

Zwei Gürtel, absichtlich:

- Der Bundler findet den benannten Export nicht und **failt den Build**. Das ist
  der Pfad, der oben gemessen wurde, und der Dateiname steht in der Meldung.
- Falls je ein Bundler die Datei doch einbindet, wirft sie beim Laden mit
  eigenem Text.

**Keine neue Dependency.** `server-only` wäre 1 KB für vier Zeilen und würde die
Null-Dependency-Eigenschaft von `packages/next` aufgeben. Der Mechanismus ist
vollständig in der `exports`-Map ausdrückbar.

## Oberfläche

```ts
export interface EmporixServiceCredentials {
  clientId: string;
  secret: string;
  /** Space-separated OAuth scopes. Omit to get whatever the account has. */
  scope?: string;
}

export function getEmporixServiceClient(opts: {
  /** Named credential sets. The name is what `auth.service(name)` takes. */
  credentials: Record<string, EmporixServiceCredentials>;
  /** Default: `process.env.EMPORIX_TENANT`. */
  tenant?: string;
  /** Default: `process.env.EMPORIX_HOST`, else the SDK default. */
  host?: string;
}): EmporixClient;
```

Rückgabe ist ein gewöhnlicher `EmporixClient` — jeder Service ist erreichbar,
kein Wrapper pro Operation. Was der Account darf, begrenzen seine Scopes
serverseitig; eine Allowlist im Package wäre eine zweite, schwächere Kopie
derselben Regel und bräuchte für jede neue Operation eine Package-Version.

```ts
// lib/emporix-service.ts — Modul-Scope, nicht in einem Handler-Body
import { getEmporixServiceClient } from "@viu/emporix-sdk-next/service";

export const service = getEmporixServiceClient({
  credentials: {
    productWriter: {
      clientId: process.env.EMPORIX_PRODUCT_WRITER_ID!,
      secret: process.env.EMPORIX_PRODUCT_WRITER_SECRET!,
      scope: "product.product_create",
    },
  },
});

// app/api/products/route.ts
import { auth } from "@viu/emporix-sdk";
import { service } from "@/lib/emporix-service";

export async function POST(request: Request): Promise<Response> {
  const created = await service.products.create(
    await request.json(),
    {},
    auth.service("productWriter"),
  );
  return Response.json(created);
}
```

### Drei Entscheidungen in der Signatur

**Kein `tagged`-Parameter.** Untagged ist strukturell, nicht konfigurierbar:
`getEmporixServiceClient` setzt `fetch` nie. `client.config.fetch` bleibt
`undefined` und ist damit direkt testbar. Eine Option, die man auf `true`
stellen kann, wäre eine Option, die irgendwann jemand auf `true` stellt.

**Kein `context`-Parameter.** `context` hängt an `StorefrontCredentials` und
wird beim anonymen Login gebunden. Ein Service-Client hat keine
Storefront-Credentials, also keinen Ort dafür. Die Option wäre wirkungslos und
würde suggerieren, sie täte etwas.

**Memoisierung auf `JSON.stringify(opts)`**, also inklusive der Secrets. Das ist
kein neues Risiko: der Client hält sie ohnehin in `ResolvedConfig.credentials`
im Prozess. Ein Key ohne Secrets könnte bei zwei Sets gleichen Namens still den
Client mit dem falschen Secret zurückgeben — ein Hash dazwischen wäre Zeremonie
für ein Risiko, das nicht besteht.

Die Memoisierung ist der Grund, warum die Funktion überhaupt existiert. Sie
sorgt dafür, dass der Token-Cache der SDK greift: eine Instanz pro Prozess,
nicht pro Request.

## Nicht-Ziele

- **Kein Wrapper pro Operation.** Die Scopes des Accounts sind die Grenze.
- **Kein Env-Var-Konvention für die Credentials.** `tenant` und `host` dürfen
  aus `process.env` defaulten wie bei `getEmporixClient`, aber wie die Secrets
  heissen, entscheidet die Storefront. Eine erzwungene Namenskonvention wäre
  Policy in einem publizierten Package.
- **Kein `next/headers`, keine Cookies.** Ein Service Account hat keine Session.
- **Keine Änderung an `getEmporixClient`.** Der Root-Entry bleibt frei von
  Secrets — das ist die halbe Sicherheitseigenschaft.
- **Keine `server-only`-Dependency.**
- **Keine Änderung am Example.** Ein Service Account im Referenz-Storefront
  bräuchte echte Credentials in `.env.local` und einen zweiten Client mit
  Schreibrechten. Verifiziert wird mit temporären, nicht committeten Dateien.

## Tests

In `packages/next/tests/service.test.ts`:

| # | Fall | Erwartung |
|---|---|---|
| 1 | zweimal mit identischen Optionen | dieselbe Instanz |
| 2 | zweimal mit verschiedenen Optionen | verschiedene Instanzen |
| 3 | `client.config.fetch` | `undefined` — kein Tagging-Fetch |
| 4 | `credentials.custom` durchgereicht | `client.config.credentials.custom.productWriter.clientId` stimmt |
| 5 | `scope` durchgereicht | landet im Body des Token-Requests |
| 6 | Token-Caching | zwei Aufrufe mit `auth.service("x")` → **ein** Token-Request |
| 7 | unbekannter Set | wirft `Unknown credential set "nope"` |
| 8 | fehlender Tenant | wirft mit einer Meldung, die `EMPORIX_TENANT` nennt |
| 9 | `exports`-Map | `./service` hat `react-server` und `default`, und `default` zeigt auf die Guard-Datei |

Tests 5 und 6 stubben `globalThis.fetch` — Token-Requests nutzen bewusst das
globale `fetch` und nicht das injizierte, also ist das der richtige Angriffspunkt.

Test 9 ist eine strukturelle Assertion auf `package.json`, kein Verhaltenstest.

### Was kein Test deckt

**Ein Unit-Test kann eine Bundler-Condition nicht ausüben.** Der Guard ist durch
den heute gemessenen Spike belegt, nicht durch die Suite. Der Plan wiederholt
diese Messung gegen das gebaute Package — temporäre Dateien im Example, ein
`next build`, danach gelöscht:

1. Import aus einem Route Handler → Build gelingt, Route antwortet.
2. Import aus einer `"use client"`-Datei → Build **failt** mit
   `[app-client]` und `[app-ssr]`.

Schritt 2 ist der eigentliche Beweis. Ohne ihn ist die Sicherheitseigenschaft
behauptet, nicht gezeigt.

## Doku

Ein Abschnitt in `packages/next/README.md` direkt nach «The one rule», weil es
dieselbe Regel eine Stufe schärfer ist: das Modul-Scope-Muster, die
`auth.service(name)`-Verwendung, die eingebauten Cache-Zahlen, und was passiert,
wenn man den Entry aus einer Client Component importiert.

Der Abschnitt nennt ausdrücklich, dass `tagged` nicht existiert und warum.

## Sicherheitsgrenze in der Ausführung

Die Credentials des Tenants liegen ausschliesslich in der ungetrackten
`examples/next-app-router/.env.local` (`.gitignore:7`). Für die Verifikation
werden **keine** echten Service-Account-Credentials gebraucht: der Guard-Test
prüft Auflösung und Build, nicht einen erfolgreichen Emporix-Aufruf. Ein
Platzhalter genügt, und es wird nie ein Credential-Wert in Terminal, Commit,
Doku oder Plan geschrieben.

## Offene Follow-ups danach

1. `docs/nextjs.md` mit dem `images.remotePatterns`-Eintrag für `next/image` —
   weiterhin offen, reine Doku.
2. Ob `getEmporixClient` selbst einen Guard bekommen soll. Heute liegt es im
   Root-Entry und ist korrekt dort: es trägt kein Secret, nur eine
   Storefront-`clientId`, die auch im Browser stehen darf. Erst wenn jemand
   `backend`-Credentials durchreichen will, wird das eine Frage — und die
   Antwort wäre, ihn stattdessen auf `./service` zu schicken.
