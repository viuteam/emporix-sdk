# `useActiveCart` Hook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `useActiveCart({ create?, type?, legalEntityId?, auth? })` to `@viu/emporix-sdk-react`. Resolves to the cart matching `storage.cartId`; with `create: true`, bootstraps via `getCurrent({siteCode, create: true})` when missing. Returns `UseQueryResult<Cart | null>`.

**Architecture:** New hook lives in `packages/react/src/hooks/use-cart.ts` alongside `useCart`, `useCartMutations`, `useCreateCart`. Uses the shared `useReadAuth` helper for auto-detect auth. Pure additive — no existing hook changes.

**Tech Stack:** TypeScript, Vitest, MSW, TanStack React Query v5, pnpm workspaces.

**Context for the engineer:**

- Read the spec first: `docs/superpowers/specs/2026-05-21-use-active-cart-design.md`.
- Branch: `feat/use-active-cart` (already created off `main`).
- Allowed commit scopes (commitlint): use `feat(react): …` for the hook itself, `test(react): …` for tests, `docs(docs): …` for the changeset / doc updates. First word lowercase.
- Pre-commit hook runs typecheck + lint + tests. Each commit should leave the repo green.
- Mechanical refactor + small new code — no API change to existing hooks.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/react/src/hooks/use-cart.ts` | All cart hooks | Add `useActiveCart` export |
| `packages/react/src/hooks/index.ts` | Hook barrel | Re-export `useActiveCart` |
| `packages/react/src/index.ts` | Package root | Re-export `useActiveCart` |
| `packages/react/tests/use-active-cart.test.tsx` | Tests | **CREATE** — 8 tests |
| `.changeset/use-active-cart.md` | Release notes | Minor changeset |
| `docs/react.md` | Doc | Document `useActiveCart` |

---

## Task 1: Add the failing tests

**Files:**
- Create: `packages/react/tests/use-active-cart.test.tsx`

- [ ] **Step 1: Inspect the existing test patterns**

Read `packages/react/tests/use-cart.test.tsx` to copy the `wrap()` helper signature + MSW setup style. The new test file follows the same conventions.

- [ ] **Step 2: Write the test file**

```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCart } from "../src/hooks/use-cart";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon",
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "rt",
      sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(
  storage: EmporixStorage = createMemoryStorage(),
  opts: { siteCode?: string } = { siteCode: "main" },
) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: {
        clientId: "sf",
        ...(opts.siteCode !== undefined ? { context: { siteCode: opts.siteCode } } : {}),
      },
    },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useActiveCart", () => {
  it("returns disabled state when storage.cartId is null and create is false", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useActiveCart(), { wrapper: wrap(storage) });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("loads the cart when storage.cartId is set on mount", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/cart-stored", () =>
        HttpResponse.json({ id: "cart-stored", items: [{ id: "i1" }] }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("cart-stored");
    const { result } = renderHook(() => useActiveCart(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.data?.id).toBe("cart-stored"));
    expect(result.current.data?.items).toHaveLength(1);
  });

  it("bootstraps a new cart with create:true when storage.cartId is null", async () => {
    let getCurrentCall: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        getCurrentCall = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "cart-new", items: [] });
      }),
      http.get("https://api.emporix.io/cart/acme/carts/cart-new", () =>
        HttpResponse.json({ id: "cart-new", items: [] }),
      ),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useActiveCart({ create: true }), {
      wrapper: wrap(storage),
    });

    await waitFor(() => expect(storage.getCartId()).toBe("cart-new"));
    expect(getCurrentCall?.get("siteCode")).toBe("main");
    expect(getCurrentCall?.get("create")).toBe("true");
    await waitFor(() => expect(result.current.data?.id).toBe("cart-new"));
  });

  it("forwards type and legalEntityId to getCurrent", async () => {
    let seenQuery: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenQuery = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "cart-q", items: [] });
      }),
      http.get("https://api.emporix.io/cart/acme/carts/cart-q", () =>
        HttpResponse.json({ id: "cart-q", items: [] }),
      ),
    );
    const storage = createMemoryStorage();
    renderHook(
      () => useActiveCart({ create: true, type: "quote", legalEntityId: "le-1" }),
      { wrapper: wrap(storage) },
    );
    await waitFor(() => expect(seenQuery?.get("type")).toBe("quote"));
    expect(seenQuery?.get("legalEntityId")).toBe("le-1");
  });

  it("skips the bootstrap when storefront.context.siteCode is missing", async () => {
    let getCalled = false;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () => {
        getCalled = true;
        return HttpResponse.json({ id: "x", items: [] });
      }),
    );
    const storage = createMemoryStorage();
    renderHook(() => useActiveCart({ create: true }), {
      wrapper: wrap(storage, { siteCode: undefined }),
    });
    // Wait a tick to allow any effects to run.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(getCalled).toBe(false);
    expect(storage.getCartId()).toBeNull();
  });

  it("does not call getCurrent when an existing cartId is in storage", async () => {
    let getCurrentCalled = false;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () => {
        getCurrentCalled = true;
        return HttpResponse.json({ id: "should-not-be-used", items: [] });
      }),
      http.get("https://api.emporix.io/cart/acme/carts/existing-cart", () =>
        HttpResponse.json({ id: "existing-cart", items: [] }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("existing-cart");
    const { result } = renderHook(() => useActiveCart({ create: true }), {
      wrapper: wrap(storage),
    });
    await waitFor(() => expect(result.current.data?.id).toBe("existing-cart"));
    expect(getCurrentCalled).toBe(false);
  });

  it("uses customer auth when a token is stored", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ id: "cust-cart", items: [] });
      }),
      http.get("https://api.emporix.io/cart/acme/carts/cust-cart", () =>
        HttpResponse.json({ id: "cust-cart", items: [] }),
      ),
    );
    const storage = createMemoryStorage({ initial: "CUST-TOK" });
    renderHook(() => useActiveCart({ create: true }), { wrapper: wrap(storage) });
    await waitFor(() => expect(storage.getCartId()).toBe("cust-cart"));
    expect(seenAuth).toBe("Bearer CUST-TOK");
  });

  it("surfaces errors from carts.get without crashing", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts/stale-cart", () =>
        HttpResponse.json({ message: "not found" }, { status: 404 }),
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("stale-cart");
    const { result } = renderHook(() => useActiveCart(), { wrapper: wrap(storage) });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
```

- [ ] **Step 3: Run, expect failures**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-active-cart`
Expected: 8 failures — `useActiveCart` is not yet exported.

---

## Task 2: Implement `useActiveCart`

**Files:**
- Modify: `packages/react/src/hooks/use-cart.ts`

- [ ] **Step 1: Add imports + helper**

In `packages/react/src/hooks/use-cart.ts`, ensure these imports exist at the top (some already do):

```typescript
import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type Cart,
  type CartAddress,
  type CartCreated,
  type CartItemInput,
  type CartItemUpdate,
  type CreateCartInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";
```

Most of these already exist; the new additions are `useEffect`, `useState`, and `useReadAuth`.

- [ ] **Step 2: Append `useActiveCart`**

At the end of `packages/react/src/hooks/use-cart.ts`, add:

```typescript
/**
 * Resolves to "the active cart": the cart matching `storage.cartId` if one is
 * present. With `create: true`, bootstraps a new cart via
 * `client.carts.getCurrent({siteCode, create: true})` when storage is empty
 * — useful on cart-page mounts where you want a cart unconditionally.
 *
 * Auto-detects auth (customer if a token is stored, else anonymous), same as
 * `useCart` and the other read hooks.
 *
 * Returns `UseQueryResult<Cart | null>`. `data: null` means "no cart yet and
 * create was not requested" — a deliberate signal so an empty-state can render
 * without confusing it with the loading state.
 */
export function useActiveCart(opts?: {
  create?: boolean;
  type?: string;
  legalEntityId?: string;
  auth?: AuthContext;
}): UseQueryResult<Cart | null> {
  const { client, storage } = useEmporix();
  const { ctx, kind } = useReadAuth(opts?.auth);

  // Lazy init: read storage exactly once on mount. Subsequent writes from
  // `useCreateCart`, `useCustomerSession.login`, or the bootstrap effect below
  // call setCartId().
  const [cartId, setCartId] = useState<string | null>(() => storage.getCartId());

  // Bootstrap: if there's no cartId and the caller asked us to create one,
  // hit getCurrent({create:true}). The effect captures the bootstrap intent
  // tuple — auth-kind switches re-run it (e.g. after login the customer's
  // cart needs to be loaded fresh).
  useEffect(() => {
    if (cartId !== null) return;
    if (!opts?.create) return;
    const siteCode = client.config?.credentials?.storefront?.context?.siteCode;
    if (!siteCode) return;
    let cancelled = false;
    client.carts
      .getCurrent(ctx, {
        siteCode,
        ...(opts.type !== undefined ? { type: opts.type } : {}),
        ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
        create: true,
      })
      .then((cart) => {
        if (cancelled) return;
        if (cart?.id) {
          storage.setCartId(cart.id);
          setCartId(cart.id);
        }
      })
      .catch(() => {
        // Best-effort bootstrap; downstream useQuery error surfaces real issues.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartId, opts?.create, opts?.type, opts?.legalEntityId, kind]);

  return useQuery({
    queryKey: [
      "emporix",
      "active-cart",
      cartId,
      { tenant: client.tenant, authKind: kind },
    ],
    enabled: cartId !== null,
    queryFn: async () => {
      if (cartId === null) return null;
      return client.carts.get(cartId, ctx);
    },
  });
}
```

The `eslint-disable-next-line react-hooks/exhaustive-deps` is intentional: `ctx`, `client`, and `storage` change identity per render but are functionally stable (they come from the provider). Including them would re-run the bootstrap on every render. The dependency set `[cartId, opts?.create, opts?.type, opts?.legalEntityId, kind]` captures every behaviorally-relevant change.

- [ ] **Step 3: Run tests, expect green**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-active-cart`
Expected: 8 tests pass.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/tests/use-active-cart.test.tsx
git commit -m "feat(cart): add useActiveCart hook with optional auto-create"
```

---

## Task 3: Re-export from the barrel + package root

**Files:**
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`

- [ ] **Step 1: Update `hooks/index.ts`**

In `packages/react/src/hooks/index.ts`, locate the line:

```typescript
export { useCart, useCartMutations, useCreateCart } from "./use-cart";
```

and replace with:

```typescript
export { useCart, useActiveCart, useCartMutations, useCreateCart } from "./use-cart";
```

- [ ] **Step 2: Update `src/index.ts`**

In `packages/react/src/index.ts`, add `useActiveCart` to the hooks re-export list (right after `useCart`):

```typescript
  useCart,
  useActiveCart,
  useCartMutations,
  useCreateCart,
```

- [ ] **Step 3: Build + verify Example typecheck**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react build
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/hooks/index.ts packages/react/src/index.ts
git commit -m "feat(react): export useActiveCart from package root"
```

---

## Task 4: Documentation

**Files:**
- Modify: `docs/react.md`

- [ ] **Step 1: Find the `useCart` paragraph in `docs/react.md`**

```bash
grep -n "useCart\|useCreateCart" docs/react.md | head -10
```

- [ ] **Step 2: Add a `useActiveCart` paragraph**

After the existing `useCreateCart` section (or wherever cart hooks are documented), append:

```markdown

### `useActiveCart(opts?)`

Resolves to "the active cart" in storage. With `opts.create = true`, bootstraps a new cart via `client.carts.getCurrent({siteCode, create: true})` if storage is empty — useful on cart-page mounts where you want a cart unconditionally.

Returns `UseQueryResult<Cart | null>`. `data: null` means "no cart yet and create was not requested" (deliberate empty-state signal vs. `undefined` = "still loading").

```tsx
// Catalog mini-cart — read-only, no auto-create:
const { data: cart } = useActiveCart();
const itemCount = cart?.items?.length ?? 0;

// Cart page — auto-create on mount:
const { data: cart, isLoading } = useActiveCart({ create: true });

// B2B quote cart in parallel to the shopping cart:
const { data: quoteCart } = useActiveCart({ create: true, type: "quote" });
```

`useActiveCart` and `useCart(cartId)` coexist with different query-keys; use `useActiveCart` for "the storefront's current cart" and `useCart(cartId)` when you already have a specific id (e.g. from a checkout confirmation page).
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md
git commit -m "docs(docs): document useActiveCart"
```

---

## Task 5: Changeset

**Files:**
- Create: `.changeset/use-active-cart.md`

- [ ] **Step 1: Write the changeset**

```markdown
---
"@viu/emporix-sdk-react": minor
---

Add `useActiveCart(opts?)` hook to `@viu/emporix-sdk-react`. Resolves to the cart matching `storage.cartId`; with `opts.create = true`, bootstraps a new cart via `client.carts.getCurrent({siteCode, create: true})` when storage is empty.

Returns `UseQueryResult<Cart | null>`. Coexists with `useCart(cartId)` (different query-key); use `useActiveCart` for "the storefront's current cart" and `useCart(cartId)` for known ids.

Useful for:
- Cart-page mounts: `useActiveCart({ create: true })`.
- Header mini-cart: `useActiveCart()` (read-only, no auto-create).
- B2B quote carts in parallel to shopping carts: `useActiveCart({ create: true, type: "quote" })`.

No SDK change; uses the existing `client.carts.getCurrent` and `client.carts.get` APIs. Auto-detects customer vs anonymous auth like the other read hooks.
```

- [ ] **Step 2: Verify `changeset status` is green**

```bash
pnpm changeset status --since=origin/main
```

Expected: lists the bump. Because the packages are `linked`, both will bump together at the next release.

- [ ] **Step 3: Commit**

```bash
git add .changeset/use-active-cart.md
git commit -m "docs(docs): changeset for useActiveCart"
```

---

## Final Verification

- [ ] **Full monorepo build + tests + typecheck**

```bash
pnpm -r build
pnpm -r test
pnpm typecheck
```

Expected: all green. Tests should be 71+ in `packages/react` (was 70, plus 8 new minus 0 removed; if a test was reorganized, the absolute count may differ — what matters is no regressions).

- [ ] **Export-surface check**

```bash
node -e "console.log(Object.keys(require('./packages/react/dist/index.cjs')).filter(k => k.startsWith('use')).sort())"
```

Expected output includes `useActiveCart` alongside the other hook exports. If it's missing, re-check Tasks 3.1-3.2.

- [ ] **Spec coverage**

Confirm every behavior in `docs/superpowers/specs/2026-05-21-use-active-cart-design.md` has a corresponding test:
- disabled when null + no create ✓
- loads from storage when set ✓
- bootstraps with create: true ✓
- forwards type / legalEntityId ✓
- skips when no siteCode ✓
- does not call getCurrent when cartId set ✓
- uses customer auth ✓
- surfaces errors ✓

- [ ] **Changeset present**

```bash
ls .changeset/use-active-cart.md
```

Expected: file exists.

---

## Follow-up (out of scope)

- Auto-recovery from stale cartId — only worth doing once we have telemetry showing it's a real problem.
- Migrate `examples/vite-spa/src/GuestCheckout.tsx` to use `useActiveCart` instead of the manual storage + `useCart` plumbing. Simple delta, separate PR.
- E2E spec exercising `useActiveCart` directly — currently covered indirectly by `customer-cart-onboarding.spec.ts`.
- `useMergeCarts()` exposed as a public hook — wait for a concrete use case.
- Phase B + Phase C (customer-account + catalog-UX hooks) are tracked as separate plans.
