# Server-First Checkout — Design

**Status:** approved
**Date:** 2026-08-01
**Affects:** `packages/sdk` (additive), `examples/next-server-first`,
`examples/storefront-demo` (import switch-over)
**Predecessor:** `2026-07-31-next-server-first-mode-design.md`
**Template:** `examples/storefront-demo/src/pages/Checkout.tsx` and
`src/checkout/*` — the shape proven there is adopted, not reinvented.

## Goal

The server-first demo gets a checkout page. It completes the flow — catalog,
cart, login, order — and shows the one point where this mode can do something
the SPA route cannot: the `saasToken` stays `httpOnly`.

## Measured foundations

Everything read from `storefront-demo` and the SDK, not assumed.

### The checkout payload

Verified in `examples/storefront-demo/src/pages/Checkout.tsx:75-131`:

| Field | Shape |
|---|---|
| `cartId` | from the cart |
| `customer` | `{ id? , email, firstName, lastName, guest }` — «logged-in customer must be identified by id; guest must not» ([Checkout.tsx:93](../../../examples/storefront-demo/src/pages/Checkout.tsx#L93)) |
| `shipping` | `{ methodId, zoneId, methodName, amount, shippingTaxCode? }`, otherwise `{ methodId: "free", zoneId: <country>, methodName: "Free Shipping", amount: 0 }` |
| `addresses` | exactly two: `type: "SHIPPING"` and `type: "BILLING"`, each `{ contactName, companyName?, street, streetNumber?, zipCode, city, country, contactPhone? }` |
| `paymentMethods` | `[{ provider: "payment-gateway", customAttributes: { modeId }, amount }]` or `[{ provider: "custom", amount }]` |

`placeOrder(input, auth, { saasToken?, siteCode? })` — the `saasToken` only for
logged-in customers ([checkout.ts:55-59](../../../packages/sdk/src/services/checkout.ts#L55)).
The return value is `CheckoutResult`, an alias for
`ResponseCheckout = { orderId?, paymentDetails?, checkoutId? }`
([checkout.ts:18](../../../packages/sdk/src/services/checkout.ts#L18),
[checkout/types.gen.ts:247](../../../packages/sdk/src/generated/checkout/types.gen.ts#L247)).

### Resolving the options

| What | Call | Pure logic afterwards |
|---|---|---|
| Payment methods | `client.payments.listPaymentModes(ctx)` | pre-select the first mode |
| Shipping zones | `client.shipping.listZones(site, { expand: "methods,fees", activeMethods: "true" }, ctx)` | `resolveZone` + `pickFee` |
| Saved addresses | `client.customers.addresses.list(ctx)` | — |

`addresses.list` goes through `requireCustomer` and throws an
`EmporixAuthError` for an anonymous context — **locally**, without ever reaching
Emporix ([require-customer.ts:10-13](../../../packages/sdk/src/core/require-customer.ts#L10)).
That is not a 401, and the difference is practical: the guest case costs no
roundtrip.

`resolveZone` and `pickFee` are **pure functions** and need no React
([ShippingSelector.tsx:21-37](../../../examples/storefront-demo/src/checkout/ShippingSelector.tsx#L21)).
Today they are **untested** — a grep across `examples`, `packages` and `e2e`
finds not a single test hit.

### `custom` is a real path, not a placeholder

Emporix's own spec, vendored by the SDK
([checkout/types.gen.ts:215](../../../packages/sdk/src/generated/checkout/types.gen.ts#L215)):

> «`custom` — When a custom provider is used. In this case the created order has
> the `IN_CHECKOUT` status.»

That is the reason the demo is a complete flow without payment authorization and
not a truncated one: the order really is created, it just sits in `IN_CHECKOUT`
and waits for the payment.

### Cache classification

Cart, payment methods and shipping zones are **group B** of the hook inventory:
readable anonymously, but not tagged by `emporixTagsForUrl` and therefore not
cacheable. They run through `withEmporixSession` in a Server Component. Saved
addresses are **group C**, customer-bound.

## What moves into the SDK

`resolveZone` and `pickFee` become pure exports in
`packages/sdk/src/services/shipping.ts`, next to the service they belong to.

```ts
/** The zone whose `shipTo` covers `country`, else the default zone, else the first. */
export function resolveZone(zones: ZoneList | undefined, country: string): Zone | undefined;

/** The applicable fee: the highest `minOrderValue` at or below the cart total,
 *  else the first fee. */
export function pickFee(
  fees: ShippingFee[] | undefined,
  cartTotal: number,
): ShippingFee | undefined;
```

The implementation is taken **verbatim** from `ShippingSelector.tsx`. The rules
are proven there against the `viu` tenant; rephrasing them would mean trading
proven behaviour for freshly written behaviour.

Two type details, measured:

- `Zone` is already public, and `ZoneList[number]` **is** `Zone`, because
  `Zones = Array<Zone>`
  ([shipping/types.gen.ts:253](../../../packages/sdk/src/generated/shipping/types.gen.ts#L253)).
  The local `type ShippingZone = ZoneList[number]` in the demo was only a
  shorthand and goes away.
- `Fee` exists as a generated type
  ([shipping/types.gen.ts:315](../../../packages/sdk/src/generated/shipping/types.gen.ts#L315)),
  but is **not** re-exported — `shipping-types.ts` exports only
  `MinimumFee`. The extraction has to re-export it as well, otherwise a public
  signature points at a non-public type. **Not as `Fee`:** the Fee service
  already occupies that name at the package root, `tsc` reports TS2308. The
  alias is called `ShippingFee` — the same prefix convention as
  `ShippingMethod` and `ShippingGroup` in the same file.

`SelectedShipping` stays in the demo. It is the shape *its* React state needs;
the server-first checkout builds the `shipping` payload directly.

**No new `helpers/` directory** for two functions. So far the SDK has no
precedent for exported pure helpers next to services — the only hit is
`_internalMedia` in `media.ts:387`, and that one is internal. These two are the
first public case, and they belong to `shipping`.

Afterwards `storefront-demo` imports from the SDK instead of defining locally.
Without that step the extraction would have solved nothing — there would be two
copies instead of one.

**This is the first SDK change of this cycle.** Until now it held throughout
that no hook-in point is missing. Two pure, additive functions change no
behaviour, but they widen the scope beyond «build one example» and need their
own changeset for `@viu/emporix-sdk` (minor).

## The page

A Server Component `app/checkout/page.tsx` with four parallel reads in **one**
session:

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

**One `withEmporixSession`, not four.** For a guest, every call builds its own
`EmporixClient` with its own token provider
([bff-session.ts:100](../../../packages/next/src/bff-session.ts#L100)) — four
calls would be four token roundtrips redeeming the same anonymous refresh token
in parallel. Emporix does tolerate that reuse (measured in the server-first
cycle with three consecutive reads), but relying on it would be unnecessary:
one client, one session, four parallel HTTP calls is both leaner and less code.

The address read attaches its `.catch(() => [])` directly. No `try/catch` and
no check for «cookie present», because two different routes lead to the same
result: the guest runs into the local `EmporixAuthError`, the expired token into
a real 401. A cookie check catches only the first.

One form, one Server Action. **No client state**: address, payment method and
shipping method are native form fields. In this mode there is no client that
could hold state, and that is the point.

The shipping selection has a genuine chicken-and-egg problem: `resolveZone`
needs the country, and the country sits in the form that has not been submitted
yet. Without client JS the page cannot react to the typing.

The solution is to move the authority instead of building intermediate states:
the page renders the methods of the zone resolved for `CONTEXT.country`, and
the **Server Action is the authority** — it calls `resolveZone`/`pickFee`
again with the country that was actually entered and takes their result, not
the radio button that was clicked.

**Known limit, deliberately accepted:** anyone who changes the country by hand
to a different one sees a radio list that no longer matches the zone, and gets a
different method than the one clicked. For a demo with a fixed CH context that
is the right limit; the alternative would be a second GET form just for the
country or a client island — both more apparatus than the point this demo makes.
A `ponytail:` comment in the code names the limit on the spot.

## The Server Action

```ts
"use server";
export async function placeOrder(formData: FormData): Promise<void>;
```

It builds the payload exactly in the shape above, reads the `saasToken` from the
httpOnly cookie and calls:

```ts
await client.checkout.placeOrder(input, ctx, {
  ...(saasToken !== null ? { saasToken } : {}),
  siteCode: "main",
});
```

**This is where the mode pays off.** The `saasToken` is `httpOnly`; the browser
never sees it. On the SPA route it has to be JS-readable, because the checkout
runs in the browser there — finding F-01 in its most concrete form.

Afterwards:

1. Delete `emporix.cartId`. The cart is **CLOSED** on Emporix; if the id stayed
   put, the cart page would query a dead resource
   ([Checkout.tsx:125-127](../../../examples/storefront-demo/src/pages/Checkout.tsx#L125)).
2. Redirect to `/checkout/done?orderId=…`.

## The success case, honestly worded

`app/checkout/done/page.tsx` shows the `orderId` and says what actually
happened: with `provider: "custom"` the order sits in `IN_CHECKOUT` and waits
for the payment. No «Thank you for your purchase» that suggests a completed
payment which does not exist.

## Error handling

The action catches errors and redirects back to `/checkout?error=…`; the page
renders the message. No toast system in this example.

The two realistic cases: Emporix rejects an address, or a line item no longer
has a price. Both arrive as an `EmporixError` with usable text.

## Non-goals

- **No payment authorization** (`payments.initialize`). The demo sticks with
  the declarative `paymentMethods` entry, just like `storefront-demo`.
- **No redirect return** from a payment provider.
- **No quote checkout** (`placeOrderFromQuote`).
- **No address management** — saved addresses are read and offered for
  selection, not created or changed.
- ~~**No change to `packages/next`.**~~ **Refuted on 2026-08-01.** The
  first logged-in live run ran into a `409 Conflict` on
  `POST /cart/viu/carts`: a customer may only have one open cart, and after
  the guest checkout the cookie was empty, so `addToCart` blindly attempted a
  `create`. At the same time the cart merge on login was missing, which the
  React package has long done in `onboardCustomerCart`. Both are **the same
  gap**: the server-first mode lacked the counterpart to the React onboarding.
  `emporixLogin` gets it — not the example, because otherwise every consumer
  repeats the mistake themselves.

## Tests

**SDK, new** — `packages/sdk/tests/shipping-helpers.test.ts`, the first
coverage of these rules at all:

| # | `resolveZone` | Expectation |
|---|---|---|
| 1 | country matches the `shipTo` of a zone | that zone |
| 2 | country matches none, there is a `default` zone | the default zone |
| 3 | country matches none, no default zone | the first zone |
| 4 | empty list or `undefined` | `undefined` |
| 5 | country in lower case, `shipTo` in upper case | matches anyway |

| # | `pickFee` | Expectation |
|---|---|---|
| 6 | several thresholds, cart total above them | the highest matching one |
| 7 | cart total exactly on a threshold | that threshold (`≤`, not `<`) |
| 8 | cart total below all thresholds | the first fee |
| 9 | fee without `minOrderValue` | counts as threshold 0 |
| 10 | empty list or `undefined` | `undefined` |

Test 7 is the most valuable one: `≤` versus `<` is exactly the mistake a
rewrite would introduce.

Test 9 needs a cast. The generated type declares `minOrderValue:
MonetaryAmount` as **required**
([shipping/types.gen.ts:317](../../../packages/sdk/src/generated/shipping/types.gen.ts#L317)),
yet the demo writes `f.minOrderValue?.amount ?? 0`. This spec has been wrong
once before — the mixed field spelling of `sessionId` versus `access_token`
showed that it does not always match reality. The test pins down the defensive
branch so that nobody removes it as dead code, and the cast documents exactly
this contradiction.

**Example** — no unit tests, as with the rest of the example. Verification
happens live:

1. Guest: fill the cart, `/checkout`, fill in the form, submit → `orderId`
   on the done page, `emporix.cartId` gone.
2. Logged in: the same, plus the saved addresses appear for selection.
3. `/debug` stays **green** after the checkout — the `saasToken` was involved
   and still never became visible to JavaScript.

Point 3 is the actual proof. Point 2 requires a login and therefore your hand
on the password field.

## Open points

1. **Which PR.** `feat/next-bff-mode` is open (PR #195) and not merged yet;
   the checkout needs `withEmporixSession` from it. Either append to #195 —
   a bigger PR, but coherent — or wait for the merge and cut a separate branch
   off `main`. Do not stack: a PR with a feature branch as its base never gets
   its `quality` checks.
2. ~~**Whether the `viu` tenant has configured payment modes.**~~ **Answered
   2026-08-01:** `listPaymentModes` comes back **empty**. So the `custom` path
   is the one that actually runs here — order `EON1225` created live.
3. ~~**Whether shipping zones are configured for `CH`.**~~ **Answered
   2026-08-01:** yes, one zone with exactly one method «Free Shipping» at 0.
   The `resolveZone` path applies, not the fallback.
