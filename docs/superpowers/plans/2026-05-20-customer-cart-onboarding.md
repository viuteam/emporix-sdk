# Customer-Cart Onboarding on Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a customer logs in or signs up, automatically load (or create) their open Emporix cart for the configured `siteCode` and — if a guest cart existed — merge it in. The cart-id ends up in `EmporixStorage`, so the UI sees the customer's cart immediately.

**Architecture:** Three SDK fixes (`CartService.getCurrent` reshape, `CartService.merge` body/path fix, expose `client.config`) plus one React hook change (`useCustomerSession.login` + `signup` orchestrate get-or-create + merge as a best-effort step right after the token is stored). `siteCode` is read from `client.config.credentials.storefront.context.siteCode` — same source the SDK already uses for anonymous-login context.

**Tech Stack:** TypeScript, Vitest, MSW, TanStack React Query v5, pnpm workspaces (`packages/sdk`, `packages/react`).

**Context for the engineer:**

- Read the spec first: `docs/superpowers/specs/2026-05-20-customer-cart-onboarding-design.md`.
- This plan starts from `main` on branch `feat/customer-cart-onboarding`. The previous PR (#25) already landed `EmporixStorage` extensions and `useCreateCart`; we build on that.
- Commitlint enforces `scope-enum` (allowed: `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, auth, http, logger, deps, docs, examples`) and lowercase subject first word. Use `feat(cart): add …` (not `feat(cart): Add …`).
- The existing `client.carts.merge(cartId, auth)` is **bugged**: it puts the wrong cart-id in the path and sends no body. Tests today only assert auth-presence — they don't catch the bug. Layer 1 fixes this correctly.
- Pre-commit hook runs typecheck + lint. Each commit should leave the repo green.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/sdk/src/client.ts` | EmporixClient class | Expose `config: ResolvedConfig` as a public readonly field |
| `packages/sdk/src/services/cart.ts` | Cart service facade | Reshape `getCurrent(auth, opts)`; fix + extend `merge(targetCartId, anonCartIds, auth)` |
| `packages/sdk/tests/services/cart.test.ts` | Cart service tests | Tighten the existing merge test; add `getCurrent` happy path + 404 + array-merge tests |
| `packages/react/src/hooks/use-customer-session.ts` | Customer-session hook | After `setCustomerToken`, run a best-effort cart-onboarding block (login + signup paths) |
| `packages/react/tests/use-customer-session.test.tsx` | Hook tests | New onboarding tests (load, merge, no-siteCode skip, best-effort failure, signup mirror) |
| `.changeset/customer-cart-onboarding.md` | Release notes | Minor for both packages; BREAKING note for `getCurrent` + `merge` signature change |
| `docs/auth.md` | Auth doc | New "Customer cart on login" subsection |
| `docs/react.md` | React doc | Note the login behavior under `useCustomerSession`; cross-link |

---

## Task 1: SDK — expose `client.config`

**Files:**
- Modify: `packages/sdk/src/client.ts`

- [ ] **Step 1: Add a public `config` field**

In `packages/sdk/src/client.ts`, near the other readonly fields, add the type import and field declaration plus the assignment in the constructor.

Top imports (line 1):

```typescript
import { validateConfig, type EmporixConfig, type ResolvedConfig } from "./core/config";
```

Inside the class (after the `readonly tokenProvider: TokenProvider;` line, before `private readonly resolver`):

```typescript
  /**
   * The validated config used to construct this client. Exposed so React /
   * Next hosts can read static settings such as `credentials.storefront.context`
   * (siteCode, currency, targetLocation) without re-plumbing them through the
   * Provider tree. Treat as read-only.
   */
  readonly config: ResolvedConfig;
```

In the constructor body, after `this.tenant = cfg.tenant;`:

```typescript
    this.config = cfg;
```

- [ ] **Step 2: Verify the type is exported from `core/config`**

Run: `grep -n "ResolvedConfig" packages/sdk/src/core/config.ts | head -3`
Expected: at least one `export ... ResolvedConfig`. If missing, add `export type { ResolvedConfig };` at the file bottom — but it's near-certain to be exported already (it's used elsewhere in the SDK).

- [ ] **Step 3: Re-export at the package root if not already**

Run: `grep -n "ResolvedConfig" packages/sdk/src/index.ts`
Expected: returns a match. If empty, add to `packages/sdk/src/index.ts`:

```typescript
export type { ResolvedConfig } from "./core/config";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): expose client.config so hosts can read storefront context"
```

---

## Task 2: SDK — fix `CartService.merge` (path + body + array)

**Files:**
- Modify: `packages/sdk/src/services/cart.ts:173-181`
- Modify: `packages/sdk/tests/services/cart.test.ts`

- [ ] **Step 1: Tighten the existing merge test (TDD)**

Edit `packages/sdk/tests/services/cart.test.ts` lines 22-25 (the `http.post(.../merge` handler) so it asserts the request path AND body shape:

Replace:

```typescript
  http.post("https://api.emporix.io/cart/acme/carts/cart1/merge", ({ request }) => {
    expect(request.headers.get("authorization")).toBe("Bearer CUST");
    return HttpResponse.json({ id: "cart-merged", items: [{ id: "i1" }] });
  }),
```

with:

```typescript
  http.post(
    "https://api.emporix.io/cart/acme/carts/customer-cart/merge",
    async ({ request }) => {
      expect(request.headers.get("authorization")).toBe("Bearer CUST");
      const body = (await request.json()) as { carts?: string[] };
      expect(body.carts).toEqual(["anon-1"]);
      return HttpResponse.json({ id: "cart-merged", items: [{ id: "i1" }] });
    },
  ),
```

Then update the `merge() requires …` test at line 60-66:

```typescript
it("merge() requires a customer context and returns the merged cart", async () => {
  await expect(
    svc().merge("customer-cart", ["anon-1"], { kind: "anonymous" }),
  ).rejects.toBeInstanceOf(EmporixValidationError);
  const merged = await svc().merge("customer-cart", ["anon-1"], {
    kind: "customer",
    token: "CUST",
  });
  expect(merged.id).toBe("cart-merged");
});
```

Add a second test for the array-merge case:

```typescript
it("merge() accepts multiple anonymous cart ids in one call", async () => {
  let seenCarts: string[] | undefined;
  server.use(
    http.post(
      "https://api.emporix.io/cart/acme/carts/customer-cart/merge",
      async ({ request }) => {
        seenCarts = ((await request.json()) as { carts: string[] }).carts;
        return HttpResponse.json({ id: "cart-merged" });
      },
    ),
  );
  await svc().merge(
    "customer-cart",
    ["anon-1", "anon-2"],
    { kind: "customer", token: "CUST" },
  );
  expect(seenCarts).toEqual(["anon-1", "anon-2"]);
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-sdk test -- cart.test`
Expected: FAIL — current `merge(anonymousCartId, auth)` signature doesn't match `merge(customerCartId, anonCartIds, auth)`; path is wrong; body is empty.

- [ ] **Step 3: Fix the implementation**

In `packages/sdk/src/services/cart.ts`, replace the current `merge` (lines 173-180):

```typescript
  /** Merges an anonymous cart into the customer's cart. Requires customer auth. */
  async merge(anonymousCartId: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "POST",
      path: `${this.base()}/${anonymousCartId}/merge`,
      auth: requireCustomerAuth(auth),
    });
  }
```

with:

```typescript
  /**
   * Merges one or more anonymous carts into the specified customer cart.
   * Per Emporix: the target cart in the path **must belong to the logged-in
   * customer**, and each id in `anonymousCartIds` must belong to an anonymous
   * customer. Anonymous carts go `CLOSED` on success.
   *
   * Requires a customer `AuthContext`.
   */
  async merge(
    customerCartId: string,
    anonymousCartIds: string[],
    auth: AuthContext,
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "POST",
      path: `${this.base()}/${customerCartId}/merge`,
      auth: requireCustomerAuth(auth),
      body: { carts: anonymousCartIds },
    });
  }
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm -F @viu/emporix-sdk test -- cart.test`
Expected: PASS for all cart tests.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/tests/services/cart.test.ts
git commit -m "fix(cart)!: merge() targets customer cart; body carries anonymous ids"
```

---

## Task 3: SDK — reshape `CartService.getCurrent`

**Files:**
- Modify: `packages/sdk/src/services/cart.ts:70-77`
- Modify: `packages/sdk/tests/services/cart.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/sdk/tests/services/cart.test.ts` (after the existing `merge()` tests, before the closing `});`):

```typescript
it("getCurrent() sends siteCode and returns the cart", async () => {
  let seenQuery: URLSearchParams | undefined;
  server.use(
    http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
      seenQuery = new URL(request.url).searchParams;
      return HttpResponse.json({ id: "current-cart", items: [] });
    }),
  );
  const c = await svc().getCurrent(
    { kind: "customer", token: "CUST" },
    { siteCode: "main" },
  );
  expect(c?.id).toBe("current-cart");
  expect(seenQuery?.get("siteCode")).toBe("main");
  expect(seenQuery?.has("create")).toBe(false);
});

it("getCurrent({ create: true }) sends create=true", async () => {
  let seenQuery: URLSearchParams | undefined;
  server.use(
    http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
      seenQuery = new URL(request.url).searchParams;
      return HttpResponse.json({ id: "created-cart", items: [] });
    }),
  );
  await svc().getCurrent(
    { kind: "customer", token: "CUST" },
    { siteCode: "main", create: true },
  );
  expect(seenQuery?.get("create")).toBe("true");
});

it("getCurrent() forwards optional type and legalEntityId", async () => {
  let seenQuery: URLSearchParams | undefined;
  server.use(
    http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
      seenQuery = new URL(request.url).searchParams;
      return HttpResponse.json({ id: "x", items: [] });
    }),
  );
  await svc().getCurrent(
    { kind: "customer", token: "CUST" },
    { siteCode: "main", type: "shopping", legalEntityId: "le-1" },
  );
  expect(seenQuery?.get("type")).toBe("shopping");
  expect(seenQuery?.get("legalEntityId")).toBe("le-1");
});

it("getCurrent() returns null on a 404 (no cart, create=false)", async () => {
  server.use(
    http.get("https://api.emporix.io/cart/acme/carts", () =>
      HttpResponse.json({ message: "not found" }, { status: 404 }),
    ),
  );
  const c = await svc().getCurrent(
    { kind: "customer", token: "CUST" },
    { siteCode: "main" },
  );
  expect(c).toBeNull();
});

it("getCurrent() propagates non-404 errors", async () => {
  server.use(
    http.get("https://api.emporix.io/cart/acme/carts", () =>
      HttpResponse.json({ message: "boom" }, { status: 500 }),
    ),
  );
  await expect(
    svc().getCurrent(
      { kind: "customer", token: "CUST" },
      { siteCode: "main" },
    ),
  ).rejects.toThrow();
});
```

Note: the existing test file imports `EmporixValidationError` only. Add an import for `EmporixNotFoundError` if needed for any direct assertion, but the cleanest assertion above is `.toBeNull()` and `.rejects.toThrow()` — both work without extra imports.

- [ ] **Step 2: Run, expect failures**

Run: `pnpm -F @viu/emporix-sdk test -- cart.test`
Expected: 5 failures — `getCurrent` signature doesn't match (missing `opts` param), tests construct calls the old impl can't handle.

- [ ] **Step 3: Replace `getCurrent`**

Add the necessary import at the top of `packages/sdk/src/services/cart.ts`:

```typescript
import { EmporixNotFoundError } from "../core/errors";
```

In `packages/sdk/src/services/cart.ts`, replace lines 70-77:

```typescript
  /**
   * Get the customer / anonymous cart matching the given criteria. Per Emporix:
   * uniqueness is defined by `siteCode` + `type` + `legalEntityId` +
   * (`customerId` derived from a customer token, or `sessionId` derived from an
   * anonymous token). With `create: true`, Emporix creates a new cart if none
   * matches.
   *
   * Returns `null` on 404 (no cart found and `create` was not set). All other
   * errors are propagated.
   */
  async getCurrent(
    auth: AuthContext,
    opts: { siteCode: string; type?: string; legalEntityId?: string; create?: boolean },
  ): Promise<Cart | null> {
    const query: Record<string, string | number> = { siteCode: opts.siteCode };
    if (opts.type !== undefined) query.type = opts.type;
    if (opts.legalEntityId !== undefined) query.legalEntityId = opts.legalEntityId;
    if (opts.create) query.create = "true";
    try {
      return await this.ctx.http.request<Cart>({
        method: "GET",
        path: this.base(),
        query,
        auth: requireCartAuth(auth),
      });
    } catch (e) {
      if (e instanceof EmporixNotFoundError) return null;
      throw e;
    }
  }
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm -F @viu/emporix-sdk test -- cart.test`
Expected: PASS — all 12 cart tests green (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/tests/services/cart.test.ts
git commit -m "feat(cart)!: getCurrent(auth, { siteCode, type?, legalEntityId?, create? })"
```

---

## Task 4: React — cart onboarding in `useCustomerSession.login`

**Files:**
- Modify: `packages/react/src/hooks/use-customer-session.ts`
- Modify: `packages/react/tests/use-customer-session.test.tsx`

- [ ] **Step 1: Inspect current login**

Read `packages/react/src/hooks/use-customer-session.ts` lines 56-80 to see the current `login` and `signup` implementations. You'll add the cart-onboarding block **after** `storage.setCustomerToken(session.customerToken)` and **before** any cache invalidation in both functions.

- [ ] **Step 2: Write the failing tests**

Add to `packages/react/tests/use-customer-session.test.tsx`. The existing file already sets up an MSW server with `/customer/{tenant}/login` etc.; piggyback on it.

Add new MSW handlers (in a `beforeEach`-scoped server.use or at the top of the new test block):

```typescript
import { http, HttpResponse } from "msw";

describe("useCustomerSession — cart onboarding on login", () => {
  it("loads the customer cart and writes cartId to storage", async () => {
    let getCurrentCall: URLSearchParams | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", ({ request }) => {
        getCurrentCall = new URL(request.url).searchParams;
        return HttpResponse.json({ id: "cust-cart", items: [] });
      }),
    );
    const storage = createMemoryStorage();
    const wrapper = wrap(storage);   // wrap = the existing test helper; siteCode "main" is in storefront context
    const { result } = renderHook(() => useCustomerSession(), { wrapper });

    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "x" });
    });

    expect(getCurrentCall?.get("siteCode")).toBe("main");
    expect(getCurrentCall?.get("create")).toBe("true");
    expect(storage.getCartId()).toBe("cust-cart");
  });

  it("merges the anonymous cartId from storage into the customer cart", async () => {
    let mergeBody: { carts?: string[] } | undefined;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () =>
        HttpResponse.json({ id: "cust-cart", items: [] }),
      ),
      http.post(
        "https://api.emporix.io/cart/acme/carts/cust-cart/merge",
        async ({ request }) => {
          mergeBody = (await request.json()) as { carts?: string[] };
          return HttpResponse.json({ id: "cust-cart" });
        },
      ),
    );
    const storage = createMemoryStorage();
    storage.setCartId("anon-cart");

    const wrapper = wrap(storage);
    const { result } = renderHook(() => useCustomerSession(), { wrapper });
    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "x" });
    });

    expect(mergeBody?.carts).toEqual(["anon-cart"]);
    expect(storage.getCartId()).toBe("cust-cart");
  });

  it("skips cart onboarding when storefront context.siteCode is missing", async () => {
    let getCalled = false;
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () => {
        getCalled = true;
        return HttpResponse.json({ id: "x", items: [] });
      }),
    );
    const storage = createMemoryStorage();
    const wrapper = wrapWithoutSiteCode(storage);   // see helper note below
    const { result } = renderHook(() => useCustomerSession(), { wrapper });
    await act(async () => {
      await result.current.login({ email: "a@b.co", password: "x" });
    });
    expect(getCalled).toBe(false);
    expect(storage.getCartId()).toBeNull();
  });

  it("login resolves even if cart onboarding throws (best-effort)", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () =>
        HttpResponse.json({ message: "boom" }, { status: 500 }),
      ),
    );
    const storage = createMemoryStorage();
    const wrapper = wrap(storage);
    const { result } = renderHook(() => useCustomerSession(), { wrapper });
    await act(async () => {
      await expect(
        result.current.login({ email: "a@b.co", password: "x" }),
      ).resolves.not.toThrow();
    });
    expect(storage.getCustomerToken()).not.toBeNull(); // login still succeeded
    expect(storage.getCartId()).toBeNull();             // cart-id stayed empty
  });

  it("signup() runs the same onboarding block", async () => {
    server.use(
      http.get("https://api.emporix.io/cart/acme/carts", () =>
        HttpResponse.json({ id: "fresh-cart", items: [] }),
      ),
    );
    const storage = createMemoryStorage();
    const wrapper = wrap(storage);
    const { result } = renderHook(() => useCustomerSession(), { wrapper });
    await act(async () => {
      await result.current.signup({ email: "new@b.co", password: "x" });
    });
    expect(storage.getCartId()).toBe("fresh-cart");
  });
});
```

> **Helper note:** the existing test file likely has a `wrap(storage)` helper that constructs an `EmporixClient` with a fixed `storefront.context` (look for `siteCode: "main"`). If it does **not** include `context.siteCode`, edit the helper to add `context: { siteCode: "main" }` — that is the realistic config for tests. If a helper needs a no-`siteCode` variant, copy it as `wrapWithoutSiteCode(storage)` and omit the `context` property.

- [ ] **Step 3: Run, expect failures**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-session.test`
Expected: 5 failures — current `login` doesn't call `getCurrent` at all.

- [ ] **Step 4: Implement the onboarding block**

In `packages/react/src/hooks/use-customer-session.ts`, locate the `login` definition (around line 56). After `storage.setCustomerToken(session.customerToken);` (line 59) and before any cache-invalidation calls, insert:

```typescript
      await onboardCustomerCart({
        client,
        storage,
        customerToken: session.customerToken,
      });
```

Do the same in the `signup` flow at line 79 (after `storage.setCustomerToken(session.customerToken);`).

At the bottom of the file (outside the hook), add the helper:

```typescript
async function onboardCustomerCart(opts: {
  client: EmporixClient;
  storage: EmporixStorage;
  customerToken: string;
}): Promise<void> {
  const { client, storage, customerToken } = opts;
  const siteCode = client.config?.credentials?.storefront?.context?.siteCode;
  if (!siteCode) return; // No site context configured → skip cart onboarding.

  const ctx = auth.customer(customerToken);
  try {
    const customerCart = await client.carts.getCurrent(ctx, {
      siteCode,
      create: true,
    });
    if (!customerCart?.cartId) return;
    const anonCartId = storage.getCartId();
    if (anonCartId && anonCartId !== customerCart.cartId) {
      await client.carts.merge(customerCart.cartId, [anonCartId], ctx);
    }
    storage.setCartId(customerCart.cartId);
  } catch {
    // Cart onboarding is best-effort; never fail login on cart trouble.
    // (Consumers who care can observe failures via the SDK logger.)
  }
}
```

Add the imports at the top of the file if missing:

```typescript
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "../storage";
import { auth } from "@viu/emporix-sdk";
```

(Most are likely already imported — only add what's missing.)

- [ ] **Step 5: Build SDK so the React package picks up the new types**

```bash
pnpm -F @viu/emporix-sdk build
```

- [ ] **Step 6: Run, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-session.test`
Expected: PASS — all new tests green plus existing ones.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/use-customer-session.ts packages/react/tests/use-customer-session.test.tsx
git commit -m "feat(customer): login and signup onboard the customer cart"
```

---

## Task 5: Docs + changeset

**Files:**
- Create: `.changeset/customer-cart-onboarding.md`
- Modify: `docs/auth.md`
- Modify: `docs/react.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/customer-cart-onboarding.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Customer-cart onboarding on login. After `useCustomerSession.login()` or `signup()` succeeds, the SDK now automatically loads (or creates) the customer's open Emporix cart for the configured `siteCode` and merges any guest cart into it. The resulting `cartId` is written into `EmporixStorage`, so the UI sees the cart immediately.

**SDK (`@viu/emporix-sdk`)**

- `EmporixClient.config` is now a public read-only field, so hosts can read static settings such as `storefront.context.siteCode` without re-plumbing.
- **BREAKING:** `CartService.getCurrent(auth)` is now `getCurrent(auth, { siteCode, type?, legalEntityId?, create? })`. `siteCode` is required per the Emporix spec. Returns `null` on 404; with `create: true`, Emporix creates a new cart if none matches.
- **BREAKING / fix:** `CartService.merge(anonymousCartId, auth)` is now `merge(customerCartId, anonymousCartIds: string[], auth)`. The old signature put the wrong cart-id in the path and sent an empty body — it never actually worked against Emporix. The new signature matches the documented contract.

**React (`@viu/emporix-sdk-react`)**

- `useCustomerSession.login()` and `useCustomerSession.signup()` now run a best-effort cart-onboarding step: `client.carts.getCurrent({ siteCode, create: true })` to load (or create) the customer cart, then `client.carts.merge(customerCartId, [anonCartId])` if a guest `cartId` was in storage, and finally `storage.setCartId(customerCartId)`. Failures are swallowed so login never blocks on cart trouble. Skipped silently if no `storefront.context.siteCode` is configured.

**Migration**

```ts
// SDK getCurrent:
- const cart = await client.carts.getCurrent(auth.customer(token));
+ const cart = await client.carts.getCurrent(auth.customer(token), { siteCode: "main" });

// SDK merge:
- await client.carts.merge(anonCartId, auth.customer(token));
+ await client.carts.merge(customerCartId, [anonCartId], auth.customer(token));
```

React consumers do not need to change anything — the new behavior kicks in automatically as long as the client's `storefront.context.siteCode` is set (which the vite-spa Example already does).
```

- [ ] **Step 2: Update `docs/auth.md`**

In `docs/auth.md`, after the existing "Persisting anonymous sessions" subsection, add:

```markdown
### Customer cart on login

When a customer logs in (or signs up), the SDK can automatically pull their open Emporix cart and merge any guest cart that was already in storage. This is wired in `useCustomerSession.login()` and `signup()`; no consumer code change is required.

The flow:

1. `POST /customer/{tenant}/login` → access token (+ saas, refresh) → `storage.setCustomerToken(...)`.
2. `GET /cart/{tenant}/carts?siteCode=<from storefront.context>&create=true` (customer auth) → returns the open customer cart, or creates one.
3. If `storage.getCartId()` held an anonymous cartId from before login: `POST /cart/{tenant}/carts/{customerCartId}/merge` with `{ carts: [anonCartId] }` → anonymous cart goes `CLOSED`, items are folded into the customer cart per Emporix's deterministic merge rules.
4. `storage.setCartId(customerCartId)`.

This is **best-effort** — if any of steps 2-3 fail, the user is still logged in. Failures are silently caught so login never blocks on cart trouble. Cart-merge conflicts (same item in both carts, etc.) are resolved server-side per the rules in [Emporix's Carts overview](https://developer.emporix.io/ce/core-commerce/carts).

Emporix's constraint: **one open cart per customer per `siteCode`/`type`/`legalEntityId` tuple** (cart type defaults to `shopping`). The SDK's onboarding flow respects this.

**Skip condition:** if the `EmporixClient` was created without `credentials.storefront.context.siteCode`, the onboarding block is a no-op. Set `siteCode` in the storefront context (same place the SDK reads it for anonymous-login context) to enable.
```

- [ ] **Step 3: Update `docs/react.md`**

In `docs/react.md`, find the `useCustomerSession()` entry and append:

```markdown

After a successful `login` or `signup`, the hook runs a best-effort cart-onboarding step: it pulls the customer's open cart from Emporix (`client.carts.getCurrent({ siteCode, create: true })`), merges any guest cart-id from storage into it, and writes the customer-cart-id back to `storage.setCartId(...)`. The UI sees the cart immediately on the next render. See [Customer cart on login](./auth.md#customer-cart-on-login) for the full flow and skip conditions.
```

- [ ] **Step 4: Commit**

```bash
git add .changeset/customer-cart-onboarding.md docs/auth.md docs/react.md
git commit -m "docs(docs): document customer-cart onboarding on login"
```

---

## Final Verification

- [ ] **Full monorepo build + tests**

```bash
pnpm -r build
pnpm -r test
```

Expected: ALL PASS, no TypeScript errors.

- [ ] **Cart-onboarding signature surface check**

```bash
git grep -nE "carts\.merge\(\w+, \{" packages/ examples/ 2>/dev/null
```

Expected: empty — no consumer is calling the old `merge(id, auth)` form. If matches are found, they must already be updated (or they're false positives in a comment/string).

- [ ] **Runtime smoke against `viu`**

Use the existing customer credentials in the viu tenant. If none, create a test customer manually first via the API or the management dashboard.

1. Start the vite-spa:

```bash
cat > examples/vite-spa/.env.local <<'EOF'
VITE_EMPORIX_TENANT=viu
VITE_EMPORIX_STOREFRONT_CLIENT_ID=miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO
EOF
pnpm -F @viu/emporix-examples-vite-spa dev
```

2. Open in Chrome (DevTools open, Network panel visible).
3. `/guest` → click "Start guest cart" → cart-A is created and persisted (`localStorage.emporix.cartId`).
4. `/account` → enter test customer credentials → click Log in.
5. Verify the Network panel shows, in order:
   - `POST /customer/viu/login` → 200
   - `GET /cart/viu/carts?siteCode=main&create=true` → 200 (cart-B)
   - `POST /cart/viu/carts/<cart-B>/merge { carts: ["<cart-A>"] }` → 200
6. Verify `localStorage.emporix.cartId` equals cart-B (not cart-A).
7. Refresh the page. Cart-B should still be in storage and `useCart(cart-B)` returns it.
8. Log out (or clear `localStorage.emporix.customerToken`), log in again **without** clicking guest cart first. Network should show login + the `GET /carts?create=true`, **no merge** (anon cartId was null). `localStorage.emporix.cartId` should now be cart-B (or a new cart if Emporix decided so).

- [ ] **Cleanup**

```bash
rm examples/vite-spa/.env.local
# stop the dev server
```

- [ ] **Changeset present**

```bash
ls .changeset/customer-cart-onboarding.md
```

Expected: file exists.

---

## Follow-up (out of scope)

- B2B cart-onboarding by `type` and `legalEntityId` — e.g. running the same flow for quote carts in parallel to shopping carts. Open a separate plan when needed.
- Same hook-only customer-cart-onboarding for `examples/next-app-router` — needs SSR-aware orchestration (cart calls in a server action vs the client).
- UI for cart-merge conflicts — surfacing "items had different quantities" results to the user; needs UX design.
- A `useCustomerCart()` higher-level hook that exposes "the current customer cart" as a single React-Query result (instead of consumers wiring `useCart(storage.getCartId())` themselves).
