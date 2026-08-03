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
case, comparing the id before and after. The swap is the normal outcome, not an
edge case: a guest who logs in moves onto the customer's cart. Verified live —
after a login the count went from **1 to 4**, which only the re-read can produce.
Guarding rather than re-reading unconditionally keeps a cart GET off the logins
where nothing moved.

| Check | Result |
|---|---|
| login where the cart id changed (none before, new one after) | guard fired, `demo.cartCount: "0"` written — that field comes only from `setCart` |
| the same login, four jars in one request (two read-only plus the two in `emporixLogin`) | exactly **one** record, all tokens in the store, login intact |
| header afterwards | «Cart» with no number, logout button instead of the login link |
| `/debug`, `document.cookie` | PASS, `emporix.siteCode` only |

What this does **not** prove: that the re-read corrects a stale **non-zero**
count. That needs the merge path to fire with a differing item count, and on this
tenant it does not fire at all — see the section below.

## Pagination is a URL here, not a «Load more» button

`/category/[id]` reads `?page=N`. storefront-demo uses
`useProductsInCategoryInfinite` and appends pages to a list, which needs client
state to hold the accumulation — there is none in this mode, so this **pages**
instead. A real behavioural difference, and the trade is not one-sided: page 3 is
a URL that can be linked, bookmarked and crawled, which an accumulating list
cannot.

**Verified 2026-08-03** with `PAGE_SIZE` temporarily at 5, against a category
holding 11 products:

| URL | Products | Page links rendered |
|---|---|---|
| `?page=1` | 5 | `2` — no Previous |
| `?page=2` | 5 | `1` and `3` |
| `?page=3` | 1 | `2` — **no Next**, `hasNextPage` is false on the last page |
| `?page=4` | 0 | none, «Nothing on page 4 · Back to page 1» |
| `?page=0`, `?page=abc`, `?page=-5` | 5 | page 1 — the bound holds |

The `?page=4` row is a fix that came out of the check: it first said «No products
in this category», which is a lie about a category holding eleven. A page number
in a URL is exactly the kind of thing that goes stale in a bookmark.

**The subcategory nav never renders on this tenant.** `categories.subcategories`
reads category-to-category *assignments*, and `viu` keeps its hierarchy in
category trees — all of the first 40 categories answered with an empty list.
storefront-demo's equivalent nav is dead here for the same reason; it calls the
same function. Kept in both, because other tenants do use assignments.

## The product page keeps its state in the URL

`/product/[id]` takes the variant choice as `?variant=<childId>`, so a picked
variant is shareable and survives a reload. storefront-demo's `VariantPicker`
holds it in a hook instead.

**Verified 2026-08-03:**

| Check | Result |
|---|---|
| a priced product | name, price, description, «Add to cart» |
| «Add to cart» from here | cart created, count 1 — the id posted is the **selected** one |
| `?variant=bogus` and `?variant=` | 200, falls back to the parent |
| an unknown product id | **404**, not 500 |

The last row is a fix that came out of the check. `products.get` throws
`EmporixNotFoundError` and nothing caught it, so a stale link produced a server
error page. A product URL outlives the product — it sits in bookmarks, in search
indexes and in other people's links — so `notFound()` is the ordinary case here,
not the exotic one.

**Descriptions are plain text here**, where storefront-demo renders markup. Its
`sanitizeHtml` needs `DOMParser`, which Node does not have; a server-rendered
consumer would silently fall through to tag-stripping while believing it had a
sanitizer. So this demo calls `stripHtml` from `examples/shared` and is honest
about it. Adding a Node-capable sanitizer would be a dependency for one demo line.

**The variant nav never renders on this tenant.** Swept 300 products across five
pages on 2026-08-03: every one is `productType: BASIC`, and
`listVariantChildren` answered empty for all of them. Kept anyway, because the
branch is what a tenant with variants needs — but it is unexercised here, the same
as the subcategory nav above.

## The cart, mutated through Server Actions

Four actions — quantity, remove, apply coupon, remove coupon — sharing one frame
that finds the cart, mutates it, pulls the count forward and revalidates. They
**return** their error rather than throwing it, so a rejected coupon is a message
in the form and not a Next error page. `ActionForm` is the single client component
that displays it.

**Verified 2026-08-03:**

| Check | Result |
|---|---|
| line label | «Just-in-Time Access (JIT)», not the id — the cart GET returns an **empty** `product`, so names come from a separate `searchByIds` |
| quantity 1 → 3 | line and total both **CHF 3.00**, count stays at one line |
| quantity 0 with the browser's `min` in place | **no request at all** — the browser blocked the submit |
| quantity 0 with `min` removed from the DOM | «Quantity must be 1 or more.», action returned in **0ms**, no Emporix call |
| empty coupon | «Enter a coupon code.», and it sits next to the quantity error — each `ActionForm` holds its own state |
| coupon `GIBTESNICHT` | `404 — {"message":"Coupon with code GIBTESNICHT not found."}` — the whole Emporix body, which is what `describeError` is for |
| remove | line gone, count **0**, «Your bag is empty», total «—», badge without a number |

Row three and four are the same input twice, and they are both worth having:
`<input min>` is a hint to the browser, not a guarantee to the server. Bypassing it
took removing the attribute from the DOM, which is exactly what a client that is
not this browser would do.

**A bug this check caught.** The mutations answer with a cart, so the first version
handed that answer straight to `setCart` to save a GET. Those answers carry **no
`id`** — and `setCart` read the id off the object, treating «no id» as «clear the
cart». A quantity change therefore deleted `emporix.cartId` out of the session and
the shopper lost their cart.

The fix is in the signature, not the caller: `setCart(jar, cartId, cart)` takes the
id as its own argument, and clearing is a separate `clearCart(jar)`. A partial
answer can now only make the count wrong, never lose the cart. The count itself
comes from a re-read, because `items` on those answers is just as unverified as
`id` was.

## The account gate, and the one trust boundary here

`requireCustomer(next)` sits at the top of every account page. Per page, and not
by choice: Next 16 runs middleware in `proxy.ts`, which is Node-runtime and has no
`cookies()`. storefront-demo gates from the client with a `RequireAuth` component,
which means it renders once, unauthenticated, before deciding. This never does.

The `?next=` it writes is where the demo grows a trust boundary, so `safeNext` is
**the one thing in these examples with unit tests**. `//evil.com` starts with a
slash and is still an absolute URL — the browser reads it as protocol-relative —
which is exactly what a naive `startsWith("/")` check waves through.

`safeNext` lives in its own module with no imports, and that is not tidiness:
`@viu/emporix-sdk-next/session` is server-only and its guard throws the moment
vitest resolves it outside the `react-server` condition. Correctly so. A pure
function does not need the company.

**Verified 2026-08-03:**

| Check | Result |
|---|---|
| `GET /account` while logged out | **307** to `/login?next=%2Faccount` |
| `?next=//evil.com` | hidden field renders `/` |
| `?next=https://evil.com` | hidden field renders `/` |
| `?next=/account/orders` | survives |
| login from `?next=/account` | **303**, lands on `/account` |
| the account page | name and email from `customers.me`, header shows «Account» |
| the two guards, mutated away one at a time | each mutation fails its own test |

The email is `contactEmail`, not `email` — the latter is empty on this shape.
Found by an empty line in the rendered page, then checked against
`storefront-demo/src/account/ProfileForm.tsx`, which reads the same four fields
against the real tenant.

## Profile and password

Two forms, no client state. `defaultValue` rather than `value`: the inputs are
uncontrolled, the browser owns what is typed and the server owns what is stored.
storefront-demo keeps the same fields in `useState` and syncs them, which is why
its form has to think about stale state after a save and this one does not.

**Verified 2026-08-03:**

| Check | Result |
|---|---|
| the four fields | prefilled from `customers.me` |
| phone set, then reloaded | new value stored and shown |
| phone **cleared**, then reloaded | empty — clearing works, see below |
| empty last name | «First and last name are required.», action returned in **0ms** |
| new password under 8 characters | rejected in **0ms**, no Emporix call |
| wrong current password | `401 — "Access denied. Entered credentials are incorrect."`, nothing changed |

The password was deliberately never changed successfully: the test account's
password lives in `.env.local`, and a successful change would leave that file
stale. The two failure paths are what can be checked without breaking the next
person's login.

**A design error found while tidying up.** The first version left empty fields out
of the update, reasoning that an empty string would clear a value nobody touched.
That is right for a partial patch and wrong for this form, which always submits all
four fields — «empty» here means the shopper cleared it, and a mistyped phone
number could never be removed. All four now go out as submitted.

Field names are measured, not guessed: `contactEmail` and `contactPhone` (not
`email`), and `currentPassword` (not `oldPassword`). Both read off
`storefront-demo/src/account/`, where the calls run against the real tenant.

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

### The guest-to-customer merge, and a store-mode bug that broke it

The merge works. Verified on 2026-08-03: a guest cart holding one product, a
customer already holding `6a6dec53…` with three, and after logging in `/cart`
showed **4 item(s)** under the customer's id, the guest's product among them.

Getting there took four wrong explanations, so the mechanism is worth writing
down. Instrumentation inside `onboardCart` printed this **before** the fix, in
store mode:

```
[onboardCart] authKind= anonymous  getCurrent= <a NEW empty cart>
              customerIdOnCart= (none)  itemsOnCart= 0
              merge FAILED: cart.merge requires a { kind: 'customer' } AuthContext
```

and this after:

```
[onboardCart] authKind= customer   getCurrent= 6a6dec53…
              customerIdOnCart= 15416067  itemsOnCart= 3
              merge OK -> 6a6dec53…
```

**The cause was a flush order, and it only ever affected store mode.**
`onboardCart` calls `withEmporixSessionMutable`, which builds its **own** jar and
branches on whether a customer token is stored. In cookie mode `persistSession`
writes through, so that jar sees the token and runs as the customer. In store
mode it only touched the in-memory record, so the second jar read a store with no
token yet and ran as a **guest** — and then `getCurrent` created a fresh anonymous
cart instead of finding the customer's, while the merge never even left the SDK:
`requireCustomerAuth` rejected the anonymous context locally. A guest who logged
in landed on an empty cart.

`emporixLogin` now flushes before onboarding. A unit test asserts it on the
store's **write order** — the customer token must reach the store before the last
write — because the request list cannot tell the two paths apart.

What this cost in wrong turns, kept as a warning about which observations are
worth trusting:

- «`getCurrent` returns the session's cart, so nothing needs merging» — wrong, it
  returns the customer's.
- «A customer token cannot search its own carts» — wrong, `POST /carts/search`
  with `q: "status:OPEN"` returns 200, scoped to the caller.
- «The merge 404s because a customer token cannot see an anonymous cart» — that
  404 came from a throwaway probe page using customer auth against a cart the
  anonymous session owned. Not the failure in `onboardCart`.
- «The anonymous session drifts across read-only renders» — wrong, `sessionId` and
  `refreshToken` were byte-identical after two.

One finding stands unrelated to the fix: a customer can hold **two** open carts —
`GET /cart/viu/carts/…` returned 200 for both. `onboardCart`'s own comment says «a
customer may hold only one open cart»; that is not what the tenant enforces.

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
