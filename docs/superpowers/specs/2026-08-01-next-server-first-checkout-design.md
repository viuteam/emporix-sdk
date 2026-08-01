# Server-First-Checkout — Design

**Status:** approved
**Datum:** 2026-08-01
**Betroffen:** `packages/sdk` (additiv), `examples/next-server-first`,
`examples/storefront-demo` (Import-Umstellung)
**Vorgänger:** `2026-07-31-next-server-first-mode-design.md`
**Vorlage:** `examples/storefront-demo/src/pages/Checkout.tsx` und
`src/checkout/*` — die dort erprobte Form wird übernommen, nicht neu erfunden.

## Ziel

Der Server-First-Demo bekommt eine Checkout-Seite. Sie schliesst den Flow ab —
Katalog, Warenkorb, Login, Bestellung — und zeigt den einen Punkt, an dem dieser
Modus etwas kann, was der SPA-Weg nicht kann: der `saasToken` bleibt `httpOnly`.

## Gemessene Grundlagen

Alles aus `storefront-demo` und der SDK gelesen, nicht angenommen.

### Die Checkout-Nutzlast

Verifiziert in `examples/storefront-demo/src/pages/Checkout.tsx:75-131`:

| Feld | Form |
|---|---|
| `cartId` | aus dem Cart |
| `customer` | `{ id? , email, firstName, lastName, guest }` — «logged-in customer must be identified by id; guest must not» ([Checkout.tsx:93](../../../examples/storefront-demo/src/pages/Checkout.tsx#L93)) |
| `shipping` | `{ methodId, zoneId, methodName, amount, shippingTaxCode? }`, sonst `{ methodId: "free", zoneId: <country>, methodName: "Free Shipping", amount: 0 }` |
| `addresses` | genau zwei: `type: "SHIPPING"` und `type: "BILLING"`, je `{ contactName, companyName?, street, streetNumber?, zipCode, city, country, contactPhone? }` |
| `paymentMethods` | `[{ provider: "payment-gateway", customAttributes: { modeId }, amount }]` oder `[{ provider: "custom", amount }]` |

`placeOrder(input, auth, { saasToken?, siteCode? })` — der `saasToken` nur für
eingeloggte Kundinnen ([checkout.ts:55-59](../../../packages/sdk/src/services/checkout.ts#L55)).
Rückgabe ist `CheckoutResult`, ein Alias auf
`ResponseCheckout = { orderId?, paymentDetails?, checkoutId? }`
([checkout.ts:18](../../../packages/sdk/src/services/checkout.ts#L18),
[checkout/types.gen.ts:247](../../../packages/sdk/src/generated/checkout/types.gen.ts#L247)).

### Die Auflösung der Optionen

| Was | Aufruf | Reine Logik danach |
|---|---|---|
| Zahlungsarten | `client.payments.listPaymentModes(ctx)` | erste Mode vorauswählen |
| Versandzonen | `client.shipping.listZones(site, { expand: "methods,fees", activeMethods: "true" }, ctx)` | `resolveZone` + `pickFee` |
| Gespeicherte Adressen | `client.customers.addresses.list(ctx)` | — |

`addresses.list` geht durch `requireCustomer` und wirft für einen anonymen
Kontext einen `EmporixAuthError` — **lokal**, ohne Emporix je zu erreichen
([require-customer.ts:10-13](../../../packages/sdk/src/core/require-customer.ts#L10)).
Das ist kein 401, und der Unterschied ist praktisch: der Gast-Fall kostet keinen
Roundtrip.

`resolveZone` und `pickFee` sind **pure Funktionen** und brauchen kein React
([ShippingSelector.tsx:21-37](../../../examples/storefront-demo/src/checkout/ShippingSelector.tsx#L21)).
Sie sind heute **ungetestet** — ein Grep über `examples`, `packages` und `e2e`
findet keinen einzigen Testtreffer.

### `custom` ist ein echter Pfad, kein Platzhalter

Emporix' eigene Spec, von der SDK vendored
([checkout/types.gen.ts:215](../../../packages/sdk/src/generated/checkout/types.gen.ts#L215)):

> «`custom` — When a custom provider is used. In this case the created order has
> the `IN_CHECKOUT` status.»

Das ist der Grund, warum der Demo ohne Zahlungs-Autorisierung ein vollständiger
Flow ist und kein abgeschnittener: die Bestellung entsteht wirklich, sie steht
nur in `IN_CHECKOUT` und wartet auf die Zahlung.

### Cache-Einordnung

Cart, Zahlungsarten und Versandzonen sind **Gruppe B** der Hook-Inventur: anonym
lesbar, aber von `emporixTagsForUrl` nicht getaggt und damit nicht cachebar. Sie
laufen über `withEmporixSession` in einer Server Component. Gespeicherte Adressen
sind **Gruppe C**, kundengebunden.

## Was in die SDK wandert

`resolveZone` und `pickFee` werden pure Exports in
`packages/sdk/src/services/shipping.ts`, neben dem Service, dem sie gehören.

```ts
/** The zone whose `shipTo` covers `country`, else the default zone, else the first. */
export function resolveZone(zones: ZoneList | undefined, country: string): Zone | undefined;

/** The applicable fee: the highest `minOrderValue` at or below the cart total,
 *  else the first fee. */
export function pickFee(fees: Fee[] | undefined, cartTotal: number): Fee | undefined;
```

Die Implementierung wird **wörtlich** aus `ShippingSelector.tsx` übernommen. Die
Regeln sind dort gegen den `viu`-Tenant erprobt; sie umzuformulieren hiesse,
erprobtes Verhalten gegen frisch geschriebenes zu tauschen.

Zwei Typ-Details, gemessen:

- `Zone` ist bereits öffentlich, und `ZoneList[number]` **ist** `Zone`, weil
  `Zones = Array<Zone>`
  ([shipping/types.gen.ts:253](../../../packages/sdk/src/generated/shipping/types.gen.ts#L253)).
  Das lokale `type ShippingZone = ZoneList[number]` im Demo war nur eine
  Abkürzung und fällt weg.
- `Fee` existiert generiert
  ([shipping/types.gen.ts:315](../../../packages/sdk/src/generated/shipping/types.gen.ts#L315)),
  ist aber **nicht** re-exportiert — `shipping-types.ts` exportiert nur
  `MinimumFee`. Die Extraktion muss `Fee` mit re-exportieren, sonst zeigt eine
  öffentliche Signatur auf einen nicht-öffentlichen Typ.

`SelectedShipping` bleibt im Demo. Es ist die Form, die *dessen* React-State
braucht; der Server-First-Checkout baut die `shipping`-Nutzlast direkt.

**Kein neues `helpers/`-Verzeichnis** für zwei Funktionen. Die SDK hat bisher
keinen Präzedenzfall für exportierte pure Helper neben Services — der einzige
Treffer ist `_internalMedia` in `media.ts:387`, und der ist intern. Diese zwei
sind der erste öffentliche Fall, und sie gehören zu `shipping`.

`storefront-demo` importiert danach aus der SDK statt lokal zu definieren. Ohne
diesen Schritt hätte die Extraktion nichts gelöst — es gäbe zwei Kopien statt
einer.

**Das ist die erste SDK-Änderung dieses Zyklus.** Bisher galt durchgehend, dass
kein Einhängepunkt fehlt. Zwei pure, additive Funktionen ändern kein Verhalten,
aber sie weiten den Rahmen über «ein Example bauen» hinaus und brauchen ein
eigenes Changeset für `@viu/emporix-sdk` (minor).

## Die Seite

Eine Server Component `app/checkout/page.tsx` mit vier parallelen Reads in
**einer** Session:

```ts
const { cart, modes, zones, addresses } = await withEmporixSession(async (c, ctx) => {
  const [cart, modes, zones, addresses] = await Promise.all([
    c.carts.get(cartId, ctx),
    c.payments.listPaymentModes(ctx),
    c.shipping.listZones(SITE.siteCode, { expand: "methods,fees", activeMethods: "true" }, ctx),
    c.customers.addresses.list(ctx).catch(() => [] as Address[]),
  ]);
  return { cart, modes, zones, addresses };
}, EMPORIX);
```

**Ein `withEmporixSession`, nicht vier.** Für einen Gast baut jeder Aufruf einen
eigenen `EmporixClient` mit eigenem Token-Provider
([bff-session.ts:100](../../../packages/next/src/bff-session.ts#L100)) — vier
Aufrufe wären vier Token-Roundtrips, die parallel dieselbe anonyme Refresh-Token
einlösen. Emporix toleriert diese Wiederverwendung zwar (im Server-First-Zyklus
mit drei aufeinanderfolgenden Reads gemessen), aber sich darauf zu stützen wäre
unnötig: ein Client, eine Session, vier parallele HTTP-Calls ist zugleich
sparsamer und weniger Code.

Der Adress-Read hängt sein `.catch(() => [])` direkt an. Kein `try/catch` und
keine Prüfung auf «Cookie vorhanden», weil zwei verschiedene Wege zum selben
Ergebnis führen: der Gast läuft in den lokalen `EmporixAuthError`, der
abgelaufene Token in einen echten 401. Eine Cookie-Prüfung fängt nur den ersten.

Ein Formular, eine Server Action. **Kein Client-State**: Adresse, Zahlungsart und
Versandart sind native Formularfelder. In diesem Modus gibt es keinen Client, der
State halten könnte, und das ist der Punkt.

Die Versandauswahl hat ein echtes Henne-Ei-Problem: `resolveZone` braucht das
Land, und das Land steht im Formular, das noch nicht abgeschickt ist. Ohne
Client-JS kann die Seite nicht auf das Tippen reagieren.

Die Lösung ist, die Autorität zu verschieben statt Zwischenzustände zu bauen:
die Seite rendert die Methoden der für `CONTEXT.country` aufgelösten Zone, und
die **Server Action ist die Autorität** — sie ruft `resolveZone`/`pickFee`
erneut mit dem tatsächlich eingegebenen Land auf und nimmt deren Ergebnis, nicht
das angeklickte Radio.

**Bekannte Grenze, bewusst akzeptiert:** wer das Land von Hand auf ein anderes
ändert, sieht eine Radio-Liste, die nicht mehr zur Zone passt, und bekommt eine
andere Methode als angeklickt. Für einen Demo mit fixem CH-Kontext ist das die
richtige Grenze; die Alternative wäre eine zweite GET-Form nur für das Land oder
eine Client-Insel — beides mehr Apparat als der Punkt, den dieser Demo macht.
Ein `ponytail:`-Kommentar im Code nennt die Grenze an Ort und Stelle.

## Die Server Action

```ts
"use server";
export async function placeOrder(formData: FormData): Promise<void>;
```

Sie baut die Nutzlast exakt in der Form oben, liest den `saasToken` aus dem
httpOnly-Cookie und ruft:

```ts
await client.checkout.placeOrder(input, ctx, {
  ...(saasToken !== null ? { saasToken } : {}),
  siteCode: "main",
});
```

**Hier zahlt sich der Modus aus.** Der `saasToken` ist `httpOnly`; der Browser
sieht ihn nie. Im SPA-Weg muss er JS-lesbar sein, weil der Checkout dort im
Browser läuft — Finding F-01 in seiner konkretesten Form.

Danach:

1. `emporix.cartId` löschen. Der Cart ist auf Emporix **CLOSED**; bliebe die Id
   stehen, fragte die Cart-Seite eine tote Ressource ab
   ([Checkout.tsx:125-127](../../../examples/storefront-demo/src/pages/Checkout.tsx#L125)).
2. Auf `/checkout/done?orderId=…` weiterleiten.

## Der Erfolgsfall, ehrlich formuliert

`app/checkout/done/page.tsx` zeigt die `orderId` und sagt, was tatsächlich
passiert ist: bei `provider: "custom"` steht die Bestellung in `IN_CHECKOUT` und
wartet auf die Zahlung. Kein «Danke für Ihren Einkauf», das eine abgeschlossene
Zahlung suggeriert, die es nicht gibt.

## Fehlerbehandlung

Die Action fängt Fehler und leitet auf `/checkout?error=…` zurück; die Seite
rendert die Meldung. Kein Toast-System in diesem Example.

Die zwei realistischen Fälle: Emporix lehnt eine Adresse ab, oder eine Position
hat keinen Preis mehr. Beide kommen als `EmporixError` mit brauchbarem Text.

## Nicht-Ziele

- **Keine Zahlungs-Autorisierung** (`payments.initialize`). Der Demo bleibt bei
  der deklarativen `paymentMethods`-Angabe, wie `storefront-demo` auch.
- **Keine Redirect-Rückkehr** von einem Payment-Provider.
- **Kein Quote-Checkout** (`placeOrderFromQuote`).
- **Keine Adressverwaltung** — gespeicherte Adressen werden gelesen und zur
  Auswahl gestellt, nicht angelegt oder geändert.
- **Keine Änderung an `packages/next`.** Der Checkout braucht nichts, was der
  Modus nicht schon hat.

## Tests

**SDK, neu** — `packages/sdk/tests/shipping-helpers.test.ts`, die erste
Abdeckung dieser Regeln überhaupt:

| # | `resolveZone` | Erwartung |
|---|---|---|
| 1 | Land trifft `shipTo` einer Zone | diese Zone |
| 2 | Land trifft keine, es gibt eine `default`-Zone | die Default-Zone |
| 3 | Land trifft keine, keine Default-Zone | die erste Zone |
| 4 | leere Liste oder `undefined` | `undefined` |
| 5 | Land in Kleinschreibung, `shipTo` in Grossschreibung | trifft trotzdem |

| # | `pickFee` | Erwartung |
|---|---|---|
| 6 | mehrere Schwellen, Warenwert darüber | die höchste passende |
| 7 | Warenwert genau auf einer Schwelle | diese Schwelle (`≤`, nicht `<`) |
| 8 | Warenwert unter allen Schwellen | die erste Fee |
| 9 | Fee ohne `minOrderValue` | zählt als Schwelle 0 |
| 10 | leere Liste oder `undefined` | `undefined` |

Test 7 ist der wertvollste: `≤` gegen `<` ist genau der Fehler, den eine
Neuformulierung einführen würde.

Test 9 braucht einen Cast. Der generierte Typ deklariert `minOrderValue:
MonetaryAmount` als **pflicht**
([shipping/types.gen.ts:317](../../../packages/sdk/src/generated/shipping/types.gen.ts#L317)),
das Demo schreibt trotzdem `f.minOrderValue?.amount ?? 0`. Diese Spec ist schon
einmal danebengelegen — die gemischte Feldschreibweise bei `sessionId` gegen
`access_token` hat gezeigt, dass sie die Realität nicht immer trifft. Der Test
hält die defensive Verzweigung fest, damit sie niemand als toten Code entfernt,
und der Cast dokumentiert genau diesen Widerspruch.

**Example** — keine Unit-Tests, wie beim Rest des Examples. Verifiziert wird live:

1. Gast: Warenkorb füllen, `/checkout`, Formular ausfüllen, absenden → `orderId`
   auf der Done-Seite, `emporix.cartId` weg.
2. Eingeloggt: dasselbe, plus die gespeicherten Adressen erscheinen zur Auswahl.
3. `/debug` bleibt nach dem Checkout **grün** — der `saasToken` war beteiligt und
   ist trotzdem nie für JavaScript sichtbar geworden.

Punkt 3 ist der eigentliche Beleg. Punkt 2 verlangt einen Login und damit deine
Hand am Passwortfeld.

## Offene Punkte

1. **Welcher PR.** `feat/next-bff-mode` ist offen (PR #195) und noch nicht
   gemergt; der Checkout braucht `withEmporixSession` daraus. Entweder an #195
   anhängen — grösserer PR, aber kohärent — oder auf den Merge warten und einen
   eigenen Branch von `main` ziehen. Nicht stacken: ein PR mit Feature-Branch als
   Basis bekommt seine `quality`-Checks nie.
2. **Ob der `viu`-Tenant konfigurierte Payment-Modes hat.** Wenn
   `listPaymentModes` leer zurückkommt, greift der `custom`-Pfad — was laut Spec
   funktioniert und die Bestellung in `IN_CHECKOUT` anlegt. Beides ist ein
   gültiges Ergebnis; welches eintritt, zeigt der Live-Lauf.
3. **Ob Versandzonen für `CH` konfiguriert sind.** Andernfalls greift der
   Free-Shipping-Fallback. Ebenfalls gültig, ebenfalls erst live sichtbar.
