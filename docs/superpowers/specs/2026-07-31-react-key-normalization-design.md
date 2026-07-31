# React Query-Key Normalization — Design

**Date:** 2026-07-31
**Package:** `@viu/emporix-sdk-react` (minor, 2.25.0 → 2.26.0)
**Also in scope:** two repo-hygiene items, no package effect

## Goal

Bring the last two read hooks that build query keys by hand onto `emporixKey`, and
fix the one place where a server-side prefetch key cannot match the hook it feeds.
Both were found and documented during the `@viu/emporix-sdk-next` work and
deliberately deferred, because they change cache keys.

## Correcting the framing this was deferred under

The deferral note said *both* items invalidate consumer caches. That is wrong for
the second one, and the difference matters for how loudly the changeset warns.

| Change | Invalidates consumer caches? |
|---|---|
| `useAvailability` / `useAvailabilities` key shape | **Yes** — every cached availability entry is orphaned |
| `prefetchOrder` `authKind` | **No** — with `auth.customer(token)` the key is already identical today. Only `auth.raw(jwt)` differs, and that path is broken, not merely different. Fixing it orphans nothing. |

## Part 1 — Availability hooks onto `emporixKey`

### Why they never fit the pattern

Both hooks take their discriminators **explicitly** rather than from ambient
context:

- `siteCode` is a positional argument, not `useReadSite()`
- `customerToken` is an option, not the token in storage

So neither `site: "full"` (which reads the ambient site) nor a bare
`mode: "read-auth"` (which reads stored token) applies directly.

### The change

`mode: "read-auth"` with an **always-supplied** `authOverride`, `site: "none"`,
and `siteCode` moved into the positional `args`.

```ts
// before — hand-built, no authKind, a boolean `anon` instead
["emporix", "availability", { tenant, productId, siteCode, anon, defaultAvailableOnNotFound }]

// after
["emporix", "availability", productId, siteCode, defaultAvailableOnNotFound, { tenant, authKind }]
```

and for the batch hook:

```ts
["emporix", "availabilities", productIds, siteCode, defaultAvailableOnNotFound, { tenant, authKind }]
```

`productIds` stays an array inside the key; React Query hashes structurally, so a
fresh array literal per render is not a problem.

### The load-bearing detail: `authOverride` is always set

```ts
authOverride: options.customerToken
  ? auth.customer(options.customerToken)
  : auth.anonymous(),
```

Omitting it when `customerToken` is absent would let `read-auth` fall back to the
**stored** token. A logged-in shopper would then start receiving personalized
availability where today the hook always reads anonymously. That is a behaviour
change, not a key normalization, and it is explicitly out of scope. Always
passing the override preserves today's semantics exactly; only the key shape
moves.

A test asserts this directly: with a customer token in storage and no
`customerToken` option, the resolved `authKind` stays `anonymous`.

### `defaultAvailableOnNotFound` stays in the key

It changes the response — products with no stock record come back
`{ available: true }` instead of `{ available: false }`. Two callers with
different values must not share a cache entry.

### What is deliberately not changed

`siteCode` does **not** move into the `site: "full"` meta slot. That slot carries
the *ambient* site from `useReadSite()`; putting an explicit argument there would
misrepresent where the value comes from and would collide with the ambient site if
a provider bound one.

## Part 2 — `prefetchEmporix` gains `mode`

`useOrder` runs with `mode: "customer"`, where `useEmporixQuery` keys `authKind`
as `"customer"` / `"anonymous"` rather than from `ctx.kind`. `prefetchOrder` keys
`authCtx.kind`, so `auth.raw(jwt)` produces `"raw"` against the hook's
`"customer"` — a silent cache miss.

```ts
export interface PrefetchEmporixOpts<T, TArgs extends readonly unknown[]> {
  // … existing fields …
  /**
   * Mirrors `useEmporixQuery`'s mode. `"customer"` keys `authKind: "customer"`
   * regardless of the context kind, matching a customer-gated hook. Default
   * `"read-auth"`, which keys `auth.kind`.
   */
  mode?: "read-auth" | "customer";
}
```

`prefetchOrder` passes `mode: "customer"`.

A `mode` option rather than a free `authKind` string: it reuses vocabulary that
already exists in this codebase, and it cannot be filled with an arbitrary value
that silently produces a key nothing reads.

## Part 3 — what this unlocks

The availability hooks become prefetchable, so three things converge:

1. The pitfall at `docs/react.md:740` — *«`useAvailability` / `useAvailabilities`
   cannot be prefetched»* — is removed.
2. The descriptor table in `docs/react.md` grows from 10 to 12 rows.
3. `tests/prefetch-parity.test.tsx` grows from 10 to 12 rows, so the two new
   descriptors are machine-checked like the rest.

The new descriptors:

| Hook | `resource` | `args` | `site` | `mode` |
|---|---|---|---|---|
| `useAvailability` | `availability` | `[productId, siteCode, defaultAvailableOnNotFound]` | `none` | read-auth |
| `useAvailabilities` | `availabilities` | `[productIds, siteCode, defaultAvailableOnNotFound]` | `none` | read-auth |

The `useOrder` row also gains `mode: "customer"` in the table, since a caller
prefetching it needs to know.

## Part 4 — repo hygiene, no package effect

Separate commits so a reviewer can accept or reject them independently of the
cache-key change.

1. `.gitignore` gains `.claude/settings.local.json`. Claude Code's convention is
   that `settings.json` is shared and `settings.local.json` is personal; the entry
   is missing, which is why `pnpm publish` refused on an unclean tree during the
   0.1.0 bootstrap.
2. `examples/next-app-router/tsconfig.tsbuildinfo` leaves version control —
   `git rm --cached` plus a `.gitignore` entry. It is a TypeScript build artifact
   and was showing up dirty in every status check.
3. `packages/next/CHANGELOG.md` gains two lines recording that 0.1.0 was a manual
   bootstrap publish (needed because npm trusted publishing is configured
   per-package and cannot be set up for a package that does not exist yet) and
   that 0.2.0 is the first pipeline release. Without this, `0.2.0 — Initial
   release` with no 0.1.0 entry reads as a mistake.

## Release mechanics, so the version jump is not a surprise

`.changeset/config.json` links `@viu/emporix-sdk` with `@viu/emporix-sdk-react`.
A react-only minor therefore also bumps `@viu/emporix-sdk` from 2.25.0 to 2.26.0,
with nothing in its changelog beyond dependency updates. That is how the last
release behaved too (sdk went 2.23.0 → 2.25.0 to match react), so it is expected,
not a defect.

One changeset, minor on `@viu/emporix-sdk-react`, stating plainly that
availability cache entries are orphaned and that the `prefetchOrder` fix is not.

## Verification

| Test | Asserts |
|---|---|
| `tests/use-availability.test.tsx` (existing, 2 tests) | **must pass unedited** — it tests behaviour, not keys |
| `tests/use-availabilities.test.tsx` (existing, 2 tests) | **must pass unedited**, same reason |
| `tests/prefetch-parity.test.tsx` | 12 rows instead of 10; the two new descriptors reproduce the hooks' real keys |
| new case in `tests/use-availability.test.tsx` | a stored customer token does **not** change the resolved `authKind` |
| new case in `tests/ssr.test.tsx` | `prefetchOrder` with `auth.raw(jwt)` produces the key `useOrder` reads |

Verified before writing this spec: **no test asserts the old availability key
shape** — zero matches for `anon:` anywhere in `packages/react/tests/`. So the two
existing availability test files genuinely serve as the behaviour-neutrality net;
if either needs editing, something beyond the key changed.

Full gates: `pnpm -r test`, `pnpm typecheck`, `pnpm lint`,
`pnpm -F @viu/emporix-sdk-react check:dist`.

## Follow-ups not in scope

1. Middleware for site/locale detection in `@viu/emporix-sdk-next` — still
   deferred, still nobody asking. In Next 16 it would be `proxy.ts` exporting
   `proxy`, Node runtime only.
2. `docs/nextjs.md` with the `images.remotePatterns` entry for `next/image`.
3. Share the eight storage-key literals between `storage/cookie-core.ts` and
   `storage/web-storage.ts`.
4. `@viu/emporix-mixins` has no `publishConfig.provenance` setting and therefore
   publishes without provenance, unlike sdk, react and next. Pre-existing; a
   one-line fix if it is not deliberate.
