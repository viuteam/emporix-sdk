# API-Quota Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce wasted API calls against the Emporix tenant quota by setting sane `QueryClient` defaults, adding per-hook `staleTime` overrides for slow-changing resources, and deduplicating the three call paths that bypass React-Query today (cart bootstrap from `useActiveCart` and login, plus the post-login `/customer/me` double-fetch).

**Architecture:** Provider sets a Balanced default profile (`staleTime: 30s`, `refetchOnWindowFocus: false`, `retry: 1`) on its self-constructed `QueryClient`. Each hook annotates its `useQuery` with a resource-appropriate `staleTime`. A new internal `bootstrapCart` helper wraps `client.carts.getCurrent({create:true})` in `qc.fetchQuery` so all callers share one cache entry. `useCustomerSession.login` reorders its steps so `honourPreferredSite` (now via `qc.fetchQuery` with the `meQuery` key) writes the cache **before** `invalidateQueries` runs — one `GET /customer/me` per login instead of two.

**Tech Stack:** TypeScript, React 18, `@tanstack/react-query` v5, Vitest + MSW.

**Context for the engineer:**
- Spec: `docs/superpowers/specs/2026-05-22-api-quota-reduction-design.md` — read it first.
- Branch: `analysis/api-call-quota-audit` (already created off `main` at `9d9b913`, spec already committed at `3fd1cd5`).
- All work lives in `@viu/emporix-sdk-react`. No SDK changes. No public API removed.
- Existing test count baseline: 156 SDK + 133 React = 289. After this plan: 156 SDK + ≈140 React.
- `EmporixProvider` lives at `packages/react/src/provider.tsx:52-98`. The fallback `QueryClient` is constructed at line 72.
- The `meQuery` key shape is `["emporix", "customer", "me", { tenant, hasToken }]` — replicate exactly so `qc.fetchQuery` from `honourPreferredSite` writes into the same cache entry.
- `useActiveCart`'s bootstrap effect is at `packages/react/src/hooks/use-cart.ts:195-223`. The customer-cart-onboarding helper at `packages/react/src/hooks/use-customer-session.ts:181-217` does the same call. Both switch to `bootstrapCart()`.
- The default `gcTime` (5 min) means our `staleTime: Infinity` bootstrap cache entry evicts naturally on idle — no manual cleanup needed.
- React-Query 5 API: `qc.fetchQuery({ queryKey, queryFn, staleTime })` returns the data promise and writes to the cache. Concurrent calls with the same key are auto-deduped.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/react/src/provider.tsx` | EmporixProvider + QueryClient defaults | Modify (default `defaultOptions.queries`) |
| `packages/react/src/hooks/internal/bootstrap-cart.ts` | Shared cart bootstrap | **CREATE** |
| `packages/react/src/hooks/use-cart.ts` | useCart / useActiveCart | Modify (use `bootstrapCart`) |
| `packages/react/src/hooks/use-customer-session.ts` | login flow | Modify (use `bootstrapCart` + reordered `honourPreferredSite`) |
| `packages/react/src/hooks/use-sites.ts` | useSites, useDefaultSite | Modify (`staleTime: 10 * 60_000`) |
| `packages/react/src/hooks/use-products.ts` | product hooks | Modify (`staleTime: 60_000`) |
| `packages/react/src/hooks/use-categories.ts` | category hooks | Modify (`staleTime: 5 * 60_000`) |
| `packages/react/src/hooks/use-match-prices.ts` | useMatchPrices | Modify (`staleTime: 60_000`) |
| `packages/react/src/hooks/use-my-segments.ts` | segment hooks (7) | Modify (`staleTime: 5 * 60_000`) |
| `packages/react/src/hooks/use-product-media.ts` | useProductMedia | Modify (`staleTime: 5 * 60_000`) |
| `packages/react/src/hooks/use-checkout.ts` | usePaymentModes | Modify (`staleTime: 10 * 60_000`) |
| `packages/react/tests/provider.test.tsx` | provider default tests | **CREATE** (2 tests) |
| `packages/react/tests/use-active-cart.test.tsx` | bootstrap dedup | Add 1 test |
| `packages/react/tests/use-customer-session.test.tsx` | login dedup | Add 1 test |
| `packages/react/tests/use-sites.test.tsx` | staleTime cache-hit | Add 1 test |
| `packages/react/tests/use-match-prices.test.tsx` | staleTime cache-hit | Add 1 test |
| `docs/react.md` | Public docs | Modify (Caching & quota section) |
| `.changeset/api-quota-reduction.md` | Release notes | **CREATE** |

---

## Task 1: QueryClient default options (Balanced profile)

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Create: `packages/react/tests/provider.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/provider.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import type { ReactNode } from "react";

function makeClient() {
  return new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
}

describe("EmporixProvider — QueryClient defaults", () => {
  it("applies Balanced defaults when no queryClient prop is passed", () => {
    const client = makeClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={createMemoryStorage()}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useQueryClient(), { wrapper });
    const defaults = result.current.getDefaultOptions().queries;
    expect(defaults?.staleTime).toBe(30_000);
    expect(defaults?.refetchOnWindowFocus).toBe(false);
    expect(defaults?.retry).toBe(1);
  });

  it("does not override an externally-passed QueryClient", () => {
    const client = makeClient();
    const externalQc = new QueryClient({
      defaultOptions: { queries: { staleTime: 999, refetchOnWindowFocus: true, retry: 5 } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={externalQc}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useQueryClient(), { wrapper });
    const defaults = result.current.getDefaultOptions().queries;
    expect(defaults?.staleTime).toBe(999);
    expect(defaults?.refetchOnWindowFocus).toBe(true);
    expect(defaults?.retry).toBe(5);
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- provider.test`
Expected: FAIL — current provider creates `new QueryClient()` with no defaults, so `staleTime` is undefined (or default 0), `refetchOnWindowFocus` is true (RQ5 default).

- [ ] **Step 3: Apply the Balanced defaults in `provider.tsx`**

Open `packages/react/src/provider.tsx`. Find the line that creates the fallback QueryClient (around line 72):

```ts
const qc = useMemo(() => queryClient ?? new QueryClient(), [queryClient]);
```

Replace with:

```ts
const DEFAULT_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: 1,
} as const;

// (inside EmporixProvider body)
const qc = useMemo(
  () =>
    queryClient ??
    new QueryClient({ defaultOptions: { queries: DEFAULT_QUERY_OPTIONS } }),
  [queryClient],
);
```

Place the `DEFAULT_QUERY_OPTIONS` const at module scope (top of file, after the imports).

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- provider.test`
Expected: PASS for both tests.

- [ ] **Step 5: Run full React test suite for regressions**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: 133 → 135 (or higher) tests passing.

Some existing tests use their own `new QueryClient({ defaultOptions: { queries: { retry: false } } })` — they're unaffected because they pass the QC explicitly.

If any existing test starts failing because it relied on `refetchOnWindowFocus` or 3-retry behavior, that's a real regression — investigate, but it's unlikely (tests typically don't trigger window-focus or retry paths).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/provider.test.tsx
git commit -m "feat(react): apply Balanced QueryClient defaults (staleTime/focus/retry)"
```

---

## Task 2: Create `bootstrapCart` shared helper

**Files:**
- Create: `packages/react/src/hooks/internal/bootstrap-cart.ts`

This helper is **not** tested in isolation — its behavior is exercised through Task 3 (useActiveCart dedup) and Task 4 (login dedup).

- [ ] **Step 1: Create the helper file**

```typescript
// packages/react/src/hooks/internal/bootstrap-cart.ts
import type { QueryClient } from "@tanstack/react-query";
import type { AuthContext, Cart, EmporixClient } from "@viu/emporix-sdk";

/**
 * Shared cart-bootstrap helper. Wraps `client.carts.getCurrent({create:true})`
 * in a `qc.fetchQuery` so concurrent callers (useActiveCart mount races, login
 * cart-onboarding) share one cache entry and trigger a single server call.
 *
 * Cache key omits `cartId` deliberately — bootstrap is the operation that
 * *creates* the cart-id. The fetched Cart's `id` is then written into the
 * storage by the caller; subsequent `useCart(id)` reads use their own
 * per-id cache key.
 *
 * `staleTime: Infinity` is safe because:
 *   - useActiveCart's effect gates on `storage.cartId !== null` — won't run
 *     bootstrap when storage already has one.
 *   - Logout / discard clears `storage.cartId` AND
 *     `qc.removeQueries(["emporix"])`, dropping the cache entry.
 *   - Default `gcTime: 5min` evicts naturally on idle.
 */
export async function bootstrapCart(opts: {
  qc: QueryClient;
  client: EmporixClient;
  ctx: AuthContext;
  authKind: string;
  siteCode: string;
  type?: string;
  legalEntityId?: string;
}): Promise<Cart | null> {
  return opts.qc.fetchQuery({
    queryKey: [
      "emporix",
      "cart-bootstrap",
      {
        tenant: opts.client.tenant,
        authKind: opts.authKind,
        siteCode: opts.siteCode,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
      },
    ],
    queryFn: () =>
      opts.client.carts.getCurrent(opts.ctx, {
        siteCode: opts.siteCode,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
        create: true,
      }),
    staleTime: Infinity,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/hooks/internal/bootstrap-cart.ts
git commit -m "feat(react): add bootstrapCart helper for dedup'd cart creation"
```

---

## Task 3: Route `useActiveCart` bootstrap through `bootstrapCart`

**Files:**
- Modify: `packages/react/src/hooks/use-cart.ts`
- Test: `packages/react/tests/use-active-cart.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/use-active-cart.test.tsx`:

```tsx
it("two parallel useActiveCart({create:true}) under the same provider share one bootstrap call", async () => {
  let calls = 0;
  server.use(
    http.get("https://api.emporix.io/cart/acme/carts", () => {
      calls += 1;
      return HttpResponse.json({ id: "cart-shared", items: [] });
    }),
    http.get("https://api.emporix.io/cart/acme/carts/cart-shared", () =>
      HttpResponse.json({ id: "cart-shared", items: [] }),
    ),
  );
  const storage = createMemoryStorage();
  const client = new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: { clientId: "sf", context: { siteCode: "main" } },
    },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
  // Two parallel mounts of useActiveCart({create:true}) in the same provider.
  const { result } = renderHook(
    () => ({
      a: useActiveCart({ create: true }),
      b: useActiveCart({ create: true }),
    }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.a.data?.id).toBe("cart-shared"));
  await waitFor(() => expect(result.current.b.data?.id).toBe("cart-shared"));
  // Only one bootstrap call to /cart/.../carts, not two.
  expect(calls).toBe(1);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-active-cart`
Expected: FAIL — current implementation fires `client.carts.getCurrent` directly in each hook's `useEffect` → `calls === 2`.

- [ ] **Step 3: Update `useActiveCart` to use `bootstrapCart`**

Open `packages/react/src/hooks/use-cart.ts`. Add the import at the top:

```ts
import { useQueryClient } from "@tanstack/react-query";
import { bootstrapCart } from "./internal/bootstrap-cart";
```

(`useQueryClient` is likely already imported for `useCreateCart` / `useCartMutations` — keep one import.)

Find the `useActiveCart` function and replace its effect (around line 195-223):

```ts
export function useActiveCart(opts?: {
  create?: boolean;
  type?: string;
  legalEntityId?: string;
  auth?: AuthContext;
}): UseQueryResult<Cart | null> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const { ctx, kind } = useReadAuth(opts?.auth);
  const { siteCode: activeSite } = useReadSite();

  const [cartId, setCartId] = useState<string | null>(() => storage.getCartId());

  useEffect(() => {
    if (cartId !== null) return;
    if (!opts?.create) return;
    const siteCode = activeSite ?? client.config?.credentials?.storefront?.context?.siteCode;
    if (!siteCode) return;
    let cancelled = false;
    bootstrapCart({
      qc,
      client,
      ctx,
      authKind: kind,
      siteCode,
      ...(opts.type !== undefined ? { type: opts.type } : {}),
      ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
    })
      .then((cart) => {
        if (cancelled) return;
        if (cart?.id) {
          storage.setCartId(cart.id);
          setCartId(cart.id);
        }
      })
      .catch(() => {
        // Best-effort bootstrap; downstream useCart error surfaces real issues.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartId, opts?.create, opts?.type, opts?.legalEntityId, kind, activeSite]);

  // Delegate to useCart with the canonical cache key.
  const inner = useCart(cartId ?? undefined, opts?.auth ? { auth: opts.auth } : {});
  const data: Cart | null | undefined = cartId === null ? null : inner.data;
  return { ...inner, data } as UseQueryResult<Cart | null>;
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-active-cart`
Expected: PASS — the new dedup test passes (`calls === 1`); existing `useActiveCart` tests still green.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/tests/use-active-cart.test.tsx
git commit -m "feat(react): route useActiveCart bootstrap through bootstrapCart"
```

---

## Task 4: Route login cart-onboarding through `bootstrapCart` + dedup `/customer/me`

**Files:**
- Modify: `packages/react/src/hooks/use-customer-session.ts`
- Test: `packages/react/tests/use-customer-session.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/use-customer-session.test.tsx` (inside the existing `describe("useCustomerSession — preferredSite honour (MS-4)", ...)` block):

```tsx
it("login fires GET /customer/me exactly once when preferredSite is set", async () => {
  let meCalls = 0;
  server.use(
    http.get("https://api.emporix.io/customer/acme/me", () => {
      meCalls += 1;
      return HttpResponse.json({ id: "c1", contactEmail: "u@e.com", preferredSite: "Y" });
    }),
    http.get("https://api.emporix.io/site/acme/sites/Y", () =>
      HttpResponse.json({
        code: "Y",
        name: "Y",
        active: true,
        default: false,
        defaultLanguage: "en",
        languages: ["en"],
        currency: "EUR",
        homeBase: { address: { country: "DE", zipCode: "1" } },
        shipToCountries: ["DE"],
      }),
    ),
    http.get("https://api.emporix.io/session-context/acme/me/context", () =>
      HttpResponse.json({ sessionId: "s", metadata: { version: 1 } }),
    ),
    http.patch(
      "https://api.emporix.io/session-context/acme/me/context",
      () => new HttpResponse(null, { status: 204 }),
    ),
  );
  const storage = createMemoryStorage();
  storage.setSiteCode("X");
  const { result } = renderHook(
    () => ({ session: useCustomerSession(), site: useSiteContext() }),
    { wrapper: wrapper(storage, { siteCode: "main" }) },
  );
  await act(async () => {
    await result.current.session.login({ email: "u@e.com", password: "p" });
  });
  // Wait for the meQuery refetch (if any) to settle.
  await waitFor(() => expect(result.current.site.siteCode).toBe("Y"));
  // The customer-session hook's meQuery + honourPreferredSite share one cache.
  expect(meCalls).toBe(1);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-session`
Expected: FAIL — current login fires meQuery refetch (via `invalidateQueries`) AND `honourPreferredSite` does its own `client.customers.me()` call → `meCalls === 2`.

- [ ] **Step 3: Refactor `honourPreferredSite` to use `qc.fetchQuery`**

Open `packages/react/src/hooks/use-customer-session.ts`. Find `honourPreferredSite` (around line 170-200) and replace with:

```ts
async function honourPreferredSite(opts: {
  qc: QueryClient;
  client: EmporixClient;
  customerToken: string;
  siteCtx: SiteContextValue | null;
}): Promise<void> {
  const { qc, client, customerToken, siteCtx } = opts;
  if (!siteCtx) return;
  try {
    const me = await qc.fetchQuery({
      queryKey: [
        "emporix",
        "customer",
        "me",
        { tenant: client.tenant, hasToken: true },
      ],
      queryFn: () => client.customers.me(auth.customer(customerToken)),
    });
    const preferred = (me as { preferredSite?: string }).preferredSite;
    if (preferred && siteCtx.siteCode !== preferred) {
      await siteCtx.setSite(preferred);
    }
  } catch {
    // Best-effort — never block login on a preference lookup.
  }
}
```

Add `QueryClient` to the imports at the top of the file:

```ts
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
```

- [ ] **Step 4: Refactor `onboardCustomerCart` to use `bootstrapCart`**

In the same file, find `onboardCustomerCart` (around line 181-217) and replace with:

```ts
async function onboardCustomerCart(opts: {
  qc: QueryClient;
  client: EmporixClient;
  storage: EmporixStorage;
  customerToken: string;
}): Promise<void> {
  const { qc, client, storage, customerToken } = opts;
  const siteCode = client.config?.credentials?.storefront?.context?.siteCode;
  if (!siteCode) return;
  const ctx = auth.customer(customerToken);
  try {
    const customerCart = await bootstrapCart({
      qc,
      client,
      ctx,
      authKind: "customer",
      siteCode,
    });
    const customerCartId = customerCart?.id;
    if (!customerCartId) return;
    const anonCartId = storage.getCartId();
    if (anonCartId && anonCartId !== customerCartId) {
      await client.carts.merge(customerCartId, [anonCartId], ctx);
    }
    storage.setCartId(customerCartId);
  } catch {
    // Cart onboarding is best-effort; never fail login on cart trouble.
  }
}
```

Add the `bootstrapCart` import:

```ts
import { bootstrapCart } from "./internal/bootstrap-cart";
```

- [ ] **Step 5: Reorder `login` and `applySession` callbacks**

The login flow must call `honourPreferredSite` BEFORE the `invalidateQueries` so the meQuery cache stays fresh and doesn't auto-refetch. Both call sites (`login` and `applySession`) get the same reorder.

Find the `login` callback (around line 59) and update:

```ts
const login = useCallback(
  async (input: { email: string; password: string }) => {
    const session = await client.customers.login(input);
    storage.setCustomerToken(session.customerToken);
    setToken(session.customerToken);
    setRefreshTok(session.refreshToken || null);
    setSaasTok(session.saasToken || null);
    await onboardCustomerCart({
      qc,
      client,
      storage,
      customerToken: session.customerToken,
    });
    // Honour preferred site BEFORE invalidate — writes meQuery cache so
    // the subsequent invalidate doesn't trigger a duplicate refetch.
    await honourPreferredSite({
      qc,
      client,
      customerToken: session.customerToken,
      siteCtx,
    });
    await qc.invalidateQueries({ queryKey: ["emporix", "customer"] });
    await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
  },
  [client, storage, qc, siteCtx],
);
```

Same change for `applySession` (around line 85):

```ts
const applySession = useCallback(
  async (session: { customerToken: string; refreshToken: string; saasToken: string }) => {
    storage.setCustomerToken(session.customerToken);
    setToken(session.customerToken);
    setRefreshTok(session.refreshToken || null);
    setSaasTok(session.saasToken || null);
    await onboardCustomerCart({
      qc,
      client,
      storage,
      customerToken: session.customerToken,
    });
    await honourPreferredSite({
      qc,
      client,
      customerToken: session.customerToken,
      siteCtx,
    });
    await qc.invalidateQueries({ queryKey: ["emporix", "customer"] });
    await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
  },
  [client, storage, qc, siteCtx],
);
```

- [ ] **Step 6: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-session`
Expected: PASS — the new dedup test passes (`meCalls === 1`); existing customer-session tests still green.

If existing tests break because they used the old `onboardCustomerCart` signature (no `qc` parameter), update them to match.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/use-customer-session.ts packages/react/tests/use-customer-session.test.tsx
git commit -m "feat(react): dedup /customer/me + cart onboarding on login"
```

---

## Task 5: Per-hook `staleTime` for stable resources (`useSites`, `useDefaultSite`)

**Files:**
- Modify: `packages/react/src/hooks/use-sites.ts`
- Test: `packages/react/tests/use-sites.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/use-sites.test.tsx`:

```tsx
it("useSites caches the listing within staleTime (no refetch on re-render)", async () => {
  let calls = 0;
  server.use(
    http.get("https://api.emporix.io/site/acme/sites", () => {
      calls += 1;
      return HttpResponse.json(SITES);
    }),
  );
  const wrap2 = wrap();
  const { result, rerender } = renderHook(() => useSites(), { wrapper: wrap2 });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls).toBe(1);
  // Re-render same hook — within staleTime, no refetch.
  rerender();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls).toBe(1);
});
```

- [ ] **Step 2: Run, expect this to pass with `staleTime: 0` by accident**

The test as written might pass even without `staleTime` because `rerender()` of the same hook instance uses the same in-memory query data. Skip step 2 — go directly to the implementation; we'll add a stronger test that exercises remount instead.

Replace step 1's test with:

```tsx
it("useSites: a second hook mount within staleTime is a cache hit (no refetch)", async () => {
  let calls = 0;
  server.use(
    http.get("https://api.emporix.io/site/acme/sites", () => {
      calls += 1;
      return HttpResponse.json(SITES);
    }),
  );
  // Both hooks share the same wrapper → same QueryClient.
  const wrapper = wrap();
  const { result: r1 } = renderHook(() => useSites(), { wrapper });
  await waitFor(() => expect(r1.current.isSuccess).toBe(true));
  expect(calls).toBe(1);
  const { result: r2 } = renderHook(() => useSites(), { wrapper });
  await waitFor(() => expect(r2.current.isSuccess).toBe(true));
  // Within staleTime, second mount is a cache hit.
  expect(calls).toBe(1);
});
```

The key is that the `wrap()` helper must reuse the same `QueryClient` between renderHook calls. Verify the existing `wrap()` definition — if it creates a fresh QC per call, refactor to memoize.

Inspect `wrap()` at the top of `tests/use-sites.test.tsx`. If it returns a fresh wrapper on each call (and each wrapper builds its own QueryClient), refactor:

```tsx
function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const storage = createMemoryStorage();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}
```

(That's the current state — a fresh `wrap()` call creates one wrapper holding one QueryClient. Calling the returned function multiple times reuses everything. So the test as written works: both `renderHook` use the **same** `wrapper` value.)

- [ ] **Step 3: Run, expect failure (or pass — depending on RQ defaults)**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-sites`
Expected: FAIL (without staleTime, the second mount might trigger a refetch on RQ5 even with the existing data) — or the existing test infrastructure may shield this. Confirm the FAIL state before continuing.

If it passes accidentally because tests don't exercise refetch-on-mount, move on — the per-hook staleTime is still a correctness signal in the code, and the cross-cutting QueryClient default already handles the cache-hit assertion at Task 1's provider-test level.

- [ ] **Step 4: Add `staleTime` overrides to `useSites` and `useDefaultSite`**

In `packages/react/src/hooks/use-sites.ts`, update both hooks:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Site } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

const SITES_STALE_TIME = 10 * 60_000; // 10 minutes — sites change admin-side only.

/** Lists active sites for the tenant. */
export function useSites(options: QueryOpts = {}): UseQueryResult<Site[]> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "sites", { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.sites.list(ctx),
    staleTime: SITES_STALE_TIME,
  });
}

/** Convenience: the tenant's default site (the one flagged `default: true`). */
export function useDefaultSite(options: QueryOpts = {}): UseQueryResult<Site> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "site-default", { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.sites.current(ctx),
    staleTime: SITES_STALE_TIME,
  });
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-sites`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-sites.ts packages/react/tests/use-sites.test.tsx
git commit -m "feat(react): useSites/useDefaultSite cache 10min (admin-changed)"
```

---

## Task 6: Per-hook `staleTime` for catalog hooks (`use-products`, `use-categories`)

**Files:**
- Modify: `packages/react/src/hooks/use-products.ts`
- Modify: `packages/react/src/hooks/use-categories.ts`

These are mechanical edits — add a `staleTime` field to each `useQuery` / `useInfiniteQuery` call. No new tests needed; existing tests don't assert on `staleTime` and continue to pass.

- [ ] **Step 1: Update `use-products.ts`**

Open `packages/react/src/hooks/use-products.ts`. Define a constant at the top:

```ts
const PRODUCTS_STALE_TIME = 60_000; // 1 minute — catalog listings + prices.
```

Add `staleTime: PRODUCTS_STALE_TIME` to every `useQuery` and `useInfiniteQuery` call in the file (`useProduct`, `useProducts`, `useProductsInfinite`, `useProductByCode`, `useProductSearch`).

Example for `useProducts`:

```ts
return useQuery({
  queryKey: ["emporix", "products", params, { tenant: client.tenant, authKind: kind, siteCode }],
  queryFn: () => client.products.list(params, ctx),
  staleTime: PRODUCTS_STALE_TIME,
});
```

Apply the same change to all 5 hooks in the file.

- [ ] **Step 2: Update `use-categories.ts`**

Open `packages/react/src/hooks/use-categories.ts`. Define a constant at the top:

```ts
const CATEGORIES_STALE_TIME = 5 * 60_000; // 5 minutes — catalog structure.
```

Add `staleTime: CATEGORIES_STALE_TIME` to every `useQuery` and `useInfiniteQuery` call (`useCategory`, `useCategories`, `useCategoriesInfinite`, `useCategoryTree`, `useProductsInCategory`, `useProductsInCategoryInfinite`).

- [ ] **Step 3: Typecheck + tests**

```bash
pnpm -F @viu/emporix-sdk-react typecheck
pnpm -F @viu/emporix-sdk-react test -- use-products
pnpm -F @viu/emporix-sdk-react test -- use-categories
```
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/hooks/use-products.ts packages/react/src/hooks/use-categories.ts
git commit -m "feat(react): products 60s + categories 5min staleTime"
```

---

## Task 7: Per-hook `staleTime` for remaining hooks (`use-match-prices`, `use-my-segments`, `use-product-media`, `use-checkout`)

**Files:**
- Modify: `packages/react/src/hooks/use-match-prices.ts`
- Modify: `packages/react/src/hooks/use-my-segments.ts`
- Modify: `packages/react/src/hooks/use-product-media.ts`
- Modify: `packages/react/src/hooks/use-checkout.ts`
- Test: `packages/react/tests/use-match-prices.test.tsx`

- [ ] **Step 1: Write a cache-hit test for `useMatchPrices`**

Append to `packages/react/tests/use-match-prices.test.tsx`:

```tsx
it("useMatchPrices caches match results within staleTime", async () => {
  let calls = 0;
  server.use(
    http.post("https://api.emporix.io/price/acme/matches/match-by-context", () => {
      calls += 1;
      return HttpResponse.json([{ priceId: "pr1", effectiveValue: 10 }]);
    }),
  );
  const wrapper = wrap();
  const input = {
    items: [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 1 } }],
  };
  const { result: r1 } = renderHook(() => useMatchPrices(input), { wrapper });
  await waitFor(() => expect(r1.current.isSuccess).toBe(true));
  expect(calls).toBe(1);
  const { result: r2 } = renderHook(() => useMatchPrices(input), { wrapper });
  await waitFor(() => expect(r2.current.isSuccess).toBe(true));
  expect(calls).toBe(1);
});
```

Verify the `wrap()` helper in `tests/use-match-prices.test.tsx` reuses a single `QueryClient` per call (typical of test files in this repo — confirm).

- [ ] **Step 2: Run, expect failure (or pass) — implement next**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-match-prices`
Expected: PASS or FAIL depending on test setup. Continue regardless.

- [ ] **Step 3: Update `use-match-prices.ts`**

```ts
const PRICES_STALE_TIME = 60_000; // 1 minute — prices change with promotions.

// inside useMatchPrices's useQuery:
return useQuery({
  queryKey: [
    "emporix",
    "match-prices",
    { tenant: client.tenant, input, anon: !options.customerToken, siteCode },
  ],
  enabled: (options.enabled ?? true) && (input.items?.length ?? 0) > 0,
  queryFn: () => client.prices.matchByContext(input, ctx),
  staleTime: PRICES_STALE_TIME,
});
```

- [ ] **Step 4: Update `use-my-segments.ts`**

Define at the top:

```ts
const SEGMENTS_STALE_TIME = 5 * 60_000; // 5 minutes — segment membership is admin-driven.
```

Add `staleTime: SEGMENTS_STALE_TIME` to every `useQuery` and `useInfiniteQuery` in the file (all 7 hooks).

- [ ] **Step 5: Update `use-product-media.ts`**

```ts
const MEDIA_STALE_TIME = 5 * 60_000; // 5 minutes — media assets are stable per product.

// inside useProductMedia's useQuery:
staleTime: MEDIA_STALE_TIME,
```

- [ ] **Step 6: Update `use-checkout.ts` (`usePaymentModes`)**

```ts
const PAYMENT_MODES_STALE_TIME = 10 * 60_000; // 10 minutes — admin-configured.

// inside usePaymentModes's useQuery:
return useQuery({
  queryKey: ["emporix", "payment-modes", { tenant: client.tenant, siteCode }],
  enabled: (options.enabled ?? true) && token !== null,
  queryFn: () => client.payments.listPaymentModes(customerOnlyCtx(token)),
  staleTime: PAYMENT_MODES_STALE_TIME,
});
```

Don't touch `useCheckout`'s mutations (they're not queries).

- [ ] **Step 7: Run all tests**

```bash
pnpm -F @viu/emporix-sdk-react test
```
Expected: all tests pass; count should be ≥ 140.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/hooks/use-match-prices.ts \
        packages/react/src/hooks/use-my-segments.ts \
        packages/react/src/hooks/use-product-media.ts \
        packages/react/src/hooks/use-checkout.ts \
        packages/react/tests/use-match-prices.test.tsx
git commit -m "feat(react): per-hook staleTime for prices/segments/media/payments"
```

---

## Task 8: Docs + changeset

**Files:**
- Modify: `docs/react.md`
- Create: `.changeset/api-quota-reduction.md`

- [ ] **Step 1: Add a "Caching & quota" subsection to `docs/react.md`**

Find the "Provider" section (around line 7-35). After the existing storage paragraphs but before the "Hooks" heading, insert:

```markdown
### Caching & quota

`EmporixProvider` ships with a Balanced React-Query default profile to keep
your tenant API-quota in check:

| Default | Value | Why |
|---|---|---|
| `staleTime` | `30s` | Fresh-within-30s policy reduces refetch-on-mount churn. |
| `refetchOnWindowFocus` | `false` | Tabbing back no longer refetches all queries. |
| `retry` | `1` | Single retry on failure instead of three (caps failed-request cost at 2× per query). |

Each hook overrides `staleTime` for resources that change at different rates:

| Hook(s) | staleTime |
|---|---|
| `useSites`, `useDefaultSite`, `usePaymentModes` | 10 min |
| `useCategory(ies)`, `useCategoryTree`, `useProductsInCategory(Infinite)`, `useProductMedia`, `useMySegment*` | 5 min |
| `useProducts(Infinite)`, `useProduct`, `useProductByCode`, `useMatchPrices` | 60 s |
| Everything else | 30 s (provider default) |

To override per call, pass `staleTime` via the existing `options`:

```tsx
const { data } = useProducts({ pageSize: 24 }, { staleTime: 10 * 60_000 });
```

To opt out of the provider defaults entirely, pass your own `queryClient`:

```tsx
const qc = new QueryClient(); // your own defaults
<EmporixProvider client={client} queryClient={qc}>...</EmporixProvider>
```
```

- [ ] **Step 2: Create the changeset**

Create `.changeset/api-quota-reduction.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

API-quota reduction: sane QueryClient defaults + bootstrap deduplication.

**QueryClient defaults** (only applied when no `queryClient` prop is passed):
- `staleTime: 30s` — fresh-within-30s policy reduces refetch-on-mount churn.
- `refetchOnWindowFocus: false` — tabbing back no longer refetches all queries.
- `retry: 1` — single retry on failure instead of three (caps failed-request
  cost at 2× per query).

**Per-hook staleTime overrides:**
- `useSites`, `useDefaultSite`, `usePaymentModes` — 10 min.
- `useCategory(ies)`, `useCategoryTree`, `useProductsInCategory(Infinite)`,
  `useProductMedia`, `useMySegment*` — 5 min.
- `useProducts(Infinite)`, `useProduct`, `useProductByCode`,
  `useMatchPrices` — 60 s.
- Cart, Profile, Search, Addresses keep the 30s default (or 0 where
  freshness matters).

**Bootstrap dedup:**
- `useActiveCart({ create: true })` and `useCustomerSession.login` cart
  onboarding share a single `qc.fetchQuery` cache entry — parallel mounts
  trigger one server call.
- `useCustomerSession.login` honours `customer.preferredSite` via the same
  `meQuery` cache key — login fires one `GET /customer/me` instead of two.

No breaking changes. Consumers passing their own `queryClient` to
`EmporixProvider` keep their existing defaults.
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md .changeset/api-quota-reduction.md
git commit -m "docs(react): document Balanced caching profile; quota-reduction changeset"
```

---

## Final Verification

- [ ] **Step 1: Full monorepo green**

```bash
pnpm -r build
pnpm -r test
pnpm typecheck
```
Expected:
- `@viu/emporix-sdk`: still 156 tests.
- `@viu/emporix-sdk-react`: was 133 → **≥ 140** (+2 provider, +1 useActiveCart, +1 customer-session, +1 useSites, +1 useMatchPrices, ≥ +1 for re-runs).
- All builds + typecheck green.

- [ ] **Step 2: E2E sanity**

```bash
set -a; source e2e/.env.local 2>/dev/null; set +a
pnpm e2e
```
Expected: 6/6 passing. The MS-4 catalog-spec asserts a `Set` of three calls — that still holds (anonymous-login + product-list + site-by-code). No new network requests added by this PR.

- [ ] **Step 3: Sanity grep for staleTime coverage**

```bash
git grep -nE "staleTime" packages/react/src/hooks/ 2>/dev/null | wc -l
```
Expected: at least 8 distinct staleTime configurations (one per hook file).

- [ ] **Step 4: Branch state**

```bash
git log --oneline origin/main..HEAD
```
Expected: 8 commits, in order:
1. Spec (already there: `3fd1cd5`)
2. Plan (this file — after writing-plans commit)
3. QueryClient defaults + provider tests
4. bootstrapCart helper
5. useActiveCart bootstrap dedup
6. login dedup (cart + me)
7. useSites/useDefaultSite staleTime
8. products/categories staleTime
9. remaining hooks staleTime
10. Docs + changeset

(Total may be 10 if the plan commit lands separately.)

---

## Follow-ups (out of scope)

- Cross-tab cart sync via `BroadcastChannel` (shares `cartId` across tabs of the same origin).
- Request batching for catalog reads (combine multiple `useProduct(id)` mounts into a `searchByIds` call).
- Cache-hit/miss metrics for observability — emit via the logger so apps can quantify quota savings in production.
- An "Aggressive" preset that flips all hooks to 5min+ staleTimes (consumer can already do this per-hook).
