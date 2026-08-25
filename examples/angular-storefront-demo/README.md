# angular-storefront-demo

Reference Angular 22 storefront on `@viu/emporix-sdk-angular`: catalog, search,
product detail with add-to-cart, cart, checkout, sign-in and account.

The Angular counterpart of [`storefront-demo`](../storefront-demo). Read that one
for the React version of the same shop; read this one for how the same thing looks
with signals.

```bash
pnpm -F @viu/emporix-sdk-angular build
pnpm -F @viu/emporix-examples-angular-storefront start
```

There is nothing to configure first. The app asks for a tenant and a public
storefront client id on the setup screen and keeps them in `localStorage` — **no
configuration lives in this source tree**, so the example can be committed and
built in CI without pointing at anyone's account.

## What to read, and in what order

**[`src/app/pages/home.ts`](./src/app/pages/home.ts) first**, because it is now
four lines of data layer: `injectProductsInfinite` for the catalog and
`injectMatchPrices` for what is on screen. The package ships the 33 injectables, so
the components call them directly.

[`src/app/lib/queries.ts`](./src/app/lib/queries.ts) is what is left of the local
query layer — 48 lines, down from 240, holding the one read the 33 do not cover
(bulk product names for cart lines whose snapshot has none). Keeping it is the
honest signal that a storefront still needs a lookup the bindings do not.

**[`src/main.ts`](./src/main.ts) second.** Two bootstraps, chosen by whether the
demo is configured. `provideEmporix` takes a constructed client, so the tenant has
to be known before the injector exists — reading the config before bootstrap beats
a factory provider that would have to represent «not configured yet» as a valid
client.

**[`src/app/pages/product.ts`](./src/app/pages/product.ts) third**, for the
add-to-cart path — and for what the bindings took over. Reading
`injectActiveCart({ create: true })` bootstraps a cart; `injectCartMutations`
resolves its id at call time, builds the auth context and invalidates afterwards.
This component used to do all three by hand.

What it still owns is the `price` row: Emporix requires `priceId` on internal-type
cart items, so an unpriced product cannot be added at all and the page says so
instead of letting the button 400.

## The one rule

**Read signals inside the options callback, never before it.** `injectQuery` runs
that callback in a reactive context, so the cache key and the `enabled` gate follow
login, logout and a site switch. [`search.ts`](./src/app/pages/search.ts) is the
smallest demonstration: typing re-keys the query, with no `effect`, subscription or
manual refetch anywhere.

## Pagination, in both shapes

The catalog uses `injectEmporixInfinite` with a «Load more» button: pages start at
1 and the button disappears when Emporix's own `hasNextPage` says there is nothing
left — no trailing empty request to discover the end. Prices are derived from
everything loaded so far, so a second page re-resolves the whole visible set in one
call rather than one per page.

The order history uses **page numbers** instead, driven by a `signal` read inside
the query's options callback. That is deliberate: an order history is a table you
jump around in, not a feed you scroll, and each page keeps its own cache entry so
going back is instant.

Building this is what found a bug in the package: `injectEmporixInfinite` built its
`queryFn` through `emporixQueryOptions`, whose signature takes no arguments, so
TanStack's `pageParam` was dropped and every page would have re-fetched page one.
The interface now takes `fetchPage(pageNumber, ctx)` and owns the cursor logic
itself, mirroring React's internal `useEmporixInfinite`. Verified live: 24 distinct
products across two pages, item 13 a different product from item 1.

## Two things running it taught us

**A paused query looks exactly like a slow one.** Point the demo at a wrong tenant
or client id and the request fails at the CORS boundary before any response headers
arrive. TanStack's default `networkMode: "online"` reads that as offline and holds
the retry, so the query sits at `status: "pending"`, `fetchStatus: "paused"` and
never errors. This example showed a spinner forever until
[`ui/query-state.ts`](./src/app/ui/query-state.ts) started rendering the paused
state — which is now the first thing you see if the configuration is wrong.

**Response shapes need normalizing, and it is not optional.** Product names are
sometimes a string and sometimes a locale map; an order number lives under
`orderNumber` on some tenants and in a mixin on others; a matched price is keyed by
`itemId` on the wire but `itemRef` in the generated type; and `Customer` has
`contactEmail`, not `email`. This example uses
[`@viu/emporix-examples-shared`](../shared) for all of it rather than re-deriving
it — the AOT build caught four of those as type errors, and the rest would have
rendered blank columns.

## Checkout places real orders

**Checkout is complete and does place orders.** It resolves delivery options from
the tenant's shipping zones (with the applicable fee via the SDK's `pickFee`),
offers the configured payment modes, assembles the `CheckoutInput` and calls
`client.checkout.placeOrder`. The payload is shown in a `<details>` block above the
button, so you can read exactly what will be sent before sending it.

Four things it has to get right, each of which Emporix rejects otherwise:

- **`customer.id` present exactly when signed in.** Without it a customer
  checkout answers «Cannot found customer»; with it, a guest is claiming an
  account it does not own.
- **The `saas-token` header on a customer checkout.** That token comes from login
  and cannot be re-minted by a refresh, which is why the session persists it.
- **One `SHIPPING` and one `BILLING` address.** Billing mirrors shipping here.
- **Dropping the local cart id on success.** Emporix closes the cart, so a kept
  id makes every later cart read 404 with nothing to bootstrap over.

The default payment provider is `custom`, which records the order without
attempting a capture — that is why every existing order on the demo tenant reads
`IN_CHECKOUT`. Selecting a configured mode routes through the payment gateway for
real, so pick that only if you mean it.

## What is not here

Compared with `storefront-demo`'s 17 routes, this has 8. The difference is
**shopping lists, reward points and returns**, plus reorder, cancel-order, variant
pickers, category navigation and the password-reset flow. Those sit in the 69
injectables `@viu/emporix-sdk-angular` does not ship yet, so building them here
would mean hand-rolling a large part of the package's future surface inside an
example. See the scope table in [`docs/angular.md`](../../docs/angular.md).

Password and login-email management **is** here, at `/account/credentials` — those
five operations were originally in the excluded set and were pulled forward,
because a storefront with a login needs them.

## Verified, and not

**Verified live** against the `viu` tenant (`main` / CHF / CH): the catalog and
search load real products, `searchByName` returns live results and re-keys purely
from the term signal, a product loads by id with its description and a resolved
price, a guest cart is created and an item added with the right YRN and price row,
the cart page renders line, quantity and total, and the header badge follows the
stored cart id across components.

Also verified: the production AOT build, every route rendering, lazy chunks
loading, the setup gate, the guest-vs-customer gating (`mode: "customer"` issues no
request without a token), and the paused-state surface.

**«price unavailable» on a catalog card is usually correct, not a bug.** Emporix
resolves price per currency, site and target location, and plenty of products have
no price in a given context — the live tenant returns an empty match list for most
of its catalog. The product page shows a real `1,00 CHF` for a product that does
have one, so the path works; a card without a price is the tenant's answer.

**The customer paths are verified too.** Signing in with a test customer stored all
three tokens, dropped the now-dormant anonymous session, and **merged the guest
cart into the customer's existing one** — the shared line went from quantity 1 to 2.
The account page renders the real profile and 19 orders across two pages, and the
`mode: "customer"` gate flipped from «no request» to «fetched» on the same reads.

A cart line whose stored snapshot has no name rendered as a blank cell until the
bulk name lookup was added; a cart item carries only an `itemYrn`, so names have to
be resolved separately. Fixed and verified.

**The order path is implemented and its payload verified against the live
tenant** — real customer id, real shipping method resolved from the tenant's zones
(`methodId: "free"`, `zoneId: "CH"`, `shippingTaxCode: "ZERO"`), `custom` provider
at the cart total. Whether an order has actually been submitted is a decision for
whoever runs it; nothing here submits on load.
