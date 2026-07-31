# Migrating `examples/next-app-router` onto `@viu/emporix-sdk-next` — Design

**Date:** 2026-07-31
**Packages touched:** `@viu/emporix-sdk-next` (one additive option), `@viu/emporix-examples-next-app-router` (private)
**Timing:** must land **before** the release PR [#183](https://github.com/viuteam/emporix-sdk/pull/183) merges

## Goal

Migrate the four server-side files of `examples/next-app-router` onto
`@viu/emporix-sdk-next`, and treat that migration as the acceptance test for
whether the package's surface is actually usable.

## Why now, specifically

`@viu/emporix-sdk-next@0.1.0` is **not yet on npm** — the changesets release PR
#183 is open and `.changeset/emporix-sdk-next-initial.md` is still unconsumed on
`main`.

That makes any API gap the migration exposes free to fix: it becomes part of
0.1.0's surface rather than a follow-up minor with a migration note. After #183
merges, the same correction costs a version bump and a changelog entry that
consumers have to read. This is the entire argument for doing the migration
first, and it expires when #183 merges.

## What the migration found

Three gaps, discovered by reading the example rather than by assuming it would
drop in cleanly.

### Gap 1 — no backend credentials, and that stays that way

`app/page.tsx` configures `credentials.backend = { clientId, secret }`.
`GetEmporixClientOptions` accepts only `clientId`, which becomes
`credentials.storefront.clientId`. There is no path for a service credential set.

For the call actually made there — `products.list(…, auth.anonymous())` — the
backend credentials are unused, so the migration works. But the gap is real: code
needing a `service` AuthContext server-side (`media.*` requires
`media.asset_read` / `media.asset_manage`) cannot use `getEmporixClient()`.

**Decision: leave it.** A secret does not belong in a memoized convenience
factory where it becomes part of a cache key. This is a boundary, not a defect —
but it is undocumented, which is a defect. The README gains the boundary and
points at `new EmporixClient` + `createTaggingFetch` as the escape hatch.

Side effect of the migration: `app/page.tsx` loses its backend credentials
entirely, because nothing used them. One fewer secret in the example's
environment surface.

### Gap 2 — `context` was missing, and it is being added

`app/product/[id]/page.tsx` binds `credentials.storefront.context = { siteCode }`.
`GetEmporixClientOptions` had no way to express that. Migrating the page naively
would silently drop the binding — and that binding is the point of the page: the
prefetch key must match what the client provider binds, or hydration is a cache
miss instead of a hit.

`currency` and `siteCode` are baseline configuration for any storefront, not a
special case. So:

```ts
export interface GetEmporixClientOptions {
  tenant?: string;
  clientId?: string;
  host?: string;
  tagged?: boolean;
  revalidate?: number;
  /**
   * Bound at anonymous login. Needed for `prices.matchByContext` and for
   * prefetch-key parity with the client-side provider.
   */
  context?: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  };
}
```

Memoization key becomes:

```
`${tenant}|${clientId}|${host ?? ""}|${tagged}|${revalidate}|${JSON.stringify(context ?? {})}`
```

`JSON.stringify` of an object literal is key-order-dependent, which is
acceptable here: two callers writing the same context in a different key order
get two client instances rather than one. That is wasteful, not wrong, and
sorting the keys to avoid it would be optimising a case that does not occur — the
context is written once per app, in one place.

No secret, fully keyable, ~6 lines plus two tests.

### Gap 3 — environment variable names

The example reads `NEXT_PUBLIC_EMPORIX_TENANT` (it must, because
`app/providers.tsx` is a Client Component and reads it in the browser). The
package reads `EMPORIX_TENANT`. The example therefore passes `tenant` and
`clientId` explicitly.

**Decision: no fallback chain in the package.** Accepting both `EMPORIX_TENANT`
and `NEXT_PUBLIC_EMPORIX_TENANT` would be two ways to configure one thing. The
README notes that a Next app usually needs `NEXT_PUBLIC_` for its client side and
will pass the values explicitly.

This also fixes a pre-existing inconsistency: today `app/page.tsx` reads
`EMPORIX_STOREFRONT_CLIENT_ID` while `app/providers.tsx` reads
`NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID` — two variables for one value.

## Migration map

| File | Today | After |
|---|---|---|
| `app/emporix.ts` | — | **new**, ~12 lines: maps this app's `NEXT_PUBLIC_*` names onto `getEmporixClient` |
| `app/layout.tsx` | `(await cookies()).get("emporix.customerToken")?.value` | `const { customerToken } = await emporixSession()` |
| `app/page.tsx` | module-scope client with backend credentials | `emporix()` per request (memoized); backend credentials deleted |
| `app/actions.ts` | module-scope client + hand-written `cookies().set(...)` | `emporix({ tagged: false })` + `emporixSessionMutable()` |
| `app/product/[id]/page.tsx` | module-scope client with `context: { siteCode }` | `emporix()` — context now comes from the shared mapper |

Three module-scope `EmporixClient` instances become zero. `app/emporix.ts`
exists because four files each need the tenant and client id, and repeating
`process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant"` four times is the
duplication this migration removes:

```ts
// app/emporix.ts
import { getEmporixClient, type GetEmporixClientOptions } from "@viu/emporix-sdk-next";
import type { EmporixClient } from "@viu/emporix-sdk";

export const SITE_CODE = "main";

/** Maps this app's NEXT_PUBLIC_* env names onto the package factory. */
export function emporix(opts: GetEmporixClientOptions = {}): EmporixClient {
  return getEmporixClient({
    tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
    clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID ?? "",
    context: { siteCode: SITE_CODE, currency: "CHF" },
    ...opts,
  });
}
```

## Untouched, and that is a finding

`app/providers.tsx`, `app/cart/page.tsx`, `app/checkout/page.tsx`,
`app/guest-checkout/page.tsx` and `app/product/[id]/product-detail.tsx` are all
Client Components and change in no way. The package touches only the server side,
exactly as intended — if the migration had needed to reach into client code, the
boundary would have been wrong.

## Changeset

`.changeset/emporix-sdk-next-initial.md` is **amended**, not supplemented. 0.1.0
has not shipped, so `context` is simply part of its surface. A second changeset
would imply a version that never existed.

Example packages are ignored by changesets
(`.changeset/config.json` → `ignore: ["@viu/emporix-examples-*"]`), so the
example changes need no entry.

## Verification

| Step | Proves |
|---|---|
| `pnpm -F @viu/emporix-sdk-next test` | the two new `context` tests, and that nothing regressed (65 → 67) |
| `pnpm typecheck` | the example compiles against the built `dist/` |
| `pnpm -F @viu/emporix-examples-next-app-router exec next build` | the real acceptance test |

**Honest limitation on the third row.** `next build` is not part of CI —
`pr-check.yml` builds packages only, and the example's `build` script is excluded
from the release gate. It has to be run locally.

Further, `app/page.tsx` performs a real API call during static generation. Run
against the `viu` tenant with valid credentials in an untracked
`examples/next-app-router/.env.local` (`.gitignore` line 7, `.env.*`, verified
with `git check-ignore`), it should complete. Without credentials it will fail in
the generation phase — which is **not** a migration failure. The compile and
typecheck phases of `next build` run first and are the part that validates the
migration. If generation fails for credential reasons, say so rather than
reporting the build as green.

Credentials are passed via the untracked env file only. They are never
hardcoded, never committed, and never printed to the terminal.

## Follow-ups not in scope

1. Middleware for site/locale detection — still deferred, still nobody asking.
2. Key normalization in `@viu/emporix-sdk-react` (availability hooks onto
   `emporixKey`, the `prefetchOrder` / `useOrder` `authKind` mismatch). Both
   invalidate consumer caches; bundle with the next react minor.
3. `docs/nextjs.md` with the `images.remotePatterns` entry for `next/image`.
