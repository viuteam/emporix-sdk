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

### Or keep the session server-side entirely

```
EMPORIX_SESSION_REDIS_URL=redis://127.0.0.1:6379
```

With this set the browser holds one opaque `emporix.sid` and nothing else; the
values live in Redis. Unset it and the example runs on cookies again, no code
change — both modes stay reachable.

The adapter is `app/session-store.ts`, about forty lines against `redis`. It
lives here rather than in the package, which is what keeps
`@viu/emporix-sdk-next` at zero runtime dependencies. Copy it.

Inspect what is actually stored:

```bash
node -e "const {createClient}=require('redis');(async()=>{const c=createClient({url:'redis://127.0.0.1:6379'});await c.connect();for(const k of await c.keys('emporix:session:*'))console.log(k,await c.ttl(k),await c.get(k));await c.quit();})()"
```

Delete a key and that one session is gone — the thing encrypted cookies cannot
do.

**Verified 2026-08-03** against the `viu` tenant, over http on a fresh cookie jar:

| Check | Result |
|---|---|
| guest cart without a secret | created and read back |
| `/debug` | **PASS**, only `emporix.siteCode` readable |
| existing plaintext cart after enabling a secret | «No cart yet» — invalidated as documented |
| guest cart with a secret | sealed, written and read back |
| replacing the key | «No cart yet» again — the mass-logout lever |

Every page and action here reads cookies through `sessionCookieJar`, never
`cookies()` directly. They did not at first, and it cost the third row above: raw
reads silently returned the plaintext cookie and kept the cart alive, so enabling
encryption looked like it had done nothing.

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

## The shell costs zero Emporix calls

A cart badge in the layout would be a `withEmporixSession` per page view, and the
guest path deliberately builds a **new** client per call — a shared guest client
would be a shared cart. On top of that a read-only jar cannot persist a rotated
anonymous session, so the documented refresh-token reuse would go from «three
reads on `/cart`» to «every page view», plus a token round-trip per page.

The count therefore sits next to the cart id in the session, written by exactly
one function (`app/lib/cart-session.ts`). The header reads it and calls nothing.

This is a denormalization with a known ceiling: **write the cart id anywhere but
`setCart` and the badge drifts.** Four call sites go through it — add to cart,
cart onboarding after login, the checkout that closes the cart, and the cart
mutations.

`cartCount` refuses to report a count when there is no cart id, and that is not
cosmetic — it is what covers logout. `SESSION_COOKIES` in the package's
`session-auth.ts` is a fixed list; a demo-owned key is not on it and would
otherwise outlive the logout.

**Verified 2026-08-03, in store mode against Redis:**

| Check | Result |
|---|---|
| load a page with the new header, empty session | Redis stays **empty** — the header opens no session |
| add to cart | `demo.cartCount: "1"` in the record, header shows «Cart (1)» |
| three more page loads | record **byte-identical** — no session opened, no token rotated |
| the same three loads, timing | `/debug` fell from 151ms to **32ms** |
| `cartId` removed from the record, count left behind (what logout produces) | «Cart» with no number |
| the same, with the guard **mutated away** | «Cart (1)» returns — the guard is load-bearing, not decorative |

The last two rows are the point. A guard that has never been observed failing is
not known to work.

The one place the count could still go stale is a login that swaps the cart, because
`emporixLogin` writes the cart id inside the package and therefore outside
`setCart`. `app/actions/auth.ts` re-reads the cart in that case — and only in that
case, comparing the id before and after. An unconditional re-read would spend a
cart GET on every login for a swap that this tenant does not perform.

| Check | Result |
|---|---|
| login where the cart id changed (none before, new one after) | guard fired, `demo.cartCount: "0"` written — that field comes only from `setCart` |
| the same login, four jars in one request (two read-only plus the two in `emporixLogin`) | exactly **one** record, all tokens in the store, login intact |
| header afterwards | «Cart» with no number, logout button instead of the login link |
| `/debug`, `document.cookie` | PASS, `emporix.siteCode` only |

What this does **not** prove: that the re-read corrects a stale **non-zero**
count. That needs the merge path to fire with a differing item count, and on this
tenant it does not fire at all — see the section below.

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

### Server-side sessions, verified 2026-08-03 against Redis in Podman

| Check | Result |
|---|---|
| cookie mode with the store code present | unchanged — the regression check |
| guest cart in store mode | created and read back |
| keys in Redis | exactly **one** per visitor |
| TTL | **7.0 days** for a guest |
| browser cookie jar | only `emporix.sid` and `emporix.siteCode` |
| deleting the key | «No cart yet» — **one** session revoked |
| `/debug` | **PASS** |

Every row above is a **guest** flow, and that is what hid a bug for a release:
`emporixLogin`, `emporixRefresh` and `emporixLogout` built their jar without the
`store` option, so the customer path silently ran on cookies. The guest path was
never affected — it goes through `withEmporixSessionMutable`, which threads the
option. Fixed and verified:

### The customer path in store mode, verified 2026-08-03

| Check | Result |
|---|---|
| catalog visit with no cart | Redis stays **empty** — the catalog writes no session |
| guest cart | **1** key, TTL **7.00 days**, `anonymousSession` + `cartId` |
| after login | still **1** key — the same sid, so the login reused the guest record |
| the record after login | `customerToken`, `refreshToken`, `saasToken`, `sessionStartedAt` all **in Redis** |
| TTL after login | **7'775'987s = 90.00 days** — `SESSION_ABSOLUTE_MAX` minus the 13s spent |
| `cartId` after login | changed to the customer's cart — the onboarding ran |
| `/login` while logged in | renders «Log out», not the form. Before the fix `emporixSession` read the record, found no token and showed the form again — logged in, and every reader said logged out |
| `document.cookie` | `emporix.siteCode=main` only |
| `/debug` | **PASS** |
| logout | `DBSIZE 0` — the record destroyed, which the 0.4.0 notes claimed already worked |

The one-key row is worth more than it looks. `emporixLogin` builds **two** jars
for one request — the one inside `withEmporixSessionMutable` and its own. That is
the pattern this README warns about elsewhere, and it works only because the
first flush sets the sid cookie before the second jar hydrates. A unit test now
insists on exactly one record, so a change to that ordering fails loudly.

The «not in a cookie» half of the claim is a unit test rather than a browser
observation, deliberately: `document.cookie` cannot see an httpOnly cookie, so it
cannot tell store mode from cookie mode. In the test the mock jar **is** the full
cookie jar, httpOnly included, and it asserts the token is absent from it.

The revocation row is the point of the whole feature. Encrypted cookies cannot do
it: the ciphertext stays valid until it expires, no matter what you want.

### Why the merge row never reproduced — root cause found 2026-08-03

Three logins that day all left the cart id pointing at the **guest** cart, with
the customer's own cart invisible. Chasing it down went through two wrong
explanations before the measurement:

1. «`getCurrent` returns the session's cart, so there is nothing to merge.» Wrong
   — a probe run inside the app showed `getCurrent` answering with
   `id=6a6dec53… customerId=15416067 items=2`, the customer's own cart.
2. «A customer token cannot search its own carts, so the owned cart cannot be
   found.» Wrong — `POST /carts/search` with `q: "status:OPEN"` returned **200**,
   exactly one hit, exactly the caller's `customerId`. The vendored spec allows
   `CustomerAccessToken` on that operation.

The actual cause, from the same probe:

```
merge THREW: POST /cart/viu/carts/6a6dec53…/merge → 404
  body={"code":404,"status":"Not Found","message":"Cart with code 6a708337… not found."}
```

**A customer token cannot see an anonymous cart**, so the merge fails whenever it
is attempted. The 404 escaped to the onboarding's best-effort `catch` and took the
id write with it, leaving the session on the guest cart.

### But the merge is almost never attempted, and that is why both demos look fine

In the ordinary guest→login flow the customer **inherits the guest's session**.
`getCurrent` then answers with that very cart, the stored id and the returned id
match, and the merge is skipped. The cart survives untouched — no merge involved.

`@viu/emporix-sdk-react`'s `onboardCustomerCart` does exactly the same thing (its
`bootstrapCart` calls the same `getCurrent(ctx, { siteCode, create: true })`), so
`storefront-demo` behaves identically: carts survive login there too, without ever
merging.

The merge is reached only when the two ids differ — when the customer already holds
**another** open cart. Reachable in four steps: log out with items in the cart,
return as a guest, add something, log in. That is the state these runs
manufactured, and it is where the 404 appears.

Fixed by giving the merge its own `catch`: the adoption happens either way, and a
logged-in customer sees the cart they own. In that divergent case the guest cart's
items stay behind — the honest state of things until someone answers which token
may fold an anonymous cart into a customer's.

Two smaller findings from the same session, neither fixed here:

- A customer can hold **two** open carts — `GET /cart/viu/carts/…` returned 200
  for both. `onboardCart`'s own comment says «a customer may hold only one open
  cart»; that is not what the tenant enforces. Whether a third via `carts.create`
  would still answer 409 was not tested.
- The 2026-08-01 row below claims a successful merge. It may well have been the
  no-merge path above, read as a merge. Left standing rather than deleted, because
  it was written from an observation.

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
