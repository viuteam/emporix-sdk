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

**[`src/app/lib/queries.ts`](./src/app/lib/queries.ts) first.** Every Emporix read
the storefront makes is in that one file. `@viu/emporix-sdk-angular` ships the
foundation — `provideEmporix`, `injectEmporixQuery`, the site signals, the customer
session — but not yet the 33 injectables that mirror the React hooks, so this is
what `docs/angular.md` tells you to do in the meantime: call the SDK through
`injectEmporixQuery` yourself. It doubles as the blueprint for those injectables.

**[`src/main.ts`](./src/main.ts) second.** Two bootstraps, chosen by whether the
demo is configured. `provideEmporix` takes a constructed client, so the tenant has
to be known before the injector exists — reading the config before bootstrap beats
a factory provider that would have to represent «not configured yet» as a valid
client.

**[`src/app/pages/product.ts`](./src/app/pages/product.ts) third**, for the
add-to-cart path. It carries the three details a package-level
`injectCartMutations` will have to keep, each of which is a real trap:
`getCurrent({create:true})` returns a `Cart` with `.id` while `create()` returns a
`CartCreated` with `.cartId`; a cart item needs its matched `price` row because
Emporix requires `priceId` on internal-type items, so an unpriced product cannot be
added at all; and the resulting cart id goes into storage, which is what makes the
header badge update.

## The one rule

**Read signals inside the options callback, never before it.** `injectQuery` runs
that callback in a reactive context, so the cache key and the `enabled` gate follow
login, logout and a site switch. [`search.ts`](./src/app/pages/search.ts) is the
smallest demonstration: typing re-keys the query, with no `effect`, subscription or
manual refetch anywhere.

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

## What is not here

Compared with `storefront-demo`'s 17 routes, this has 7. The difference is the
account extras — **shopping lists, reward points and returns**, plus reorder,
cancel-order, variant pickers, category navigation and the password-reset flow.
Those sit in the 74 injectables `@viu/emporix-sdk-angular` does not ship yet, so
building them here would mean hand-rolling a large part of the package's future
surface inside an example. See the scope table in
[`docs/angular.md`](../../docs/angular.md).

**Checkout stops before submitting.** The page gathers what
`client.checkout.placeOrder` needs and shows the payload, but does not send it.
Placing real orders on whatever tenant someone points this at is a side effect an
example should not have.

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

**Not verified: the customer paths.** Sign-in, the account order list and the
guest-cart merge on login need test-customer credentials, which do not belong in
this repository. And **no order has been placed** — the checkout page shows its
payload instead of sending it, deliberately.
