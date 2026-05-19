# Plan C — Anonymous Checkout & Session Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind `currency`/`siteCode`/`targetLocation` at anonymous-login so `match-prices-by-context` works, add a `useMatchPrices` React hook, and demonstrate a full end-to-end guest checkout in the `next-app-router` and `vite-spa` examples, verified live against tenant `viu`.

**Architecture:** `EmporixConfig.credentials.storefront` gains an optional `context`. `DefaultTokenProvider.fetchAnonymous` appends those fields as query params on `GET /customerlogin/auth/anonymous/{login,refresh}`. The context is fixed at config time, so the single anonymous-session slot stays correct (no per-call context → no cache collisions). A thin `useMatchPrices` hook wraps `client.prices.matchByContext`. The examples drive the guest flow with the client directly (anonymous `AuthContext`) for cart/checkout plus the new hook for pricing.

**Tech Stack:** TypeScript 5.x strict, vitest + msw, @testing-library/react + jsdom, React 18, Next 14 App Router, Vite SPA, chrome-devtools MCP for live verification.

**Spec:** `docs/superpowers/specs/2026-05-18-pricing-generated-types-guest-checkout-design.md` §C, §D.

**Depends on:** Plan B merged to `main` (`PriceService` + `EmporixClient.prices`).

**Branch:** create `feat/anonymous-checkout` from `main` before Task 1.

---

### Task 1: Anonymous-session context in config & auth

**Files:**
- Modify: `packages/sdk/src/core/config.ts:20-23` (`StorefrontCredentials`)
- Modify: `packages/sdk/src/core/auth.ts:171-198` (`fetchAnonymous`)
- Test: `packages/sdk/tests/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/auth.test.ts` (reuse its existing msw `server`; if none, use the `setupServer` pattern from other test files):

```ts
it("sends currency/siteCode/targetLocation as anonymous-login query params", async () => {
  let url = "";
  server.use(
    http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", ({ request }) => {
      url = request.url;
      return HttpResponse.json({ access_token: "a", refresh_token: "r", sessionId: "s", expires_in: 3600 });
    }),
  );
  const { EmporixClient } = await import("../src/index");
  const client = new EmporixClient({
    tenant: "viu",
    credentials: {
      storefront: { clientId: "sf", context: { currency: "CHF", siteCode: "main", targetLocation: "CH" } },
    },
  });
  await client.customers.anonymous();
  const u = new URL(url);
  expect(u.searchParams.get("currency")).toBe("CHF");
  expect(u.searchParams.get("siteCode")).toBe("main");
  expect(u.searchParams.get("targetLocation")).toBe("CH");
});

it("omits context params when no context is configured", async () => {
  let url = "";
  server.use(
    http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", ({ request }) => {
      url = request.url;
      return HttpResponse.json({ access_token: "a", refresh_token: "r", sessionId: "s", expires_in: 3600 });
    }),
  );
  const { EmporixClient } = await import("../src/index");
  const client = new EmporixClient({ tenant: "viu", credentials: { storefront: { clientId: "sf" } } });
  await client.customers.anonymous();
  const u = new URL(url);
  expect(u.searchParams.has("currency")).toBe(false);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @viu/emporix-sdk test -- auth`
Expected: FAIL — `context` is not a valid `StorefrontCredentials` field (typecheck) / params not sent.

- [ ] **Step 3: Extend `StorefrontCredentials`**

In `packages/sdk/src/core/config.ts`, replace the `StorefrontCredentials` interface (lines 20-23) with:

```ts
/** Storefront credential — anonymous token needs the client id only, no secret. */
export interface StorefrontCredentials {
  clientId: string;
  /**
   * Session context bound at anonymous-login time. Required for
   * `prices.matchByContext` to resolve currency/site/country server-side.
   * `targetLocation` is an ISO country code.
   */
  context?: { currency?: string; siteCode?: string; targetLocation?: string };
}
```

- [ ] **Step 4: Send the context on anonymous login/refresh**

In `packages/sdk/src/core/auth.ts` `fetchAnonymous` (lines 171-198), after the existing
`url.searchParams.set("client_id", sf.clientId);` line (line 178) add:

```ts
const c = sf.context;
if (c?.currency) url.searchParams.set("currency", c.currency);
if (c?.siteCode) url.searchParams.set("siteCode", c.siteCode);
if (c?.targetLocation) url.searchParams.set("targetLocation", c.targetLocation);
```

No cache-key change is needed: the context is fixed for the provider instance
(config-level, never per-call), so the single anonymous-session slot cannot
collide. Note this reasoning in a one-line code comment above the block:
`// Context is config-fixed → single anon slot stays correct (no per-call ctx).`

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter @viu/emporix-sdk test -- auth && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/config.ts packages/sdk/src/core/auth.ts packages/sdk/tests/auth.test.ts
git commit -m "feat(auth): bind currency/siteCode/targetLocation at anonymous login"
```

---

### Task 2: `useMatchPrices` React hook

**Files:**
- Create: `packages/react/src/hooks/use-match-prices.ts`
- Modify: `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts:9-22`
- Test: `packages/react/tests/use-match-prices.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/use-match-prices.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, createMemoryStorage, useMatchPrices } from "../src/index";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "a", refresh_token: "r", sessionId: "s", expires_in: 3600 }),
  ),
  http.post("https://api.emporix.io/price/viu/match-prices-by-context", () =>
    HttpResponse.json([{ priceId: "pr1", effectiveValue: 12.5 }]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrapper({ children }: { children: ReactNode }) {
  const client = new EmporixClient({ tenant: "viu", credentials: { storefront: { clientId: "sf" } } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <EmporixProvider client={client} storage={createMemoryStorage()}>
        {children}
      </EmporixProvider>
    </QueryClientProvider>
  );
}

describe("useMatchPrices", () => {
  it("resolves prices for the given items", async () => {
    const { result } = renderHook(
      () => useMatchPrices([{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 1 } }]),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.effectiveValue).toBe(12.5);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @viu/emporix-sdk-react test -- use-match-prices`
Expected: FAIL — `useMatchPrices` is not exported.

- [ ] **Step 3: Implement the hook**

Create `packages/react/src/hooks/use-match-prices.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext, type PriceMatch, type PriceMatchItem } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

/**
 * Resolves prices for `items` via `prices.matchByContext`. Defaults to the
 * anonymous session token; pass a customer token for personalized pricing.
 * The SDK does not cache prices — control freshness via the query key /
 * `enabled` (re-run before checkout).
 */
export function useMatchPrices(
  items: PriceMatchItem[],
  options: { enabled?: boolean; customerToken?: string | null } = {},
): UseQueryResult<PriceMatch[]> {
  const { client } = useEmporix();
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useQuery({
    queryKey: ["emporix", "match-prices", { tenant: client.tenant, items, anon: !options.customerToken }],
    enabled: (options.enabled ?? true) && items.length > 0,
    queryFn: () => client.prices.matchByContext(items, ctx),
  });
}
```

- [ ] **Step 4: Export it**

In `packages/react/src/hooks/index.ts`, add `export { useMatchPrices } from "./use-match-prices";` alongside the other hook re-exports.

In `packages/react/src/index.ts`, add `useMatchPrices` to the hook list imported/exported from `./hooks/index` (the block on lines 9-22).

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm --filter @viu/emporix-sdk-react test -- use-match-prices && pnpm --filter @viu/emporix-sdk-react typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-match-prices.ts packages/react/src/hooks/index.ts \
  packages/react/src/index.ts packages/react/tests/use-match-prices.test.tsx
git commit -m "feat(react): add useMatchPrices hook"
```

---

### Task 3: Probe tenant `viu` for the real session context

Do **not** hardcode `CHF`/`main`/`CH`. Determine the tenant's real values first.

**Files:** none (investigation; records a value used in Tasks 4–5)

- [ ] **Step 1: Resolve a product id and the site/currency**

Run (node-server already lists `viu` products anonymously):

```bash
cd examples/node-server
EMPORIX_TENANT=viu EMPORIX_STOREFRONT_CLIENT_ID=miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO \
  pnpm start 2>&1 | head -20
```

Note one real product `id` from the output.

- [ ] **Step 2: Confirm site & currency**

Run:

```bash
curl -s "https://api.emporix.io/site/viu/sites" | head -c 2000
```

Read the response: record the site `code` (e.g. `main`), its `defaultLanguage`/`currency`, and the country. Write the three values into a scratch note `docs/superpowers/plans/plan-c-viu-context.md`:

```markdown
# Plan C — viu live context (verified <date>)
- siteCode: <value>
- currency: <value>
- targetLocation: <ISO country>
- sample productId: <value>
```

If `/site/viu/sites` requires auth, instead read the values from the
anonymous-login response used by node-server, or from the Emporix tenant
admin — the requirement is real verified values, not guesses.

- [ ] **Step 3: Commit the note**

```bash
git add docs/superpowers/plans/plan-c-viu-context.md
git commit -m "docs(examples): record verified viu session context"
```

---

### Task 4: Guest checkout in `vite-spa`

**Files:**
- Modify: `examples/vite-spa/src/main.tsx:8-14` (add `context`)
- Create: `examples/vite-spa/src/GuestCheckout.tsx`
- Modify: `examples/vite-spa/src/App.tsx` (add a route/link to it)

Use the verified values from `docs/superpowers/plans/plan-c-viu-context.md`
wherever `<SITE>`, `<CURRENCY>`, `<COUNTRY>`, `<PRODUCT_ID>` appear.

- [ ] **Step 1: Configure the storefront context**

In `examples/vite-spa/src/main.tsx`, replace the `credentials` block (lines 11-13) with:

```ts
  credentials: {
    storefront: {
      clientId: import.meta.env.VITE_EMPORIX_STOREFRONT_CLIENT_ID ?? "",
      context: { currency: "<CURRENCY>", siteCode: "<SITE>", targetLocation: "<COUNTRY>" },
    },
  },
```

- [ ] **Step 2: Create the guest-checkout component**

Create `examples/vite-spa/src/GuestCheckout.tsx`:

```tsx
import { useState } from "react";
import { useEmporix, useMatchPrices } from "@viu/emporix-sdk-react";

const PRODUCT_ID = "<PRODUCT_ID>";
const ANON = { kind: "anonymous" } as const;

/** Full guest flow: anonymous cart → add item → match prices → place order. */
export function GuestCheckout(): React.JSX.Element {
  const { client } = useEmporix();
  const [cartId, setCartId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prices = useMatchPrices(
    [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }],
    { enabled: cartId !== null },
  );

  async function startCart(): Promise<void> {
    setError(null);
    try {
      const cart = await client.carts.create(undefined, ANON);
      await client.carts.addItem(cart.id, { productId: PRODUCT_ID, quantity: 1 }, ANON);
      setCartId(cart.id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function placeOrder(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      // Freshness: re-match right before ordering.
      await client.prices.matchByContext(
        [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }],
        ANON,
      );
      const r = await client.checkout.placeOrder(
        {
          cartId,
          customer: { email: "guest@example.com", guest: true },
          shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
          addresses: [
            { contactName: "Guest", street: "S", zipCode: "1", city: "C", country: "<COUNTRY>", type: "SHIPPING" },
            { contactName: "Guest", street: "S", zipCode: "1", city: "C", country: "<COUNTRY>", type: "BILLING" },
          ],
          paymentMethods: [{ provider: "none", method: "invoice" }],
        },
        ANON,
      );
      setOrderId(r.orderId);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main>
      <h1>Guest checkout</h1>
      {!cartId && <button onClick={() => void startCart()}>Start guest cart</button>}
      {cartId && <p>Cart: {cartId}</p>}
      {prices.data && <p>Unit price: {prices.data[0]?.effectiveValue ?? "—"}</p>}
      {cartId && !orderId && (
        <button onClick={() => void placeOrder()}>Place guest order</button>
      )}
      {orderId && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
```

- [ ] **Step 3: Route to it**

In `examples/vite-spa/src/App.tsx`: import `GuestCheckout`, add a `<Link to="/guest">Guest checkout</Link>` next to the existing nav links, and add `<Route path="/guest" element={<GuestCheckout />} />` to the `<Routes>` block.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @viu/emporix-examples-vite-spa typecheck` (or the example's package name as defined in its `package.json`).
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add examples/vite-spa/src/main.tsx examples/vite-spa/src/GuestCheckout.tsx examples/vite-spa/src/App.tsx
git commit -m "feat(examples): guest checkout flow in vite-spa"
```

---

### Task 5: Guest checkout in `next-app-router`

**Files:**
- Create: `examples/next-app-router/app/guest-checkout/page.tsx`
- Modify: `examples/next-app-router/app/providers.tsx` (ensure storefront client + context configured) — confirm by reading it first

- [ ] **Step 1: Inspect the provider wiring**

Run: `cat -n examples/next-app-router/app/providers.tsx`
Confirm the client passed to `EmporixProvider` includes `credentials.storefront`.
If it does not set `context`, add `context: { currency: "<CURRENCY>", siteCode: "<SITE>", targetLocation: "<COUNTRY>" }` to its `storefront` block (values from `plan-c-viu-context.md`). Make only that edit.

- [ ] **Step 2: Create the guest-checkout page**

Create `examples/next-app-router/app/guest-checkout/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useEmporix, useMatchPrices } from "@viu/emporix-sdk-react";

const PRODUCT_ID = "<PRODUCT_ID>";
const ANON = { kind: "anonymous" } as const;

export default function GuestCheckoutPage(): React.JSX.Element {
  const { client } = useEmporix();
  const [cartId, setCartId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prices = useMatchPrices(
    [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }],
    { enabled: cartId !== null },
  );

  async function startCart(): Promise<void> {
    setError(null);
    try {
      const cart = await client.carts.create(undefined, ANON);
      await client.carts.addItem(cart.id, { productId: PRODUCT_ID, quantity: 1 }, ANON);
      setCartId(cart.id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function placeOrder(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      await client.prices.matchByContext(
        [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }],
        ANON,
      );
      const r = await client.checkout.placeOrder(
        {
          cartId,
          customer: { email: "guest@example.com", guest: true },
          shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
          addresses: [
            { contactName: "Guest", street: "S", zipCode: "1", city: "C", country: "<COUNTRY>", type: "SHIPPING" },
            { contactName: "Guest", street: "S", zipCode: "1", city: "C", country: "<COUNTRY>", type: "BILLING" },
          ],
          paymentMethods: [{ provider: "none", method: "invoice" }],
        },
        ANON,
      );
      setOrderId(r.orderId);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <main>
      <h1>Guest checkout</h1>
      {!cartId && <button onClick={() => void startCart()}>Start guest cart</button>}
      {cartId && <p>Cart: {cartId}</p>}
      {prices.data && <p>Unit price: {prices.data[0]?.effectiveValue ?? "—"}</p>}
      {cartId && !orderId && <button onClick={() => void placeOrder()}>Place guest order</button>}
      {orderId && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @viu/emporix-examples-next-app-router typecheck` (or the example's actual package name).
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add examples/next-app-router/app/guest-checkout/page.tsx examples/next-app-router/app/providers.tsx
git commit -m "feat(examples): guest checkout page in next-app-router"
```

---

### Task 6: Live verification against tenant `viu`

Credentials: tenant `viu`, storefront client id
`miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO`. Set them via the
example env files (`.env`, never committed; `.env.example` only).

- [ ] **Step 1: Verify `vite-spa` end-to-end**

```bash
cd examples/vite-spa
VITE_EMPORIX_TENANT=viu \
VITE_EMPORIX_STOREFRONT_CLIENT_ID=miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO \
  pnpm dev
```

With the chrome-devtools MCP: open the dev URL, navigate to `/guest`, click
"Start guest cart", confirm a cart id and a non-empty unit price render, click
"Place guest order", and confirm an order id appears with no console errors.
If the API rejects the order (e.g. required shipping method), capture the
Emporix error body and adjust the `shipping`/`paymentMethods`/`addresses`
fields in `GuestCheckout.tsx` to satisfy the tenant config, then re-verify.

- [ ] **Step 2: Verify `next-app-router` end-to-end**

```bash
cd examples/next-app-router
NEXT_PUBLIC_EMPORIX_TENANT=viu \
EMPORIX_STOREFRONT_CLIENT_ID=miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO \
  pnpm dev
```

With chrome-devtools: open `/guest-checkout`, run the same flow, confirm cart
id → price → order id with no console/server errors. Apply the same
field-correction loop if the tenant rejects the order.

- [ ] **Step 2b: Reflect any field corrections back into both examples**

If Step 1 or 2 required changing the checkout payload, apply the identical
correction to *both* `GuestCheckout.tsx` and `guest-checkout/page.tsx` so they
stay in sync, then commit:

```bash
git add examples/vite-spa/src/GuestCheckout.tsx examples/next-app-router/app/guest-checkout/page.tsx
git commit -m "fix(examples): align guest checkout payload with viu tenant config"
```

- [ ] **Step 3: Document the verified flow**

Append a "Guest (anonymous) checkout" section to `docs/checkout.md` describing
the verified sequence (anonymous token with context → cart → add item →
`matchByContext` → re-match → `placeOrder` with `customer.guest:true`,
anonymous auth, no saas-token) and that the SDK is stateless on price
freshness (caller re-matches).

```bash
git add docs/checkout.md
git commit -m "docs(checkout): document the verified anonymous guest checkout flow"
```

---

### Task 7: Changeset & green gate

- [ ] **Step 1: Add changesets**

Create `.changeset/anonymous-checkout.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

`credentials.storefront.context` ({ currency, siteCode, targetLocation }) is
now sent at anonymous-login so `prices.matchByContext` resolves prices from
the session. Adds the `useMatchPrices` React hook. The next-app-router and
vite-spa examples now include a verified end-to-end anonymous guest checkout.
```

- [ ] **Step 2: Full green gate**

Run:

```bash
pnpm build && pnpm typecheck && pnpm -r --filter "./packages/*" test
```

Expected: all green; coverage ≥80% on `packages/*`.

- [ ] **Step 3: Commit**

```bash
git add .changeset/anonymous-checkout.md
git commit -m "chore(repo): add changeset for anonymous checkout + useMatchPrices"
```

- [ ] **Step 4: Finish the branch**

Use **superpowers:finishing-a-development-branch** (verify tests → 4-option menu → execute choice).

---

## Self-Review

- **Spec coverage (§C, §D):** `storefront.context` config — Task 1 Step 3; query params on login/refresh — Task 1 Step 4; cache reasoning (config-fixed, single slot) — Task 1 Step 4 note; `useMatchPrices` — Task 2; no hardcoded viu context (live probe) — Task 3; guest checkout in vite-spa + next — Tasks 4–5; re-match before order (freshness, caller-owned) — Tasks 4–5 `placeOrder`; live verification both apps — Task 6; docs — Task 6 Step 3; changesets (sdk+react minor) — Task 7. Covered.
- **Placeholder scan:** `<SITE>`/`<CURRENCY>`/`<COUNTRY>`/`<PRODUCT_ID>` are explicit substitution tokens resolved by the live probe in Task 3 and recorded in a tracked note before use — not deferred work. All component code is shown in full.
- **Type consistency:** `useMatchPrices(items, options)` signature, `PriceMatchItem`/`PriceMatch` (from Plan B), `client.prices.matchByContext`, `client.carts.create/addItem`, `client.checkout.placeOrder` with `customer.guest:true` + anonymous `AuthContext`, and `credentials.storefront.context` are used identically across config, auth, hook, both examples, tests, and changeset.
