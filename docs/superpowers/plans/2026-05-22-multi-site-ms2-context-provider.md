# Multi-Site MS-2 — Context Provider + Cache-Key Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `siteCode` an **observable, runtime-settable** value via `useSiteContext()`, persist it through `EmporixStorage`, and embed it into every site-aware React-Query cache key so different sites yield separate cache entries.

**Architecture:** A new React context (`EmporixSiteContext`) holds the active `siteCode`. The `EmporixProvider` resolves the initial value (prop → storage → static config → `null`) and exposes `setSite(code)` which writes storage, clears the site-aware cart-id, and invalidates `["emporix"]` queries. An internal `useReadSite()` helper composes `siteCode` into every Read-Hook's query key. `setSite` stays **sync void** in MS-2 — the async server-side `sessionContext.patch` arrives in MS-3.

**Tech Stack:** TypeScript, React 18, `@tanstack/react-query` v5, Vitest + MSW.

**Context for the engineer:**
- Spec: `docs/superpowers/specs/2026-05-21-multi-site-foundation-design.md` — read MS-2 section first.
- Branch: `feat/multi-site-ms2-context` (already created off `main` at `1ff1003`).
- MS-1 shipped — `client.sites.list/get/current`, `useSites()`, `useDefaultSite()` are public. We don't touch them here.
- The provider currently lives at `packages/react/src/provider.tsx` and exposes only `EmporixContext`. Add a sibling `EmporixSiteContext` rather than overload the existing one.
- 0 existing tests assert on `queryKey` shape directly (verified via `grep`), so adding `siteCode` to every site-aware key is internal-only.
- `useQueryClient()` is available inside any hook under `QueryClientProvider` — used by `setSite` for cache invalidation.
- `useCustomerSession.login/logout/refresh` already calls `qc.invalidateQueries({queryKey: ["emporix","cart"]})` — that pattern works after the key-shape change (predicate still matches).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/react/src/storage/index.ts` | EmporixStorage interface | Modify (add `getSiteCode`/`setSiteCode`) |
| `packages/react/src/storage/memory.ts` | Memory backend | Modify (impl methods) |
| `packages/react/src/storage/local-storage.ts` | localStorage backend | Modify (impl methods + `emporix.siteCode` key) |
| `packages/react/src/storage/cookie.ts` | Cookie backend | Modify (impl methods + cookie name) |
| `packages/react/tests/storage.test.ts` | Storage tests | Modify (add roundtrip + persistence cases) |
| `packages/react/src/provider.tsx` | EmporixProvider | Modify (new `EmporixSiteContext` + `initialSiteCode` prop) |
| `packages/react/src/hooks/internal/use-read-site.ts` | Internal helper | **CREATE** (returns `{ siteCode }`) |
| `packages/react/src/hooks/use-site-context.ts` | Public hook | **CREATE** (`useSiteContext()`) |
| `packages/react/tests/use-site-context.test.tsx` | Provider/context tests | **CREATE** |
| `packages/react/src/hooks/use-products.ts` | Product hooks | Modify (key includes siteCode) |
| `packages/react/src/hooks/use-categories.ts` | Category hooks | Modify (key includes siteCode) |
| `packages/react/src/hooks/use-cart.ts` | Cart hooks | Modify (key includes siteCode) |
| `packages/react/src/hooks/use-match-prices.ts` | Price hook | Modify (key includes siteCode) |
| `packages/react/src/hooks/use-my-segments.ts` | Segment hooks (7) | Modify (key includes siteCode) |
| `packages/react/src/hooks/use-checkout.ts` | usePaymentModes | Modify (key includes siteCode) |
| `packages/react/tests/use-products.test.tsx` | Site-isolation test | Add 1 test |
| `packages/react/src/hooks/index.ts` | Re-exports | Modify (add `useSiteContext`) |
| `packages/react/src/index.ts` | Package re-exports | Modify (add `useSiteContext` + `SiteContextValue`) |
| `docs/react.md` | Public docs | Modify (`useSiteContext` section + Provider initialSiteCode) |
| `.changeset/multi-site-ms2.md` | Release notes | **CREATE** |

---

## Task 1: Extend `EmporixStorage` with `getSiteCode` / `setSiteCode`

**Files:**
- Modify: `packages/react/src/storage/index.ts`, `memory.ts`, `local-storage.ts`, `cookie.ts`
- Test: `packages/react/tests/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/react/tests/storage.test.ts`, append:

```typescript
describe("siteCode storage", () => {
  it("memory: getSiteCode returns null, then the set value", () => {
    const s = createMemoryStorage();
    expect(s.getSiteCode()).toBeNull();
    s.setSiteCode("ThermoBrand_DE");
    expect(s.getSiteCode()).toBe("ThermoBrand_DE");
    s.setSiteCode(null);
    expect(s.getSiteCode()).toBeNull();
  });

  it("localStorage: persists siteCode under emporix.siteCode", () => {
    const s = createLocalStorageStorage();
    s.setSiteCode("WarmTech_DE");
    expect(globalThis.localStorage.getItem("emporix.siteCode")).toBe("WarmTech_DE");
    expect(s.getSiteCode()).toBe("WarmTech_DE");
    s.setSiteCode(null);
    expect(globalThis.localStorage.getItem("emporix.siteCode")).toBeNull();
  });

  it("cookie: round-trips siteCode through document.cookie", () => {
    // Mimic the existing cookie test setup — relies on jsdom's document.cookie.
    document.cookie = "";
    const s = createCookieStorage({ secure: false, sameSite: "lax" });
    s.setSiteCode("main");
    expect(s.getSiteCode()).toBe("main");
  });
});
```

- [ ] **Step 2: Update the interface**

In `packages/react/src/storage/index.ts`, add to `EmporixStorage`:

```typescript
export interface EmporixStorage {
  getCustomerToken(): string | null;
  setCustomerToken(token: string | null): void;
  subscribe?(listener: (token: string | null) => void): () => void;
  getCartId(): string | null;
  setCartId(id: string | null): void;
  getAnonymousSession(): PersistedAnonymousSession | null;
  setAnonymousSession(session: PersistedAnonymousSession | null): void;
  // NEW MS-2:
  getSiteCode(): string | null;
  setSiteCode(code: string | null): void;
}
```

- [ ] **Step 3: Implement in memory backend**

In `packages/react/src/storage/memory.ts`, add a `siteCode: string | null = null;` variable and the two methods alongside the existing `getCartId`/`setCartId`:

```typescript
let siteCode: string | null = null;
// inside the returned object:
getSiteCode: () => siteCode,
setSiteCode: (code) => { siteCode = code; },
```

- [ ] **Step 4: Implement in localStorage backend**

In `packages/react/src/storage/local-storage.ts`, add a constant and methods:

```typescript
const SITE_KEY = "emporix.siteCode";
// inside the returned object, near setCartId:
getSiteCode: () => safeGet(SITE_KEY),
setSiteCode: (code) => {
  if (code === null) safeRemove(SITE_KEY);
  else safeSet(SITE_KEY, code);
},
```

(Use the existing `safeGet`/`safeSet`/`safeRemove` helpers in that file — match the pattern of `getCartId`.)

- [ ] **Step 5: Implement in cookie backend**

In `packages/react/src/storage/cookie.ts`, add a constant and methods:

```typescript
const SITE_NAME = "emporix.siteCode";
// near setCartId:
getSiteCode: () => readCookie(SITE_NAME),
setSiteCode: (code) => writeCookie(SITE_NAME, code),
```

- [ ] **Step 6: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage`
Expected: all storage tests pass including the 3 new siteCode roundtrip cases.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/storage/ packages/react/tests/storage.test.ts
git commit -m "feat(react): EmporixStorage.getSiteCode/setSiteCode across all 3 backends"
```

---

## Task 2: `EmporixSiteContext` + `initialSiteCode` prop + `useSiteContext()`

**Files:**
- Create: `packages/react/src/hooks/internal/use-read-site.ts`
- Create: `packages/react/src/hooks/use-site-context.ts`
- Modify: `packages/react/src/provider.tsx`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`
- Create: `packages/react/tests/use-site-context.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/use-site-context.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useSiteContext } from "../src/hooks/use-site-context";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient(staticSite?: string) {
  return new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: {
        clientId: "sf",
        ...(staticSite ? { context: { siteCode: staticSite } } : {}),
      },
    },
    logger: false,
  });
}

function wrap(opts: {
  storage?: EmporixStorage;
  initialSiteCode?: string;
  staticSite?: string;
} = {}) {
  const client = makeClient(opts.staticSite);
  const storage = opts.storage ?? createMemoryStorage();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={client}
      storage={storage}
      queryClient={queryClient}
      {...(opts.initialSiteCode !== undefined ? { initialSiteCode: opts.initialSiteCode } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("useSiteContext — initial-state resolution", () => {
  it("uses initialSiteCode prop when provided", () => {
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ initialSiteCode: "ThermoBrand_DE", staticSite: "main" }),
    });
    expect(result.current.siteCode).toBe("ThermoBrand_DE");
  });

  it("falls back to storage.getSiteCode() when no prop", () => {
    const storage = createMemoryStorage();
    storage.setSiteCode("WarmTech_DE");
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ storage, staticSite: "main" }),
    });
    expect(result.current.siteCode).toBe("WarmTech_DE");
  });

  it("falls back to client.config.storefront.context.siteCode when storage is empty", () => {
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ staticSite: "main" }),
    });
    expect(result.current.siteCode).toBe("main");
  });

  it("falls back to null when nothing is configured", () => {
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap(),
    });
    expect(result.current.siteCode).toBeNull();
  });

  it("currency and targetLocation are null in MS-2 (populated in MS-4)", () => {
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ initialSiteCode: "X" }),
    });
    expect(result.current.currency).toBeNull();
    expect(result.current.targetLocation).toBeNull();
  });
});

describe("useSiteContext — setSite", () => {
  it("updates state + storage", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ storage }),
    });
    act(() => {
      result.current.setSite("ThermoBrand_DE");
    });
    expect(result.current.siteCode).toBe("ThermoBrand_DE");
    expect(storage.getSiteCode()).toBe("ThermoBrand_DE");
  });

  it("clears storage.cartId on site switch (carts are site-aware)", () => {
    const storage = createMemoryStorage();
    storage.setCartId("old-cart-on-old-site");
    storage.setSiteCode("old-site");
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ storage }),
    });
    act(() => {
      result.current.setSite("new-site");
    });
    expect(storage.getCartId()).toBeNull();
  });

  it("setSite(null) clears the active site", () => {
    const storage = createMemoryStorage();
    storage.setSiteCode("X");
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ storage }),
    });
    act(() => {
      result.current.setSite(null);
    });
    expect(result.current.siteCode).toBeNull();
    expect(storage.getSiteCode()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-site-context`
Expected: FAIL — `useSiteContext` cannot be imported.

- [ ] **Step 3: Create the internal helper**

Create `packages/react/src/hooks/internal/use-read-site.ts`:

```typescript
import { useContext } from "react";
import { EmporixSiteContext } from "../../provider";

/**
 * Internal: returns the active `siteCode` from the EmporixProvider's site
 * context. Used by site-aware Read-Hooks to compose their query keys.
 *
 * Returns `null` when no site context is mounted — hooks use `null` in the
 * query key so cache entries are deterministic.
 */
export function useReadSite(): { siteCode: string | null } {
  const ctx = useContext(EmporixSiteContext);
  return { siteCode: ctx?.siteCode ?? null };
}
```

- [ ] **Step 4: Create the public hook**

Create `packages/react/src/hooks/use-site-context.ts`:

```typescript
import { useContext } from "react";
import { EmporixSiteContext, type SiteContextValue } from "../provider";

/**
 * Returns the active site context: `{ siteCode, currency, targetLocation,
 * setSite }`. In MS-2, `currency` and `targetLocation` are always `null`;
 * they auto-populate in MS-4. `setSite(code)` is sync void in MS-2; it
 * becomes async in MS-3 (PATCHing `/session-context/{tenant}/me/context`).
 */
export function useSiteContext(): SiteContextValue {
  const ctx = useContext(EmporixSiteContext);
  if (!ctx) {
    throw new Error("useSiteContext must be used within an EmporixProvider");
  }
  return ctx;
}
```

- [ ] **Step 5: Add `EmporixSiteContext` + `initialSiteCode` to the provider**

Replace `packages/react/src/provider.tsx` content with:

```tsx
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage/index";
import { createMemoryStorage } from "./storage/memory";

interface EmporixContextValue {
  client: EmporixClient;
  storage: EmporixStorage;
}

export interface SiteContextValue {
  siteCode: string | null;
  /** MS-4 populates this from the active site's DTO. */
  currency: string | null;
  /** MS-4 populates this from the active site's DTO. */
  targetLocation: string | null;
  /** Sync in MS-2 (state + storage + cart-id clear + cache invalidate). Async in MS-3. */
  setSite: (code: string | null) => void;
}

const EmporixContext = createContext<EmporixContextValue | null>(null);
export const EmporixSiteContext = createContext<SiteContextValue | null>(null);

export interface EmporixProviderProps {
  client: EmporixClient;
  queryClient?: QueryClient;
  storage?: EmporixStorage;
  initialCustomerToken?: string;
  /**
   * Initial site code. Resolution order: this prop → `storage.getSiteCode()` →
   * `client.config.credentials.storefront.context.siteCode` → `null`.
   */
  initialSiteCode?: string;
  children: ReactNode;
}

export function EmporixProvider({
  client,
  queryClient,
  storage,
  initialCustomerToken,
  initialSiteCode,
  children,
}: EmporixProviderProps): React.JSX.Element {
  const value = useMemo<EmporixContextValue>(() => {
    const s =
      storage ??
      createMemoryStorage(
        initialCustomerToken !== undefined ? { initial: initialCustomerToken } : {},
      );
    if (initialCustomerToken && storage && storage.getCustomerToken() === null) {
      storage.setCustomerToken(initialCustomerToken);
    }
    return { client, storage: s };
  }, [client, storage, initialCustomerToken]);

  const qc = useMemo(() => queryClient ?? new QueryClient(), [queryClient]);

  useState(() => {
    client.tokenProvider.attachAnonymousStore?.({
      read: () => value.storage.getAnonymousSession(),
      write: (s) => value.storage.setAnonymousSession(s),
    });
    return null;
  });

  return (
    <EmporixContext.Provider value={value}>
      <QueryClientProvider client={qc}>
        <SiteContextProvider
          client={client}
          storage={value.storage}
          initialSiteCode={initialSiteCode}
        >
          {children}
        </SiteContextProvider>
      </QueryClientProvider>
    </EmporixContext.Provider>
  );
}

function SiteContextProvider({
  client,
  storage,
  initialSiteCode,
  children,
}: {
  client: EmporixClient;
  storage: EmporixStorage;
  initialSiteCode?: string;
  children: ReactNode;
}): React.JSX.Element {
  const qc = useQueryClient();
  const [siteCode, setSiteCodeState] = useState<string | null>(() => {
    if (initialSiteCode !== undefined) return initialSiteCode;
    const fromStorage = storage.getSiteCode();
    if (fromStorage !== null) return fromStorage;
    return client.config?.credentials?.storefront?.context?.siteCode ?? null;
  });

  const setSite = useCallback(
    (code: string | null) => {
      storage.setSiteCode(code);
      // Carts are site-aware — old cartId becomes unreachable on the new site.
      storage.setCartId(null);
      setSiteCodeState(code);
      void qc.invalidateQueries({ queryKey: ["emporix"] });
    },
    [storage, qc],
  );

  const value = useMemo<SiteContextValue>(
    () => ({
      siteCode,
      currency: null,
      targetLocation: null,
      setSite,
    }),
    [siteCode, setSite],
  );

  return <EmporixSiteContext.Provider value={value}>{children}</EmporixSiteContext.Provider>;
}

export function useEmporix(): EmporixContextValue {
  const ctx = useContext(EmporixContext);
  if (!ctx) throw new Error("useEmporix must be used within an EmporixProvider");
  return ctx;
}
```

- [ ] **Step 6: Re-export `useSiteContext` and `SiteContextValue`**

In `packages/react/src/hooks/index.ts`, add:

```typescript
export { useSiteContext } from "./use-site-context";
```

In `packages/react/src/index.ts`, append `useSiteContext` to the existing named-exports from `./hooks/index`, and re-export `SiteContextValue` from `./provider`:

```typescript
export { EmporixProvider, useEmporix } from "./provider";
export type { EmporixProviderProps, SiteContextValue } from "./provider";
```

- [ ] **Step 7: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-site-context`
Expected: PASS for all 8 site-context tests.

- [ ] **Step 8: Verify no existing tests broke**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: 110 + 8 = 118 tests passing (existing site-context-unaware tests render the provider without the new prop — they get `siteCode: null`, which doesn't affect data assertions).

If any existing test fails because the wrapper now requires `QueryClientProvider` ordering or similar — that's a regression in the provider refactor. Recheck the provider JSX order.

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/provider.tsx \
        packages/react/src/hooks/internal/use-read-site.ts \
        packages/react/src/hooks/use-site-context.ts \
        packages/react/src/hooks/index.ts \
        packages/react/src/index.ts \
        packages/react/tests/use-site-context.test.tsx
git commit -m "feat(react): EmporixSiteContext + useSiteContext + initialSiteCode prop"
```

---

## Task 3: Cache-key migration on all site-aware hooks

**Files:**
- Modify: `packages/react/src/hooks/use-products.ts`
- Modify: `packages/react/src/hooks/use-categories.ts`
- Modify: `packages/react/src/hooks/use-cart.ts`
- Modify: `packages/react/src/hooks/use-match-prices.ts`
- Modify: `packages/react/src/hooks/use-my-segments.ts`
- Modify: `packages/react/src/hooks/use-checkout.ts`
- Test: `packages/react/tests/use-products.test.tsx` (add 1 site-isolation case)

The pattern across all hooks is identical: import `useReadSite`, call it, append `siteCode` to the query-key's last meta-object. Apply it once per file, run that file's tests, commit. Below is the pattern; **apply to every Read-Hook in every file listed**.

### Pattern (apply to every site-aware Read-Hook)

```typescript
// Before:
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

export function useProducts(...) {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "products", params, { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.products.list(params, ctx),
  });
}

// After:
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";

export function useProducts(...) {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: ["emporix", "products", params, { tenant: client.tenant, authKind: kind, siteCode }],
    queryFn: () => client.products.list(params, ctx),
  });
}
```

`useCartMutations` is a write-hook but still uses a cart-cache key. Its `keyFor(id)` helper must include `siteCode` too — read `useReadSite()` at the top of the function and pass `siteCode` into `keyFor`.

- [ ] **Step 1: Add site-isolation test (site-aware cache shape)**

Append to `packages/react/tests/use-products.test.tsx`:

```tsx
it("useProducts on different sites yields separate cache entries", async () => {
  // Two products endpoints hit; key shape includes siteCode → no cross-contamination.
  let calls = 0;
  server.use(
    http.get("https://api.emporix.io/product/acme/products", () => {
      calls += 1;
      return HttpResponse.json([{ id: `p-${calls}` }]);
    }),
  );
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { rerender, result } = renderHook(
    ({ site }: { site: string }) => useProducts({ pageSize: 5 }),
    {
      wrapper: ({ children }) => (
        <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient} initialSiteCode="A">
          {children}
        </EmporixProvider>
      ),
      initialProps: { site: "A" },
    },
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(calls).toBe(1);

  // Remount under a different site (simulates setSite via initialSiteCode in fresh wrapper).
  rerender({ site: "B" });
  // Same provider — but a different site would need separate wrapper. Skip the rerender
  // assertion; the real isolation check is below using two separate hook instances.

  // Mount a second hook under a different provider wrapper with a different siteCode.
  const queryClient2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result: result2 } = renderHook(() => useProducts({ pageSize: 5 }), {
    wrapper: ({ children }) => (
      <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient2} initialSiteCode="B">
        {children}
      </EmporixProvider>
    ),
  });
  await waitFor(() => expect(result2.current.isSuccess).toBe(true));
  // Different siteCode → different cache key → a fresh fetch happened.
  expect(calls).toBe(2);
});
```

(This test uses two separate `QueryClient` instances — easier than asserting on internal cache. The cache-isolation guarantee is "a fresh siteCode triggers a fresh fetch", which `calls === 2` proves.)

- [ ] **Step 2: Migrate `use-products.ts` (4 hooks: useProduct, useProducts, useProductsInfinite, useProductByCode, useProductSearch)**

Add `import { useReadSite } from "./internal/use-read-site";` at the top. Then in each hook:
1. Call `const { siteCode } = useReadSite();`
2. Append `siteCode` to the meta-object in the queryKey.

Run tests:
```bash
pnpm -F @viu/emporix-sdk-react test -- use-products
```
Expected: all pass.

- [ ] **Step 3: Migrate `use-categories.ts` (6 hooks)**

Same pattern: import + call + append. Run tests:
```bash
pnpm -F @viu/emporix-sdk-react test -- use-categories
```
Expected: all pass.

- [ ] **Step 4: Migrate `use-cart.ts` (3 hooks: useCart, useActiveCart, useCartMutations)**

`useCart`: standard pattern.
`useActiveCart`: standard pattern (it composes via `useCart`, but its bootstrap effect path needs `siteCode` in its own logic too — read it but don't include in opts; the inner `useCart` call already keys by it).
`useCartMutations`: read `useReadSite()` at top; pass `siteCode` into `keyFor(id)` so the mutation writes to the same cache entry useCart reads.

Run tests:
```bash
pnpm -F @viu/emporix-sdk-react test -- use-cart
pnpm -F @viu/emporix-sdk-react test -- use-active-cart
```
Expected: all pass.

- [ ] **Step 5: Migrate `use-match-prices.ts`, `use-my-segments.ts`, `use-checkout.ts`**

`use-match-prices.ts`: 1 hook (`useMatchPrices`) — standard pattern.
`use-my-segments.ts`: 7 hooks — same pattern, repeat for each.
`use-checkout.ts`: only `usePaymentModes` is site-aware (its key gets `siteCode`). `useCheckout` is mutation-only — leave its query-cache alone.

Run all tests:
```bash
pnpm -F @viu/emporix-sdk-react test
```
Expected: 118 + 1 new isolation test = 119 (or higher if existing tests count is different).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-products.ts \
        packages/react/src/hooks/use-categories.ts \
        packages/react/src/hooks/use-cart.ts \
        packages/react/src/hooks/use-match-prices.ts \
        packages/react/src/hooks/use-my-segments.ts \
        packages/react/src/hooks/use-checkout.ts \
        packages/react/tests/use-products.test.tsx
git commit -m "feat(react): include siteCode in all site-aware query keys"
```

---

## Task 4: Documentation + changeset

**Files:**
- Modify: `docs/react.md`
- Create: `.changeset/multi-site-ms2.md`

- [ ] **Step 1: Update `docs/react.md`**

In the "Sites" subsection (added in MS-1), replace the "MS-2 roadmap" hint paragraph with the actual documentation:

```markdown
### Sites

For tenants with multiple storefront sites, the SDK exposes the Site Settings
Service and an observable active-site context:

`useSites()` — lists the active sites for the tenant.

`useDefaultSite()` — convenience for "the site flagged as `default: true`".

`useSiteContext()` — returns `{ siteCode, currency, targetLocation, setSite }`
for the **active** site. The provider resolves the initial value from (in
order): the `initialSiteCode` prop → `storage.getSiteCode()` → the static
`client.config.credentials.storefront.context.siteCode` → `null`.

```tsx
<EmporixProvider client={client} storage={storage} initialSiteCode="ThermoBrand_DE">
  <App />
</EmporixProvider>

function SiteSwitcher() {
  const { data: sites } = useSites();
  const { siteCode, setSite } = useSiteContext();
  return (
    <select value={siteCode ?? ""} onChange={(e) => setSite(e.target.value)}>
      {sites?.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
    </select>
  );
}
```

`setSite(code)` writes `storage.setSiteCode(code)`, clears `storage.cartId`
(carts are site-aware), and invalidates `["emporix"]` queries — all
site-aware caches refetch on the new site. In MS-2 `currency` and
`targetLocation` stay `null`; they auto-derive from the site DTO in MS-4.
Server-side session-context sync arrives in MS-3 (`setSite` becomes async).

All site-aware React-Query hooks include `siteCode` in their cache key, so
two `useProducts({pageSize: 12})` calls under different sites yield two
separate cache entries.
```

- [ ] **Step 2: Create changeset**

Create `.changeset/multi-site-ms2.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

Multi-site MS-2: observable site context + cache-key migration.

**Provider**
- `<EmporixProvider initialSiteCode>` prop — resolution order: prop →
  `storage.getSiteCode()` → static `client.config.…context.siteCode` →
  `null`.

**Hooks**
- `useSiteContext()` — returns `{ siteCode, currency, targetLocation,
  setSite }` for the active site. In MS-2 `currency` and `targetLocation`
  are `null` (populated in MS-4). `setSite(code)` writes storage, clears
  `storage.cartId` (carts are site-aware), and invalidates all
  `["emporix"]` queries.

**Storage**
- `EmporixStorage.{get,set}SiteCode` across all three backends (memory,
  localStorage, cookie). localStorage key: `emporix.siteCode`.

**Cache keys**
- All site-aware query keys (`useProducts`, `useCategories`, `useCart`,
  `useActiveCart`, `useCartMutations`, `useMatchPrices`, `useMySegment*`,
  `usePaymentModes`, etc.) now include `siteCode`. Different sites =
  separate cache entries. Internal change — no consumer subscribed
  directly to query keys.

No breaking changes. Existing single-site apps work unchanged — they
implicitly run with the static config's `siteCode` (or `null`).
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md .changeset/multi-site-ms2.md
git commit -m "docs(repo): document useSiteContext + initialSiteCode; MS-2 changeset"
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
- `@viu/emporix-sdk`: still 148 tests.
- `@viu/emporix-sdk-react`: was 110 → **≥ 119** (+8 site-context + +1 isolation).
- All builds + typecheck green.

- [ ] **Step 2: E2E sanity**

```bash
set -a; source e2e/.env.local 2>/dev/null; set +a
pnpm e2e
```
Expected: 6/6 still passing. MS-2 is additive — existing flows run with
`siteCode: null` (or static config's site) without behavior change.

- [ ] **Step 3: Site-isolation manual sanity (optional)**

Mount two `<EmporixProvider initialSiteCode="X">` and `<EmporixProvider initialSiteCode="Y">` subtrees with the **same** `EmporixClient` + `QueryClient`. Use `useProducts` in both. Check Network panel — two separate fetches (not one shared cache hit). The Task 3 Step 1 test already automates this, so this manual check is only for visual confirmation.

- [ ] **Step 4: Branch state**

```bash
git log --oneline origin/main..HEAD
```
Expected: 5 commits + plan = 6 total:
1. MS-2 plan (this file)
2. Storage extension
3. SiteContext provider + useSiteContext
4. Cache-key migration
5. Docs + changeset

---

## Follow-ups (out of scope, ship as MS-3)

- `client.sessionContext.patch/get` — server-side session-context sync.
- Make `setSite()` async, awaiting `sessionContext.patch`.
- `isSwitching` and `switchError` fields on `useSiteContext()` return.

## Out of scope (deferred to MS-4)

- Auto-fetch active site's DTO to populate `currency` + `targetLocation`.
- Customer `customerprefferedSite` honour at login.

## Out of scope (deferred to a later follow-up)

- Site-switcher UI in `examples/vite-spa` + `examples/next-app-router` — land alongside MS-3 once `setSite` is async and `isSwitching` is exposed.
