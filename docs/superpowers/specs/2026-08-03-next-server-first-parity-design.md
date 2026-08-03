# next-server-first auf Muster-Parität — Design

**Status:** approved (2026-08-03) — Muster-Parität, `examples/shared`, CSS kopiert, PR 5 drin
**Datum:** 2026-08-03
**Betroffen:** `packages/next` (ein Fehler), `examples/next-server-first`,
`examples/storefront-demo`, neu `examples/shared`
**Vorgänger:** `2026-08-01-next-server-first-checkout-design.md`,
`2026-08-03-server-side-sessions-design.md`

## Ziel

`examples/next-server-first` wird die zweite Referenz-Demo: dieselben Flüsse wie
`examples/storefront-demo`, aber server-first. Nicht Route für Route, sondern
**Muster für Muster** — jede Route, die eine neue server-first Frage beantwortet,
kommt rein; dasselbe CRUD-Formular ein viertes Mal nicht.

## Gemessener Ausgangszustand

| | storefront-demo | next-server-first |
|---|---|---|
| Routen | 17 (15 echte, 2 Catch-alls) | 6 |
| Dateien | 63 | 14 |
| Zeilen | 3'690 | 722 |
| React-Hooks benutzt | **39** von 111 | **0** |
| direkte `client.*`-Aufrufe | 2 (`products`, `tenant`) | alle |

Die letzte Zeile ist der Kern der Portierungsarbeit. storefront-demo *ist* 39
Hooks; alles außer Katalog-Lesen läuft über React Query. Server-first wird aus
jedem Lese-Hook ein Server-Component-Read und aus jedem Mutations-Hook eine
Server Action — grob 24 Reads und rund 22 Actions.

## Nicht-Ziele, mit Begründung

Diese vier gehören ins README der Demo als ausdrückliche Nicht-Ziele, nicht als
Lücke:

- **`/account/returns`, `/account/rewards`, `/account/lists`** — dasselbe
  CRUD-über-Server-Action-Muster wie `addresses`. Nach dem dritten Mal lernt
  niemand mehr etwas dazu, aber jede SDK-Änderung muss sie nachziehen.
- **`/reset-password`** — braucht einen echten E-Mail-Umlauf. Nicht
  verifizierbar heisst nicht behauptbar; die Demo behauptet nur, was gemessen
  wurde.
- **B2B** — hat storefront-demo selbst nicht. Grep findet dort nur einen
  Telemetrie-Event-Namen (`company:switched`), den nichts auslöst, und ein
  `companyName`-Feld im Adressformular. `examples/README.md:42` behauptet
  «catalog, cart, checkout, account and B2B» und ist damit falsch.
- **Optimistische Updates** — es gibt keinen Client-State, der optimistisch sein
  könnte. Das ist der dokumentierte Preis des Modus, keine offene Aufgabe.

Zwei falsche Zeilen in `examples/README.md` werden mitkorrigiert: die
B2B-Behauptung oben und «It states the cost in numbers and shows what a full
storefront would need» — diesen Abschnitt gibt es im README der Demo nicht.

## PR 0 — Ein Fehler im Paket, ausgeliefert in #198

Blockiert die Konto-Arbeit und gehört deshalb zuerst und allein.

`session-auth.ts` konstruiert seinen Jar an drei Stellen ohne Optionen:
[Zeile 66](../../../packages/next/src/session-auth.ts#L66) (`emporixLogin`),
[Zeile 151](../../../packages/next/src/session-auth.ts#L151) (`emporixRefresh`),
[Zeile 229](../../../packages/next/src/session-auth.ts#L229) (`emporixLogout`).
`opts.store` liegt an jeder Stelle in Reichweite und wird nicht durchgereicht,
also greift der Cookie-Zweig in
[session-cookies.ts:120](../../../packages/next/src/session-cookies.ts#L120).

Im Store-Modus:

1. **`emporixLogin`** schreibt `customerToken`, `refreshToken` und `saasToken`
   in echte Cookies. Der saasToken-JWT landet im Browser — genau das, was das
   Feature verhindern soll.
2. **`emporixSession(STORE_OPT)`** liest danach den Record, in dem kein
   `customerToken` steht, und meldet **anonym**. Der Kunde ist eingeloggt und
   jeder Leser sagt «nicht eingeloggt». Kein Degradieren, ein Bruch.
3. **`emporixLogout`** trifft den No-op in
   [session-cookies.ts:132](../../../packages/next/src/session-cookies.ts#L132).
   Der Store-Record überlebt den Logout.

Das Changeset `.changeset/next-session-store.md` behauptet «`emporixLogout`
destroys the record». Das ist falsch und wird korrigiert.

**Warum die Live-Prüfung das nicht gesehen hat:** alles, was im Store-Modus lief,
war der Gast-Pfad, und der geht über `withEmporixSessionMutable`, das `opts.store`
korrekt durchreicht. Die Login-Zeilen im README der Demo sind vom 2026-08-01 —
vor dem Store. Der Kundenpfad im Store-Modus wurde nie ausgeführt.

**Fix:** dieselbe Zeile dreimal.

```ts
const jar = await sessionCookieJar(opts.store !== undefined ? { store: opts.store } : {});
```

**Tests, die das gefangen hätten** — je einer pro Funktion, mit einem
Fake-Store, der Schreibvorgänge mitzählt:

- `emporixLogin` mit `store` schreibt **keinen** `customerToken` als Cookie und
  der Record enthält ihn.
- `emporixRefresh` mit `store` schreibt den rotierten Token in den Record.
- `emporixLogout` mit `store` ruft `store.destroy(sid)`.

Die drei Tests müssen ohne den Fix rot sein. Das ist die Abnahmebedingung, nicht
«die Tests laufen».

## Architektur — `examples/shared`

Neues Workspace-Paket `@viu/emporix-examples-shared`. Zwei Dinge sind gratis:
`pnpm-workspace.yaml` listet `examples/*`, das Paket wird erfasst; und das Glob
`@viu/emporix-examples-*` in `.changeset/config.json` `ignore` deckt es ab — kein
Changeset, keine Version, kein Publish.

**Verschoben, nicht kopiert.** storefront-demo importiert danach daraus. Damit
bleibt der Kommentar «the SINGLE place that reads SDK/generated field names»
wahr, und es entsteht ein Regressionsbeleg gratis: typecheckt und läuft
storefront-demo nach dem Verschieben unverändert, war die Extraktion sauber.

Aus `examples/storefront-demo/src/lib/adapters.ts` (360 Zeilen) und
`lib/format.ts` (13 Zeilen) wandert alles ins Paket **ausser** zwei Exporten:

| Bleibt in storefront-demo | Warum |
|---|---|
| `sanitizeHtml` | benutzt `DOMParser` ([adapters.ts:88](../../../examples/storefront-demo/src/lib/adapters.ts#L88)), den es in Node nicht gibt |
| `productDescription` | baut auf `sanitizeHtml` auf |

`stripHtml` — heute die private No-DOM-Rückfallebene in derselben Datei — wird
exportiert und wandert mit. Es ist reine String-Arbeit und funktioniert überall.
Die Next-Demo rendert Produktbeschreibungen damit als **Klartext**, nicht als
Markup, und sagt das im README. Ein Sanitizer mit Node-Pfad wäre eine
Abhängigkeit für eine Demo-Zeile.

Hooks wandern nicht: `usePrices` (15 Zeilen) und `useProductNames` (27 Zeilen)
bleiben in storefront-demo. Ihre Logik steckt schon in den geteilten Helfern; die
Next-Demo schreibt daraus zwei kleine Server-Funktionen.

Das Paket bekommt ein eigenes README mit «copy this» — nach dem Vorbild von
`examples/next-server-first/app/session-store.ts`, das genauso im Example liegt
und genau das sagt. Es ist ein geteilter Helfer-Satz, kein Beispiel; die Tabelle
in `examples/README.md` beschreibt es entsprechend und nicht als sechste Demo.

## Muster 1 — Shell ohne einen einzigen Emporix-Aufruf

Ein Cart-Badge im Layout wäre pro Seitenaufruf ein `withEmporixSession`, und der
Gast-Pfad baut dort absichtlich einen **neuen** Client pro Aufruf
([session-client.ts, `newGuestClient`](../../../packages/next/src/session-client.ts)) —
ein geteilter Guest-Client wäre ein geteilter Warenkorb. Dazu kommt: ein
read-only Jar kann eine rotierte anonyme Session nicht persistieren. Die
dokumentierte Wiederverwendung des Refresh-Tokens würde damit von «drei Reads auf
`/cart`» auf «jeder Seitenaufruf» skalieren, plus ein Token-Umlauf pro Seite.

Die Zählung liegt deshalb neben der Cart-Id in der Session, mit genau einem
Schreiber:

```ts
// app/lib/cart-session.ts
import { STORAGE_KEYS, SESSION_MAX_AGE, type SessionCookieJar } from "@viu/emporix-sdk-next/session";

const COUNT = "demo.cartCount";

/**
 * Die EINZIGE Stelle, die die Cart-Id schreibt. Wäre die Zählung woanders
 * schreibbar, könnte sie driften; so kann sie es strukturell nicht.
 */
export function setCart(
  jar: SessionCookieJar,
  cart: { id: string; items?: unknown[] } | null,
): void {
  if (cart === null) {
    jar.delete(STORAGE_KEYS.cartId);
    jar.delete(COUNT);
    return;
  }
  jar.set(STORAGE_KEYS.cartId, cart.id, SESSION_MAX_AGE.cartId);
  jar.set(COUNT, String(cart.items?.length ?? 0), SESSION_MAX_AGE.cartId);
}

export function cartCount(jar: SessionCookieJar): number {
  // Ohne Cart-Id ist eine Zählung bedeutungslos. Das deckt den Logout ab:
  // SESSION_COOKIES in session-auth.ts ist eine feste Liste, unser Demo-Key
  // steht nicht drin und würde den Logout sonst überleben.
  if (jar.get(STORAGE_KEYS.cartId) === null) return 0;
  const n = Number(jar.get(COUNT));
  return Number.isInteger(n) && n > 0 ? n : 0;
}
```

Die `cartId`-Prüfung ist nicht Kosmetik, sondern die Logout-Korrektheit. Und
`Number.isInteger` statt eines Wahrheitstests, weil `Number(null)` **0** ist und
nicht `NaN` — derselbe Stolperstein wie bei `SESSION_STARTED_AT`.

Jede Cart-Mutation hat den Warenkorb schon in der Hand (Emporix gibt ihn zurück),
also kostet `setCart` keinen zusätzlichen Aufruf. Vier Aufrufstellen:
`addToCart`, `updateItem`/`removeItem`, das Leeren nach dem Checkout, und das
Cart-Onboarding beim Login.

Das Layout liest die Zählung aus dem Jar und macht keinen Emporix-Aufruf. Der
Key wird über `cookieSet` geschrieben und ist damit `httpOnly` — `/debug` bleibt
grün.

Die Shell bekommt weiter: ein Suchformular als **reines** `<form action="/search"
method="get">` ohne JavaScript (storefront-demos Header hält den Suchtext in
`useState`), den Konto-Status aus der Session, und den Site-/Sprach-Umschalter
als Server Action.

## Muster 2 — Pagination über die URL

`client.categories.productsIn(id, { pageNumber, pageSize }, auth)` liefert
`PaginatedItems<Product>` mit `hasNextPage`
([category.ts:181](../../../packages/sdk/src/services/category.ts#L181)). Die
Seite liest `?page=N`, «Weiter» ist ein `<Link>`.

```tsx
export default async function CategoryPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const client = getEmporixClient({ context: CONTEXT });
  const result = await client.categories.productsIn(id, { pageNumber: page, pageSize: 24 }, undefined);
  // …
}
```

`Number(undefined) || 1` ergibt 1, `Number("0") || 1` ergibt 1, `Math.max`
fängt Negatives. Kein Validierungs-Framework nötig, aber die Grenze wird
gezogen.

Das **akkumuliert nicht** wie `useProductsInCategoryInfinite`; man blättert,
statt anzuhängen. Verhaltensdifferenz, die ins README gehört statt übertüncht zu
werden — Akkumulieren braucht Client-State, und den gibt es in diesem Modus
nicht.

Gleiches Muster für `/account/orders`.

## Muster 3 — Fehleranzeige: eine Client-Komponente, nicht acht

storefront-demo hat `Toasts.tsx` (81 Zeilen, Context plus State). `useActionState`
verlangt eine Client-Komponente. Statt jedes mutierende Formular zu einer zu
machen, nimmt eine generische den Action als Prop — Server Actions sind als Prop
serialisierbar, die Kinder bleiben serverseitig gerendert:

```tsx
"use client";
import { useActionState } from "react";

export interface ActionState {
  error: string | null;
}

export function ActionForm({ action, submit, children }: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submit: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction}>
      {children}
      {state.error !== null ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? "…" : submit}</button>
    </form>
  );
}
```

Damit müssen die Actions den Fehler **zurückgeben** statt zu werfen. Das ist
ohnehin die Form, die eine echte App will, und `describe(e)` aus
`app/actions/checkout.ts` — das `EmporixError.body` sichtbar macht — ist die
Stelle, an der die Meldung entsteht.

Die Alternative, ein Redirect mit `?error=…`, bräuchte null Client-Komponenten,
schreibt aber Fehlertexte in teilbare URLs. Das ist ein Defekt, nicht nur
unschön. Die Demo bekommt damit ihre zweite Client-Komponente neben
`typeahead.tsx`; beide machen keinen Emporix-Aufruf mit einem Token, die These
des Modus bleibt intakt.

## Muster 4 — Auth-Gate pro Seite, nicht als Middleware

Next 16 führt Middleware in `proxy.ts` aus, das Node-Runtime ist und kein
`cookies()` hat — steht schon im README der Demo. Also ein Helfer am Anfang jeder
Konto-Seite:

```ts
// app/lib/require-customer.ts
import { redirect } from "next/navigation";
import { emporixSession } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";

export async function requireCustomer(next: string): Promise<string> {
  const { customerToken } = await emporixSession(STORE_OPT);
  if (customerToken === null) redirect(`/login?next=${encodeURIComponent(next)}`);
  return customerToken;
}
```

`/login` honoriert `?next=` und akzeptiert **nur** Pfade, die mit `/` und nicht
mit `//` beginnen:

```ts
function safeNext(raw: string | undefined): string {
  // Offene Weiterleitung ist eine Vertrauensgrenze. `//evil.com` ist ein
  // protokollrelativer Absolutlink, kein Pfad.
  if (raw === undefined || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
```

Diese Funktion bekommt einen Test mit `//evil.com`, `https://evil.com`,
`/account` und `undefined`. Sie ist die einzige Stelle in der Demo, an der eine
Vertrauensgrenze liegt, und ist deshalb nicht «nur eine Demo».

## Routen nach der Arbeit

13 Routen gegen storefront-demos 15 echte.

| Route | Status | Neues Muster |
|---|---|---|
| `/` | da, bekommt Gitter und Preise | — |
| `/search` | neu | GET-Formular ohne JS, `client.products.searchByName` ([product.ts:168](../../../packages/sdk/src/services/product.ts#L168)) |
| `/category/[id]` | neu | Pagination über `?page=N`, Unterkategorien |
| `/product/[id]` | neu | Varianten über `?variant=`, Beschreibung als Klartext |
| | | `client.products.listVariantChildren(id, { pageSize }, auth)` liefert die Kinder; jedes wird ein `<Link>` auf `?variant=<childId>`; die gewählte Kind-Id ist, was «In den Warenkorb» benutzt |
| `/cart` | da, nur lesend | Menge, Entfernen, Coupon, Namen, Summen |
| `/checkout`, `/checkout/done` | da | — |
| `/login` | da | `?next=` |
| `/debug` | da | — |
| `/account` | neu | Auth-Gate |
| `/account/profile` | neu | Profil und Passwort |
| `/account/addresses` | neu | CRUD über Server Actions |
| `/account/orders` | neu | Pagination |
| `/account/orders/[id]` | neu | Reorder, Cancel |

Zum Warenkorb zwei Dinge, die storefront-demo schon gelernt hat und die die
Next-Demo sonst neu erlebt: der Cart-GET liefert ein **leeres** `product`, Namen
müssen separat aufgelöst werden (dafür existiert `useProductNames`); und ein
Mengen-Update geht mit `partial: true`, sonst muss die ganze Zeile inklusive
`itemYrn` und Preiszeile zurückgeschickt werden.

## PR 5 — Webhook-Route und `revalidateTag`

`revalidateTag` für Warenkorb, Bestellungen und Kundendaten ist per Design
unmöglich: `emporixTagsForUrl` gibt für diese Services absichtlich `[]` zurück
([tags.ts](../../../packages/next/src/tags.ts)). Das `revalidatePath` in den
Cart-Actions ist damit korrekt und nicht das Grobwerkzeug — es ist das einzige
Werkzeug.

Wo `revalidateTag` hingehört, ist der Katalog, und die Webhook-Route im Paket
macht den Zyklus schon
([webhook.ts:163](../../../packages/next/src/webhook.ts#L163)). Die Lücke ist,
dass **kein Example sie mountet**: `examples/next-server-first` hat nur die
Proxy-Route. Der getaggte Client hat seine Hälfte, ihm fehlt der Auslöser.

PR 5 mountet sie unter `app/api/emporix/webhook/route.ts` und dokumentiert das
Secret. Verifiziert mit einem selbst signierten Aufruf: ein Produkt ändern, den
Webhook feuern, und die Katalogseite zeigt den neuen Wert, ohne dass ein Deploy
oder ein Timeout dazwischen liegt.

## Verifikation

Jeder PR endet mit einem Live-Beleg gegen den `viu`-Tenant, nicht mit «Tests
grün». Nach dem Muster der bisherigen READMEs als Tabelle mit Datum.

| PR | Beleg |
|---|---|
| 0 | Login im Store-Modus: Tokens **nicht** im Browser-Cookie-Jar, `emporixSession` meldet den Kunden, Logout löscht den Redis-Key. Die drei neuen Tests sind ohne den Fix rot. |
| 1 | storefront-demo typecheckt und läuft unverändert nach dem Verschieben; `/debug` grün; Badge zeigt die Zählung ohne einen Emporix-Aufruf im Netzwerk-Log |
| 2 | Kategorie mit mehr als 24 Produkten blättert vor und zurück; Variante wechselt über die URL; Suche findet ein bekanntes Produkt |
| 3 | Menge ändern, neu laden, neuer Wert steht; Zeile entfernen; Badge stimmt nach jedem Schritt; ein absichtlich fehlerhafter Coupon zeigt die Emporix-Meldung |
| 4 | Gate leitet ohne Token nach `/login?next=…` um und danach zurück; Adresse angelegt, gelesen, geändert, gelöscht; Bestellliste zeigt die Bestellungen aus dem Checkout-Test |
| 5 | Signierter Webhook-Aufruf invalidiert ein Produkt; falsche Signatur ergibt 401 und invalidiert nichts |

Unit-Tests gibt es nur für das Paket (PR 0) und für `safeNext`. Examples haben
`test` und `lint` bewusst als No-op; sie werden durch Typecheck, Build und
Ausführen verifiziert.

## Reihenfolge und Abhängigkeiten

| PR | Inhalt | Braucht |
|---|---|---|
| 0 | `opts.store` an drei Stellen, drei Tests, Changeset-Korrektur | — |
| 1 | `examples/shared`, CSS kopiert, Shell mit Badge | — |
| 2 | `/search`, `/category/[id]`, `/product/[id]` | 1 |
| 3 | `/cart` voll, `ActionForm` | 1 |
| 4 | Konto-Routen | 0, 1, 3 (`ActionForm`) |
| 5 | Webhook-Route | 1 |

PR 0 ist kein Teil der Paritätsarbeit und läuft allein, damit die Korrektur des
Changesets nicht in einer Feature-PR untergeht.

## Risiken

**Die CSS-Kopplung ist bewusst in Kauf genommen.** Die zwei CSS-Dateien werden
kopiert, nicht geteilt. Damit driften die Demos optisch auseinander, aber nichts
bricht still — die Alternative, sie zu teilen, hätte bedeutet, dass eine
Änderung in storefront-demos CSS die Next-Demo kaputt aussehen lässt, ohne dass
ein Test es merkt.

**Das Verschieben der Adapter berührt die Referenz-Demo.** storefront-demo ist
die Demo, auf die alle Antworten verweisen. Der Regressionsbeleg (typecheckt und
läuft unverändert) ist deshalb Abnahmebedingung von PR 1, nicht ein
Nice-to-have.

**Die Zählung in der Session ist eine Denormalisierung.** Vier Schreibstellen,
alle über `setCart`. Bricht jemand diese Regel und schreibt die Cart-Id direkt,
driftet der Badge. Die Obergrenze ist bekannt und benannt; die Alternative wäre
ein Emporix-Aufruf pro Seitenaufruf.

**`emporixLogin` in `withEmporixSessionMutable` ist nach PR 0 noch nicht
vollständig geprüft.** Die drei Tests decken den Jar ab. Was ungemessen bleibt:
ob zwei gleichzeitige Requests im Store-Modus einander überschreiben können —
das ist ein offener Punkt aus der Store-Spec und wird von dieser Arbeit nicht
geschlossen.
