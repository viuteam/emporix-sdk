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

Optionally seal the session cookies. Add to `.env.local`:

```
EMPORIX_COOKIE_SECRET=<a base64url 32-byte key>
```

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Setting or changing it logs every existing session out — including any cart you
had open. That is the intended behaviour, not a bug: removing a key is the
mass-logout lever.

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
| guest checkout, end to end | order **EON1225** created |
| `/cart` after the checkout | «No cart yet» — the cart cookie was cleared |
| `/debug` after the checkout | **PASS**, only `emporix.siteCode` readable |
| logged-in checkout, end to end | order **EON1226** created |
| saved address on `/checkout` | prefilled from the account |
| `/debug` after the logged-in checkout | **PASS** — a `saasToken` authorized the order and JavaScript never saw it |
| cart merge on login | guest cart `6a6ded65…` folded into customer cart `6a6dec53…`, both items present |

The merge check is worth spelling out, because the obvious version of it proves
nothing. Seeing the guest's item after logging in is **not** evidence: the cookie
could still point at the guest cart, which a customer token can read. The
decisive observation is the **id**. Guest cart `6a6ded65a13cfa5608e34060` held
one product, the customer's open cart `6a6dec535dd5944e2482e27c` held another;
after login `/cart` showed the **customer** id with **both**. That is why the
page prints the cart id at all.

The checkout run also answered two configuration questions about the tenant:
`listPaymentModes` returns **empty**, so the `custom` provider path is the one
that actually runs here; and a shipping zone for `CH` **is** configured, with a
single «Free Shipping» method at cost 0.

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

### The login leg

Exercised live on 2026-08-01, with a human typing the password — entering
credentials into a form is not something the assistant that wrote this does.
Everything on either side of that keystroke was driven automatically.

Run it yourself: put the test account in `.env.local`
(`EMPORIX_TEST_CUSTOMER_EMAIL` / `_PASSWORD`), log in at `/login`, then open
`/debug`. Expect it to stay green — the three token cookies are httpOnly, so
JavaScript must not see them.
