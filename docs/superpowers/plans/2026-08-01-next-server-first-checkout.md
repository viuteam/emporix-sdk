# Server-First-Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `examples/next-server-first` bekommt einen funktionierenden Checkout,
und die zwei pure Funktionen, die er dafür braucht, ziehen aus dem
Storefront-Demo in die SDK — mit Tests, die es dort noch nie gab.

**Architecture:** Eine Server Component liest Cart, Zahlungsarten, Versandzonen
und gespeicherte Adressen in **einer** `withEmporixSession` parallel. Ein
natives Formular postet an eine Server Action, die die `CheckoutInput`-Nutzlast
zusammenbaut, den `saasToken` aus dem httpOnly-Cookie zieht und
`client.checkout.placeOrder` ruft. Kein Client-JS, kein Client-State.

**Tech Stack:** Next 16 (App Router, Server Actions), `@viu/emporix-sdk`,
`@viu/emporix-sdk-next/bff`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-01-next-server-first-checkout-design.md`

## Global Constraints

- **Branch:** `feat/next-bff-mode`. Diese Arbeit hängt an **PR #195** an. Nicht
  stacken, keinen neuen Branch ziehen.
- **Push:** über HTTPS mit gh-Token. SSH ist hier tot.
- **Commitlint:** Scope aus `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth,
  http, logger, deps, docs, examples`. Es gibt **keinen** `next`-Scope — für
  Package-Arbeit `repo` nehmen. Erstes Wort nach dem Scope ist ein
  **kleingeschriebenes Verb**.
- **Keine Credentials in den Code.** Tenant `viu`, Site `main`, Currency `CHF`,
  Country `CH` stehen in `examples/next-server-first/.env.local`, das
  `.gitignore` über `.env.*` ausschliesst. Nie hardcoden, nie ins Terminal
  echoen, nie committen.
- **Examples typechecken gegen `dist/`.** Nach jeder SDK-Änderung
  `pnpm -F @viu/emporix-sdk build`, bevor ein Example typecheckt.
- **Schweizer Hochdeutsch in Prosa, kein scharfes S.** Code und Kommentare
  bleiben englisch, wie im Rest des Repos.
- **`exactOptionalPropertyTypes` ist an.** Ein optionales Feld bekommt entweder
  einen Wert oder existiert nicht — `{ ...(x ? { k: x } : {}) }`, nie
  `{ k: undefined }`.

---

### Task C1: `resolveZone` und `pickFee` in die SDK

**Files:**
- Modify: `packages/sdk/src/services/shipping-types.ts` (Re-Export von `ShippingFee`)
- Modify: `packages/sdk/src/services/shipping.ts` (die zwei Funktionen)
- Test: `packages/sdk/tests/shipping-helpers.test.ts` (neu)

**Interfaces:**
- Consumes: nichts.
- Produces:
  - `resolveZone(zones: ZoneList | undefined, country: string): Zone | undefined`
  - `pickFee(fees: ShippingFee[] | undefined, cartTotal: number): ShippingFee | undefined`
  - `ShippingFee` als öffentlicher Typ aus `@viu/emporix-sdk`

- [ ] **Step 1: Den Testfile schreiben**

Erstelle `packages/sdk/tests/shipping-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickFee, resolveZone, type ShippingFee, type Zone } from "../src/index";

/**
 * Fixtures against the generated shapes: `Zone.id`, `Zone.name` and
 * `Zone.shipTo` are all required, as are `ShippingFee.cost` and
 * `ShippingFee.minOrderValue`.
 */
function zone(id: string, countries: string[], isDefault = false): Zone {
  return {
    id,
    name: id,
    shipTo: countries.map((country) => ({ country })),
    ...(isDefault ? { default: true } : {}),
  };
}

function fee(minOrderValue: number, cost: number): ShippingFee {
  return {
    cost: { currency: "CHF", amount: cost },
    minOrderValue: { currency: "CHF", amount: minOrderValue },
  };
}

describe("resolveZone", () => {
  it("returns the zone whose shipTo covers the country", () => {
    const zones = [zone("eu", ["DE", "FR"]), zone("ch", ["CH"])];
    expect(resolveZone(zones, "CH")?.id).toBe("ch");
  });

  it("falls back to the default zone when no shipTo matches", () => {
    const zones = [zone("eu", ["DE"]), zone("rest", ["US"], true)];
    expect(resolveZone(zones, "CH")?.id).toBe("rest");
  });

  it("falls back to the first zone when there is no default either", () => {
    const zones = [zone("eu", ["DE"]), zone("us", ["US"])];
    expect(resolveZone(zones, "CH")?.id).toBe("eu");
  });

  it("returns undefined for an empty or missing list", () => {
    expect(resolveZone([], "CH")).toBeUndefined();
    expect(resolveZone(undefined, "CH")).toBeUndefined();
  });

  it("matches case-insensitively in both directions", () => {
    // The non-matching zone comes FIRST on purpose. With a single zone the
    // `?? zones[0]` fallback returns that same zone, so the assertion would
    // pass even with the case normalization removed — a vacuous test.
    const zones = [zone("eu", ["DE"]), zone("ch", ["ch"])];
    expect(resolveZone(zones, "  Ch ")?.id).toBe("ch");
  });
});

describe("pickFee", () => {
  it("takes the highest threshold at or below the cart total", () => {
    const fees = [fee(0, 10), fee(50, 5), fee(100, 0)];
    expect(pickFee(fees, 75)?.cost.amount).toBe(5);
  });

  it("includes a threshold the total exactly meets", () => {
    // The `<=` vs `<` boundary. A rewrite that drops the equals case ships a
    // customer who hit free-shipping exactly a shipping charge.
    const fees = [fee(0, 10), fee(100, 0)];
    expect(pickFee(fees, 100)?.cost.amount).toBe(0);
  });

  it("falls back to the first fee when the total is below every threshold", () => {
    const fees = [fee(50, 5), fee(100, 0)];
    expect(pickFee(fees, 10)?.cost.amount).toBe(5);
  });

  it("treats a missing minOrderValue as zero", () => {
    // The generated type declares `minOrderValue` REQUIRED, yet the storefront
    // demo guards with `?.amount ?? 0`. This spec has been wrong before — the
    // mixed `sessionId` / `access_token` casing proved it — so the defensive
    // branch stays, and this test stops anyone deleting it as dead code.
    const fees = [{ cost: { currency: "CHF", amount: 7 } } as unknown as ShippingFee, fee(100, 0)];
    expect(pickFee(fees, 5)?.cost.amount).toBe(7);
  });

  it("returns undefined for an empty or missing list", () => {
    expect(pickFee([], 100)).toBeUndefined();
    expect(pickFee(undefined, 100)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Testlauf — muss fehlschlagen**

```bash
pnpm -F @viu/emporix-sdk test -- shipping-helpers
```

Erwartung: Fehler beim Import — `resolveZone`, `pickFee` und `ShippingFee` gibt
es noch nicht in `../src/index`. Gemessene Baseline vorher: 837 SDK-Tests.

- [ ] **Step 3: `ShippingFee` re-exportieren**

In `packages/sdk/src/services/shipping-types.ts` den Import-Block um `Fee as
GenFee` ergänzen und darunter re-exportieren, direkt neben `MinimumFee`:

```ts
/**
 * A shipping fee: a cost plus the order value it applies from.
 *
 * Named `ShippingFee`, not `Fee` — the Fee service already owns that name at
 * the package root, and the prefix matches `ShippingMethod` / `ShippingGroup`
 * in this file.
 */
export type ShippingFee = GenFee;
```

**Nicht `Fee` nennen.** Der Fee-Service exportiert diesen Namen schon aus
`./fee`; `tsc` meldet sonst TS2308 in `src/index.ts`. Die Tests laufen trotzdem
grün durch — Typen sind zur Laufzeit weg — also fällt das erst im Typecheck
auf.

- [ ] **Step 4: Die zwei Funktionen ergänzen**

In `packages/sdk/src/services/shipping.ts`, **oberhalb** der
`ShippingService`-Klasse (sie sind pure und gehören nicht in die Klasse).
`ShippingFee` muss im bestehenden `import type { ... } from
"./shipping-types"`-Block ergänzt und im `export type { ... }`-Block mit
re-exportiert werden, damit `@viu/emporix-sdk` ihn nach aussen gibt:

```ts
/**
 * The zone whose `shipTo` covers `country`, else the default zone, else the first.
 *
 * Taken verbatim from the storefront demo, where the rules were proven against
 * a live tenant. The `?? []` guards a field the generated type marks required —
 * that spec has been wrong before.
 */
export function resolveZone(zones: ZoneList | undefined, country: string): Zone | undefined {
  if (!zones || zones.length === 0) return undefined;
  const c = country.trim().toUpperCase();
  const byCountry = c
    ? zones.find((z) => (z.shipTo ?? []).some((s) => s.country?.toUpperCase() === c))
    : undefined;
  return byCountry ?? zones.find((z) => z.default) ?? zones[0];
}

/**
 * The applicable fee: the highest `minOrderValue` at or below `cartTotal`,
 * else the first fee.
 *
 * `<=`, not `<`: a total that exactly meets a free-shipping threshold gets free
 * shipping.
 */
export function pickFee(fees: ShippingFee[] | undefined, cartTotal: number): ShippingFee | undefined {
  if (!fees || fees.length === 0) return undefined;
  const eligible = fees
    .filter((f) => (f.minOrderValue?.amount ?? 0) <= cartTotal)
    .sort((a, b) => (b.minOrderValue?.amount ?? 0) - (a.minOrderValue?.amount ?? 0));
  return eligible[0] ?? fees[0];
}
```

- [ ] **Step 5: Den Export bestätigen**

`packages/sdk/src/index.ts:254` ist `export * from "./shipping"` — gemessen, kein
namentlicher Block. Die zwei Funktionen und `ShippingFee` sind damit automatisch
öffentlich, sobald sie in `shipping.ts` exportiert sind. Nur bestätigen:

```bash
pnpm -F @viu/emporix-sdk build && grep -c "resolveZone\|pickFee" packages/sdk/dist/index.d.ts
```

Erwartung: mindestens 2.

- [ ] **Step 6: Testlauf — muss durchlaufen**

```bash
pnpm -F @viu/emporix-sdk test -- shipping-helpers
```

Erwartung: 10 Tests grün.

- [ ] **Step 7: Mutation testen — der Punkt der Übung**

Ein Guard, der nie fehlgeschlagen ist, ist nicht als funktionierend bekannt.
Zwei Mutationen, jede einzeln, jeweils zurückdrehen:

1. In `pickFee` `<=` durch `<` ersetzen → Test «includes a threshold the total
   exactly meets» **muss** rot werden.
2. In `resolveZone` das `.toUpperCase()` auf `s.country` entfernen → Test
   «matches case-insensitively in both directions» **muss** rot werden.

Wird eine Mutation nicht gefangen, ist der zugehörige Test wertlos — dann den
Test reparieren, nicht die Mutation behalten.

- [ ] **Step 8: Volle Suite und Typecheck**

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck
```

Erwartung: alles grün. Notiere die Gesamtzahl der Tests — sie kommt in die
PR-Beschreibung, und geratene Zahlen sind in diesem Zyklus schon dreimal falsch
gewesen.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/shipping.ts packages/sdk/src/services/shipping-types.ts packages/sdk/tests/shipping-helpers.test.ts && git commit -m "feat(sdk): export resolveZone and pickFee next to the shipping service"
```

---

### Task C2: Storefront-Demo importiert aus der SDK

**Files:**
- Modify: `examples/storefront-demo/src/checkout/ShippingSelector.tsx:1-36`
- Modify: `examples/storefront-demo/src/pages/Checkout.tsx:120` (toter Cast)

**Interfaces:**
- Consumes: `resolveZone`, `pickFee`, `Fee`, `Zone` aus `@viu/emporix-sdk` (Task C1).
- Produces: nichts Neues. `SelectedShipping` bleibt lokal exportiert — es ist die
  Form, die *dieser* React-State braucht.

- [ ] **Step 1: SDK bauen**

Examples typechecken gegen `dist/`, nicht gegen `src/`.

```bash
pnpm -F @viu/emporix-sdk build
```

- [ ] **Step 2: Lokale Definitionen durch den Import ersetzen**

In `examples/storefront-demo/src/checkout/ShippingSelector.tsx`:

Die Import-Zeile ersetzen:

```ts
import type { ZoneList, ShippingMethod } from "@viu/emporix-sdk";
```

durch:

```ts
import {
  pickFee,
  resolveZone,
  type ShippingFee,
  type ShippingMethod,
  type Zone,
  type ZoneList,
} from "@viu/emporix-sdk";
```

Dann ersatzlos löschen:

- `type ShippingZone = ZoneList[number];` — das **ist** `Zone`, weil
  `Zones = Array<Zone>`.
- `type Fee = ShippingMethod["fees"][number];` — heisst in der SDK
  `ShippingFee`; die lokalen Verwendungen mit umbenennen.
- die ganze Funktion `resolveZone` (Zeilen 20-27)
- die ganze Funktion `pickFee` (Zeilen 29-36)

Und die verbliebenen Verwendungen von `ShippingZone` im File auf `Zone` umbenennen
— in `toSelected(method, zone: ShippingZone, …)` und wo sonst der Alias auftaucht:

```bash
grep -n "ShippingZone" examples/storefront-demo/src/checkout/ShippingSelector.tsx
```

- [ ] **Step 3: Den toten Cast in Checkout.tsx entfernen**

In `examples/storefront-demo/src/pages/Checkout.tsx` wird das Objekt als
`input: input as never` übergeben. Der Cast ist überflüssig — gemessen: der
Demo typecheckt sauber ohne ihn, weil `useCheckout` den Parameter bereits als
`CheckoutInput` deklariert. Ein `as never` an genau der Stelle, die der
Server-First-Checkout nachbaut, würde sonst mitkopiert.

```ts
      const r = await placeOrder.mutateAsync({
        input,
```

- [ ] **Step 4: Typecheck**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
```

Erwartung: keine Ausgabe ausser dem Kommando-Echo.

- [ ] **Step 5: Prüfen, dass nichts zurückblieb**

```bash
grep -rn "resolveZone\|pickFee\|ShippingZone" examples/storefront-demo/src
```

Erwartung: nur noch Aufrufe (`resolveZone(zones, country)`, `pickFee(m.fees, …)`)
und der Import — keine `function`- oder `type`-Definitionen mehr.

- [ ] **Step 6: Commit**

```bash
git add examples/storefront-demo/src && git commit -m "refactor(examples): import the shipping helpers from the sdk"
```

---

### Task C3: Checkout-Seite, Server Action und Done-Seite

**Files:**
- Create: `examples/next-server-first/app/actions/checkout.ts`
- Create: `examples/next-server-first/app/checkout/page.tsx`
- Create: `examples/next-server-first/app/checkout/done/page.tsx`
- Modify: `examples/next-server-first/app/cart/page.tsx` (Link zum Checkout)

**Interfaces:**
- Consumes: `resolveZone`, `pickFee` aus `@viu/emporix-sdk` (Task C1);
  `withEmporixSession`, `withEmporixSessionMutable`, `STORAGE_KEYS` aus
  `@viu/emporix-sdk-next/bff`; `SITE`, `CONTEXT`, `EMPORIX` aus `../emporix`.
- Produces: `submitCheckout(formData: FormData): Promise<void>` — eine Server
  Action, die bei Erfolg auf `/checkout/done?orderId=…` weiterleitet und bei
  Fehler auf `/checkout?error=…`.

- [ ] **Step 1: Die Server Action schreiben**

Erstelle `examples/next-server-first/app/actions/checkout.ts`:

```ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pickFee, resolveZone } from "@viu/emporix-sdk";
import type { CheckoutInput } from "@viu/emporix-sdk";
import { STORAGE_KEYS, withEmporixSessionMutable } from "@viu/emporix-sdk-next/bff";
import { CONTEXT, EMPORIX, SITE } from "../emporix";

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

/**
 * Places the order from the checkout form.
 *
 * The `saasToken` never leaves the server: it is read from an httpOnly cookie
 * here and handed to the SDK as a header. In the SPA mode the same token has to
 * be readable by JavaScript, because the checkout runs in the browser.
 */
export async function submitCheckout(formData: FormData): Promise<void> {
  const jar = await cookies();
  const cartId = jar.get(STORAGE_KEYS.cartId)?.value ?? null;
  if (cartId === null) redirect("/checkout?error=No+cart");
  const saasToken = jar.get(STORAGE_KEYS.saasToken)?.value ?? null;
  const loggedIn = jar.get(STORAGE_KEYS.customerToken)?.value !== undefined;

  const country = field(formData, "country") || CONTEXT.targetLocation;
  const firstName = field(formData, "firstName");
  const lastName = field(formData, "lastName");
  const modeId = field(formData, "modeId");

  let orderId: string | undefined;
  try {
    const result = await withEmporixSessionMutable(async (client, ctx) => {
      const [cart, zones] = await Promise.all([
        client.carts.get(cartId, ctx),
        client.shipping.listZones(
          SITE.siteCode,
          { expand: "methods,fees", activeMethods: "true" },
          ctx,
        ),
      ]);
      const total = cart.totalPrice?.amount ?? 0;

      // The form's radio is a hint, not the authority: the customer may have
      // typed a country that belongs to a different zone. Re-resolve here.
      const zone = resolveZone(zones, country);
      const method = (zone?.methods ?? []).find((m) => m.id === field(formData, "methodId"))
        ?? (zone?.methods ?? [])[0];
      const fee = pickFee(method?.fees, total);
      const shipping =
        zone && method && fee
          ? {
              methodId: method.id,
              zoneId: zone.id,
              methodName: typeof method.name === "string" ? method.name : method.id,
              amount: fee.cost.amount,
              ...(method.shippingTaxCode ? { shippingTaxCode: method.shippingTaxCode } : {}),
            }
          : { methodId: "free", zoneId: country, methodName: "Free Shipping", amount: 0 };

      const address = {
        contactName: `${firstName} ${lastName}`.trim(),
        street: field(formData, "street"),
        ...(field(formData, "streetNumber") ? { streetNumber: field(formData, "streetNumber") } : {}),
        zipCode: field(formData, "zipCode"),
        city: field(formData, "city"),
        country,
      };

      const input: CheckoutInput = {
        cartId,
        customer: {
          email: field(formData, "email"),
          firstName,
          lastName,
          // A logged-in customer must NOT be flagged as a guest; Emporix reads
          // the identity off the token in that case.
          guest: !loggedIn,
        },
        shipping,
        addresses: [
          { ...address, type: "SHIPPING" },
          { ...address, type: "BILLING" },
        ],
        // `custom` is a documented Emporix provider, not a demo stand-in: the
        // order it creates has the IN_CHECKOUT status and waits for payment.
        paymentMethods: modeId
          ? [{ provider: "payment-gateway", customAttributes: { modeId }, amount: total }]
          : [{ provider: "custom", amount: total }],
      };

      return client.checkout.placeOrder(input, ctx, {
        ...(loggedIn && saasToken !== null ? { saasToken } : {}),
        siteCode: SITE.siteCode,
      });
    }, EMPORIX);
    orderId = result.orderId;
  } catch (e) {
    redirect(`/checkout?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }

  // Emporix CLOSES the cart on a successful checkout. Keeping the id would point
  // the cart page at a dead resource.
  jar.delete(STORAGE_KEYS.cartId);
  revalidatePath("/cart");
  redirect(`/checkout/done?orderId=${encodeURIComponent(orderId ?? "")}`);
}
```

**Achtung bei `redirect()` im `try`:** Next implementiert `redirect()` als
geworfene Ausnahme. Ein `redirect()` **innerhalb** eines `try` mit `catch` wird
vom eigenen `catch` gefangen. Deshalb stehen hier alle Erfolgs-Redirects
**ausserhalb** des `try`-Blocks, und der einzige `redirect()` im `catch` ist der
Fehlerfall selbst.

- [ ] **Step 2: Die Checkout-Seite schreiben**

Erstelle `examples/next-server-first/app/checkout/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { pickFee, resolveZone, type Address } from "@viu/emporix-sdk";
import { STORAGE_KEYS, withEmporixSession } from "@viu/emporix-sdk-next/bff";
import { CONTEXT, EMPORIX, SITE } from "../emporix";
import { submitCheckout } from "../actions/checkout";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}): Promise<React.JSX.Element> {
  const { error } = await searchParams;
  const cartId = (await cookies()).get(STORAGE_KEYS.cartId)?.value ?? null;
  if (cartId === null) {
    return (
      <main>
        <h1>Checkout</h1>
        <p>
          No cart yet. Add something from the <a href="/">catalog</a>.
        </p>
      </main>
    );
  }

  // ONE session, four parallel calls. Four separate withEmporixSession calls
  // would build four guest clients and redeem the same anonymous refresh token
  // four times over — see bff-session.ts:100.
  const { cart, modes, zones, addresses } = await withEmporixSession(async (c, ctx) => {
    const [cart, modes, zones, addresses] = await Promise.all([
      c.carts.get(cartId, ctx),
      c.payments.listPaymentModes(ctx),
      c.shipping.listZones(SITE.siteCode, { expand: "methods,fees", activeMethods: "true" }, ctx),
      // A guest throws EmporixAuthError locally, an expired token 401s. Both
      // mean "no saved addresses", and neither is worth a second code path.
      c.customers.addresses.list(ctx).catch(() => [] as Address[]),
    ]);
    return { cart, modes, zones, addresses };
  }, EMPORIX);

  const total = cart.totalPrice?.amount ?? 0;
  // ponytail: the zone is resolved for the configured country only. Typing a
  // different country leaves this radio list stale — the action re-resolves and
  // wins. Upgrade path: a separate GET form for the country, or a client island.
  const zone = resolveZone(zones, CONTEXT.targetLocation);
  const methods = zone?.methods ?? [];
  const saved = addresses[0];

  return (
    <main>
      <h1>Checkout</h1>
      {error ? <p role="alert">{error}</p> : null}
      <p>
        {cart.items?.length ?? 0} item(s), total {total} {cart.totalPrice?.currency ?? ""}
      </p>

      <form action={submitCheckout}>
        <fieldset>
          <legend>Contact</legend>
          <input name="email" type="email" placeholder="email" required defaultValue={saved?.contactName ? undefined : ""} />
          <input name="firstName" placeholder="first name" required />
          <input name="lastName" placeholder="last name" required />
        </fieldset>

        <fieldset>
          <legend>Address{saved ? " (prefilled from your account)" : ""}</legend>
          <input name="street" placeholder="street" required defaultValue={saved?.street ?? ""} />
          <input name="streetNumber" placeholder="no." defaultValue={saved?.streetNumber ?? ""} />
          <input name="zipCode" placeholder="zip" required defaultValue={saved?.zipCode ?? ""} />
          <input name="city" placeholder="city" required defaultValue={saved?.city ?? ""} />
          <input name="country" placeholder="country" required defaultValue={saved?.country ?? CONTEXT.targetLocation} />
        </fieldset>

        <fieldset>
          <legend>Shipping</legend>
          {methods.length === 0 ? (
            <p>No configured method for {CONTEXT.targetLocation} — free shipping applies.</p>
          ) : (
            methods.map((m, i) => (
              <label key={m.id}>
                <input type="radio" name="methodId" value={m.id} defaultChecked={i === 0} />
                {typeof m.name === "string" ? m.name : m.id} — {pickFee(m.fees, total)?.cost.amount ?? 0}
              </label>
            ))
          )}
        </fieldset>

        <fieldset>
          <legend>Payment</legend>
          {modes.length === 0 ? (
            <p>No configured payment mode — the order is placed with the `custom` provider.</p>
          ) : (
            modes.map((m, i) => (
              <label key={m.id ?? i}>
                <input type="radio" name="modeId" value={m.id ?? ""} defaultChecked={i === 0} />
                {m.id ?? "mode"}
              </label>
            ))
          )}
        </fieldset>

        <button type="submit">Place order</button>
      </form>
    </main>
  );
}
```

Wenn `PaymentMode` andere Felder hat als `id`, beim Typecheck korrigieren —
`m.id` ist die Annahme, die der Typecheck in Step 4 bestätigt oder widerlegt.

- [ ] **Step 3: Die Done-Seite schreiben**

Erstelle `examples/next-server-first/app/checkout/done/page.tsx`:

```tsx
export default async function CheckoutDonePage({
  searchParams,
}: {
  searchParams: Promise<{ orderId?: string }>;
}): Promise<React.JSX.Element> {
  const { orderId } = await searchParams;
  return (
    <main>
      <h1>Order placed</h1>
      <p>Order id: {orderId || "(none returned)"}</p>
      <p>
        With the <code>custom</code> payment provider Emporix creates the order in
        the <code>IN_CHECKOUT</code> status — it exists and is waiting for payment,
        it is not paid. The cart is closed and its cookie has been cleared.
      </p>
      <p>
        The <code>saasToken</code> used for this order stayed in an httpOnly
        cookie the whole time. Check <a href="/debug">/debug</a>.
      </p>
      <a href="/">Back to the catalog</a>
    </main>
  );
}
```

- [ ] **Step 4: Link vom Cart zum Checkout**

In `examples/next-server-first/app/cart/page.tsx`, im `else`-Zweig unterhalb der
Item-Liste:

```tsx
          <a href="/checkout">Checkout</a>
```

- [ ] **Step 5: Typecheck**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

Erwartung: sauber. Wahrscheinliche Treffer, die hier auffallen: die Felder von
`PaymentMode`, und `exactOptionalPropertyTypes` bei den Adressfeldern. Beides an
Ort und Stelle reparieren, nicht mit `as` wegcasten — dieser Zyklus hat gerade
erst einen toten `as never` entfernt.

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first/app && git commit -m "feat(examples): add a server-first checkout to the next demo"
```

---

### Task C4: Changeset, README und Live-Verifikation

**Files:**
- Create: `.changeset/sdk-shipping-helpers.md`
- Modify: `examples/next-server-first/README.md`

**Interfaces:**
- Consumes: alles aus C1-C3.
- Produces: nichts im Code.

- [ ] **Step 1: Changeset für die SDK**

Erstelle `.changeset/sdk-shipping-helpers.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Export `resolveZone` and `pickFee` alongside the shipping service, plus the
`Fee` type they use. Both are pure functions lifted verbatim from the storefront
demo, where they had no test coverage; they now have ten.

`resolveZone(zones, country)` picks the zone whose `shipTo` covers the country,
falling back to the default zone and then the first. `pickFee(fees, cartTotal)`
picks the highest `minOrderValue` at or below the total, falling back to the
first fee.
```

Kein Changeset für die Examples — `@viu/emporix-examples-*` stehen in
`.changeset/config.json` unter `ignore`.

- [ ] **Step 2: README-Abschnitt**

In `examples/next-server-first/README.md` einen Abschnitt ergänzen, der die
Checkout-Route beschreibt und den einen Punkt macht, den dieser Demo belegt:

```markdown
## Checkout

`/checkout` reads the cart, the payment modes, the shipping zones and — for a
logged-in customer — the saved addresses in one server session, then posts a
native form to a Server Action.

The point: the Server Action reads the `saasToken` from an httpOnly cookie and
passes it to Emporix as a header. The browser never sees it. In the SPA mode the
same token has to be readable by JavaScript, because the checkout runs there.

With no configured payment mode the order goes out with the `custom` provider,
which Emporix documents as creating the order in the `IN_CHECKOUT` status — a
real order waiting for payment, not a paid one.
```

- [ ] **Step 3: Volle Suite und Typecheck über alles**

```bash
pnpm -r test && pnpm typecheck
```

Erwartung: alles grün. Die Testzahl notieren.

- [ ] **Step 4: Commit**

```bash
git add .changeset examples/next-server-first/README.md && git commit -m "docs(repo): document the server-first checkout and changeset the sdk helpers"
```

- [ ] **Step 5: Live-Verifikation — Gast**

```bash
pnpm -F @viu/emporix-examples-next-server-first dev
```

Im Browser:

1. `/` öffnen, ein Produkt aus der Kategorie hinzufügen, die die README nennt
   (nicht jedes Produkt hat einen Preis).
2. `/cart` — die Position erscheint.
3. `/checkout` — Formular ausfüllen, Land `CH` lassen, absenden.
4. `/checkout/done` zeigt eine `orderId`.
5. In den DevTools prüfen: `emporix.cartId` ist weg.
6. `/cart` zeigt wieder «No cart yet».

- [ ] **Step 6: Live-Verifikation — eingeloggt**

Dieser Schritt braucht das Passwort im Formular. **Das tippt die Nutzerin
selbst** — Zugangsdaten in Felder einzugeben ist eine Grenze, die auch mit
Freigabe steht. Alles davor und danach läuft ohne.

1. Nutzerin loggt sich auf `/login` ein.
2. `/checkout` — die Adressfelder sind aus dem Konto vorbefüllt.
3. Bestellung absenden → `orderId` auf der Done-Seite.
4. `/debug` ist **grün**: kein Token für JavaScript sichtbar, obwohl der
   `saasToken` gerade an einem Checkout beteiligt war.

Punkt 4 ist der eigentliche Beleg dieses ganzen Modus.

- [ ] **Step 7: Push zu PR #195**

```bash
git push origin feat/next-bff-mode
```

Dann die PR-Beschreibung um den Checkout ergänzen: die neuen SDK-Exports mit
ihren zehn Tests, die Checkout-Route, und die gemessene Gesamt-Testzahl.

**Nicht mergen.** Das ist die Entscheidung der Nutzerin.

---

## Self-Review

**Spec-Abdeckung** — jede Anforderung der Spec hat eine Task:

| Spec-Abschnitt | Task |
|---|---|
| `resolveZone`/`pickFee` in die SDK, `Fee` re-exportieren | C1 |
| Zehn Tests inklusive der `≤`-Grenze und des Cast-Falls | C1 Step 1 |
| `storefront-demo` importiert aus der SDK | C2 |
| Vier parallele Reads in **einer** Session | C3 Step 2 |
| Adress-Read mit `.catch(() => [])` | C3 Step 2 |
| Natives Formular ohne Client-State | C3 Step 2 |
| Server Action ist die Autorität für die Versandzone | C3 Step 1 |
| `saasToken` aus dem httpOnly-Cookie | C3 Step 1 |
| `emporix.cartId` löschen, weil der Cart CLOSED ist | C3 Step 1 |
| Done-Seite sagt ehrlich `IN_CHECKOUT` | C3 Step 3 |
| Fehler zurück auf `/checkout?error=` | C3 Step 1 + Step 2 |
| Changeset für `@viu/emporix-sdk` (minor) | C4 Step 1 |
| Live-Checks Gast, eingeloggt, `/debug` grün | C4 Steps 5-6 |

**Nicht abgedeckt und bewusst so:** die Nicht-Ziele der Spec
(`payments.initialize`, Provider-Rückkehr, Quote-Checkout, Adressverwaltung).

**Typ-Konsistenz:** `submitCheckout` heisst in C3 Step 1 und Step 2 gleich. Die
in C1 produzierten Signaturen (`resolveZone`, `pickFee`, `Fee`) werden in C2 und
C3 mit genau diesen Namen konsumiert. `SITE.siteCode` ist `"main"` aus
`app/emporix.ts:4`, `CONTEXT.targetLocation` ist `"CH"` aus Zeile 12.

**Zwei Annahmen, die der Typecheck in C3 Step 5 bestätigt oder widerlegt:** die
Feldnamen von `PaymentMode` (angenommen: `id`), und dass `Address` die Felder
`street`, `streetNumber`, `zipCode`, `city`, `country` trägt. Beide sind im Plan
als Prüfpunkt markiert statt als Tatsache behauptet.
