# `useEmporixQuery` — internal read-hook factory (Roadmap row 8)

## Problem

Roadmap row 8 from the 2026-06-11 enterprise review (§4, *Refactoring & Komplexitätsreduktion*). The single largest DRY violation in `packages/react` is the read-hook preamble: ~26 hook files build a `useQuery` the same way — destructure `useEmporix()`, resolve auth via `useReadAuth()`, resolve site via `useReadSite()`, assemble the key with `emporixKey(resource, args, { tenant, authKind, siteCode?, language? })`, then call `useQuery({ queryKey, queryFn, enabled, staleTime })`. Each hook repeats ~6–10 lines of identical scaffolding; the meaningful part of most hooks is one `queryFn` line.

This is purely a maintainability concern (🟢, no production blocker): a key-shape change today means editing ~26 files; the scaffolding obscures each hook's actual intent.

## Goal

Introduce one internal factory, `useEmporixQuery`, that encapsulates the auth + site + key + default-options scaffolding, and migrate the read hooks that follow the standard `emporixKey` pattern onto it. **Strictly behavior-preserving** — identical query keys, identical `enabled` logic, identical `staleTime`. No public API change. No test may change its expectations.

## Non-goals

- **No bespoke-key hooks.** `use-my-segments` (literal `["emporix","segment",…]` keys), `useCustomerSession.meQuery` (literal key), and `use-customer-addresses` (`ADDRESSES_KEY` constant) do **not** use `emporixKey` and stay untouched.
- **No infinite-query change.** Infinite hooks already share `useEmporixInfinite`; out of scope.
- **No mutation change.** Only read (`useQuery`) hooks.
- **No other §4 cleanup.** Scope is deliberately the one high-value factory (decided in brainstorming).

## Two auth patterns the factory must cover

Inspection of the current hooks shows exactly two auth shapes, both keyed through `emporixKey`:

1. **Read-auth (`anonymous`-or-`customer`):** `const { ctx } = useReadAuth(override)`. `authKind = ctx.kind`. Query is enabled regardless of auth. `queryFn(ctx)`. Examples: `useProduct`, `useProducts`, `useCategory(ies)`, `useCart`, `useCloudFunction`, `useSites`, `useSalesOrder`, `useApprovals`, …

2. **Customer-gated:** `const token = useCustomerToken()`. `authKind = token ? "customer" : "anonymous"`. `enabled` requires `token !== null` (often ANDed with an id/option gate). `queryFn(auth.customer(token))`. Examples: `useMyCompanies`, `useCompany`, `useCompanyGroups`, `useCompanyLocations`, `useMyOrders`, `useOrder`, `usePaymentModes`, …

The factory accepts a discriminated config so each call site states only what differs.

## Design

New file `packages/react/src/hooks/internal/use-emporix-query.ts`:

```ts
type SiteFields = "full" | "language" | "none";
// "full"     → meta carries { siteCode, language }   (site-aware reads: products, cart, …)
// "language" → meta carries { language } only          (orders read)
// "none"     → meta carries neither                    (companies, payment-modes, …)

interface ReadAuthQuery<T, TArgs extends readonly unknown[]> {
  mode: "read-auth";
  resource: string;
  args: TArgs;
  site: SiteFields;
  queryFn: (ctx: AuthContext) => Promise<T>;
  authOverride?: AuthContext;       // from QueryOpts.auth
  staleTime?: number;
  enabled?: boolean;                // ANDed with internal gates (default true)
}

interface CustomerGatedQuery<T, TArgs extends readonly unknown[]> {
  mode: "customer";
  resource: string;
  args: TArgs;
  site: SiteFields;
  queryFn: (ctx: AuthContext) => Promise<T>;  // ctx is auth.customer(token)
  staleTime?: number;
  enabled?: boolean;                // ANDed with `token !== null`
}

export function useEmporixQuery<T, TArgs extends readonly unknown[]>(
  cfg: ReadAuthQuery<T, TArgs> | CustomerGatedQuery<T, TArgs>,
): UseQueryResult<T>;
```

Internally the factory calls a **fixed, unconditional set of hooks every render** (Rules of Hooks — never branch on `mode` around a hook call). One token read serves both modes:
- `const { client } = useEmporix();`
- `const token = useCustomerToken();` — the single reactive token source.
- `const readCtx = cfg.authOverride ?? (token ? auth.customer(token) : auth.anonymous());` — inlines `useReadAuth`'s exact logic (no second subscription).
- `const site = useReadSite();`

Then it *selects* with plain (non-hook) logic on the render-stable `mode` literal:
- `authKind` = `mode === "customer" ? (token ? "customer" : "anonymous") : readCtx.kind`.
- `resolvedCtx` = `mode === "customer" ? auth.customer(token!) : readCtx` (customer mode only reaches `queryFn` when `enabled`, so `token` is non-null there).
- `siteMeta` from `site` per the `site` setting (`{siteCode,language}` / `{language}` / `{}`).
- `queryKey` = `emporixKey(resource, args, { tenant: client.tenant, authKind, ...siteMeta })` — byte-identical to today.
- `enabled` = `(cfg.enabled ?? true) && (mode === "customer" ? token !== null : true)`.
- returns `useQuery({ queryKey, queryFn: () => cfg.queryFn(resolvedCtx), enabled, ...(cfg.staleTime !== undefined ? { staleTime: cfg.staleTime } : {}) })`.

No hook is ever conditionally called, so hook order is identical across renders regardless of `mode`. (Note: the factory calls `useEmporix()` itself, so a migrated hook only keeps its own `useEmporix()` where its `queryFn` closes over `client`.)

### Example migration (`useProduct`)

Before (10 lines):
```ts
export function useProduct(productId: string, options: QueryOpts = {}): UseQueryResult<Product> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode, language } = useReadSite();
  return useQuery({
    queryKey: emporixKey("product", [productId], { tenant: client.tenant, authKind: ctx.kind, siteCode, language }),
    queryFn: () => client.products.get(productId, undefined, ctx),
    staleTime: PRODUCTS_STALE_TIME,
  });
}
```

After (3 lines of intent):
```ts
export function useProduct(productId: string, options: QueryOpts = {}): UseQueryResult<Product> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "product", args: [productId],
    ...(options.auth ? { authOverride: options.auth } : {}),
    queryFn: (ctx) => client.products.get(productId, undefined, ctx),
    staleTime: PRODUCTS_STALE_TIME,
  });
}
```

(`client` is still needed for `client.tenant` inside the factory and for `queryFn`; the factory takes `client` from `useEmporix()` itself, so the hook only keeps `client` where its `queryFn` closes over it.)

## Scope of migration

All read hooks that key through `emporixKey` (~26 files; final list enumerated in the implementation plan), classified into the two modes above. Hooks that don't fit (bespoke keys, infinite, mutations) are left exactly as-is.

## Error handling

No change. The factory adds no error paths; `queryFn` rejections propagate to React Query exactly as today.

## Testing strategy

- **Regression net:** the existing per-hook test suites (`packages/react/tests/*.test.tsx`) are the contract. Every one must stay green with **zero edits** — that is the proof the refactor is behavior-preserving (same keys, same `enabled`, same `staleTime`).
- **New focused test** for the factory itself (`use-emporix-query.test.tsx`): asserts (a) `read-auth` mode keys with `authKind` from the resolved context and stays enabled without a token; (b) `customer` mode keys `authKind: "customer"` and gates `enabled` on the reactive token (re-enables on login, via `useCustomerToken`); (c) the three `site` settings produce the exact meta shapes (`{siteCode,language}` / `{language}` / `{}`).
- Full suite (`pnpm -F @viu/emporix-sdk-react test`) green; `pnpm typecheck` clean.

## Release

`@viu/emporix-sdk-react` **patch** — internal refactor, no observable behavior or API change. One changeset.

## Branch & PR

Branch `refactor/use-emporix-query-factory` (from `main`). Standalone PR, independent of the row-9 client-factory work.
