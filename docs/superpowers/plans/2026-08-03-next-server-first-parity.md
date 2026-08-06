# next-server-first to pattern parity — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `examples/next-server-first` gets 13 routes and covers every
pattern that `examples/storefront-demo` solves with React-Query hooks — only
server-first, plus a package bug from #198 up front.

**Architecture:** A new workspace package `examples/shared` holds the
Emporix shape normalisation that both demos need (moved out of
storefront-demo, not copied). The Next demo reads in Server Components and
writes in Server Actions; the shell costs zero Emporix calls because the
cart count rides along in the session. Errors are **returned** from actions
instead of being thrown, and a single client component displays them.

**Tech Stack:** Next 16 App Router, React 19 (`useActionState`),
`@viu/emporix-sdk-next/session`, Vitest for the package, Redis in Podman for
store mode.

**Spec:** `docs/superpowers/specs/2026-08-03-next-server-first-parity-design.md`

## Global Constraints

- **Commitlint:** scope from `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. There is **no** `next` scope — package changes go under `repo`. The first word after the scope is a **lowercase verb**.
- **Examples typecheck against `dist/`.** After every change to SDK or React sources: `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` **before** typechecking the examples.
- **Examples have no unit tests.** `test` and `lint` are deliberate no-ops. Verification is typecheck, build and running it. Unit tests only come about in Task 0 (`packages/next`) and Task 4.1 (`safeNext`).
- **`.env*` is outside the assistant's write permissions.** New variables are documented in the README; the human adds them to `.env.example`.
- **No cookie is read directly.** Always via `sessionCookieJar` — raw `cookies()` access bypasses the `__Host-` prefix and the encryption codec.
- **`STORE_OPT` to every reader.** `withEmporixSession*`, `emporixTokenProxy`, `emporixSession`. One forgotten spot silently falls back to cookie mode.
- **`exactOptionalPropertyTypes` is on.** Optional fields are spread conditionally (`...(x !== undefined ? { x } : {})`), not assigned `undefined`.
- Never the sharp s, always «ss». Prose in Swiss High German, code and identifiers in English as in the repo. *(Superseded 2026-08-05: everything committed is English — see `CLAUDE.md`. Kept as the record of the constraint that applied when this plan was written.)*

## Measured signatures

Everything here was read from the sources on 2026-08-03, not remembered. Tasks
refer to it instead of guessing.

| Call | Signature |
|---|---|
| `client.categories.get` | `(categoryId, auth) => Promise<Category>` |
| `client.categories.subcategories` | `(categoryId, { pageNumber?, pageSize? }, auth) => Promise<Category[]>` |
| `client.categories.productsIn` | `(categoryId, { pageNumber?, pageSize? }, auth) => Promise<PaginatedItems<Product>>` — has `hasNextPage` |
| `client.products.get` | `(productId, undefined, auth) => Promise<Product>` |
| `client.products.searchByName` | `(term, { pageNumber?, pageSize? }, auth) => Promise<PaginatedItems<Product>>` |
| `client.products.searchByIds` | `(ids, { chunkSize? }, auth) => Promise<Product[]>` |
| `client.products.listVariantChildren` | `(parentVariantId, { pageSize? }, auth) => Promise<Product[]>` |
| `client.prices.matchByContext` | `(input, auth) => Promise<PriceMatch[]>` |
| `client.carts.get` | `(cartId, auth) => Promise<Cart>` |
| `client.carts.getCurrent` | `(auth, { siteCode, create }) => Promise<Cart>` — `.id` |
| `client.carts.addItem` | `(cartId, input, auth)` |
| `client.carts.updateItem` | `(cartId, itemId, patch, auth, { partial: true })` |
| `client.carts.removeItem` | `(cartId, itemId, auth)` |
| `client.carts.applyCoupon` / `.removeCoupon` | `(cartId, code, auth)` |
| `client.carts.addItemsBatch` | `(cartId, body, auth)` |
| `client.customers.me` | `(auth) => Promise<Customer>` |
| `client.customers.update` | `(patch: CustomerUpdateInput, auth) => Promise<Customer>` |
| `client.customers.changePassword` | `(input: PasswordChangeInput, auth) => Promise<void>` |
| `client.customers.addresses.list` | `(auth)` |
| `client.customers.addresses.add` | `(input, auth)` |
| `client.customers.addresses.update` | `(id, patch, auth)` |
| `client.customers.addresses.remove` | `(id, auth)` |
| `client.orders.listMine` | `(auth, { pageNumber?, pageSize? }) => Promise<PaginatedItems<Order>>` |
| `client.orders.get` | `(orderId, auth)` |
| `client.orders.cancel` | `(orderId, auth, { saasToken? })` |

## File structure

**New — `examples/shared/`**

| File | Responsibility |
|---|---|
| `package.json` | `@viu/emporix-examples-shared`, `private: true`, no `build` (source import via `exports: { ".": "./src/index.ts" }`) |
| `src/index.ts` | re-export of `adapters.ts` and `format.ts` |
| `src/adapters.ts` | moved out of `storefront-demo/src/lib/adapters.ts`, without `sanitizeHtml`/`productDescription`, with `stripHtml` exported |
| `src/format.ts` | moved out of `storefront-demo/src/lib/format.ts` |
| `README.md` | «copy this» — it is a set of helpers, not a demo |

**Changed — `examples/storefront-demo/`**

| File | Change |
|---|---|
| `src/lib/adapters.ts` | shrinks to `sanitizeHtml` + `productDescription`, re-exports the rest from the shared package |
| `src/lib/format.ts` | deleted, imports point at the package |
| `package.json` | dependency `@viu/emporix-examples-shared: workspace:*` |

**New — `examples/next-server-first/app/`**

| File | Responsibility |
|---|---|
| `lib/cart-session.ts` | `setCart`, `cartCount` — the only writer of the cart id |
| `lib/require-customer.ts` | `requireCustomer`, `safeNext` |
| `lib/prices.ts` | `pricesFor(client, auth, products)` — server-side counterpart to `usePrices` |
| `lib/product-names.ts` | `namesFor(client, auth, ids)` — counterpart to `useProductNames` |
| `components/action-form.tsx` | `ActionForm` — the only client component for forms |
| `components/product-grid.tsx` | server-side product grid |
| `components/header.tsx` | shell header, server-rendered |
| `search/page.tsx`, `category/[id]/page.tsx`, `product/[id]/page.tsx` | catalog |
| `account/page.tsx`, `account/profile/page.tsx`, `account/addresses/page.tsx`, `account/orders/page.tsx`, `account/orders/[id]/page.tsx` | account |
| `actions/account.ts` | profile, password, address CRUD, cancel, reorder |
| `api/emporix/webhook/route.ts` | Task 5.1 |
| `styles/tokens.css`, `styles/global.css` | copied from storefront-demo |

---

## Task 0: `opts.store` to the three jar constructions in `session-auth.ts`

A bug from #198. Blocks Task 4.*. Ships alone as its own PR so the changeset
correction does not get lost inside a feature PR.

**Files:**
- Modify: `packages/next/src/session-auth.ts:66`, `:151`, `:229`
- Modify: `.changeset/next-session-store.md`
- Test: `packages/next/tests/session-auth.test.ts`

**Interfaces:**
- Consumes: `sessionCookieJar(opts: { readOnly?: boolean; store?: EmporixSessionStore })` from `session-cookies.ts`; `EmporixSessionStore` with `read`/`write`/`destroy` from `session-store.ts`.
- Produces: nothing new. Behaviour of `emporixLogin`, `emporixRefresh`, `emporixLogout` in store mode.

- [ ] **Step 1: Look at the existing test file and write the fake-store helper**

First read `packages/next/tests/session-auth.test.ts` to take over the repo's
mock setup and MSW handlers. Then this helper into the same file:

```ts
import type { EmporixSessionStore } from "../src/session-store";

/** A store that records what it does — that is the evidence, not the content. */
function fakeStore(): EmporixSessionStore & {
  records: Map<string, Record<string, string>>;
  destroyed: string[];
} {
  const records = new Map<string, Record<string, string>>();
  const destroyed: string[] = [];
  return {
    records,
    destroyed,
    read: async (id) => records.get(id) ?? null,
    write: async (id, record) => {
      records.set(id, { ...record });
    },
    destroy: async (id) => {
      destroyed.push(id);
      records.delete(id);
    },
  };
}
```

- [ ] **Step 2: Write the three failing tests**

```ts
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { SESSION_SID } from "../src/session-store";

it("emporixLogin with a store keeps the customer token OUT of the browser", async () => {
  const store = fakeStore();
  await emporixLogin({ email: "a@b.ch", password: "x" }, { store, ...BASE_OPTS });

  // The evidence is two-sided: not in the cookie AND in the record. Checking
  // only one half would let the cookie branch pass.
  expect(cookieJar.get(STORAGE_KEYS.customerToken)).toBeUndefined();
  const record = [...store.records.values()][0];
  expect(record?.[STORAGE_KEYS.customerToken]).toBeTypeOf("string");
});

it("emporixRefresh with a store writes the rotated token into the record", async () => {
  const store = fakeStore();
  const sid = "sid-under-test";
  store.records.set(sid, { [STORAGE_KEYS.refreshToken]: "old-refresh" });
  cookieJar.set(SESSION_SID, sid);

  await emporixRefresh({ store, ...BASE_OPTS });

  expect(store.records.get(sid)?.[STORAGE_KEYS.customerToken]).toBeTypeOf("string");
  expect(cookieJar.get(STORAGE_KEYS.customerToken)).toBeUndefined();
});

it("emporixLogout with a store destroys the record", async () => {
  const store = fakeStore();
  const sid = "sid-to-destroy";
  store.records.set(sid, { [STORAGE_KEYS.customerToken]: "tok" });
  cookieJar.set(SESSION_SID, sid);

  await emporixLogout({ store, ...BASE_OPTS });

  expect(store.destroyed).toEqual([sid]);
  expect(store.records.has(sid)).toBe(false);
});
```

Take `BASE_OPTS` and `cookieJar` from the existing file — it already has
both, because the cookie-mode tests run on them.

- [ ] **Step 3: Run the tests — they MUST be red**

Run: `pnpm -F @viu/emporix-sdk-next test -- session-auth`
Expected: **all three FAIL**. Expected: test 1 finds a `customerToken` in the
cookie jar; test 2 finds the record unchanged; test 3 finds
`store.destroyed` empty.

If one is green, the test is wrong, not the code. Then the setup of
`cookieJar`/`BASE_OPTS` is off — look into it before going on.

- [ ] **Step 4: Apply the fix in the three places**

At `session-auth.ts:66`, `:151` and `:229`, each:

```ts
const jar = await sessionCookieJar(opts.store !== undefined ? { store: opts.store } : {});
```

`{ store: opts.store }` directly does not work: `exactOptionalPropertyTypes`
forbids assigning `undefined` to an optional field.

- [ ] **Step 5: Run the tests — green now, and the rest too**

Run: `pnpm -F @viu/emporix-sdk-next test`
Expected: PASS, 203 tests (200 existing plus three new). No existing test
may tip over — the cookie-mode tests pass no `store` and run
unchanged through the same branch.

- [ ] **Step 6: Changeset correction**

In `.changeset/next-session-store.md` the line «`emporixLogout` destroys the
record» shipped without being true. That changeset was already published with
#198, so the correction goes into a **new** changeset:

```bash
cat > .changeset/next-store-auth-threading.md <<'EOF'
---
"@viu/emporix-sdk-next": patch
---

Fixes store mode for logged-in customers. `emporixLogin`, `emporixRefresh` and
`emporixLogout` built their cookie jar without the `store` option, so in store
mode they silently used cookies.

The effect was not a leak but a break: login wrote `customerToken`,
`refreshToken` and `saasToken` into real browser cookies, while
`emporixSession({ store })` read the store record — which had none of them — and
reported the visitor as anonymous. Logged in, and every reader said logged out.

`emporixLogout` hit the cookie-mode no-op, so the store record survived the
logout. The 0.4.0 release notes claimed it destroyed the record. It did not.

Guest mode was never affected: it runs through `withEmporixSessionMutable`,
which threads the option correctly.
EOF
```

- [ ] **Step 7: Live evidence in store mode**

Redis must be running (`podman ps` shows the container on 6379).

```bash
pnpm -F @viu/emporix-sdk-next build && pnpm -F @viu/emporix-examples-next-server-first dev
```

With `EMPORIX_SESSION_REDIS_URL` set: log in at `/login` (the human types
the password), then check:

```bash
node -e "const {createClient}=require('redis');(async()=>{const c=createClient({url:'redis://127.0.0.1:6379'});await c.connect();for(const k of await c.keys('emporix:session:*'))console.log(k,await c.ttl(k),await c.get(k));await c.quit();})()"
```

Expected: the record contains `emporix.customerToken`, and in the browser
`/debug` shows **only** `emporix.sid` and `emporix.siteCode`. Then log out and
query the key list again — the key is gone.

- [ ] **Step 8: Commit**

```bash
git add packages/next/src/session-auth.ts packages/next/tests/session-auth.test.ts .changeset/next-store-auth-threading.md
git commit -m "fix(repo): thread the session store through login, refresh and logout"
```

---

## Task 1.1: Create `examples/shared` and move the adapters

**Files:**
- Create: `examples/shared/package.json`, `examples/shared/tsconfig.json`, `examples/shared/src/index.ts`, `examples/shared/src/adapters.ts`, `examples/shared/src/format.ts`, `examples/shared/README.md`
- Modify: `examples/storefront-demo/src/lib/adapters.ts`, `examples/storefront-demo/package.json`
- Delete: `examples/storefront-demo/src/lib/format.ts`
- Modify: `examples/README.md`

**Interfaces:**
- Produces: `@viu/emporix-examples-shared` exports `localized`, `pickText`, `stripHtml`, `imageOf`, `toProductCard`, `ProductCardVM`, `productName`, `productImages`, `priceMatchItems`, `PriceVM`, `priceForProduct`, `productYrn`, `catLabel`, `catId`, `CartLinePrice`, `CartLineVM`, `toCartLine`, `cartLines`, `cartTotal`, `cartCoupons`, `OrderVM`, `orderVM`, `OrderItemVM`, `orderItems`, `money`.
- storefront-demo keeps locally: `sanitizeHtml`, `productDescription`.

- [ ] **Step 1: Package manifest**

No build step: the package is imported as source. That is why `exports`
points straight at `src/`.

```json
{
  "name": "@viu/emporix-examples-shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "echo \"no tests — see examples/README.md\"",
    "lint": "echo \"no lint — see examples/README.md\""
  },
  "dependencies": { "@viu/emporix-sdk": "workspace:*" }
}
```

`test` and `lint` as no-ops with an explanatory message, the way the other
examples do it — otherwise `pnpm -r test` runs into nothing and you wonder why.

Copy `tsconfig.json` from `examples/node-server/tsconfig.json`; it is the
example without React and therefore fits.

- [ ] **Step 2: Move the files**

```bash
git mv examples/storefront-demo/src/lib/adapters.ts examples/shared/src/adapters.ts
git mv examples/storefront-demo/src/lib/format.ts examples/shared/src/format.ts
```

`git mv` instead of copying, so the history comes along.

- [ ] **Step 3: Take `sanitizeHtml` and `productDescription` out of the package, export `stripHtml`**

In `examples/shared/src/adapters.ts` **delete** the two functions `sanitizeHtml`
and `productDescription` and add the `export` to `stripHtml`:

```ts
/**
 * Tag strip without a DOM. Pure string work, so it also runs in Node — which
 * `sanitizeHtml` does not, because it needs `DOMParser`. Server-rendered
 * consumers get plain text instead of markup, and that is the honest trade.
 */
export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

The file header comment «View-model adapters — the SINGLE place that reads
SDK/generated field names» stays and becomes true again. Add:

```ts
/**
 * Shared by examples/storefront-demo and examples/next-server-first. If you
 * build your own storefront: copy it. This is not a published API.
 */
```

- [ ] **Step 4: `src/index.ts`**

```ts
export * from "./adapters";
export * from "./format";
```

- [ ] **Step 5: Switch storefront-demo over**

Recreate `examples/storefront-demo/src/lib/adapters.ts` — only the two
browser-bound functions plus a re-export, so that the 30+ existing
import paths stay unchanged:

```ts
import type { Product } from "@viu/emporix-sdk";
import { pickText, stripHtml } from "@viu/emporix-examples-shared";

/** Everything shape-normalising lives in the shared package. Only what needs a browser stays here. */
export * from "@viu/emporix-examples-shared";

const UNSAFE_TAGS = "script,style,iframe,object,embed,link,meta,base,form,input,template";

/**
 * Sanitize merchant-authored description HTML for safe rendering. Keeps the
 * markup but drops script/style/embeds, `on*` handlers and `javascript:` URLs,
 * and hardens links. Uses the browser DOMParser — no dependency, but browser
 * only, which is why this did not move into the shared package.
 * For untrusted / user-generated HTML prefer a vetted sanitizer (e.g. DOMPurify).
 */
export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === "undefined") return stripHtml(html);
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(UNSAFE_TAGS).forEach((el) => el.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === "A" && el.getAttribute("href")) {
      el.setAttribute("rel", "noopener noreferrer nofollow");
      el.setAttribute("target", "_blank");
    }
  });
  return doc.body.innerHTML.trim();
}

/** Product description as sanitized HTML, ready for `dangerouslySetInnerHTML`. */
export function productDescription(p: Product): string {
  return sanitizeHtml(pickText((p as { description?: unknown }).description, ""));
}
```

Then add the dependency in `examples/storefront-demo/package.json`:
`"@viu/emporix-examples-shared": "workspace:*"`.

Switch the four files that import `../lib/format` over to
`@viu/emporix-examples-shared`:

```bash
grep -rln 'lib/format' examples/storefront-demo/src
```

- [ ] **Step 6: The regression evidence**

```bash
pnpm install
pnpm -F @viu/emporix-examples-shared typecheck
pnpm -F @viu/emporix-examples-storefront-demo typecheck
pnpm -F @viu/emporix-examples-storefront-demo build
```

Expected: all three green. Then start the demo and walk through it **by hand**:
home page with prices, open a product, into the cart, `/cart` with a
total, `/account/orders` with an order. That is this task's acceptance
condition — with `as`-heavy adapters a typecheck proves too little.

- [ ] **Step 7: Correct `examples/README.md`**

Three changes:

1. Line 42: «checkout, account and B2B» → «checkout and account». storefront-demo has no B2B; grep finds only a telemetry event name that nothing triggers.
2. Delete the line «It states the cost in numbers and shows what a full storefront would need» outright — that section does not exist in the demo's README.
3. After the five-demo table, one paragraph:

```markdown
## `shared/` is not a demo

`examples/shared` is an unpublished workspace package with the Emporix
shape normalisation that `storefront-demo` and `next-server-first` both
need — orders come back in two shapes, cart lines want their price line
back on update, text fields are sometimes a string and sometimes a locale
map. If you build your own storefront, you copy the files; they are
deliberately not part of the published API.
```

- [ ] **Step 8: Commit**

```bash
git add examples/shared examples/storefront-demo examples/README.md pnpm-lock.yaml
git commit -m "refactor(examples): move the shape adapters into a shared package"
```

---

## Task 1.2: Shell, CSS and the cart count in the session

**Files:**
- Create: `examples/next-server-first/app/lib/cart-session.ts`, `app/components/header.tsx`, `app/styles/tokens.css`, `app/styles/global.css`
- Modify: `examples/next-server-first/app/layout.tsx`, `app/actions/cart.ts`, `app/actions/checkout.ts`, `app/package.json`
- Modify: `examples/next-server-first/README.md`

**Interfaces:**
- Consumes: `@viu/emporix-examples-shared` (Task 1.1); `sessionCookieJar`, `STORAGE_KEYS`, `SESSION_MAX_AGE`, `SessionCookieJar`, `emporixSession` from `@viu/emporix-sdk-next/session`.
- Produces: `setCart(jar, cart | null): void` and `cartCount(jar): number` from `app/lib/cart-session.ts`. From here on **nobody** writes `STORAGE_KEYS.cartId` directly any more.

- [ ] **Step 1: Copy the CSS**

```bash
mkdir -p examples/next-server-first/app/styles
cp examples/storefront-demo/src/styles/tokens.css examples/next-server-first/app/styles/tokens.css
cp examples/storefront-demo/src/styles/global.css examples/next-server-first/app/styles/global.css
```

Copied, **not** shared. Shared would mean: a change in storefront-demo's CSS
makes this demo look broken without any test noticing it. Copied, they drift
apart visually and nothing breaks. At the top of both files:

```css
/* Copied from examples/storefront-demo/src/styles/ on 2026-08-03. Deliberately
   a copy: a shared file would have coupled the two demos to each other. */
```

`catalog.css` stays out — it belongs to components this demo does not
have.

- [ ] **Step 2: `cart-session.ts`**

```ts
import {
  SESSION_MAX_AGE,
  STORAGE_KEYS,
  type SessionCookieJar,
} from "@viu/emporix-sdk-next/session";

const COUNT = "demo.cartCount";

/**
 * The ONLY place that writes the cart id.
 *
 * The count sits next to it in the session so the shell can show it
 * without an Emporix call: a badge in the layout would otherwise mean one
 * `withEmporixSession` per page view, and the guest path deliberately
 * builds a new client per call there. If the count were writable
 * elsewhere it could drift; this way it structurally cannot.
 */
export function setCart(
  jar: SessionCookieJar,
  cart: { id?: string; items?: unknown[] } | null,
): void {
  const id = cart?.id;
  if (cart === null || id === undefined) {
    jar.delete(STORAGE_KEYS.cartId);
    jar.delete(COUNT);
    return;
  }
  jar.set(STORAGE_KEYS.cartId, id, SESSION_MAX_AGE.cartId);
  jar.set(COUNT, String(cart.items?.length ?? 0), SESSION_MAX_AGE.cartId);
}

export function cartCount(jar: SessionCookieJar): number {
  // Without a cart id a count is meaningless, and that covers the logout:
  // SESSION_COOKIES in session-auth.ts is a fixed list, our demo key
  // is not in it and would otherwise survive the logout.
  if (jar.get(STORAGE_KEYS.cartId) === null) return 0;
  // `Number.isInteger`, not a truthiness test: `Number(null)` is 0 and not
  // NaN — the same stumbling block as with SESSION_STARTED_AT.
  const n = Number(jar.get(COUNT));
  return Number.isInteger(n) && n > 0 ? n : 0;
}
```

- [ ] **Step 3: `header.tsx`**

Server component. The search field is a plain GET form — storefront-demo's
header keeps the text in `useState` and navigates programmatically; here it
needs no JavaScript for that.

```tsx
import { emporixSession, sessionCookieJar } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { cartCount } from "../lib/cart-session";
import { logout } from "../actions/auth";

export async function Header(): Promise<React.JSX.Element> {
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const { customerToken } = await emporixSession(STORE_OPT);
  const count = cartCount(jar);

  return (
    <header style={{ borderBottom: "1px solid var(--line)" }}>
      <div className="container cluster" style={{ gap: "var(--s-5)", paddingBlock: "var(--s-4)" }}>
        <a href="/" className="serif">Server—First</a>
        {/* No onSubmit, no useState: a GET form navigates by itself. */}
        <form action="/search" method="get" style={{ flex: 1, maxWidth: "26rem" }}>
          <input className="input" type="search" name="q" placeholder="Search the catalogue…" aria-label="Search products" />
        </form>
        <nav className="cluster" style={{ gap: "var(--s-4)", marginLeft: "auto" }}>
          <a href="/cart" className="u-underline">Cart{count > 0 ? ` (${count})` : ""}</a>
          {customerToken === null ? (
            <a href="/login" className="u-underline">Login</a>
          ) : (
            <>
              <a href="/account" className="u-underline">Account</a>
              <form action={logout} style={{ display: "inline" }}>
                <button type="submit" className="btn btn--ghost btn--sm">Logout</button>
              </form>
            </>
          )}
          <a href="/debug" className="u-underline">Debug</a>
        </nav>
      </div>
    </header>
  );
}
```

`app/actions/auth.ts` exports `login(formData: FormData): Promise<void>` and
`logout(): Promise<void>` — both names are measured, not guessed.

- [ ] **Step 4: Rebuild `layout.tsx`**

```tsx
import type { ReactNode } from "react";
import "./styles/tokens.css";
import "./styles/global.css";
import { Header } from "./components/header";

export const metadata = { title: "Emporix SDK — server-first example" };

/**
 * No provider, no client-side EmporixClient, no storage. This
 * absence IS the demonstration. The header is a server component and makes
 * not a single Emporix call — the cart count lives in the
 * session.
 */
export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <Header />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 5: Switch the existing write sites over to `setCart`**

In `app/actions/cart.ts` replace the block:

```ts
    let cartId = jar.get(STORAGE_KEYS.cartId);
    if (cartId === null) {
      const cart = await client.carts.getCurrent(ctx, { siteCode: SITE.siteCode, create: true });
      cartId = cart?.id ?? null;
      if (cartId === null) throw new Error("Emporix returned no cart");
      setCart(jar, cart);
    }
    await client.carts.addItem(cartId, { /* unchanged */ }, ctx);
    // Emporix does not return the cart from addItem, so read it once —
    // the count in the header has to be right after adding.
    setCart(jar, await client.carts.get(cartId, ctx));
```

In `app/actions/checkout.ts` switch clearing the cart after the order over to
`setCart(sessionJar, null)` — today `STORAGE_KEYS.cartId` is deleted directly
there, which would leave the count standing.

**Careful:** `client.carts.getCurrent` returns a `Cart` with `.id`,
`client.carts.create` a `CartCreated` with `.cartId`. `setCart` reads `.id` —
`create` would silently write a count without an id.

- [ ] **Step 6: The login path**

`emporixLogin` performs the cart onboarding inside the package and writes
`STORAGE_KEYS.cartId` itself — outside `setCart`. After the login the count is
therefore the guest cart's, not the merged one's.

Fix in `app/actions/auth.ts`, right after `emporixLogin`:

```ts
  // emporixLogin merges the guest and the customer cart and writes the
  // cart id inside the package, so outside setCart. Bring the count up to
  // date once afterwards, or the header shows the number from before the merge.
  await withEmporixSessionMutable(async (client, ctx, jar) => {
    const cartId = jar.get(STORAGE_KEYS.cartId);
    if (cartId !== null) setCart(jar, await client.carts.get(cartId, ctx));
  }, EMPORIX);
```

- [ ] **Step 7: Typecheck and live evidence**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
pnpm -F @viu/emporix-examples-next-server-first dev
```

Expected, in the browser with the network tab open:

| Check | Expectation |
|---|---|
| Load the home page | header styled, «Cart» without a number |
| «Add to cart», then reload the home page | «Cart (1)», and **no** Emporix request when loading the home page |
| `/debug` | PASS, only `emporix.siteCode` readable (or `emporix.sid` in store mode) |
| Log in with a guest cart | count matches `/cart` |
| Log out | «Cart» without a number |

The second row is this task's actual evidence. If a token or cart request
shows up when the home page loads, `cartCount` is not taking hold and the
header reads through Emporix after all.

- [ ] **Step 8: README section**

In `examples/next-server-first/README.md` after «The catalog/cart split»:

```markdown
## The shell costs zero Emporix calls

A cart badge in the layout would be one `withEmporixSession` per page
view, and the guest path deliberately builds a new client per call
there — a shared guest client would be a shared cart. On top of that, a
read-only jar cannot persist a rotated anonymous session, so reuse of the
refresh token would scale from «three reads on /cart» to «every page
view».

The count therefore sits next to the cart id in the session, written by
exactly one function (`app/lib/cart-session.ts`). That is a
denormalisation with a known ceiling: whoever writes the cart id directly
instead of taking `setCart` lets the badge drift.
```

- [ ] **Step 9: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add a server-rendered shell to the next demo"
```

---

## Task 6.1: Language and site switcher in the shell

> **Order: this task runs LAST, after Task 5.1.** It stands here because it
> belongs to the shell from Task 1.2, but it **deletes** `CONTEXT` and `EMPORIX`
> from `app/emporix.ts` — and Tasks 2.1 through 4.4 use both. Pulled forward,
> it breaks every page written after it. As its own, seventh PR.

The spec lists it in pattern 1 as a subordinate clause. It is bigger than that:
`CONTEXT` in `app/emporix.ts` is a module constant that **every** reader
binds — catalog pages via `getEmporixClient({ context: CONTEXT })` and all
session calls via `EMPORIX`. A switcher means deriving that from the
session.

The good news is in
[client.ts:113](../../../packages/next/src/client.ts#L113): the
memoisation key contains the context, so one context per visitor choice yields
its own client instance and **no** leak between visitors. The comment
there says «the context is written once per app, in one place» — this task
breaks exactly that assumption, and from then on the map grows with the number
of distinct contexts. With two or three sites that is bounded and fine; the
line ought to be corrected.

**Files:**
- Create: `examples/next-server-first/app/lib/site-context.ts`, `app/actions/site.ts`, `app/components/site-switcher.tsx`
- Modify: `app/emporix.ts`, `app/components/header.tsx`, `app/page.tsx`, `app/search/page.tsx`, `app/category/[id]/page.tsx`, `app/product/[id]/page.tsx`
- Modify: `packages/next/src/client.ts:110-112` (comment), `examples/next-server-first/README.md`

**Interfaces:**
- Produces: `siteContext(): Promise<{ siteCode: string; currency: string; targetLocation: string; language?: string }>` and `emporixOptions(): Promise<WithEmporixSessionOptions>` from `app/lib/site-context.ts`; `switchLanguage`, and — depending on Step 1 — `switchSite` from `app/actions/site.ts`.

- [ ] **Step 1: Measure how many sites the tenant has — that decides the rest**

```bash
pnpm -F @viu/emporix-examples-next-server-first dev
```

Then use a throwaway route or the existing `/debug` to render
`client.sites.list(undefined)`. `sites.list(auth)` and
`sites.listCodes(auth)` both exist.

**If exactly one site is configured** (on the `viu` tenant `main` is the one
the proxy pins): a site switcher with a single entry demonstrates nothing and
cannot be verified. Then the **site** part drops out and this task delivers
only the **language** switcher — language is a free choice and not
tenant-configured, so it is checkable. The narrowing is recorded in the README
together with the reason, by the same rule that excludes `/reset-password`:
what cannot be verified is not claimed here.

**If there are two or more:** Steps 2–7 as written, plus Step 8.

Write the result of this measurement into the commit message. Without it the
rest of the task is speculation.

- [ ] **Step 2: `lib/site-context.ts`**

```ts
import { sessionCookieJar, STORAGE_KEYS, type WithEmporixSessionOptions } from "@viu/emporix-sdk-next/session";
import { SESSION_STORE, STORE_OPT } from "../emporix";

/** The default when the visitor has chosen nothing. That used to be CONTEXT. */
const DEFAULTS = { siteCode: "main", currency: "CHF", targetLocation: "CH" } as const;

/**
 * The context for this request, derived from the session instead of from a
 * module constant. `siteCode` and `language` are PUBLIC session keys — even
 * in store mode they sit there as ordinary cookies and are readable by
 * JavaScript. That is deliberate: they are display settings, not secrets.
 */
export async function siteContext(): Promise<{
  siteCode: string;
  currency: string;
  targetLocation: string;
  language?: string;
}> {
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const language = jar.get(STORAGE_KEYS.language);
  return {
    siteCode: jar.get(STORAGE_KEYS.siteCode) ?? DEFAULTS.siteCode,
    currency: DEFAULTS.currency,
    targetLocation: DEFAULTS.targetLocation,
    ...(language !== null ? { language } : {}),
  };
}

/** The same for the session calls. Replaces the exported `EMPORIX`. */
export async function emporixOptions(): Promise<WithEmporixSessionOptions> {
  return {
    context: await siteContext(),
    ...(SESSION_STORE !== undefined ? { store: SESSION_STORE } : {}),
  };
}
```

With several sites the currency comes from the chosen site instead of from
`DEFAULTS` — then add a `client.sites.get(siteCode, undefined)` in
`siteContext` and read the currency from it.

- [ ] **Step 3: `actions/site.ts`**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { SESSION_MAX_AGE, STORAGE_KEYS, sessionCookieJar } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import type { ActionState } from "../components/action-form";

/** The languages the demo offers. Freely chosen, not tenant-configured. */
export const LANGUAGES = ["en", "de"] as const;

export async function switchLanguage(_state: ActionState, form: FormData): Promise<ActionState> {
  const language = String(form.get("language"));
  // Allowlist, not free text: the value lands in a cookie and from there in
  // every Emporix request as a header.
  if (!LANGUAGES.includes(language as (typeof LANGUAGES)[number])) {
    return { error: "Unsupported language" };
  }
  const jar = await sessionCookieJar(STORE_OPT);
  jar.set(STORAGE_KEYS.language, language, SESSION_MAX_AGE.siteCode);
  await jar.flush();
  // "layout", not just the page: the language affects every server-side
  // read, including the one in the header.
  revalidatePath("/", "layout");
  return { error: null };
}
```

Check `SESSION_MAX_AGE.siteCode` — if the key is named differently there, take
the actual one; `SESSION_MAX_AGE` is exported from
`@viu/emporix-sdk-next/session`.

- [ ] **Step 4: `components/site-switcher.tsx`**

Server component, one form per language — that keeps it usable without
JavaScript and needs no `<select onChange>`.

```tsx
import { STORAGE_KEYS, sessionCookieJar } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { LANGUAGES, switchLanguage } from "../actions/site";
import { ActionForm } from "./action-form";

export async function SiteSwitcher(): Promise<React.JSX.Element> {
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const active = jar.get(STORAGE_KEYS.language) ?? "en";

  return (
    <span className="cluster" style={{ gap: "var(--s-2)" }}>
      {LANGUAGES.map((l) => (
        <ActionForm key={l} action={switchLanguage} submit={l === active ? `${l} ●` : l}>
          <input type="hidden" name="language" value={l} />
        </ActionForm>
      ))}
    </span>
  );
}
```

- [ ] **Step 5: Switch every reader over to the session context**

```bash
grep -rn 'CONTEXT\|EMPORIX\b' examples/next-server-first/app
```

Every `getEmporixClient({ context: CONTEXT })` → `getEmporixClient({ context: await siteContext() })`,
every `EMPORIX` → `await emporixOptions()`. Then **delete** `CONTEXT` and
`EMPORIX` from `app/emporix.ts` so no call site can fall back. `SITE`,
`SESSION_STORE`, `STORE_OPT` and `PRICED_CATEGORY` stay.

Insert `<SiteSwitcher />` into the `<nav>` in `components/header.tsx`, before
`Cart`.

- [ ] **Step 6: Correct the wrong comment in the package**

`packages/next/src/client.ts`, the block above the memoisation key:

```ts
  // JSON.stringify is key-order-dependent, so the same context written with its
  // fields in a different order yields a second instance. Wasteful, not wrong.
  // Note the map grows with the number of DISTINCT contexts, not with requests —
  // an app that lets visitors switch site or language will hold one client per
  // combination. Bounded by the configuration, not by traffic.
```

- [ ] **Step 7: Typecheck and live evidence**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

| Check | Expectation |
|---|---|
| Click «de» | the active marker moves, the page reloads |
| Network tab on the next catalog request | the Emporix request carries the new language |
| Product name with a German localisation | shows the German variant, if the tenant has one |
| Cookies | `emporix.language` is there and **readable by JavaScript** — unlike the tokens, and that is deliberate |
| `/debug` | stays PASS: a readable `emporix.language` is not a secret |

The fourth row is the point where one could misread `/debug` —
green means «no tokens readable», not «no cookies readable». If `/debug`
checks against an allowlist, `emporix.language` has to go in there.

If the tenant has no German localisations, row 3 is not checkable. Then take
row 2 as the evidence and record in the README that the effect on the
display depends on the tenant data.

- [ ] **Step 8: Only with two or more sites — bring the cart along**

A site or currency switch does not rebind the anonymous token; Emporix has its
own operations for the cart. After writing the `siteCode`:

```ts
  await withEmporixSessionMutable(async (client, ctx, jar) => {
    const cartId = jar.get(STORAGE_KEYS.cartId);
    if (cartId === null) return;
    // changeSite/changeCurrency exist BECAUSE a freshly bound context does not
    // take the existing cart along. Without this step the cart keeps
    // showing the old currency.
    await client.carts.changeSite(cartId, siteCode, ctx);
    setCart(jar, await client.carts.get(cartId, ctx));
  }, await emporixOptions());
```

Evidence: item in the cart, switch site, open `/cart` — currency and total
are those of the new site.

- [ ] **Step 9: Commit**

```bash
git add examples/next-server-first packages/next/src/client.ts
git commit -m "feat(examples): derive the emporix context from the session"
```

Does it need a changeset? No — the change to `client.ts` is a comment.

---

## Task 2.1: `/search`

**Files:**
- Create: `examples/next-server-first/app/search/page.tsx`, `app/components/product-grid.tsx`, `app/lib/prices.ts`
- Modify: `examples/next-server-first/app/page.tsx`

**Interfaces:**
- Consumes: `toProductCard`, `ProductCardVM`, `PriceVM`, `priceForProduct`, `priceMatchItems`, `money` from `@viu/emporix-examples-shared`.
- Produces: `pricesFor(client, auth, products): Promise<(id: string) => PriceVM | undefined>` from `app/lib/prices.ts`; `ProductGrid` from `app/components/product-grid.tsx`.

- [ ] **Step 1: `lib/prices.ts`**

Server-side counterpart to `usePrices` — the same logic, without React Query.

```ts
import type { AuthContext, EmporixClient, Product } from "@viu/emporix-sdk";
import { priceForProduct, priceMatchItems, type PriceVM } from "@viu/emporix-examples-shared";

/**
 * Resolves the prices for a set of products in ONE call and returns a
 * lookup function. One call per product would be N requests per page.
 */
export async function pricesFor(
  client: EmporixClient,
  auth: AuthContext | undefined,
  products: Product[],
): Promise<(id: string) => PriceVM | undefined> {
  const items = priceMatchItems(products);
  if (items.length === 0) return () => undefined;
  const matches = await client.prices.matchByContext({ items }, auth);
  return (id) => priceForProduct(matches, id);
}
```

- [ ] **Step 2: `components/product-grid.tsx`**

```tsx
import { money, toProductCard, type PriceVM } from "@viu/emporix-examples-shared";
import type { Product } from "@viu/emporix-sdk";
import { addToCart } from "../actions/cart";

/** Server component. The class names come from the copied CSS. */
export function ProductGrid({
  products,
  priceOf,
}: {
  products: Product[];
  priceOf: (id: string) => PriceVM | undefined;
}): React.JSX.Element {
  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <ul className="grid" style={{ listStyle: "none", padding: 0 }}>
      {products.map((p) => {
        const vm = toProductCard(p);
        const price = priceOf(vm.id);
        return (
          <li key={vm.id} className="pc">
            <a href={`/product/${encodeURIComponent(vm.id)}`}>
              {vm.image ? <img src={vm.image} alt={vm.imageAlt} /> : <div className="pc__ph" />}
              <span className="serif">{vm.name}</span>
            </a>
            {price ? <p className="price">{money(price.amount, price.currency)}</p> : null}
            <form action={add}>
              <input type="hidden" name="productId" value={vm.id} />
              <button type="submit" className="btn btn--sm">Add to cart</button>
            </form>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 3: `search/page.tsx`**

```tsx
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { CONTEXT } from "../emporix";
import { ProductGrid } from "../components/product-grid";
import { pricesFor } from "../lib/prices";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}): Promise<React.JSX.Element> {
  const q = ((await searchParams).q ?? "").trim();
  const client = getEmporixClient({ context: CONTEXT });
  // searchByName builds the Emporix filter `name:(~…)` and escapes the
  // regex metacharacters — hence no quoting of our own here.
  const page = q === "" ? null : await client.products.searchByName(q, { pageSize: 24 }, undefined);
  const priceOf = await pricesFor(client, undefined, page?.items ?? []);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Search</p>
      <h2 className="serif">{q === "" ? "Search the catalogue" : `«${q}»`}</h2>
      {page === null ? (
        <p className="muted">Type a query in the header.</p>
      ) : page.items.length === 0 ? (
        <p className="muted">Nothing found for «{q}».</p>
      ) : (
        <ProductGrid products={page.items} priceOf={priceOf} />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Switch the home page over to `ProductGrid`**

`app/page.tsx` keeps its catalog call and replaces the `<ul>` with
`<ProductGrid products={page.items} priceOf={priceOf} />` together with
`const priceOf = await pricesFor(client, undefined, page.items)`. The local
`label()` function goes away — `toProductCard` in the grid does that.

- [ ] **Step 5: Typecheck and live evidence**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

Then in the browser: type «shirt» (or a term the home page shows) into the
header and submit. Expected: the URL is `/search?q=shirt`, hits with prices,
«Add to cart» raises the badge. An empty search shows the hint text.

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add server-rendered search to the next demo"
```

---

## Task 2.2: `/category/[id]` with pagination over the URL

**Files:**
- Create: `examples/next-server-first/app/category/[id]/page.tsx`

**Interfaces:**
- Consumes: `ProductGrid`, `pricesFor` (Task 2.1); `catLabel`, `catId` from `@viu/emporix-examples-shared`.

- [ ] **Step 1: The page**

```tsx
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { catId, catLabel } from "@viu/emporix-examples-shared";
import { CONTEXT } from "../../emporix";
import { ProductGrid } from "../../components/product-grid";
import { pricesFor } from "../../lib/prices";

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  // `Number(undefined) || 1` gives 1, `Number("abc") || 1` gives 1, and
  // Math.max catches negatives. The bound is drawn, without a framework.
  const page = Math.max(1, Number((await searchParams).page) || 1);

  const client = getEmporixClient({ context: CONTEXT });
  const [category, subs, products] = await Promise.all([
    client.categories.get(id, undefined),
    client.categories.subcategories(id, { pageSize: 50 }, undefined),
    client.categories.productsIn(id, { pageNumber: page, pageSize: 24 }, undefined),
  ]);
  const priceOf = await pricesFor(client, undefined, products.items);
  const href = (n: number): string => `/category/${encodeURIComponent(id)}?page=${n}`;

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Category</p>
      <h2 className="serif">{catLabel(category)}</h2>

      {subs.length > 0 ? (
        <nav className="catnav" aria-label="Subcategories">
          {subs.map((s) => (
            <a key={catId(s)} href={`/category/${encodeURIComponent(catId(s))}`} className="u-underline">
              {catLabel(s)}
            </a>
          ))}
        </nav>
      ) : null}

      {products.items.length === 0 ? (
        // A pure parent category has only subcategories — the tiles above
        // are then the answer, not an empty message.
        subs.length > 0 ? null : <p className="muted">No products in this category.</p>
      ) : (
        <>
          <ProductGrid products={products.items} priceOf={priceOf} />
          {/* Paging, not appending: accumulating like useInfiniteQuery
              would need client state, and there is none in this mode. */}
          <nav className="cluster" style={{ gap: "var(--s-4)", marginTop: "var(--s-6)" }}>
            {page > 1 ? <a href={href(page - 1)} className="btn btn--outline">← Previous</a> : null}
            <span className="muted">Page {page}</span>
            {products.hasNextPage ? <a href={href(page + 1)} className="btn btn--outline">Next →</a> : null}
          </nav>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck and live evidence**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

`PRICED_CATEGORY` from `app/emporix.ts` has 11 products — too few for a
second page. So for the evidence, temporarily set `pageSize` to 5, page
forward, page back, and put the value back to 24.

Expected: page 2 shows different products, «Previous» only appears from page 2
on, «Next» disappears on the last page. `?page=0` and `?page=abc` land on
page 1, `?page=-5` too.

- [ ] **Step 3: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add a paginated category page to the next demo"
```

---

## Task 2.3: `/product/[id]` with variants

**Files:**
- Create: `examples/next-server-first/app/product/[id]/page.tsx`

**Interfaces:**
- Consumes: `pricesFor` (Task 2.1); `productName`, `productImages`, `imageOf`, `stripHtml`, `pickText`, `money` from `@viu/emporix-examples-shared`; `addToCart` from `app/actions/cart.ts`.

- [ ] **Step 1: The page**

```tsx
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { imageOf, money, pickText, productImages, productName, stripHtml } from "@viu/emporix-examples-shared";
import { CONTEXT } from "../../emporix";
import { pricesFor } from "../../lib/prices";
import { addToCart } from "../../actions/cart";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ variant?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const chosen = (await searchParams).variant;
  const client = getEmporixClient({ context: CONTEXT });

  const parent = await client.products.get(id, undefined, undefined);
  // Children are empty when the product is not a PARENT_VARIANT — the call is
  // wasted then, but cheaper than a type check across the five
  // product shapes of the Emporix union.
  const children = await client.products.listVariantChildren(id, { pageSize: 50 }, undefined);
  const selected =
    children.find((c) => (c as { id?: string }).id === chosen) ?? (children[0] ?? parent);
  const selectedId = (selected as { id?: string }).id ?? id;

  const priceOf = await pricesFor(client, undefined, [selected]);
  const price = priceOf(selectedId);
  const name = productName(parent);
  // stripHtml, not sanitizeHtml: there is no `DOMParser` in Node. The
  // description comes as plain text here, not as markup — see the README.
  const description = stripHtml(pickText((parent as { description?: unknown }).description, ""));

  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("productId")));
  }

  return (
    <main className="container pdp" style={{ paddingBlock: "var(--s-6)" }}>
      <p><a href="/" className="eyebrow u-underline">← Catalogue</a></p>
      <div className="pdp__grid">
        <div>
          {productImages(parent).map((m, i) => {
            const url = imageOf([m]);
            return url ? <img key={i} src={url} alt={name} style={{ maxWidth: "100%" }} /> : null;
          })}
        </div>
        <div className="pdp__info">
          <h1 className="serif">{name}</h1>
          {price ? <p className="price">{money(price.amount, price.currency)}</p> : null}
          {description !== "" ? <p className="muted" style={{ maxWidth: "52ch" }}>{description}</p> : null}

          {children.length > 0 ? (
            // Variants over the URL, not over client state: every child is
            // a link, and the chosen one is a shareable state.
            <nav className="cluster" aria-label="Variants" style={{ gap: "var(--s-2)" }}>
              {children.map((c) => {
                const cid = (c as { id?: string }).id ?? "";
                return (
                  <a
                    key={cid}
                    href={`/product/${encodeURIComponent(id)}?variant=${encodeURIComponent(cid)}`}
                    className={cid === selectedId ? "tag tag--accent" : "tag"}
                  >
                    {productName(c)}
                  </a>
                );
              })}
            </nav>
          ) : null}

          <form action={add} style={{ marginTop: "var(--s-4)" }}>
            {/* The chosen child id, not the parent's: a
                PARENT_VARIANT cannot be ordered. */}
            <input type="hidden" name="productId" value={selectedId} />
            <button type="submit" className="btn btn--accent">Add to cart</button>
          </form>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: README line about the description**

In `examples/next-server-first/README.md` under «Not every product has a
price», one paragraph:

```markdown
## Product descriptions are plain text here

storefront-demo renders the merchant-authored description as HTML, cleaned
via `DOMParser`. That does not exist in Node, so this demo takes `stripHtml`
from `examples/shared` and shows plain text. A sanitizer with a Node path
would be a dependency for one demo line — the wrong trade.
```

- [ ] **Step 3: Typecheck and live evidence**

Expected: a product from the grid opens, name, price and description are
there. A product **with** variants shows the tiles; a click changes the
URL to `?variant=…`, marks the chosen one, and «Add to cart» puts the
**variant** in the cart (check it on the `itemYrn` in `/cart`). A product
**without** variants shows no tiles and puts itself in the cart.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add a product page with variants to the next demo"
```

---

## Task 3.1: `ActionForm` and returning errors

**Files:**
- Create: `examples/next-server-first/app/components/action-form.tsx`, `app/lib/describe-error.ts`
- Modify: `examples/next-server-first/app/actions/checkout.ts`

**Interfaces:**
- Produces: `ActionState = { error: string | null }`, `ActionForm({ action, submit, children })` from `app/components/action-form.tsx`; `describeError(e: unknown): string` from `app/lib/describe-error.ts`.
- Every action from Task 3.2 on has the shape `(state: ActionState, form: FormData) => Promise<ActionState>`.

- [ ] **Step 1: `describe-error.ts`**

`app/actions/checkout.ts` today has a local `describe(e)` that makes
`EmporixError.body` visible — without it, a 400 only arrives as «Request
failed». The function gets shared instead of being written a second time.

First read the existing implementation in `app/actions/checkout.ts` and move
it **verbatim** into `app/lib/describe-error.ts`, exported as
`describeError`. Then import it in `checkout.ts` and delete the local
copy.

- [ ] **Step 2: `action-form.tsx`**

```tsx
"use client";
import { useActionState } from "react";

export interface ActionState {
  error: string | null;
}

/**
 * The only client component for forms. `useActionState` demands one, but
 * not eight: the action comes in as a prop (Server Actions are
 * serialisable), and the children stay server-rendered.
 *
 * The alternative — a redirect with `?error=…` — would need zero client
 * components, but writes error texts into shareable URLs. That is a defect,
 * not merely ugly.
 */
export function ActionForm({
  action,
  submit,
  children,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  submit: string;
  children?: React.ReactNode;
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction}>
      {children}
      {state.error !== null ? (
        <p role="alert" className="muted" style={{ color: "var(--oxblood)" }}>
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn btn--sm" disabled={pending}>
        {pending ? "…" : submit}
      </button>
    </form>
  );
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm -F @viu/emporix-examples-next-server-first typecheck
```

Expected: green. `/checkout` must work unchanged — the only intervention
there was moving `describe`.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add one client form wrapper for action errors"
```

---

## Task 3.2: `/cart` with quantities, removal, coupon and totals

**Files:**
- Create: `examples/next-server-first/app/lib/product-names.ts`
- Modify: `examples/next-server-first/app/cart/page.tsx`, `app/actions/cart.ts`

**Interfaces:**
- Consumes: `ActionForm`, `ActionState`, `describeError` (Task 3.1); `setCart` (Task 1.2); `cartLines`, `cartTotal`, `cartCoupons`, `money`, `productName` from `@viu/emporix-examples-shared`.
- Produces: `namesFor(client, auth, ids): Promise<Record<string, string>>` from `app/lib/product-names.ts`; the actions `setQuantity`, `removeLine`, `applyCoupon`, `removeCoupon` from `app/actions/cart.ts`.

- [ ] **Step 1: `lib/product-names.ts`**

```ts
import type { AuthContext, EmporixClient } from "@viu/emporix-sdk";
import { productName } from "@viu/emporix-examples-shared";

/**
 * Resolves display names by product id. Cart lines carry only an
 * `itemYrn` — the cart GET returns an EMPTY `product`, so there is no
 * name in the response and it has to be fetched separately.
 */
export async function namesFor(
  client: EmporixClient,
  auth: AuthContext | undefined,
  ids: string[],
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter((x) => x !== "")));
  if (unique.length === 0) return {};
  const products = await client.products.searchByIds(unique, {}, auth);
  const map: Record<string, string> = {};
  for (const p of products) {
    const id = (p as { id?: string }).id;
    if (id !== undefined) map[id] = productName(p);
  }
  return map;
}
```

- [ ] **Step 2: The four actions in `app/actions/cart.ts`**

All of them return `ActionState` instead of throwing — that is what `ActionForm`
can display. All of them go through `setCart` so the badge is right.

```ts
import type { ActionState } from "../components/action-form";
import { describeError } from "../lib/describe-error";
import { setCart } from "../lib/cart-session";

/** Shared frame: fetch the cart, mutate, update the count, return the error. */
async function mutateCart(
  fn: (client: EmporixClient, ctx: AuthContext, cartId: string) => Promise<void>,
): Promise<ActionState> {
  try {
    await withEmporixSessionMutable(async (client, ctx, jar) => {
      const cartId = jar.get(STORAGE_KEYS.cartId);
      if (cartId === null) throw new Error("No cart");
      await fn(client, ctx, cartId);
      setCart(jar, await client.carts.get(cartId, ctx));
    }, EMPORIX);
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/cart");
  revalidatePath("/");
  return { error: null };
}

export async function setQuantity(_state: ActionState, form: FormData): Promise<ActionState> {
  "use server";
  const itemId = String(form.get("itemId"));
  const quantity = Number(form.get("quantity"));
  if (!Number.isInteger(quantity) || quantity < 1) return { error: "Quantity must be 1 or more" };
  return mutateCart((client, ctx, cartId) =>
    // `partial: true` → the quantity only. Without it PUT replaces the whole
    // line and wants itemYrn plus price line back.
    client.carts.updateItem(cartId, itemId, { quantity }, ctx, { partial: true }),
  );
}

export async function removeLine(_state: ActionState, form: FormData): Promise<ActionState> {
  "use server";
  const itemId = String(form.get("itemId"));
  return mutateCart((client, ctx, cartId) => client.carts.removeItem(cartId, itemId, ctx));
}

export async function applyCoupon(_state: ActionState, form: FormData): Promise<ActionState> {
  "use server";
  const code = String(form.get("code")).trim();
  if (code === "") return { error: "Enter a coupon code" };
  return mutateCart((client, ctx, cartId) => client.carts.applyCoupon(cartId, code, ctx));
}

export async function removeCoupon(_state: ActionState, form: FormData): Promise<ActionState> {
  "use server";
  const code = String(form.get("code"));
  return mutateCart((client, ctx, cartId) => client.carts.removeCoupon(cartId, code, ctx));
}
```

Add `EmporixClient` and `AuthContext` as type imports from
`@viu/emporix-sdk`.

- [ ] **Step 3: `cart/page.tsx` afresh**

```tsx
import { STORAGE_KEYS, sessionCookieJar, withEmporixSession } from "@viu/emporix-sdk-next/session";
import { cartCoupons, cartLines, cartTotal, money } from "@viu/emporix-examples-shared";
import { EMPORIX, STORE_OPT } from "../emporix";
import { ActionForm } from "../components/action-form";
import { namesFor } from "../lib/product-names";
import { applyCoupon, removeCoupon, removeLine, setQuantity } from "../actions/cart";

export default async function CartPage(): Promise<React.JSX.Element> {
  // sessionCookieJar, not cookies(): the prefix and the codec hang off it.
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const cartId = jar.get(STORAGE_KEYS.cartId);

  if (cartId === null) {
    return (
      <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
        <h1 className="serif">Cart</h1>
        <p className="muted">No cart yet. Add something from the <a href="/">catalog</a>.</p>
      </main>
    );
  }

  const { lines, total, coupons, names } = await withEmporixSession(async (client, ctx) => {
    const cart = await client.carts.get(cartId, ctx);
    const l = cartLines(cart);
    return {
      lines: l,
      total: cartTotal(cart),
      coupons: cartCoupons(cart),
      names: await namesFor(client, ctx, l.map((x) => x.productId)),
    };
  }, EMPORIX);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <h1 className="serif">Your bag</h1>
      {/* The id is httpOnly, only the server can show it. It stands here
          because its change across a login is the only evidence that the
          cart onboarding really swapped the guest cart. */}
      <p className="muted">Cart <code>{cartId}</code></p>

      {lines.length === 0 ? (
        <p className="muted">Your bag is empty.</p>
      ) : (
        <ul className="cart__lines" style={{ listStyle: "none", padding: 0 }}>
          {lines.map((l) => (
            <li key={l.id} className="cart__line">
              <span className="serif">{names[l.productId] ?? l.productId}</span>
              <ActionForm action={setQuantity} submit="Update">
                <input type="hidden" name="itemId" value={l.id} />
                <label className="field__label" htmlFor={`qty-${l.id}`}>Quantity</label>
                <input id={`qty-${l.id}`} className="input" name="quantity" type="number" min={1} defaultValue={l.quantity} />
              </ActionForm>
              <ActionForm action={removeLine} submit="Remove">
                <input type="hidden" name="itemId" value={l.id} />
              </ActionForm>
              <span className="price">{l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}</span>
            </li>
          ))}
        </ul>
      )}

      <aside className="cart__summary surface">
        <h3 className="serif">Summary</h3>
        <ActionForm action={applyCoupon} submit="Apply">
          <label className="field__label" htmlFor="code">Coupon</label>
          <input id="code" className="input" name="code" placeholder="Code" />
        </ActionForm>
        {coupons.map((c) => (
          <ActionForm key={c} action={removeCoupon} submit={`Remove ${c}`}>
            <input type="hidden" name="code" value={c} />
          </ActionForm>
        ))}
        <div className="cart__total">
          <span className="eyebrow">Total</span>
          <span className="price">{total ? money(total.amount, total.currency) : "—"}</span>
        </div>
        {lines.length > 0 ? <a href="/checkout" className="btn btn--accent">Checkout →</a> : null}
      </aside>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck and live evidence**

| Check | Expectation |
|---|---|
| Add a product, open `/cart` | line with the **name** (not the id), unit and line total |
| Quantity to 3, «Update» | line shows 3, line total tripled, badge still shows 1 position |
| Quantity to 0, «Update» | «Quantity must be 1 or more», no request to Emporix |
| «Remove» | line gone, badge drops |
| Coupon «NOPE», «Apply» | Emporix message in the form, not «Request failed» |
| Empty coupon | «Enter a coupon code» |

Rows 3 and 6 are the evidence for returning errors: without `ActionForm` a
thrown exception would show the Next error page there.

The name row is the evidence for `namesFor` — the cart GET returns an empty
`product`, so without the second call the bare id would stand there.

- [ ] **Step 5: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add cart mutations to the next demo"
```

---

## Task 4.1: Auth gate, `safeNext` and `/account`

**Needs Task 0** — without the store fix, `emporixSession` in store mode reports
every logged-in customer as anonymous, and the gate redirects in a loop.

**Files:**
- Create: `examples/next-server-first/app/lib/require-customer.ts`, `app/account/page.tsx`
- Create: `examples/next-server-first/tests/safe-next.test.ts`
- Modify: `examples/next-server-first/app/login/page.tsx`, `app/actions/auth.ts`, `app/package.json`

**Interfaces:**
- Produces: `requireCustomer(next: string): Promise<string>` and `safeNext(raw: string | undefined): string` from `app/lib/require-customer.ts`.

- [ ] **Step 1: The failing test for `safeNext`**

The only trust boundary in this demo. It gets a test even though examples
otherwise have none — an open redirect is not a demo detail.

`examples/next-server-first/package.json`: `"test": "vitest run"` instead of
the no-op, and `vitest` as a devDependency. On top of that, in
`examples/README.md` under «Conventions» extend the line «No unit tests» with:
«— except `next-server-first/tests/safe-next.test.ts`, which covers an open
redirect.»

```ts
import { describe, expect, it } from "vitest";
import { safeNext } from "../app/lib/require-customer";

describe("safeNext", () => {
  it("keeps a plain path", () => {
    expect(safeNext("/account/orders")).toBe("/account/orders");
  });
  it("rejects a protocol-relative absolute link", () => {
    // `//evil.com` is NOT a path — the browser reads it as an absolute link.
    expect(safeNext("//evil.com")).toBe("/");
  });
  it("rejects an absolute URL", () => {
    expect(safeNext("https://evil.com")).toBe("/");
  });
  it("falls back when absent", () => {
    expect(safeNext(undefined)).toBe("/");
  });
});
```

- [ ] **Step 2: Run the test — red**

Run: `pnpm -F @viu/emporix-examples-next-server-first test`
Expected: FAIL, «Failed to resolve import» or «safeNext is not a function».

- [ ] **Step 3: `lib/require-customer.ts`**

```ts
import { redirect } from "next/navigation";
import { emporixSession } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";

/**
 * Own paths only. An open redirect is a trust boundary, even in a
 * demo — `//evil.com` is a protocol-relative absolute link and not a
 * path, even though it begins with a slash.
 */
export function safeNext(raw: string | undefined): string {
  if (raw === undefined || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

/**
 * Gate for account pages. Per page, not as middleware: Next 16 runs
 * middleware in `proxy.ts`, which is Node runtime and has no `cookies()`.
 */
export async function requireCustomer(next: string): Promise<string> {
  const { customerToken } = await emporixSession(STORE_OPT);
  if (customerToken === null) redirect(`/login?next=${encodeURIComponent(next)}`);
  return customerToken;
}
```

- [ ] **Step 4: Run the test — green**

Run: `pnpm -F @viu/emporix-examples-next-server-first test`
Expected: PASS, 4 tests.

- [ ] **Step 5: `/login` honours `?next=`**

In `app/login/page.tsx` accept `searchParams`, apply `safeNext` to it and send
the value along as `<input type="hidden" name="next" …>`. In the login
action in `app/actions/auth.ts`, after `emporixLogin` and the count update
from Task 1.2:

```ts
  // safeNext here too, not only when rendering: the field comes from the form
  // and is therefore determined by the client.
  redirect(safeNext(String(form.get("next") ?? "/")));
```

- [ ] **Step 6: `/account`**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { pickText } from "@viu/emporix-examples-shared";
import { EMPORIX } from "../emporix";
import { requireCustomer } from "../lib/require-customer";

export default async function AccountPage(): Promise<React.JSX.Element> {
  await requireCustomer("/account");
  const customer = await withEmporixSession((client, ctx) => client.customers.me(ctx), EMPORIX);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Account</p>
      <h1 className="serif">
        {pickText((customer as { firstName?: unknown }).firstName, "")}{" "}
        {pickText((customer as { lastName?: unknown }).lastName, "")}
      </h1>
      <nav className="cluster" style={{ gap: "var(--s-4)" }}>
        <a href="/account/profile" className="u-underline">Profile</a>
        <a href="/account/addresses" className="u-underline">Addresses</a>
        <a href="/account/orders" className="u-underline">Orders</a>
      </nav>
    </main>
  );
}
```

- [ ] **Step 7: Live evidence**

Logged out, open `/account`: redirect to `/login?next=%2Faccount`. Log in:
back on `/account` with the name. Then open `/login?next=//evil.com`, log
in — landing on `/`, not on evil.com. And once in store mode with
Redis, because exactly that ends in a redirect loop without Task 0.

- [ ] **Step 8: Commit**

```bash
git add examples/next-server-first examples/README.md
git commit -m "feat(examples): gate the account routes server-side"
```

---

## Task 4.2: `/account/profile` — profile and password

**Files:**
- Create: `examples/next-server-first/app/account/profile/page.tsx`, `app/actions/account.ts`

**Interfaces:**
- Consumes: `requireCustomer` (Task 4.1), `ActionForm`/`ActionState`/`describeError` (Task 3.1).
- Produces: `updateProfile`, `changePassword` from `app/actions/account.ts`.

- [ ] **Step 1: The two actions**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { withEmporixSessionMutable } from "@viu/emporix-sdk-next/session";
import { EMPORIX } from "../emporix";
import type { ActionState } from "../components/action-form";
import { describeError } from "../lib/describe-error";

export async function updateProfile(_state: ActionState, form: FormData): Promise<ActionState> {
  const firstName = String(form.get("firstName")).trim();
  const lastName = String(form.get("lastName")).trim();
  if (firstName === "" || lastName === "") return { error: "First and last name are required" };
  const contactEmail = String(form.get("contactEmail") ?? "").trim();
  const contactPhone = String(form.get("contactPhone") ?? "").trim();
  try {
    await withEmporixSessionMutable(
      (client, ctx) =>
        client.customers.update(
          {
            firstName,
            lastName,
            // exactOptionalPropertyTypes: omit empty fields instead of
            // sending "" — "" would delete an existing value.
            ...(contactEmail !== "" ? { contactEmail } : {}),
            ...(contactPhone !== "" ? { contactPhone } : {}),
          },
          ctx,
        ),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account");
  revalidatePath("/account/profile");
  return { error: null };
}

export async function changePassword(_state: ActionState, form: FormData): Promise<ActionState> {
  // `currentPassword`, NOT `oldPassword` — measured against
  // storefront-demo/src/account/PasswordForm.tsx:23, where the call is proven
  // live. The wrong name yields a 400 with an unclear body.
  const currentPassword = String(form.get("currentPassword"));
  const newPassword = String(form.get("newPassword"));
  if (newPassword.length < 8) return { error: "The new password needs at least 8 characters" };
  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.changePassword({ currentPassword, newPassword }, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  // No revalidate: there is nothing to display that would have changed.
  return { error: null };
}
```

The four profile fields (`firstName`, `lastName`, `contactEmail`, `contactPhone`)
are read from `storefront-demo/src/account/ProfileForm.tsx` — the same source
that runs against the real tenant. `CustomerUpdateInput` is an alias for the
generated `CustomerUpdateDto`; if the generated type differs, the type wins.

- [ ] **Step 2: The page**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { pickText } from "@viu/emporix-examples-shared";
import { EMPORIX } from "../../emporix";
import { requireCustomer } from "../../lib/require-customer";
import { ActionForm } from "../../components/action-form";
import { changePassword, updateProfile } from "../../actions/account";

export default async function ProfilePage(): Promise<React.JSX.Element> {
  await requireCustomer("/account/profile");
  const customer = await withEmporixSession((client, ctx) => client.customers.me(ctx), EMPORIX);
  const c = customer as {
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
    contactEmail?: unknown;
    contactPhone?: unknown;
  };

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow"><a href="/account" className="u-underline">← Account</a></p>
      <h1 className="serif">Profile</h1>
      <p className="muted">{pickText(c.email, "")}</p>

      <ActionForm action={updateProfile} submit="Save">
        <label className="field__label" htmlFor="firstName">First name</label>
        <input id="firstName" className="input" name="firstName" defaultValue={pickText(c.firstName, "")} />
        <label className="field__label" htmlFor="lastName">Last name</label>
        <input id="lastName" className="input" name="lastName" defaultValue={pickText(c.lastName, "")} />
        <label className="field__label" htmlFor="contactEmail">Contact email</label>
        <input id="contactEmail" className="input" name="contactEmail" type="email" defaultValue={pickText(c.contactEmail, "")} />
        <label className="field__label" htmlFor="contactPhone">Phone</label>
        <input id="contactPhone" className="input" name="contactPhone" type="tel" defaultValue={pickText(c.contactPhone, "")} />
      </ActionForm>

      <h2 className="serif" style={{ marginTop: "var(--s-6)" }}>Password</h2>
      <ActionForm action={changePassword} submit="Change">
        <label className="field__label" htmlFor="currentPassword">Current password</label>
        <input id="currentPassword" className="input" name="currentPassword" type="password" autoComplete="current-password" />
        <label className="field__label" htmlFor="newPassword">New password</label>
        <input id="newPassword" className="input" name="newPassword" type="password" autoComplete="new-password" />
      </ActionForm>
    </main>
  );
}
```

- [ ] **Step 3: Live evidence**

Change the name, save, reload — the new name stands in the form **and** in
`/account`. An empty name field shows «First and last name are required»
without an Emporix request. For the password, a too-short new one shows the
length message; a wrong current one shows the Emporix message.

Do not play the password change through with the test account if other tasks
have to log in with it afterwards — otherwise the `.env.local` is out of date.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add a profile page to the next demo"
```

---

## Task 4.3: `/account/addresses` — CRUD over Server Actions

**Files:**
- Create: `examples/next-server-first/app/account/addresses/page.tsx`
- Modify: `examples/next-server-first/app/actions/account.ts`

**Interfaces:**
- Produces: `addAddress`, `updateAddress`, `deleteAddress` from `app/actions/account.ts`.

- [ ] **Step 1: The three actions**

The seven field names are read from
`examples/storefront-demo/src/account/AddressForm.tsx` — the call there runs
against the real tenant, that is the dependable source.

```ts
const ADDRESS_FIELDS = [
  "contactName",
  "contactPhone",
  "street",
  "streetNumber",
  "zipCode",
  "city",
  "country",
] as const;

function readAddress(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ADDRESS_FIELDS) out[f] = String(form.get(f) ?? "").trim();
  return out;
}

function missing(a: Record<string, string>): string | null {
  // Emporix answers a missing required field with a 400 whose body
  // names the field. Checking here first saves the round trip and is clearer.
  for (const f of ["contactName", "street", "zipCode", "city", "country"]) {
    if (a[f] === "") return `${f} is required`;
  }
  return null;
}

export async function addAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const address = readAddress(form);
  const problem = missing(address);
  if (problem !== null) return { error: problem };
  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.addresses.add(address as never, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/addresses");
  return { error: null };
}

export async function updateAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id"));
  const address = readAddress(form);
  const problem = missing(address);
  if (problem !== null) return { error: problem };
  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.addresses.update(id, address as never, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/addresses");
  return { error: null };
}

export async function deleteAddress(_state: ActionState, form: FormData): Promise<ActionState> {
  const id = String(form.get("id"));
  try {
    await withEmporixSessionMutable(
      (client, ctx) => client.customers.addresses.remove(id, ctx),
      EMPORIX,
    );
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/addresses");
  return { error: null };
}
```

**On the `as never`:** typecheck without the cast first. For the checkout I had
taken the same cast over from storefront-demo and then measured that it is not
needed. If the typecheck stays red, replace the cast with the generated
input shape, not with `never` — and if only `never` works, justify why in
one line.

- [ ] **Step 2: The page**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { EMPORIX } from "../../emporix";
import { requireCustomer } from "../../lib/require-customer";
import { ActionForm } from "../../components/action-form";
import { addAddress, deleteAddress, updateAddress } from "../../actions/account";

const FIELDS = [
  { name: "contactName", label: "Contact name" },
  { name: "contactPhone", label: "Phone" },
  { name: "street", label: "Street" },
  { name: "streetNumber", label: "No." },
  { name: "zipCode", label: "Postcode" },
  { name: "city", label: "City" },
  { name: "country", label: "Country (ISO-2)" },
] as const;

export default async function AddressesPage(): Promise<React.JSX.Element> {
  await requireCustomer("/account/addresses");
  const addresses = await withEmporixSession(
    (client, ctx) => client.customers.addresses.list(ctx),
    EMPORIX,
  );

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow"><a href="/account" className="u-underline">← Account</a></p>
      <h1 className="serif">Addresses</h1>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {addresses.map((a) => {
          const r = a as Record<string, string | undefined>;
          const id = r.id ?? "";
          return (
            <li key={id} className="surface" style={{ marginBottom: "var(--s-4)" }}>
              <ActionForm action={updateAddress} submit="Save">
                <input type="hidden" name="id" value={id} />
                {FIELDS.map((f) => (
                  <span key={f.name}>
                    <label className="field__label" htmlFor={`${id}-${f.name}`}>{f.label}</label>
                    <input id={`${id}-${f.name}`} className="input" name={f.name} defaultValue={r[f.name] ?? ""} />
                  </span>
                ))}
              </ActionForm>
              <ActionForm action={deleteAddress} submit="Delete">
                <input type="hidden" name="id" value={id} />
              </ActionForm>
            </li>
          );
        })}
      </ul>

      <h2 className="serif">New address</h2>
      <ActionForm action={addAddress} submit="Add">
        {FIELDS.map((f) => (
          <span key={f.name}>
            <label className="field__label" htmlFor={`new-${f.name}`}>{f.label}</label>
            <input id={`new-${f.name}`} className="input" name={f.name} />
          </span>
        ))}
      </ActionForm>
    </main>
  );
}
```

- [ ] **Step 3: Live evidence**

Create an address (CH, valid postcode), reload the page — it is in the list.
Change the city, save, reload — changed value. Delete, reload — gone.
An empty required field shows «… is required» without an Emporix request.

Then open `/checkout`: the saved address must be pre-filled there — that
checks that this page writes the address in the shape the checkout
reads.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add address crud to the next demo"
```

---

## Task 4.4: `/account/orders` and `/account/orders/[id]`

**Files:**
- Create: `examples/next-server-first/app/account/orders/page.tsx`, `app/account/orders/[id]/page.tsx`
- Modify: `examples/next-server-first/app/actions/account.ts`

**Interfaces:**
- Consumes: `orderVM`, `orderItems`, `money` from `@viu/emporix-examples-shared`; `setCart` (Task 1.2).
- Produces: `cancelOrder`, `reorder` from `app/actions/account.ts`.

- [ ] **Step 1: The list page**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { money, orderVM } from "@viu/emporix-examples-shared";
import { EMPORIX } from "../../emporix";
import { requireCustomer } from "../../lib/require-customer";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.JSX.Element> {
  await requireCustomer("/account/orders");
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const result = await withEmporixSession(
    (client, ctx) => client.orders.listMine(ctx, { pageNumber: page, pageSize: 10 }),
    EMPORIX,
  );

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow"><a href="/account" className="u-underline">← Account</a></p>
      <h1 className="serif">Orders</h1>
      {result.items.length === 0 ? (
        <p className="muted">No orders yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {result.items.map((o) => {
            const vm = orderVM(o);
            return (
              <li key={vm.id} className="surface" style={{ marginBottom: "var(--s-3)" }}>
                <a href={`/account/orders/${encodeURIComponent(vm.id)}`} className="u-underline serif">
                  {vm.number}
                </a>
                <span className="tag">{vm.status}</span>
                <span className="muted">{vm.itemCount} item(s)</span>
                <span className="price">{vm.total ? money(vm.total.amount, vm.total.currency) : "—"}</span>
              </li>
            );
          })}
        </ul>
      )}
      <nav className="cluster" style={{ gap: "var(--s-4)" }}>
        {page > 1 ? <a href={`/account/orders?page=${page - 1}`} className="btn btn--outline">← Previous</a> : null}
        <span className="muted">Page {page}</span>
        {result.hasNextPage ? <a href={`/account/orders?page=${page + 1}`} className="btn btn--outline">Next →</a> : null}
      </nav>
    </main>
  );
}
```

- [ ] **Step 2: The two actions**

`orders.cancel` takes an optional `saasToken`. In server-first mode it lives
in the session and must never reach the browser — that is the same
mechanism as in the checkout and the reason why this action **must** be
server-side.

```ts
export async function cancelOrder(_state: ActionState, form: FormData): Promise<ActionState> {
  const orderId = String(form.get("orderId"));
  try {
    await withEmporixSessionMutable(async (client, ctx, jar) => {
      const saasToken = jar.get(STORAGE_KEYS.saasToken);
      await client.orders.cancel(
        orderId,
        ctx,
        saasToken !== null ? { saasToken } : {},
      );
    }, EMPORIX);
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/account/orders");
  revalidatePath(`/account/orders/${orderId}`);
  return { error: null };
}

export async function reorder(_state: ActionState, form: FormData): Promise<ActionState> {
  const orderId = String(form.get("orderId"));
  try {
    await withEmporixSessionMutable(async (client, ctx, jar) => {
      const order = await client.orders.get(orderId, ctx);
      const items = orderItems(order).map((i) => ({
        itemYrn: productYrn(client.tenant, i.productId),
        quantity: i.quantity,
      }));
      if (items.length === 0) throw new Error("This order has no items to reorder");

      let cartId = jar.get(STORAGE_KEYS.cartId);
      if (cartId === null) {
        // getCurrent({ create: true }), not create: a customer may have only
        // one open cart, and a blind create answers with 409.
        const cart = await client.carts.getCurrent(ctx, { siteCode: SITE.siteCode, create: true });
        cartId = cart?.id ?? null;
        if (cartId === null) throw new Error("Emporix returned no cart");
        setCart(jar, cart);
      }
      await client.carts.addItemsBatch(cartId, { items } as never, ctx);
      setCart(jar, await client.carts.get(cartId, ctx));
    }, EMPORIX);
  } catch (e) {
    return { error: describeError(e) };
  }
  revalidatePath("/cart");
  revalidatePath("/");
  return { error: null };
}
```

Import `orderItems`, `productYrn` and `SITE`. The `as never` on
`addItemsBatch` comes from `use-reorder.ts` — typecheck without the cast first
and keep it only if it stays red without it. Emporix requires a `priceId` on
internal line items; if the batch fails with that message, the price per line
item has to be resolved via `matchByContext` as in `addToCart`. Implement it
that way then, and record in the README that the reorder resolves prices anew
instead of taking over the order's.

- [ ] **Step 3: The detail page**

```tsx
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { money, orderItems, orderVM } from "@viu/emporix-examples-shared";
import { EMPORIX } from "../../../emporix";
import { requireCustomer } from "../../../lib/require-customer";
import { ActionForm } from "../../../components/action-form";
import { cancelOrder, reorder } from "../../../actions/account";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  await requireCustomer(`/account/orders/${id}`);
  const order = await withEmporixSession((client, ctx) => client.orders.get(id, ctx), EMPORIX);
  const vm = orderVM(order);
  const items = orderItems(order);

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow"><a href="/account/orders" className="u-underline">← Orders</a></p>
      <h1 className="serif">{vm.number}</h1>
      <p><span className="tag">{vm.status}</span> {vm.createdAt ?? ""}</p>

      <ul style={{ listStyle: "none", padding: 0 }}>
        {items.map((i) => (
          <li key={i.id} className="cart__line">
            <span className="serif">{i.name}</span>
            <span className="muted">× {i.quantity}</span>
            <span className="price">{i.lineTotal ? money(i.lineTotal.amount, i.lineTotal.currency) : ""}</span>
          </li>
        ))}
      </ul>
      <p className="price">Total {vm.total ? money(vm.total.amount, vm.total.currency) : "—"}</p>

      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <ActionForm action={reorder} submit="Reorder">
          <input type="hidden" name="orderId" value={vm.id} />
        </ActionForm>
        <ActionForm action={cancelOrder} submit="Cancel order">
          <input type="hidden" name="orderId" value={vm.id} />
        </ActionForm>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Live evidence**

Logged in, open `/account/orders` — the orders from the earlier
checkout tests (EON1225, EON1226) stand there with number, status and total.
Open one detail: line items with **names**, not with ids. «Reorder» raises the
badge and `/cart` shows the line items. «Cancel order» on an order in
status `IN_CHECKOUT` changes the status; on a completed one it shows the
Emporix message in the form instead of an error page.

The name point is not cosmetics: `orderItems` reads both order shapes
(list with `items`, GET with `entries`), and without the shared function the
detail page would be empty.

- [ ] **Step 5: Bring the README table up to date**

In `examples/next-server-first/README.md`, extend the table «What each page
proves» with the new routes and add a dated verification section for
this work — after the pattern of the existing tables, with the values
actually observed, not with expected ones.

Likewise enter the four non-goals from the spec:

```markdown
## What this demo deliberately does NOT have

- `/account/returns`, `/account/rewards`, `/account/lists` — the same
  CRUD-over-Server-Action pattern as `addresses`, a fourth time. It teaches
  nothing new and would have to be dragged along with every SDK change.
- `/reset-password` — needs a real email round trip. What cannot be
  verified is not claimed here.
- B2B — `storefront-demo` does not have it either.
- Optimistic updates — there is no client state that could be
  optimistic. The documented price of the mode, not an open task.
```

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): add order history to the next demo"
```

---

## Task 5.1: Webhook route and `revalidateTag`

**Files:**
- Create: `examples/next-server-first/app/api/emporix/webhook/route.ts`
- Modify: `examples/next-server-first/README.md`

**Interfaces:**
- Consumes: the webhook export from `@viu/emporix-sdk-next/webhook`.

- [ ] **Step 1: The route**

`createEmporixWebhookRoute(opts)` returns a `(req: Request) => Promise<Response>`
that is exported directly as `POST` — no destructuring. Options:
`secret` (required), `onEvent?`, `maxAgeSeconds?`, `canonicalize?`, `profile?`
(default `{ expire: 0 }`).

```ts
import { createEmporixWebhookRoute } from "@viu/emporix-sdk-next/webhook";

const secret = process.env.EMPORIX_WEBHOOK_SECRET;
// Throw instead of quietly returning 401: a route that rejects every delivery
// because a variable is missing is the most expensive way to hide a
// configuration error. That is the pattern this example already uses for the tenant.
if (secret === undefined || secret === "") {
  throw new Error("EMPORIX_WEBHOOK_SECRET is not set — see the README.");
}

/**
 * The trigger that was missing until now.
 *
 * The tagged client (`getEmporixClient()`) stamps catalog responses with
 * cache tags, and this route calls `revalidateTag` on them (webhook.ts:163).
 * Without this file, half of it had no sender: no example mounted it.
 *
 * For cart, orders and customer data that does NOT exist and cannot
 * exist — `emporixTagsForUrl` deliberately returns `[]` there. The
 * `revalidatePath` in the cart actions is therefore correct and not the
 * blunt instrument; it is the only instrument.
 */
export const POST = createEmporixWebhookRoute({
  secret,
  // Five-minute replay window. Without the option the age of the delivery is
  // not checked at all, and an intercepted delivery stays valid for
  // arbitrarily long.
  maxAgeSeconds: 300,
});
```

- [ ] **Step 2: README section with the secret**

```markdown
## Webhook: `revalidateTag` closes the loop

```
EMPORIX_WEBHOOK_SECRET=<the secret configured in Emporix>
```

Catalog data is cached by the tagged client and lives until something
declares it invalid. This route is that something. Without it, only waiting
helps.

For cart, orders and customer data there are no tags — deliberately, they
are per-visitor mutable or secret. There, `revalidatePath` is
right.
```

The human adds it to `.env.example`: `.env*` lies outside the write permissions.

- [ ] **Step 3: Live evidence**

Rename a product in the Emporix backend and load the catalog page — it still
shows the old name (that is the cache, not a bug). Then fire the webhook with a
valid signature and reload: new name, without a deploy and without any
waiting.

Then fire with a **wrong** signature: `401`, and a name changed afterwards
does **not** appear — an invalid signature must invalidate nothing.

Take the signature computation from `packages/next/tests/webhook.test.ts`; the
tests there already build it.

- [ ] **Step 4: Commit**

```bash
git add examples/next-server-first
git commit -m "feat(examples): mount the webhook route in the next demo"
```

---

## Wrap-up

**Execution order — seven PRs, not six.** The spec counts six; while planning it
came out that the switcher from pattern 1 changes the context of every reader
site and therefore needs its own PR at the end:

```
0  →  1.1 → 1.2  →  2.1 → 2.2 → 2.3  →  3.1 → 3.2  →  4.1 → 4.2 → 4.3 → 4.4  →  5.1  →  6.1
```

`6.1` stands above `2.1` in the document because it belongs to the shell —
it is executed **last**.

After every PR group (0 · 1.1–1.2 · 2.1–2.3 · 3.1–3.2 · 4.1–4.4 · 5.1 · 6.1):

```bash
pnpm -r build && pnpm -r test && pnpm typecheck && pnpm lint
```

Expected: `pnpm -r test` stays at 1'439 tests plus **5** from Task 0 (not 3 —
two came along during implementation, for the saasToken and for the
single-record promise) plus 4 from Task 4.1 = **1'448**. Measured after Task 0:
**1'444**. After Task 1.1 the typecheck covers eleven projects instead of ten.

Then `superpowers:finishing-a-development-branch` for the PR. Changesets only
for Task 0 — `@viu/emporix-examples-*` is under `ignore` in
`.changeset/config.json` and is never versioned.
