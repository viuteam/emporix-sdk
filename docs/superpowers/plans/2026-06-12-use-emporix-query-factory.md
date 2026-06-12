# `useEmporixQuery` Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the repeated auth/site/key/defaults preamble across the standard `useQuery` read hooks by extracting one internal `useEmporixQuery` factory, behavior-preservingly.

**Architecture:** New internal hook `useEmporixQuery` resolves auth (one `useCustomerToken` read), site, assembles the `emporixKey`, computes `enabled`, and returns `useQuery`. Each standard read hook is rewritten to call it with a small config. Query keys, `enabled`, and `staleTime` are byte-identical — the existing per-hook test suites are the regression net and must stay green with zero edits.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), React 18/19, TanStack Query v5, Vitest + MSW + @testing-library/react (jsdom), Changesets.

**Branch & PR:** Work on `refactor/use-emporix-query-factory` (already created from `main`; this plan is committed there). One PR against `main`. Commitlint: scope from allowlist (`react`, `docs`, `repo`), first word after scope a lowercase verb. Pre-commit runs lint + typecheck.

**Spec:** `docs/superpowers/specs/2026-06-12-use-emporix-query-factory-design.md`.

**Pre-verified facts (don't re-derive):**
- `emporixKey(resource, args, { tenant, authKind, siteCode?, language? })` (`hooks/internal/query-keys.ts`) drops only `undefined` fields, keeps `null`. So `site: "full"` ⇒ pass `{ siteCode, language }`; `"language"` ⇒ `{ language }`; `"none"` ⇒ pass neither.
- `useReadAuth(override)` returns `{ ctx }` = override, else `token ? auth.customer(token) : auth.anonymous()`; it already reads the token via `useCustomerToken()` (`hooks/internal/use-read-auth.ts`).
- `useReadSite()` returns `{ siteCode: string|null, language: string|null }` (`hooks/internal/use-read-site.ts`).
- `useCustomerToken()` is the reactive `useSyncExternalStore` token read (`hooks/internal/use-storage-snapshot.ts`).
- Two auth shapes among the standard hooks: **read-auth** (`const { ctx } = useReadAuth(opts.auth)`, `authKind = ctx.kind`, always enabled re: auth) and **customer-gated** (`const token = useCustomerToken()`, `authKind = token ? "customer" : "anonymous"`, `enabled` requires `token !== null`).
- Infinite hooks use `useEmporixInfinite` (`hooks/internal/use-emporix-infinite.ts`), NOT `useQuery` — OUT of scope.

---

## Task 1: The `useEmporixQuery` factory + tests

**Files:**
- Create: `packages/react/src/hooks/internal/use-emporix-query.ts`
- Create: `packages/react/tests/use-emporix-query.test.tsx`

### 1.1 Write the failing tests

- [ ] **Step 1:** Create `packages/react/tests/use-emporix-query.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useEmporixQuery } from "../src/hooks/internal/use-emporix-query";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/thing/acme/things/t1", () => HttpResponse.json({ id: "t1" })),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        {children}
      </EmporixProvider>
    ),
  };
}

describe("useEmporixQuery", () => {
  it("read-auth mode: keys authKind from resolved context, enabled without a token", async () => {
    const { wrapper, queryClient } = wrap();
    const { result } = renderHook(
      () =>
        useEmporixQuery({
          mode: "read-auth", site: "full", resource: "thing", args: ["t1"],
          queryFn: () => Promise.resolve({ id: "t1" }),
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const key = queryClient.getQueryCache().getAll()[0]!.queryKey;
    expect(key).toEqual(["emporix", "thing", "t1", { tenant: "acme", authKind: "anonymous", siteCode: null, language: null }]);
  });

  it("customer mode: disabled without a token, re-enables reactively on login, keys authKind", async () => {
    const storage = createMemoryStorage();
    const { wrapper, queryClient } = wrap(storage);
    let calls = 0;
    const { result } = renderHook(
      () =>
        useEmporixQuery({
          mode: "customer", site: "none", resource: "mine", args: [],
          queryFn: () => { calls += 1; return Promise.resolve(["x"]); },
        }),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(calls).toBe(0);
    act(() => storage.setCustomerToken("cust"));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toBe(1);
    const key = queryClient.getQueryCache().getAll().at(-1)!.queryKey;
    expect(key).toEqual(["emporix", "mine", { tenant: "acme", authKind: "customer" }]);
  });

  it("site fields: 'language' carries only language; 'none' carries neither", async () => {
    const { wrapper, queryClient } = wrap();
    renderHook(
      () =>
        useEmporixQuery({
          mode: "read-auth", site: "language", resource: "ling", args: [1],
          queryFn: () => Promise.resolve(1), enabled: false,
        }),
      { wrapper },
    );
    const key = queryClient.getQueryCache().getAll().find((q) => q.queryKey[1] === "ling")!.queryKey;
    expect(key).toEqual(["emporix", "ling", 1, { tenant: "acme", authKind: "anonymous", language: null }]);
  });

  it("honours an authOverride in read-auth mode", async () => {
    const { wrapper, queryClient } = wrap();
    const { auth } = await import("@viu/emporix-sdk");
    renderHook(
      () =>
        useEmporixQuery({
          mode: "read-auth", site: "none", resource: "ov", args: [],
          authOverride: auth.customer("forced"),
          queryFn: () => Promise.resolve(1), enabled: false,
        }),
      { wrapper },
    );
    const key = queryClient.getQueryCache().getAll().find((q) => q.queryKey[1] === "ov")!.queryKey;
    expect(key).toEqual(["emporix", "ov", { tenant: "acme", authKind: "customer" }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — module doesn't exist. `pnpm -F @viu/emporix-sdk-react test -- use-emporix-query` → FAIL (transform/import error).

### 1.2 Implement the factory

- [ ] **Step 3:** Create `packages/react/src/hooks/internal/use-emporix-query.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext } from "@viu/emporix-sdk";
import { useEmporix } from "../../provider";
import { useReadSite } from "./use-read-site";
import { useCustomerToken } from "./use-storage-snapshot";
import { emporixKey } from "./query-keys";

/** Which site discriminators go into the query key's meta object. */
type SiteFields = "full" | "language" | "none";

interface BaseQuery<T, TArgs extends readonly unknown[]> {
  resource: string;
  args: TArgs;
  site: SiteFields;
  /** Receives the resolved auth context. */
  queryFn: (ctx: AuthContext) => Promise<T>;
  staleTime?: number;
  /** ANDed with the internal gates (customer-gated requires a token). */
  enabled?: boolean;
}

/** Anonymous-or-customer read (customer if a token is stored, else anonymous). */
interface ReadAuthQuery<T, TArgs extends readonly unknown[]> extends BaseQuery<T, TArgs> {
  mode: "read-auth";
  /** Per-call override (the hook's `QueryOpts.auth`). */
  authOverride?: AuthContext;
}

/** Customer-only read: keyed customer/anonymous, enabled only with a token. */
interface CustomerGatedQuery<T, TArgs extends readonly unknown[]> extends BaseQuery<T, TArgs> {
  mode: "customer";
}

/**
 * Internal read-hook factory. Encapsulates the auth + site + key + default-
 * options scaffolding repeated across the standard read hooks. Behavior is
 * identical to the hand-rolled `useQuery` it replaces: same query key, same
 * `enabled`, same `staleTime`.
 *
 * Calls a fixed, unconditional set of hooks every render (Rules of Hooks);
 * a single `useCustomerToken()` read serves both modes.
 */
export function useEmporixQuery<T, TArgs extends readonly unknown[]>(
  cfg: ReadAuthQuery<T, TArgs> | CustomerGatedQuery<T, TArgs>,
): UseQueryResult<T> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { siteCode, language } = useReadSite();

  const authOverride = cfg.mode === "read-auth" ? cfg.authOverride : undefined;
  const readCtx: AuthContext =
    authOverride ?? (token ? auth.customer(token) : auth.anonymous());

  const authKind =
    cfg.mode === "customer" ? (token ? "customer" : "anonymous") : readCtx.kind;
  // Customer mode only reaches queryFn when enabled (token present).
  const resolvedCtx: AuthContext =
    cfg.mode === "customer" ? auth.customer(token as string) : readCtx;

  const siteMeta =
    cfg.site === "full"
      ? { siteCode, language }
      : cfg.site === "language"
        ? { language }
        : {};

  const enabled =
    (cfg.enabled ?? true) && (cfg.mode === "customer" ? token !== null : true);

  return useQuery({
    queryKey: emporixKey(cfg.resource, cfg.args, {
      tenant: client.tenant,
      authKind,
      ...siteMeta,
    }),
    queryFn: () => cfg.queryFn(resolvedCtx),
    enabled,
    ...(cfg.staleTime !== undefined ? { staleTime: cfg.staleTime } : {}),
  });
}
```

- [ ] **Step 4: Run** `pnpm -F @viu/emporix-sdk-react test -- use-emporix-query` → all 4 pass.

- [ ] **Step 5: Commit:**

```bash
git add packages/react/src/hooks/internal/use-emporix-query.ts packages/react/tests/use-emporix-query.test.tsx
git commit -m "feat(react): add internal useEmporixQuery read-hook factory"
```

---

## Task 2: Worked migration — `use-products.ts` (read-auth / site=full)

**Files:** Modify `packages/react/src/hooks/use-products.ts`. Regression net: `packages/react/tests/use-products.test.tsx` (must stay green, **no edits**).

The transformation rule (apply to every migrated hook): the current `queryFn: () => client.X.method(…, ctx)` keeps its body but becomes `queryFn: (ctx) => client.X.method(…, ctx)`; `queryKey`'s `resource`/`args` and the `enabled`/`staleTime` move into the factory config; `mode`/`site` come from the classification table. Drop the now-unused `useReadAuth`/`useReadSite` imports and the `const { ctx } = useReadAuth(...)` / `const { siteCode, language } = useReadSite()` lines. Keep `const { client } = useEmporix()` only where `queryFn` (or other code) still closes over `client`.

- [ ] **Step 1:** Replace each non-infinite hook in `use-products.ts`. `useProduct` becomes:

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

Apply the same shape to `useProducts` (`resource: "products"`, `args: [params]`, `queryFn: (ctx) => client.products.list(params, ctx)`), `useProductByCode` (`resource: "product-by-code"`, `args: [code]`, `enabled: typeof code === "string" && code !== ""`, `queryFn: (ctx) => client.products.getByCode(code, ctx)` — keep the file's exact current `queryFn` call), `useProductSearch` (`resource: "product-search"`, `args: [query, params]`, `enabled: typeof query === "string" && query.trim() !== ""`), `useProductNameSearch` (`resource: "product-name-search"`, `args: [term, params]`, `enabled: typeof term === "string" && term.trim() !== ""`), and `useProductsByCodes` (`resource: "products-by-codes"`, `args: [codes, options.chunkSize]`, `enabled: codes.length > 0`, `staleTime: 30_000`). For each, copy the file's existing `queryFn` body verbatim, changing `() =>` to `(ctx) =>`. **Leave `useProductsInfinite` untouched** (uses `useEmporixInfinite`).

- [ ] **Step 2:** Add the import `import { useEmporixQuery } from "./internal/use-emporix-query";`. Remove `useReadAuth`/`useReadSite` imports **only if** no remaining hook in the file uses them (the infinite hook still does — keep them). Remove the now-unused `QueryOpts`? No — `QueryOpts` is still the option type; keep it.

- [ ] **Step 3: Run** `pnpm -F @viu/emporix-sdk-react test -- use-products` → green, **unchanged assertions**. Then `pnpm typecheck` → clean.

- [ ] **Step 4: Commit:**

```bash
git add packages/react/src/hooks/use-products.ts
git commit -m "refactor(react): migrate product read hooks to useEmporixQuery"
```

---

## Task 3: Worked migration — customer-gated (`use-company.ts`, `use-order.ts`)

**Files:** Modify `use-company.ts`, `use-order.ts`. Regression nets: `use-my-companies.test.tsx`, `use-order.test.tsx`, etc. (no edits).

- [ ] **Step 1:** `useCompany` (customer-gated, no site) becomes:

```ts
export function useCompany(legalEntityId: string | undefined): UseQueryResult<LegalEntity> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "companies", args: [legalEntityId ?? null],
    enabled: legalEntityId !== undefined,
    queryFn: (ctx) => client.companies.get(legalEntityId as string, ctx),
  });
}
```

Note: the original `enabled` is `token !== null && legalEntityId !== undefined`; the factory adds the `token !== null` gate for `mode: "customer"`, so the hook only passes the **extra** condition `legalEntityId !== undefined`. The original `queryFn` used `auth.customer(token as string)` — that is exactly the `ctx` the factory passes in customer mode. Drop the `useCustomerToken` import/line.

- [ ] **Step 2:** `useOrder` (customer-gated, site=language) becomes:

```ts
export function useOrder(orderId: string | undefined, options: UseOrderOptions = {}): UseQueryResult<Order> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "language", resource: "orders", args: [orderId ?? null],
    enabled: orderId !== undefined,
    queryFn: (ctx) =>
      client.orders.get(orderId as string, ctx, options.saasToken ? { saasToken: options.saasToken } : {}),
  });
}
```

(The original keyed `{ tenant, authKind, language }` — `site: "language"` reproduces it. `auth.customer(token)` → `ctx`.)

- [ ] **Step 3: Run** `pnpm -F @viu/emporix-sdk-react test -- use-my-companies use-order` → green unchanged. `pnpm typecheck` clean.

- [ ] **Step 4: Commit:**

```bash
git add packages/react/src/hooks/use-company.ts packages/react/src/hooks/use-order.ts
git commit -m "refactor(react): migrate company + order read hooks to useEmporixQuery"
```

---

## Task 4: Migrate the remaining standard hooks (classification table)

Apply the **same transformation rule** (Task 2 header) to every hook below. For each, `resource`/`args`/`queryFn`/`staleTime`/`enabled` are copied verbatim from the file's current `useQuery`; only `mode` and `site` are stated here. Infinite hooks in these files stay untouched. After each file, run that file's test (`pnpm -F @viu/emporix-sdk-react test -- <name>`) — it must stay green with **no edits**.

**read-auth, site=full** (siteCode + language):
- `use-categories.ts`: `useCategory`, `useSubcategories`, `useCategories`, `useCategoryTree`, `useProductsInCategory`. (NOT `useCategoriesInfinite`, `useProductsInCategoryInfinite`.)
- `use-cart.ts`: `useCart` — `args: [storedCartId/resolvedId ?? null, activeCompany?.id ?? null]`; the hook keeps its `useCartId()` + `useActiveCompany()` calls before the factory and passes their results into `args`. `enabled: resolvedId !== undefined`. Keep `useReadSite`/`useReadAuth` removal scoped to `useCart` only (the file's mutation hooks are untouched).
- `use-variant-children.ts`: the `useVariantChildren` read (verify it keys `{tenant,authKind,siteCode,language}`; if so, `site: "full"`).

**read-auth, site=none** (no site meta):
- `use-approvals.ts`: both reads — `resource: "approvals"`, `args: [opts.query ?? null]` and `[approvalId ?? null]`, `enabled: Boolean(approvalId)` on the single read, `staleTime: STALE`.
- `use-returns.ts`: both reads — `resource: "returns"`, args + `enabled: Boolean(returnId)` likewise.
- `use-sales-order.ts`: the read keying `emporixKey("orders", [orderId], { tenant, authKind: ctx.kind })` → `mode: "read-auth", site: "none"`.

**customer-gated, site=none:**
- `use-my-companies.ts` (`useMyCompanies`: `resource: "companies"`, `args: ["mine"]`, no extra enabled), `use-company-groups.ts`, `use-company-locations.ts`, `use-company-contacts.ts` (each `args: ["groups"|"locations"|"contacts", legalEntityId ?? null]`, `enabled: legalEntityId !== undefined`).

**customer-gated, site=language:**
- `use-my-orders.ts` (`useMyOrders`: `resource: "orders"`, `args: ["mine", effectiveLE ?? null, status ?? null, pageNumber ?? 1, pageSize ?? null]`, no extra enabled beyond token). (NOT `useMyOrdersInfinite`.)

- [ ] **Step 1:** Migrate the files above, one logical group per edit pass. Add the `useEmporixQuery` import to each; remove now-unused `useReadAuth`/`useReadSite`/`useCustomerToken` imports per file (only if no remaining hook in that file uses them).

- [ ] **Step 2: Run after each file** `pnpm -F @viu/emporix-sdk-react test -- <file-stem>` → green, assertions unchanged.

- [ ] **Step 3:** Full suite `pnpm -F @viu/emporix-sdk-react test` → all green; `pnpm typecheck` → clean.

- [ ] **Step 4: Commit** (may split per group):

```bash
git add packages/react/src/hooks/use-categories.ts packages/react/src/hooks/use-cart.ts packages/react/src/hooks/use-variant-children.ts packages/react/src/hooks/use-approvals.ts packages/react/src/hooks/use-returns.ts packages/react/src/hooks/use-sales-order.ts packages/react/src/hooks/use-my-companies.ts packages/react/src/hooks/use-company-groups.ts packages/react/src/hooks/use-company-locations.ts packages/react/src/hooks/use-company-contacts.ts packages/react/src/hooks/use-my-orders.ts
git commit -m "refactor(react): migrate remaining standard read hooks to useEmporixQuery"
```

### Explicit exclusions (do NOT migrate — document only)

These do not fit the standard pattern; leaving them is correct, not an omission:
- **All `useEmporixInfinite` hooks** — not `useQuery`.
- **`use-my-segments.ts`** — bespoke literal `["emporix","segment",…]` keys, not `emporixKey`.
- **`useCustomerSession.meQuery`** — bespoke literal key.
- **`use-customer-addresses.ts`** — bespoke `ADDRESSES_KEY` constant.
- **`usePaymentModes` (`use-checkout.ts`)** — hard-codes `authKind: "customer"`, keys `siteCode` only (no language), and folds `useActiveCompany()` into the key. Non-standard meta + auth.
- **`useAvailability*` (`use-availability.ts`)** — site-only meta + `Boolean(siteCode)`-gated enabled.
- **`useMatchPrices` (`use-prices.ts`)** — uses context-auth (`requireContextAuth`), not the read-auth/customer pattern.
- **`useCloudFunction` (`use-cloud-functions.ts`)** — bespoke override-as-primary auth; leave as-is.
- **`use-reward-points.ts`, `use-shopping-lists.ts`, `use-sites.ts`** — verify against the criteria during execution; migrate only those that match read-auth/customer + site∈{full,language,none} with no hard-coded `authKind` and no extra in-key hook deps. If a hook needs a knob the factory lacks, leave it and note why in the commit body.

---

## Task 5: Changeset, final verification, PR

- [ ] **Step 1:** Create `.changeset/use-emporix-query-factory.md`:

```md
---
"@viu/emporix-sdk-react": patch
---

internal refactor: the standard read hooks now share a single `useEmporixQuery` factory that encapsulates auth-context resolution, site discriminators, query-key assembly, and default options. No observable behavior or API change — query keys, `enabled` gates, and `staleTime` values are identical; the existing hook test suites pass unchanged.
```

- [ ] **Step 2: Verify:** `pnpm -F @viu/emporix-sdk-react test` (all green, +4 factory tests), `pnpm -r build`, `pnpm typecheck` (clean), `pnpm -F @viu/emporix-sdk-react check:dist` (banners OK). Confirm **no existing test file was edited** (`git diff --name-only main..HEAD -- 'packages/react/tests/*'` should list only the new `use-emporix-query.test.tsx`).

- [ ] **Step 3: Commit + push:**

```bash
git add .changeset/use-emporix-query-factory.md
git commit -m "docs(repo): add changeset for useEmporixQuery factory"
git push -u origin refactor/use-emporix-query-factory
```

KNOWN ISSUE: the sandbox has no SSH identity — if push fails with `Permission denied (publickey)`, STOP and hand `! git push -u origin refactor/use-emporix-query-factory` to the user; do not retry.

- [ ] **Step 4: PR** against `main`, title `refactor(react): extract useEmporixQuery read-hook factory`, body summarizing the DRY win + the "zero test edits = behavior preserved" guarantee + the explicit exclusions. End with the Claude Code attribution line.

---

## Self-review notes (done at plan time)

- **Spec coverage:** factory design (spec §Design) → Task 1; two-mode coverage → Tasks 2+3 worked examples; full migration scope (spec §Scope) → Task 4 table; non-goals/exclusions (spec §Non-goals) → Task 4 exclusion list; testing strategy (spec §Testing) → factory tests in Task 1 + the "existing tests unchanged" gate in every migration task + the `git diff` check in Task 5; patch release → Task 5. ✓
- **Behavior-preservation is the contract:** every migration task's gate is "the existing test suite stays green with zero edits." The Task-5 `git diff --name-only` check enforces that no test assertion was weakened to make a migration pass.
- **Rules of Hooks:** the factory calls a fixed hook set unconditionally (`useEmporix`, `useCustomerToken`, `useReadSite`) and branches only with plain logic on the render-stable `mode` literal — no conditional hook calls. ✓
- **Type consistency:** `useEmporixQuery` signature in Task 1 is consumed with matching `mode`/`site`/`resource`/`args`/`queryFn`/`enabled`/`staleTime`/`authOverride` fields in Tasks 2–4. `auth.customer`/`auth.anonymous` and `emporixKey` are existing exports. ✓
- **Known execution risks flagged inline:** files needing per-hook verification (`use-variant-children`, `use-reward-points`, `use-shopping-lists`, `use-sites`) are called out in Task 4 with the apply-the-criteria-or-skip rule; the exclusion list documents every hook deliberately left behind.
