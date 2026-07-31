# React Server Storage + Generic Prefetch — Design

**Date:** 2026-07-31
**Package:** `@viu/emporix-sdk-react`
**Entry points touched:** `./ssr` (additive), `./storage` (internal refactor only)
**Release:** minor — additive, no signature changes

## Goal

Make `@viu/emporix-sdk-react` usable from a server runtime without every
consuming app re-writing the same glue:

1. **Session from an injected cookie jar** — an `EmporixStorage` that reads
   (and optionally writes) through a caller-supplied accessor, so RSC / Server
   Actions / Route Handlers / Remix loaders can resolve the customer session.
2. **Prefetch for every read hook** — one generic `prefetchEmporix` replacing
   the three hand-written helpers, so server-side prefetch is no longer limited
   to Product, Cart and Order.

Both are framework-neutral. No `next` import, no new dependency, no new package.

## Why now

This is step 1 of a two-step evaluation ("how do we support Next.js"). The
finding was that the Next-specific surface is small (~80 lines: cache tags,
`revalidate` route handler, middleware, a server-client singleton) but is
blocked behind two gaps that are **not** Next-specific. Closing them here
benefits Next, Remix, SvelteKit and Nitro equally, and shrinks whatever
Next-only package may follow.

## Current state (measured 2026-07-31)

| Fact | Evidence |
|---|---|
| RSC boundary is already correct | `tsup.config.ts` builds two configs: client entries (`index`, `provider`, `hooks`, `storage`) get a `"use client"` banner, `ssr` deliberately does not. Enforced by `scripts/check-dist.mjs`. |
| `./ssr` is the only server-safe entry | Same. A server-only export placed in `./storage` would pull `"use client"` into every importing Server Component. |
| No `next` import anywhere in the packages | 0 matches for `next/` under `packages/**/src`. |
| Cookie storage is browser-only | `storage/cookie.ts` reads `document.cookie`; when `document` is undefined it logs a warning and returns `createMemoryStorage()`. Unusable on a server. |
| `EmporixStorage` is fully synchronous | `storage/index.ts`: every accessor is `(): string \| null` / `(v): void`. |
| Prefetch covers 3 of ~43 keyed read queries | `ssr.ts` (84 lines) exports `prefetchProduct`, `prefetchCart`, `prefetchOrder`. |
| Query keys are already declarative | `useEmporixQuery({ mode, site, resource, args, queryFn })` in `hooks/internal/use-emporix-query.ts`. 25 distinct `resource` literals go through it; 18 further `emporixKey(...)` call sites in 12 non-internal hook files (mostly infinite queries) build keys by hand. 25 + 18 = the ~43 above. |

The declarative key construction is what makes a single generic prefetch
possible instead of ~43 per-resource helpers.

## Non-goals

- No `next`-specific code (cache tags, `revalidateTag`, middleware, image
  loaders, route handlers). That is step 2 and a separate decision.
- No new package.
- No change to the `EmporixStorage` interface — in particular it stays
  synchronous.
- No refactor of the ~42 hook files to export their descriptors. Evaluated and
  rejected for this step: large diff, and the benefit only materialises once
  someone actually server-prefetches the rare hooks.
- No fix for the pre-existing `prefetchOrder` `authKind` mismatch (see
  *Known issues* below) — that is a cache-invalidation event for every
  consumer and deserves its own PR.

## Component 1 — `createServerStorage`

### Interface

```ts
// packages/react/src/storage/server.ts
export interface ServerCookieJar {
  /** Read a cookie value. Return `null` when absent. */
  get(name: string): string | null;
  /** Write a cookie; `null` deletes it. Omit to make the storage read-only. */
  set?(name: string, value: string | null): void;
}

export function createServerStorage(jar: ServerCookieJar): EmporixStorage;
```

The jar is synchronous by design. Next 15's `cookies()` returns a promise, but
the object it resolves to reads synchronously — so the `await` belongs to the
caller, and the storage interface stays unchanged.

### Read-only default

When `set` is omitted, every setter is a no-op that logs `console.warn` **once
per storage key per storage instance** — not once per call, which would flood a
render loop, and not once globally, which would hide a second offending key.

This is a platform constraint, not a preference: Next throws if a Server
Component writes a cookie during render. Only Server Actions and Route Handlers
may write. Silently swallowing the write would hide a real application bug.

`subscribe` and `subscribeAll` are omitted from the returned object — both are
optional in `EmporixStorage`, and a server-render storage has no lifetime over
which to observe changes.

### Cookie-name mapping is extracted, not duplicated

`storage/cookie.ts` is 100 lines, of which roughly 80 are the mapping "8 cookie
names → 16 getters/setters". That mapping moves to a new
`storage/cookie-core.ts`:

```ts
// packages/react/src/storage/cookie-core.ts

/** The eight persisted keys. Literals must match today's cookie.ts exactly. */
export const COOKIE_NAMES = {
  customerToken: "emporix.customerToken",   // overridable via opts.tokenName
  cartId: "emporix.cartId",
  anonymousSession: "emporix.anonymousSession",
  siteCode: "emporix.siteCode",
  language: "emporix.language",
  activeLegalEntityId: "emporix.activeLegalEntityId",
  refreshToken: "emporix.refreshToken",
  saasToken: "emporix.saasToken",
} as const;

export function createCookieBackedStorage(
  io: {
    get(name: string): string | null;
    set?(name: string, value: string | null): void;
  },
  opts?: {
    tokenName?: string;
    /** Called after every write. Omit to skip notification entirely, in which
     *  case the returned object has no `subscribeAll`. */
    notify?: (key: EmporixStorageKey) => void;
  },
): EmporixStorage;
```

`notify` is a callback rather than a boolean so the core stays free of the
`createListenerSet` lifetime — the browser backend owns the listener set and
passes its `notify`; the server backend passes nothing.

- `cookie.ts` keeps only: `document` guard + memory fallback, `Secure`/`SameSite`
  attribute assembly, the `document.cookie` read/write pair, and the
  `createListenerSet` wiring whose `notify` it hands down → shrinks to ~35 lines.
- `server.ts` supplies the injected jar and passes no `notify`.

The eight cookie-name string literals must exist in exactly one place after
this change. Today they are duplicated in `examples/next-app-router/app/actions.ts`;
that duplication is what this extraction removes for consumers.

Net effect: roughly zero new lines for a new capability. This is the reason the
refactor is in scope rather than a copy of the mapping.

### Export location

`createServerStorage` and `ServerCookieJar` are exported from **`./ssr` only**.
They must not appear in `./storage` or `./index` — those carry the
`"use client"` banner. `scripts/check-dist.mjs` already fails the build if the
banner rules are violated; no new gate is needed.

### `serverAuth` helper

```ts
export function serverAuth(storage: EmporixStorage): AuthContext;
```

Returns `auth.customer(token)` when a customer token is present, else
`auth.anonymous()`. Three lines, and it mirrors `useEmporixQuery`'s resolution
exactly — which matters because `authKind` is part of the query key. Getting
this wrong by hand is one of the two ways to produce a silent cache miss.

## Component 2 — `prefetchEmporix`

### Interface

```ts
// packages/react/src/ssr.ts
export interface PrefetchEmporixOpts<T, TArgs extends readonly unknown[]> {
  client: EmporixClient;
  /** The hook's `resource` literal, e.g. "product". */
  resource: string;
  /** The hook's `args` tuple, e.g. [productId]. */
  args: TArgs;
  /** Which site discriminators the hook puts in the key. */
  site: SiteFields;                    // "full" | "language" | "none"
  auth?: AuthContext;                  // default: auth.anonymous()
  siteCode?: string | null;            // default: null
  language?: string | null;            // default: null
  queryFn: (ctx: AuthContext) => Promise<T>;
}

export function prefetchEmporix<T, TArgs extends readonly unknown[]>(
  qc: QueryClient,
  opts: PrefetchEmporixOpts<T, TArgs>,
): Promise<void>;
```

`SiteFields` is currently a private type alias in
`hooks/internal/use-emporix-query.ts`. It moves to
`hooks/internal/query-keys.ts` and is re-exported as a type from `./ssr`.

### Structural key parity

The site-meta computation currently inlined in `use-emporix-query.ts` (lines
~63–68) moves into `query-keys.ts`:

```ts
export function siteMeta(
  site: SiteFields,
  siteCode: string | null,
  language: string | null,
): { siteCode?: string | null; language?: string | null } {
  return site === "full"
    ? { siteCode, language }
    : site === "language"
      ? { language }
      : {};
}
```

`useEmporixQuery` and `prefetchEmporix` both call it. Parity of the trailing
meta object is therefore structural — it cannot drift. The remaining drift
surface is only the three values a caller supplies: `resource`, `args`, `site`.
Those are covered by the parity test (Component 3).

### The three existing helpers become wrappers

Signatures stay byte-identical, so this is not a breaking change.

| Helper | `resource` | `args` | `site` |
|---|---|---|---|
| `prefetchProduct` | `product` | `[productId]` | `full` |
| `prefetchCart` | `cart` | `[cartId, activeCompanyId ?? null]` | `full` |
| `prefetchOrder` | `orders` | `[orderId]` | `language` |

Each mapping was read off the hook, not inferred:

- `useProduct` — `use-products.ts:19`: `mode: "read-auth", site: "full", resource: "product", args: [productId]`
- `useCart` — `use-cart.ts:38-39`: `mode: "read-auth", site: "full", resource: "cart", args: [resolvedId ?? null, activeCompany?.id ?? null]`
- `useOrder` — `use-order.ts:17`: `mode: "customer", site: "language", resource: "orders", args: [orderId ?? null]`

`ssr.ts` stays roughly its current size — the three helpers collapse to a few
lines each, and `prefetchEmporix` plus its options interface take up the
difference — while going from 3 covered queries to all ~43.

### Usage

```ts
// A Next.js Server Component
import { cookies } from "next/headers";
import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { createServerStorage, serverAuth, prefetchEmporix } from "@viu/emporix-sdk-react/ssr";

const jar = await cookies();
const storage = createServerStorage({ get: (n) => jar.get(n)?.value ?? null });
const ctx = serverAuth(storage);

const qc = new QueryClient();
await prefetchEmporix(qc, {
  client: sdk,
  resource: "products-in-category",
  args: [categoryId, { pageSize: 24 }],
  site: "full",
  auth: ctx,
  siteCode: storage.getSiteCode(),
  queryFn: (c) => sdk.categories.listProducts(categoryId, { pageSize: 24 }, c),
});
```

## Component 3 — Keeping the descriptors honest

### Documented table

`docs/react.md` gains a table under *SSR / RSC* covering the ~10 hooks a server
realistically prefetches:

`product`, `products`, `product-by-code`, `category`, `categories`,
`products-in-category`, `cart`, `orders`, `availability`, `sites`

Each row lists the hook name, `resource`, `args` shape and `site`.

### Parity test

`packages/react/tests/prefetch-parity.test.tsx` — for each documented row:

1. Render the hook inside an `EmporixProvider` with a mocked client.
2. Read the actual key from `qc.getQueryCache().getAll()[0].queryKey`.
3. Build the same key via `prefetchEmporix` using the table's values.
4. Assert deep equality.

The table cannot drift silently. The test file also serves as the worked
reference for the ~33 queries not in the table — the generic function works for
all of them, they simply aren't tabulated.

Test infrastructure exists: 81 test files in `packages/react/tests/`, flat (no
subdirectories), each wiring its own provider; `use-emporix-query.test.tsx`
already asserts key shapes. This test wires its own provider too, matching the
existing convention.

## Error handling and documented pitfalls

**Write attempt on a read-only server storage** — no-op plus one `console.warn`
per key. Never throws: a warning must not take down a server render.

**`httpOnly` breaks the client side.** If a Server Action writes
`emporix.customerToken` with `httpOnly: true`, the browser-side
`createCookieStorage` can no longer read it and the provider mounts
unauthenticated. This is a genuine security improvement *and* a footgun. The
supported pattern is the existing one: server reads the cookie, passes
`initialCustomerToken` into the provider, which seeds `createMemoryStorage`.
Must be stated explicitly in `docs/react.md`.

**Per-request `EmporixClient`.** Unchanged rule (`docs/react.md:640`): one
client per server, never per request. `createServerStorage` is the opposite —
it is per request, because the cookie jar is. The docs must make that asymmetry
explicit, since it is the natural place to get it wrong.

## Known issues (documented, not fixed here)

`prefetchOrder` sets `authKind` from `authCtx.kind`, while `useOrder` runs with
`mode: "customer"` and sets `authKind` to `"customer"` / `"anonymous"`. With
`auth.customer(token)` the two agree. With `auth.raw(externalJwt)` the prefetch
writes `"raw"` and the hook reads `"customer"` → silent cache miss (a second
fetch after hydration, no error). This predates this change. It gets a warning
in `docs/react.md`; the fix is deferred because changing key construction
invalidates cached entries for every consumer and belongs in its own PR with
its own changeset note.

## Testing

| Test | Asserts |
|---|---|
| `tests/prefetch-parity.test.tsx` (new) | documented descriptors produce the hooks' real keys |
| `tests/server-storage.test.ts` (new) | jar delegation for all 8 keys; read-only no-op warns once per key; `subscribe`/`subscribeAll` absent; `serverAuth` resolves customer vs anonymous |
| `tests/ssr.test.tsx` (existing, unchanged) | the three wrappers still produce their original keys |
| existing cookie-storage tests (unchanged) | proof that the `cookie.ts` extraction is behaviour-neutral |

The two "unchanged" rows are the actual safety net for the refactor: if either
needs editing, the refactor was not behaviour-neutral and the change must be
re-examined.

Full gates: `pnpm -r test`, `pnpm typecheck`, `pnpm -F @viu/emporix-sdk-react check:dist`.

## Release

One changeset, minor on `@viu/emporix-sdk-react`:

- new: `createServerStorage`, `ServerCookieJar`, `serverAuth`, `prefetchEmporix`,
  `PrefetchEmporixOpts`, `SiteFields` (all from `./ssr`)
- unchanged: `prefetchProduct`, `prefetchCart`, `prefetchOrder` signatures
- internal: cookie-name mapping extracted to `storage/cookie-core.ts`

## Follow-ups (out of scope, tracked here so they are not lost)

1. Fix the `prefetchOrder` / `useOrder` `authKind` mismatch (own PR).
2. Decide on `@viu/emporix-sdk-next` — worth it at two or more Next storefronts,
   otherwise a `docs/nextjs.md` with snippets. Needs the Emporix webhook
   signature scheme checked first (`docs/webhook.md` documents `secretKey` as
   write-only but not the header scheme).
3. Update `examples/next-app-router` to consume `createServerStorage` and drop
   its duplicated cookie-name literals and its second module-scope
   `EmporixClient`.
