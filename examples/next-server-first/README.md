# Server-first example

Demonstrates `@viu/emporix-sdk-next`'s server-first mode: **no Emporix token in
the browser**, not even an anonymous one.

The browser makes no Emporix calls at all. Server Components read, Server Actions
write, and a narrow proxy serves the public catalog. There is no
`EmporixProvider`, no client-side `EmporixClient` and no storage adapter — the
browser has nothing to hold a token in.

`@viu/emporix-sdk-react` appears in `package.json` only because it is a required
peer of `@viu/emporix-sdk-next`. **No react hook or storage adapter is imported
by any file here.**

## Run it

```bash
cp .env.example .env.local   # then fill in tenant and storefront client id
pnpm -F @viu/emporix-examples-next-server-first dev
```

## What each page proves

| Page | Proves |
|---|---|
| `/` | catalog rendered on the server with the memoized tagged client |
| `/login` | `emporixLogin` / `emporixLogout` via Server Actions, session in httpOnly cookies |
| `/cart` | `withEmporixSession*`, a guest cart bound to a server-managed anonymous session |
| `/checkout` | four reads in one session, and a `saasToken` that authorizes an order without ever reaching the browser |
| `/debug` | **what the browser can actually read** — green only when no secret is reachable from JavaScript |
| typeahead on `/` | a client-side catalog read with no token, through `/api/emporix` |

## Checkout

`/checkout` reads the cart, the payment modes, the shipping zones and — for a
logged-in customer — the saved addresses in **one** `withEmporixSession` with
four parallel calls, then posts a native form to a Server Action. No client
state: in this mode there is no client to hold any.

The point: the Server Action reads the `saasToken` from an httpOnly cookie and
passes it to Emporix as a header. The browser never sees it. In the SPA mode the
same token has to be readable by JavaScript, because the checkout runs there.

Two details worth knowing before you read the code:

- **One session, not four.** Each `withEmporixSession` call builds its own guest
  client with its own token provider. Four calls would redeem the same anonymous
  refresh token four times in parallel.
- **The Server Action is the authority on shipping.** The page resolves the zone
  for the configured country, but a customer can type a different one. The action
  re-runs `resolveZone`/`pickFee` against what was actually submitted and uses
  that, not the radio that was clicked. The radio list can therefore go stale if
  you change the country — a deliberate limit for a demo with a fixed CH context.

With no configured payment mode the order goes out with the `custom` provider,
which Emporix documents as creating the order in the `IN_CHECKOUT` status — a
real order waiting for payment, not a paid one. The done page says exactly that.

## The catalog/cart split

Catalog reads use `getEmporixClient()`. Cart reads and writes use
`withEmporixSession*`. Do not swap them: `withEmporixSession` in a Server
Component gets a read-only cookie jar, so it cannot persist the anonymous session
it just obtained, and every render would log in anonymously again.

## Not every product has a price

Emporix requires a `priceId` on internal-type cart items, and a product only has
one in a context that resolves. `app/actions/cart.ts` resolves the price
server-side and throws a clear error when there is none. The catalog page lists
products from a category known to carry prices on the `viu` tenant — see
`PRICED_CATEGORY` in `app/emporix.ts`.

## Verified against the `viu` tenant

Measured on 2026-08-01 with `next start`:

| Check | Result |
|---|---|
| catalog server-rendered | 11 products from the priced category |
| plain visit sets no secret cookie | only `emporix.siteCode` |
| catalog proxy, product URL | `200` |
| catalog proxy, cart / customer / cross-site | `403` each |
| guest cart: add, then read **three times** | all `200`, item present each time |
| cookie flags after the guest flow | `emporix.cartId` and `emporix.anonymousSession` **httpOnly**, only `emporix.siteCode` readable |

Also driven through a real browser: Add to cart from the catalog, `/cart` showing
the item, and `/debug` **green** while the cart cookies exist — they are httpOnly,
so JavaScript cannot see them. The typeahead's request was
`GET /api/emporix/product/viu/products` carrying `Authorization: Bearer proxied`,
the placeholder; the route discarded it and substituted the server's real
anonymous token, and 5 matching products rendered.

### One open question, answered

A guest cart read in a Server Component gets a read-only cookie jar, so it cannot
persist the rotated anonymous session — the next read reuses the previous refresh
token. Three consecutive reads all succeeded, so **Emporix tolerates anonymous
refresh-token reuse**. That is tenant behaviour, not a guarantee: if it ever
changes, the fix is to fetch the cart through a Server Action, or to have the
proxy keep a short-lived anonymous access token in the cookie.

### Not exercised live

The customer login leg. The unit suite covers it — all three token cookies
httpOnly, no token in the response body, logout clearing everything — but the
live run did not include it: driving a Next Server Action with a password through
`curl` fought Next's FormData encoding, and typing a password into a browser form
is not something the assistant that wrote this does.

Run it yourself: put the test account in `.env.local`
(`EMPORIX_TEST_CUSTOMER_EMAIL` / `_PASSWORD`), log in at `/login`, then open
`/debug`. Expect it to stay green — the three token cookies are httpOnly, so
JavaScript must not see them.
