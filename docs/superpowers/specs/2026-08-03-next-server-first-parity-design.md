# next-server-first to pattern parity — design

**Status:** approved (2026-08-03) — pattern parity, `examples/shared`, CSS copied, PR 5 included
**Date:** 2026-08-03
**Affected:** `packages/next` (one bug), `examples/next-server-first`,
`examples/storefront-demo`, newly `examples/shared`
**Predecessors:** `2026-08-01-next-server-first-checkout-design.md`,
`2026-08-03-server-side-sessions-design.md`

## Goal

`examples/next-server-first` becomes the second reference demo: the same flows as
`examples/storefront-demo`, but server-first. Not route by route, but
**pattern by pattern** — every route that answers a new server-first question
goes in; the same CRUD form a fourth time does not.

## Measured starting state

| | storefront-demo | next-server-first |
|---|---|---|
| Routes | 17 (15 real ones, 2 catch-alls) | 6 |
| Files | 63 | 14 |
| Lines | 3'690 | 722 |
| React hooks used | **39** of 111 | **0** |
| direct `client.*` calls | 2 (`products`, `tenant`) | all of them |

The last row is the heart of the porting work. storefront-demo *is* 39
hooks; everything apart from reading the catalog runs through React Query. Server-first
turns every read hook into a Server Component read and every mutation hook into a
Server Action — roughly 24 reads and around 22 actions.

## Non-goals, with reasoning

These four belong in the demo's README as explicit non-goals, not as a
gap:

- **`/account/returns`, `/account/rewards`, `/account/lists`** — the same
  CRUD-via-Server-Action pattern as `addresses`. After the third time nobody
  learns anything new from them, but every SDK change has to drag them along.
- **`/reset-password`** — needs a real email round trip. Not
  verifiable means not claimable; the demo only claims what has been
  measured.
- **B2B** — storefront-demo does not have it itself. Grep finds only a
  telemetry event name there (`company:switched`) that nothing triggers, and a
  `companyName` field in the address form. `examples/README.md:42` claims
  «catalog, cart, checkout, account and B2B» and is therefore wrong.
- **Optimistic updates** — there is no client state that could be
  optimistic. That is the documented price of the mode, not an open task.

Two wrong lines in `examples/README.md` get corrected along with it: the
B2B claim above and «It states the cost in numbers and shows what a full
storefront would need» — that section does not exist in the demo's README.

## PR 0 — one bug in the package, shipped in #198

Blocks the account work and therefore goes first and alone.

`session-auth.ts` constructs its jar in three places without options:
[line 66](../../../packages/next/src/session-auth.ts#L66) (`emporixLogin`),
[line 151](../../../packages/next/src/session-auth.ts#L151) (`emporixRefresh`),
[line 229](../../../packages/next/src/session-auth.ts#L229) (`emporixLogout`).
`opts.store` is within reach in every one of those places and is not passed through,
so the cookie branch in
[session-cookies.ts:120](../../../packages/next/src/session-cookies.ts#L120) takes over.

In store mode:

1. **`emporixLogin`** writes `customerToken`, `refreshToken` and `saasToken`
   into real cookies. The saasToken JWT ends up in the browser — exactly what the
   feature is meant to prevent.
2. **`emporixSession(STORE_OPT)`** then reads the record, which holds no
   `customerToken`, and reports **anonymous**. The customer is logged in and
   every reader says «not logged in». Not a degradation, a break.
3. **`emporixLogout`** hits the no-op in
   [session-cookies.ts:132](../../../packages/next/src/session-cookies.ts#L132).
   The store record survives the logout.

The changeset `.changeset/next-session-store.md` claims «`emporixLogout`
destroys the record». That is wrong and gets corrected.

**Why the live check did not see this:** everything that ran in store mode
was the guest path, and that goes through `withEmporixSessionMutable`, which passes
`opts.store` through correctly. The login lines in the demo's README are from 2026-08-01 —
before the store. The customer path in store mode was never exercised.

**Fix:** the same line three times.

```ts
const jar = await sessionCookieJar(opts.store !== undefined ? { store: opts.store } : {});
```

**Tests that would have caught this** — one per function, with a
fake store that counts writes:

- `emporixLogin` with `store` writes **no** `customerToken` as a cookie and
  the record contains it.
- `emporixRefresh` with `store` writes the rotated token into the record.
- `emporixLogout` with `store` calls `store.destroy(sid)`.

The three tests have to be red without the fix. That is the acceptance criterion, not
«the tests run».

## Architecture — `examples/shared`

New workspace package `@viu/emporix-examples-shared`. Two things come for free:
`pnpm-workspace.yaml` lists `examples/*`, so the package is picked up; and the glob
`@viu/emporix-examples-*` in `.changeset/config.json` `ignore` covers it — no
changeset, no version, no publish.

**Moved, not copied.** storefront-demo imports from it afterwards. That keeps
the comment «the SINGLE place that reads SDK/generated field names»
true, and a regression proof comes for free: if storefront-demo typechecks and runs
unchanged after the move, the extraction was clean.

Out of `examples/storefront-demo/src/lib/adapters.ts` (360 lines) and
`lib/format.ts` (13 lines) everything moves into the package **except** two exports:

| Stays in storefront-demo | Why |
|---|---|
| `sanitizeHtml` | uses `DOMParser` ([adapters.ts:88](../../../examples/storefront-demo/src/lib/adapters.ts#L88)), which does not exist in Node |
| `productDescription` | builds on `sanitizeHtml` |

`stripHtml` — today the private no-DOM fallback in the same file — gets
exported and moves along. It is pure string work and works everywhere.
The Next demo uses it to render product descriptions as **plain text**, not as
markup, and says so in the README. A sanitizer with a Node path would be a
dependency for one line of demo.

Hooks do not move: `usePrices` (15 lines) and `useProductNames` (27 lines)
stay in storefront-demo. Their logic already sits in the shared helpers; the
Next demo turns them into two small server functions.

The package gets a README of its own saying «copy this» — modelled on
`examples/next-server-first/app/session-store.ts`, which likewise sits in the example
and says exactly that. It is a shared set of helpers, not an example; the table
in `examples/README.md` describes it accordingly and not as a sixth demo.

## Pattern 1 — shell without a single Emporix call

A cart badge in the layout would be one `withEmporixSession` per page view, and the
guest path deliberately builds a **new** client per call there
([session-client.ts, `newGuestClient`](../../../packages/next/src/session-client.ts)) —
a shared guest client would be a shared cart. On top of that: a
read-only jar cannot persist a rotated anonymous session. The
documented reuse of the refresh token would therefore scale from «three reads on
`/cart`» to «every page view», plus one token round trip per page.

The count therefore sits next to the cart id in the session, with exactly one
writer:

```ts
// app/lib/cart-session.ts
import { STORAGE_KEYS, SESSION_MAX_AGE, type SessionCookieJar } from "@viu/emporix-sdk-next/session";

const COUNT = "demo.cartCount";

/**
 * The ONLY place that writes the cart id. If the count were writable
 * somewhere else it could drift; this way it structurally cannot.
 */
export function setCart(
  jar: SessionCookieJar,
  cart: { id: string; items?: unknown[] } | null,
): void {
  if (cart === null) {
    jar.delete(STORAGE_KEYS.cartId);
    jar.delete(COUNT);
    return;
  }
  jar.set(STORAGE_KEYS.cartId, cart.id, SESSION_MAX_AGE.cartId);
  jar.set(COUNT, String(cart.items?.length ?? 0), SESSION_MAX_AGE.cartId);
}

export function cartCount(jar: SessionCookieJar): number {
  // Without a cart id a count is meaningless. That covers the logout:
  // SESSION_COOKIES in session-auth.ts is a fixed list, our demo key
  // is not in it and would otherwise survive the logout.
  if (jar.get(STORAGE_KEYS.cartId) === null) return 0;
  const n = Number(jar.get(COUNT));
  return Number.isInteger(n) && n > 0 ? n : 0;
}
```

The `cartId` check is not cosmetics, it is the logout correctness. And
`Number.isInteger` instead of a truthiness test, because `Number(null)` is **0** and
not `NaN` — the same stumbling block as with `SESSION_STARTED_AT`.

Every cart mutation already has the cart in hand (Emporix returns it),
so `setCart` costs no extra call. Four call sites:
`addToCart`, `updateItem`/`removeItem`, the clearing after checkout, and the
cart onboarding at login.

The layout reads the count out of the jar and makes no Emporix call. The
key is written via `cookieSet` and is therefore `httpOnly` — `/debug` stays
green.

The shell also gets: a search form as a **pure** `<form action="/search"
method="get">` without JavaScript (storefront-demo's header keeps the search text in
`useState`), the account status from the session, and the site/language switcher
as a Server Action.

## Pattern 2 — pagination via the URL

`client.categories.productsIn(id, { pageNumber, pageSize }, auth)` returns
`PaginatedItems<Product>` with `hasNextPage`
([category.ts:181](../../../packages/sdk/src/services/category.ts#L181)). The
page reads `?page=N`, «Next» is a `<Link>`.

```tsx
export default async function CategoryPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const client = getEmporixClient({ context: CONTEXT });
  const result = await client.categories.productsIn(id, { pageNumber: page, pageSize: 24 }, undefined);
  // …
}
```

`Number(undefined) || 1` yields 1, `Number("0") || 1` yields 1, `Math.max`
catches negatives. No validation framework needed, but the boundary does get
drawn.

This **does not accumulate** the way `useProductsInCategoryInfinite` does; you page
instead of appending. A behavioural difference that belongs in the README instead of being
papered over — accumulating needs client state, and there is none in this
mode.

Same pattern for `/account/orders`.

## Pattern 3 — error display: one client component, not eight

storefront-demo has `Toasts.tsx` (81 lines, context plus state). `useActionState`
requires a client component. Instead of turning every mutating form into one,
a generic one takes the action as a prop — Server Actions are serialisable as a
prop, the children stay server-rendered:

```tsx
"use client";
import { useActionState } from "react";

export interface ActionState {
  error: string | null;
}

export function ActionForm({ action, submit, children }: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submit: string;
  children: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction}>
      {children}
      {state.error !== null ? <p role="alert">{state.error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? "…" : submit}</button>
    </form>
  );
}
```

That means the actions have to **return** the error instead of throwing it. That is
the shape a real app wants anyway, and `describe(e)` from
`app/actions/checkout.ts` — which makes `EmporixError.body` visible — is the
place where the message comes into being.

The alternative, a redirect with `?error=…`, would need zero client components,
but writes error texts into shareable URLs. That is a defect, not merely
unsightly. This gives the demo its second client component alongside
`typeahead.tsx`; neither of them makes an Emporix call with a token, so the thesis
of the mode stays intact.

## Pattern 4 — auth gate per page, not as middleware

Next 16 runs middleware in `proxy.ts`, which is Node runtime and has no
`cookies()` — already stated in the demo's README. So a helper at the top of every
account page:

```ts
// app/lib/require-customer.ts
import { redirect } from "next/navigation";
import { emporixSession } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";

export async function requireCustomer(next: string): Promise<string> {
  const { customerToken } = await emporixSession(STORE_OPT);
  if (customerToken === null) redirect(`/login?next=${encodeURIComponent(next)}`);
  return customerToken;
}
```

`/login` honours `?next=` and accepts **only** paths that begin with `/` and not
with `//`:

```ts
function safeNext(raw: string | undefined): string {
  // An open redirect is a trust boundary. `//evil.com` is a
  // protocol-relative absolute link, not a path.
  if (raw === undefined || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}
```

This function gets a test with `//evil.com`, `https://evil.com`,
`/account` and `undefined`. It is the only place in the demo where a
trust boundary sits, and is therefore not «just a demo».

## Routes after the work

13 routes against storefront-demo's 15 real ones.

| Route | Status | New pattern |
|---|---|---|
| `/` | there, gets a grid and prices | — |
| `/search` | new | GET form without JS, `client.products.searchByName` ([product.ts:168](../../../packages/sdk/src/services/product.ts#L168)) |
| `/category/[id]` | new | pagination via `?page=N`, subcategories |
| `/product/[id]` | new | variants via `?variant=`, description as plain text |
| | | `client.products.listVariantChildren(id, { pageSize }, auth)` returns the children; each becomes a `<Link>` to `?variant=<childId>`; the selected child id is what «Add to cart» uses |
| `/cart` | there, read-only | quantity, remove, coupon, names, totals |
| `/checkout`, `/checkout/done` | there | — |
| `/login` | there | `?next=` |
| `/debug` | there | — |
| `/account` | new | auth gate |
| `/account/profile` | new | profile and password |
| `/account/addresses` | new | CRUD via Server Actions |
| `/account/orders` | new | pagination |
| `/account/orders/[id]` | new | reorder, cancel |

On the cart, two things storefront-demo has already learned and that the
Next demo would otherwise learn afresh: the cart GET returns an **empty** `product`, names
have to be resolved separately (that is what `useProductNames` exists for); and a
quantity update goes with `partial: true`, otherwise the whole line including
`itemYrn` and price line has to be sent back.

## PR 5 — webhook route and `revalidateTag`

`revalidateTag` for cart, orders and customer data is impossible by
design: `emporixTagsForUrl` deliberately returns `[]` for these services
([tags.ts](../../../packages/next/src/tags.ts)). The `revalidatePath` in the
cart actions is therefore correct and not the blunt instrument — it is the only
instrument.

Where `revalidateTag` does belong is the catalog, and the webhook route in the package
already does the cycle
([webhook.ts:163](../../../packages/next/src/webhook.ts#L163)). The gap is
that **no example mounts it**: `examples/next-server-first` only has the
proxy route. The tagged client has its half, what it lacks is the trigger.

PR 5 mounts it at `app/api/emporix/webhook/route.ts` and documents the
secret. Verified with a self-signed call: change a product, fire the
webhook, and the catalog page shows the new value without a deploy
or a timeout in between.

## Verification

Every PR ends with live evidence against the `viu` tenant, not with «tests
green». Following the pattern of the READMEs so far, as a table with a date.

| PR | Evidence |
|---|---|
| 0 | Login in store mode: tokens **not** in the browser cookie jar, `emporixSession` reports the customer, logout deletes the Redis key. The three new tests are red without the fix. |
| 1 | storefront-demo typechecks and runs unchanged after the move; `/debug` green; badge shows the count without a single Emporix call in the network log |
| 2 | a category with more than 24 products pages forward and back; the variant switches via the URL; search finds a known product |
| 3 | change the quantity, reload, the new value is there; remove a line; the badge is right after every step; a deliberately broken coupon shows the Emporix message |
| 4 | without a token the gate redirects to `/login?next=…` and back again afterwards; address created, read, changed, deleted; the order list shows the orders from the checkout test |
| 5 | a signed webhook call invalidates a product; a wrong signature yields 401 and invalidates nothing |

Unit tests exist only for the package (PR 0) and for `safeNext`. Examples have
`test` and `lint` deliberately as no-ops; they are verified through typecheck, build and
running them.

## Order and dependencies

| PR | Content | Needs |
|---|---|---|
| 0 | `opts.store` in three places, three tests, changeset correction | — |
| 1 | `examples/shared`, CSS copied, shell with badge | — |
| 2 | `/search`, `/category/[id]`, `/product/[id]` | 1 |
| 3 | `/cart` in full, `ActionForm` | 1 |
| 4 | account routes | 0, 1, 3 (`ActionForm`) |
| 5 | webhook route | 1 |

PR 0 is not part of the parity work and runs alone, so that the correction of the
changeset does not get lost in a feature PR.

**Addendum from 2026-08-03, arising while planning:** PR 1 turned into **two**.
The language and site switcher, carried here in pattern 1 as a subordinate clause, moves
the Emporix context of **every** reading site from a module constant onto the session
and deletes `CONTEXT` and `EMPORIX` from `app/emporix.ts` in the process. It therefore has to
run **last**, after PR 5, otherwise it breaks every page that comes into being
after it. So there are seven PRs; the plan carries it as task 6.1.

On top of that came a measurement that is due before the implementation: if the `viu` tenant has only
**one** site, a site switcher demonstrates nothing and is not
verifiable. Then only the language switcher remains — by the same rule that
excludes `/reset-password`.

## Risks

**The CSS coupling is deliberately accepted.** The two CSS files are
copied, not shared. That lets the demos drift apart visually, but nothing
breaks silently — the alternative, sharing them, would have meant that a
change in storefront-demo's CSS makes the Next demo look broken without
a test noticing.

**Moving the adapters touches the reference demo.** storefront-demo is
the demo every answer points to. The regression proof (typechecks and
runs unchanged) is therefore an acceptance criterion of PR 1, not a
nice-to-have.

**The count in the session is a denormalisation.** Four write sites,
all via `setCart`. If somebody breaks that rule and writes the cart id directly,
the badge drifts. The ceiling is known and named; the alternative would be
one Emporix call per page view.

**`emporixLogin` in `withEmporixSessionMutable` is still not fully
checked after PR 0.** The three tests cover the jar. What stays unmeasured:
whether two concurrent requests in store mode can overwrite each other —
that is an open point from the store spec and is not closed by this
work.
