# Server-First-Checkout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `examples/next-server-first` gets a working checkout, and the two pure
functions it needs for that move out of the storefront demo and into the SDK —
with tests that never existed there.

**Architecture:** One Server Component reads the cart, the payment modes, the
shipping zones and the saved addresses in parallel inside **one**
`withEmporixSession`. A native form posts to a Server Action that assembles the
`CheckoutInput` payload, pulls the `saasToken` out of the httpOnly cookie and
calls `client.checkout.placeOrder`. No client JS, no client state.

**Tech Stack:** Next 16 (App Router, Server Actions), `@viu/emporix-sdk`,
`@viu/emporix-sdk-next/bff`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-01-next-server-first-checkout-design.md`

## Global Constraints

- **Branch:** `feat/next-bff-mode`. This work attaches to **PR #195**. Do not
  stack, do not cut a new branch.
- **Push:** `git push origin feat/next-bff-mode` over SSH. The gh token is
  rejected for Git operations over HTTPS — only the API use of `gh` works.
- **Commitlint:** Scope out of `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth,
  http, logger, deps, docs, examples`. There is **no** `next` scope — use `repo`
  for package work. The first word after the scope is a
  **lowercase verb**.
- **No credentials in the code.** Tenant `viu`, site `main`, currency `CHF`,
  country `CH` live in `examples/next-server-first/.env.local`, which
  `.gitignore` excludes via `.env.*`. Never hardcode them, never echo them into
  the terminal, never commit them.
- **Examples typecheck against `dist/`.** After every SDK change run
  `pnpm -F @viu/emporix-sdk build` before an example typechecks.
- **Swiss Standard German in prose, no sharp s.** Code and comments stay
  English, as in the rest of the repo. *(Superseded 2026-08-05: everything committed is English — see `CLAUDE.md`. Kept as the record of the constraint that applied when this plan was written.)*
- **`exactOptionalPropertyTypes` is on.** An optional field either gets a value
  or does not exist — `{ ...(x ? { k: x } : {}) }`, never
  `{ k: undefined }`.

---

### Task C1: `resolveZone` and `pickFee` into the SDK

**Files:**
- Modify: `packages/sdk/src/services/shipping-types.ts` (re-export of `ShippingFee`)
- Modify: `packages/sdk/src/services/shipping.ts` (the two functions)
- Test: `packages/sdk/tests/shipping-helpers.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `resolveZone(zones: ZoneList | undefined, country: string): Zone | undefined`
  - `pickFee(fees: ShippingFee[] | undefined, cartTotal: number): ShippingFee | undefined`
  - `ShippingFee` as a public type out of `@viu/emporix-sdk`

- [ ] **Step 1: Write the test file**

Create `packages/sdk/tests/shipping-helpers.test.ts`:

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

- [ ] **Step 2: Test run — must fail**

```bash
pnpm -F @viu/emporix-sdk test -- shipping-helpers
```

Expectation: an import error — `resolveZone`, `pickFee` and `ShippingFee` do not
exist in `../src/index` yet. Measured baseline beforehand: 837 SDK tests.

- [ ] **Step 3: Re-export `ShippingFee`**

In `packages/sdk/src/services/shipping-types.ts`, extend the import block with
`Fee as GenFee` and re-export it below, right next to `MinimumFee`:

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

**Do not call it `Fee`.** The Fee service already exports that name from
`./fee`; otherwise `tsc` reports TS2308 in `src/index.ts`. The tests still pass
green anyway — types are gone at runtime — so this only shows up in the
typecheck.

- [ ] **Step 4: Add the two functions**

In `packages/sdk/src/services/shipping.ts`, **above** the `ShippingService`
class (they are pure and do not belong in the class). `ShippingFee` has to be
added to the existing `import type { ... } from "./shipping-types"` block and
re-exported along with the others in the `export type { ... }` block, so that
`@viu/emporix-sdk` hands it outward:

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

- [ ] **Step 5: Confirm the export**

`packages/sdk/src/index.ts:254` is `export * from "./shipping"` — measured, not a
named block. The two functions and `ShippingFee` are therefore public
automatically as soon as they are exported in `shipping.ts`. Just confirm it:

```bash
pnpm -F @viu/emporix-sdk build && grep -c "resolveZone\|pickFee" packages/sdk/dist/index.d.ts
```

Expectation: at least 2.

- [ ] **Step 6: Test run — must pass**

```bash
pnpm -F @viu/emporix-sdk test -- shipping-helpers
```

Expectation: 10 tests green.

- [ ] **Step 7: Mutation testing — the point of the exercise**

A guard that has never failed is not known to work.
Two mutations, each one on its own, each one reverted afterwards:

1. In `pickFee`, replace `<=` with `<` → the test «includes a threshold the total
   exactly meets» **must** turn red.
2. In `resolveZone`, remove the `.toUpperCase()` on `s.country` → the test
   «matches case-insensitively in both directions» **must** turn red.

If a mutation is not caught, the corresponding test is worthless — then repair
the test, do not keep the mutation.

- [ ] **Step 8: Full suite and typecheck**

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck
```

Expectation: everything green. Note down the total number of tests — it goes into
the PR description, and guessed numbers have already been wrong three times in
this cycle.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/shipping.ts packages/sdk/src/services/shipping-types.ts packages/sdk/tests/shipping-helpers.test.ts && git commit -m "feat(sdk): export resolveZone and pickFee next to the shipping service"
```

---

### Task C2: The storefront demo imports from the SDK

**Files:**
- Modify: `examples/storefront-demo/src/checkout/ShippingSelector.tsx:1-36`
- Modify: `examples/storefront-demo/src/pages/Checkout.tsx:120` (dead cast)

**Interfaces:**
- Consumes: `resolveZone`, `pickFee`, `Fee`, `Zone` from `@viu/emporix-sdk` (Task C1).
- Produces: nothing new. `SelectedShipping` stays exported locally — it is the
  shape *this* React state needs.

- [ ] **Step 1: Build the SDK**

Examples typecheck against `dist/`, not against `src/`.

```bash
pnpm -F @viu/emporix-sdk build
```

- [ ] **Step 2: Replace the local definitions with the import**

In `examples/storefront-demo/src/checkout/ShippingSelector.tsx`:

Replace the import line:

```ts
import type { ZoneList, ShippingMethod } from "@viu/emporix-sdk";
```

with:

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

Then delete outright:

- `type ShippingZone = ZoneList[number];` — that **is** `Zone`, because
  `Zones = Array<Zone>`.
- `type Fee = ShippingMethod["fees"][number];` — in the SDK it is called
  `ShippingFee`; rename the local usages along with it.
- the whole `resolveZone` function (lines 20-27)
- the whole `pickFee` function (lines 29-36)

And rename the remaining usages of `ShippingZone` in the file to `Zone`
— in `toSelected(method, zone: ShippingZone, …)` and wherever else the alias shows up:

```bash
grep -n "ShippingZone" examples/storefront-demo/src/checkout/ShippingSelector.tsx
```

- [ ] **Step 3: Remove the dead cast in Checkout.tsx**

In `examples/storefront-demo/src/pages/Checkout.tsx` the object is passed as
`input: input as never`. The cast is superfluous — measured: the demo typechecks
cleanly without it, because `useCheckout` already declares the parameter as
`CheckoutInput`. An `as never` at exactly the spot the server-first checkout
rebuilds would otherwise be copied along.

```ts
      const r = await placeOrder.mutateAsync({
        input,
```

- [ ] **Step 4: Typecheck**

```bash
pnpm -F @viu/emporix-examples-storefront-demo typecheck
```

Expectation: no output apart from the command echo.

- [ ] **Step 5: Check that nothing was left behind**

```bash
grep -rn "resolveZone\|pickFee\|ShippingZone" examples/storefront-demo/src
```

Expectation: only calls (`resolveZone(zones, country)`, `pickFee(m.fees, …)`)
and the import — no more `function` or `type` definitions.

- [ ] **Step 6: Commit**

```bash
git add examples/storefront-demo/src && git commit -m "refactor(examples): import the shipping helpers from the sdk"
```

---

### Task C3: Checkout page, Server Action and done page

**Files:**
- Create: `examples/next-server-first/app/actions/checkout.ts`
- Create: `examples/next-server-first/app/checkout/page.tsx`
- Create: `examples/next-server-first/app/checkout/done/page.tsx`
- Modify: `examples/next-server-first/app/cart/page.tsx` (link to the checkout)

**Interfaces:**
- Consumes: `resolveZone`, `pickFee` from `@viu/emporix-sdk` (Task C1);
  `withEmporixSession`, `withEmporixSessionMutable`, `STORAGE_KEYS` from
  `@viu/emporix-sdk-next/bff`; `SITE`, `CONTEXT`, `EMPORIX` from `../emporix`.
- Produces: `submitCheckout(formData: FormData): Promise<void>` — a Server
  Action that on success redirects to `/checkout/done?orderId=…` and on failure
  to `/checkout?error=…`.

- [ ] **Step 1: Write the Server Action**

Create `examples/next-server-first/app/actions/checkout.ts`:

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

**Watch out for `redirect()` inside `try`:** Next implements `redirect()` as a
thrown exception. A `redirect()` **inside** a `try` that has a `catch` gets
caught by that very `catch`. That is why all success redirects here sit
**outside** the `try` block, and the only `redirect()` in the `catch` is the
error case itself.

- [ ] **Step 2: Write the checkout page**

Create `examples/next-server-first/app/checkout/page.tsx`:

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

If `PaymentMode` has fields other than `id`, fix it during the typecheck —
`m.id` is the assumption the typecheck in Step 4 confirms or refutes.

- [ ] **Step 3: Write the done page**

Create `examples/next-server-first/app/checkout/done/page.tsx`:

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

- [ ] **Step 4: Link from the cart to the checkout**

In `examples/next-server-first/app/cart/page.tsx`, in the `else` branch below the
item list:

```tsx
          <a href="/checkout">Checkout</a>
```

- [ ] **Step 5: Typecheck**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

Expectation: clean. Likely hits that show up here: the fields of `PaymentMode`,
and `exactOptionalPropertyTypes` on the address fields. Repair both on the spot,
do not cast them away with `as` — this cycle has just removed a dead
`as never`.

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first/app && git commit -m "feat(examples): add a server-first checkout to the next demo"
```

---

### Task C4: Changeset, README and live verification

**Files:**
- Create: `.changeset/sdk-shipping-helpers.md`
- Modify: `examples/next-server-first/README.md`

**Interfaces:**
- Consumes: everything out of C1-C3.
- Produces: nothing in the code.

- [ ] **Step 1: Changeset for the SDK**

Create `.changeset/sdk-shipping-helpers.md`:

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

No changeset for the examples — `@viu/emporix-examples-*` are listed in
`.changeset/config.json` under `ignore`.

- [ ] **Step 2: README section**

In `examples/next-server-first/README.md`, add a section that describes the
checkout route and makes the one point this demo proves:

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

- [ ] **Step 3: Full suite and typecheck across everything**

```bash
pnpm -r test && pnpm typecheck
```

Expectation: everything green. Note down the test count.

- [ ] **Step 4: Commit**

```bash
git add .changeset examples/next-server-first/README.md && git commit -m "docs(repo): document the server-first checkout and changeset the sdk helpers"
```

- [ ] **Step 5: Live verification — guest**

```bash
pnpm -F @viu/emporix-examples-next-server-first dev
```

In the browser:

1. Open `/`, add a product from the category the README names
   (not every product has a price).
2. `/cart` — the line item appears.
3. `/checkout` — fill in the form, leave the country as `CH`, submit.
4. `/checkout/done` shows an `orderId`.
5. Check in the DevTools: `emporix.cartId` is gone.
6. `/cart` shows «No cart yet» again.

- [ ] **Step 6: Live verification — logged in**

This step needs the password in the form. **The user types that
themselves** — entering credentials into fields is a boundary that holds even
with approval. Everything before and after it runs without.

1. The user logs in at `/login`.
2. `/checkout` — the address fields are prefilled from the account.
3. Submit the order → `orderId` on the done page.
4. `/debug` is **green**: no token visible to JavaScript, even though the
   `saasToken` was just involved in a checkout.

Point 4 is the actual proof of this whole mode.

- [ ] **Step 7: Push to PR #195**

```bash
git push origin feat/next-bff-mode
```

Then extend the PR description with the checkout: the new SDK exports with their
ten tests, the checkout route, and the measured total test count.

**Do not merge.** That is the user's decision.

---

## Self-Review

**Spec coverage** — every requirement of the spec has a task:

| Spec section | Task |
|---|---|
| `resolveZone`/`pickFee` into the SDK, re-export `Fee` | C1 |
| Ten tests including the `≤` boundary and the cast case | C1 Step 1 |
| `storefront-demo` imports from the SDK | C2 |
| Four parallel reads in **one** session | C3 Step 2 |
| Address read with `.catch(() => [])` | C3 Step 2 |
| Native form without client state | C3 Step 2 |
| The Server Action is the authority for the shipping zone | C3 Step 1 |
| `saasToken` out of the httpOnly cookie | C3 Step 1 |
| Delete `emporix.cartId`, because the cart is CLOSED | C3 Step 1 |
| The done page honestly says `IN_CHECKOUT` | C3 Step 3 |
| Errors back to `/checkout?error=` | C3 Step 1 + Step 2 |
| Changeset for `@viu/emporix-sdk` (minor) | C4 Step 1 |
| Live checks as guest, logged in, `/debug` green | C4 Steps 5-6 |

**Not covered, and deliberately so:** the non-goals of the spec
(`payments.initialize`, provider return, quote checkout, address management).

**Type consistency:** `submitCheckout` has the same name in C3 Step 1 and Step 2.
The signatures produced in C1 (`resolveZone`, `pickFee`, `Fee`) are consumed in C2
and C3 under exactly those names. `SITE.siteCode` is `"main"` from
`app/emporix.ts:4`, `CONTEXT.targetLocation` is `"CH"` from line 12.

**Two assumptions the typecheck in C3 Step 5 confirms or refutes:** the field
names of `PaymentMode` (assumed: `id`), and that `Address` carries the fields
`street`, `streetNumber`, `zipCode`, `city`, `country`. Both are marked in the
plan as a check point instead of being claimed as fact.
