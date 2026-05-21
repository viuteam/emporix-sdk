# Example-Apps Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten three example apps without changing observable behavior — replace the `wantCart`-boolean-as-bootstrap-trigger pattern with explicit `useCreateCart` + `useCart()` lifecycle, DRY the cart-discard logic into a helper, model UI state with a phase enum, and surface intentional cross-example duplication.

**Architecture:** Examples-only refactor. No SDK/React-package changes. The two guest-checkout examples switch from `useActiveCart(wantCart ? { create: true } : undefined)` to `useCart()` (storage-fallback variant from PR #35) + `useCreateCart` mutation for explicit creation. `useCart()` reads storage at every render and re-renders are driven by mutation state changes + `qc.invalidateQueries` — no more boolean-flag toggling hook behavior. Checkout page extracts its inline 35-line order payload. `displayName` duplication gets a marker comment.

**Tech Stack:** TypeScript, React 18, `@tanstack/react-query` v5, Next.js App Router, Vite + React Router. No new dependencies.

**Context for the engineer:**
- Branch: `refactor/examples-cleanup` (already created off `main` at `ac0c67e`).
- Examples have NO unit tests — verification is `pnpm typecheck` + `pnpm e2e` (live against `viu` tenant).
- `useCart()` (no-arg) and `useCartMutations()` (no-arg) were added in PR #35 — both read from `storage` automatically.
- `useCreateCart`'s `onSuccess` writes `storage.setCartId` AND invalidates `["emporix","cart"]` (also from PR #35). That invalidation triggers React-Query's subscribers to re-render — which makes `useCart()` re-read storage. This is the mechanism that replaces the `wantCart` setState.
- Why **not** `useActiveCart()` for guest-checkout? It seeds its cartId from storage **once** at mount (`useState` init), so external storage writes (from `useCreateCart` or `clearLocalCart`) don't reach it. `useCart()` reads storage at every render — the right primitive for explicit-lifecycle scenarios.
- E2E suite (6 tests) covers this flow live — if it stays green, the refactor preserves behavior.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `examples/vite-spa/src/GuestCheckout.tsx` | vite-spa guest flow | Full refactor (P1) |
| `examples/next-app-router/app/guest-checkout/page.tsx` | Next guest flow | Mirror refactor of vite-spa (P1) |
| `examples/next-app-router/app/checkout/page.tsx` | Next checkout demo | Extract order payload, conditional saasToken (P2) |
| `examples/vite-spa/src/App.tsx` | vite-spa root | One marker comment on `displayName` (P3) |
| `examples/next-app-router/app/page.tsx` | Next RSC catalog | One marker comment on `displayName` (P3) |

No new files. No new package deps.

---

## Task 1: Refactor `examples/vite-spa/src/GuestCheckout.tsx`

**Files:**
- Modify: `examples/vite-spa/src/GuestCheckout.tsx` (full rewrite, ~95 LOC down from ~120)

- [ ] **Step 1: Capture the current baseline**

Run e2e suite to confirm everything's green before changes:

```bash
set -a; source e2e/.env.local; set +a; pnpm e2e
```

Expected: 6/6 passing. If anything is red, **stop** — fix unrelated red before continuing.

- [ ] **Step 2: Rewrite the file**

Replace the entire content of `examples/vite-spa/src/GuestCheckout.tsx` with:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEmporix,
  useCart,
  useCartMutations,
  useCreateCart,
  useMatchPrices,
  useCheckout,
} from "@viu/emporix-sdk-react";

// Priced product on tenant `viu` (CHF/main/CH) — see plan-c-viu-context.md.
const PRODUCT_ID = "0f1e2d3c-4b5a";

type Phase = "empty" | "shopping" | "ordered";

/**
 * Hook-only guest flow: `useCart()` reads the active cartId from storage at
 * every render, paired with `useCreateCart` for explicit cart creation. The
 * cart survives page reloads via storage persistence of `cartId` and the
 * anonymous `sessionId`.
 */
export function GuestCheckout(): React.JSX.Element {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const cart = useCart();
  const cartId = cart.data?.id ?? null;
  const createCart = useCreateCart();
  const cartMutations = useCartMutations();
  const checkout = useCheckout();
  const prices = useMatchPrices(
    { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
    { enabled: cartId !== null },
  );
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function clearLocalCart(): Promise<void> {
    storage.setCartId(null);
    await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
  }

  async function startCart(): Promise<void> {
    setError(null);
    try {
      await createCart.mutateAsync({ currency: "CHF" });
    } catch (e) {
      setError(String(e));
    }
  }

  async function addSampleItem(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      const { data: matched } = await prices.refetch();
      const p = matched?.[0] as
        | { priceId?: string; originalValue?: number; effectiveValue?: number }
        | undefined;
      if (!p?.priceId) throw new Error("no price resolved for the product");
      await cartMutations.addItem.mutateAsync({
        itemYrn: `urn:yaas:hybris:product:product:${client.tenant};${PRODUCT_ID}`,
        quantity: 1,
        price: {
          priceId: p.priceId,
          originalAmount: p.originalValue ?? 0,
          effectiveAmount: p.effectiveValue ?? 0,
          currency: "CHF",
        },
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function placeOrder(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      const { data: fresh } = await prices.refetch();
      const amount = (fresh?.[0] as { effectiveValue?: number } | undefined)?.effectiveValue ?? 0;
      const r = await checkout.placeOrder.mutateAsync({
        input: {
          cartId,
          customer: { email: "guest@example.com", firstName: "Guest", lastName: "Shopper", guest: true },
          shipping: { methodId: "free", zoneId: "CH", methodName: "Free Shipping", amount: 0 },
          addresses: [
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "BILLING" },
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "SHIPPING" },
          ],
          paymentMethods: [{ provider: "custom", amount }],
        },
      });
      setOrderId(r.orderId ?? null);
      // Cart is CLOSED on Emporix after a successful order — clear local state.
      await clearLocalCart();
    } catch (e) {
      setError(String(e));
    }
  }

  async function discardCart(): Promise<void> {
    await clearLocalCart();
    setOrderId(null);
  }

  const itemCount = cart.data?.items?.length ?? 0;
  const phase: Phase = orderId ? "ordered" : cart.data ? "shopping" : "empty";

  return (
    <main>
      <h1>Guest checkout</h1>
      {phase === "empty" && (
        <button onClick={() => void startCart()} disabled={createCart.isPending}>
          {createCart.isPending ? "Starting…" : "Start guest cart"}
        </button>
      )}
      {phase === "shopping" && cartId && (
        <>
          <p>Cart: {cartId} ({itemCount} item(s))</p>
          {prices.data && (
            <p>
              Unit price:{" "}
              {(prices.data[0] as { effectiveValue?: number } | undefined)?.effectiveValue ?? "—"}
            </p>
          )}
          {itemCount === 0 ? (
            <button onClick={() => void addSampleItem()}>Add sample item</button>
          ) : (
            <button onClick={() => void placeOrder()}>Place guest order</button>
          )}
          <button onClick={() => void discardCart()}>Discard cart</button>
        </>
      )}
      {phase === "ordered" && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
```

- [ ] **Step 3: Typecheck the example**

```bash
pnpm -F @viu/emporix-examples-vite-spa typecheck
```

Expected: clean. If it fails on import of `useCart`/`useCreateCart`/`useQueryClient`, the SDK build may be stale. Rebuild:

```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-vite-spa typecheck
```

- [ ] **Step 4: Run e2e to verify behavior is preserved**

```bash
set -a; source e2e/.env.local; set +a; pnpm e2e
```

Expected: 6/6 passing. The critical spec is `e2e/specs/guest-checkout.spec.ts` — it covers the start → add-item → place-order flow.

If the discard-cart UI shows stale data after click (visual regression), it's likely the `useCart` re-render race — debug by checking React-Query devtools or by adding a `key={cart.data?.id ?? "none"}` to the cart-display `<p>`. But the e2e doesn't exercise discard, so it shouldn't show up there.

- [ ] **Step 5: Commit**

```bash
git add examples/vite-spa/src/GuestCheckout.tsx
git commit -m "refactor(examples): vite-spa guest-checkout uses useCart + useCreateCart + phase enum"
```

---

## Task 2: Refactor `examples/next-app-router/app/guest-checkout/page.tsx`

**Files:**
- Modify: `examples/next-app-router/app/guest-checkout/page.tsx` (mirror of Task 1)

- [ ] **Step 1: Rewrite the file**

Replace the entire content of `examples/next-app-router/app/guest-checkout/page.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useEmporix,
  useCart,
  useCartMutations,
  useCreateCart,
  useMatchPrices,
  useCheckout,
} from "@viu/emporix-sdk-react";

// Priced product on tenant `viu` (CHF/main/CH) — see plan-c-viu-context.md.
const PRODUCT_ID = "0f1e2d3c-4b5a";

type Phase = "empty" | "shopping" | "ordered";

/**
 * Hook-only guest flow: `useCart()` reads the active cartId from storage at
 * every render, paired with `useCreateCart` for explicit cart creation.
 * Mirrors `examples/vite-spa/src/GuestCheckout.tsx`.
 */
export default function GuestCheckoutPage(): React.JSX.Element {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const cart = useCart();
  const cartId = cart.data?.id ?? null;
  const createCart = useCreateCart();
  const cartMutations = useCartMutations();
  const checkout = useCheckout();
  const prices = useMatchPrices(
    { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
    { enabled: cartId !== null },
  );
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function clearLocalCart(): Promise<void> {
    storage.setCartId(null);
    await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
  }

  async function startCart(): Promise<void> {
    setError(null);
    try {
      await createCart.mutateAsync({ currency: "CHF" });
    } catch (e) {
      setError(String(e));
    }
  }

  async function addSampleItem(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      const { data: matched } = await prices.refetch();
      const p = matched?.[0] as
        | { priceId?: string; originalValue?: number; effectiveValue?: number }
        | undefined;
      if (!p?.priceId) throw new Error("no price resolved for the product");
      await cartMutations.addItem.mutateAsync({
        itemYrn: `urn:yaas:hybris:product:product:${client.tenant};${PRODUCT_ID}`,
        quantity: 1,
        price: {
          priceId: p.priceId,
          originalAmount: p.originalValue ?? 0,
          effectiveAmount: p.effectiveValue ?? 0,
          currency: "CHF",
        },
      });
    } catch (e) {
      setError(String(e));
    }
  }

  async function placeOrder(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      const { data: fresh } = await prices.refetch();
      const amount = (fresh?.[0] as { effectiveValue?: number } | undefined)?.effectiveValue ?? 0;
      const r = await checkout.placeOrder.mutateAsync({
        input: {
          cartId,
          customer: { email: "guest@example.com", firstName: "Guest", lastName: "Shopper", guest: true },
          shipping: { methodId: "free", zoneId: "CH", methodName: "Free Shipping", amount: 0 },
          addresses: [
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "BILLING" },
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "SHIPPING" },
          ],
          paymentMethods: [{ provider: "custom", amount }],
        },
      });
      setOrderId(r.orderId ?? null);
      await clearLocalCart();
    } catch (e) {
      setError(String(e));
    }
  }

  async function discardCart(): Promise<void> {
    await clearLocalCart();
    setOrderId(null);
  }

  const itemCount = cart.data?.items?.length ?? 0;
  const phase: Phase = orderId ? "ordered" : cart.data ? "shopping" : "empty";

  return (
    <main>
      <h1>Guest checkout</h1>
      {phase === "empty" && (
        <button onClick={() => void startCart()} disabled={createCart.isPending}>
          {createCart.isPending ? "Starting…" : "Start guest cart"}
        </button>
      )}
      {phase === "shopping" && cartId && (
        <>
          <p>Cart: {cartId} ({itemCount} item(s))</p>
          {prices.data && (
            <p>
              Unit price:{" "}
              {(prices.data[0] as { effectiveValue?: number } | undefined)?.effectiveValue ?? "—"}
            </p>
          )}
          {itemCount === 0 ? (
            <button onClick={() => void addSampleItem()}>Add sample item</button>
          ) : (
            <button onClick={() => void placeOrder()}>Place guest order</button>
          )}
          <button onClick={() => void discardCart()}>Discard cart</button>
        </>
      )}
      {phase === "ordered" && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm -F @viu/emporix-examples-next-app-router typecheck
```

Expected: clean.

- [ ] **Step 3: Drop auto-regenerated Next files (they always come back)**

```bash
git checkout -- examples/next-app-router/next-env.d.ts examples/next-app-router/tsconfig.json examples/next-app-router/tsconfig.tsbuildinfo 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add examples/next-app-router/app/guest-checkout/page.tsx
git commit -m "refactor(examples): next-app-router guest-checkout uses useCart + useCreateCart + phase enum"
```

---

## Task 3: Clean up `examples/next-app-router/app/checkout/page.tsx`

**Files:**
- Modify: `examples/next-app-router/app/checkout/page.tsx` (extract payload, conditional saasToken)

- [ ] **Step 1: Rewrite the file**

Replace the entire content of `examples/next-app-router/app/checkout/page.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { useCheckout } from "@viu/emporix-sdk-react";
import type { CheckoutInput } from "@viu/emporix-sdk";

function demoOrder(cartId: string): CheckoutInput {
  return {
    cartId,
    customer: { email: "demo@example.com", id: "demo" },
    shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
    addresses: [
      { contactName: "Demo", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" },
      { contactName: "Demo", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" },
    ],
    paymentMethods: [{ provider: "none", method: "invoice" }],
  };
}

export default function CheckoutPage(): React.JSX.Element {
  const { placeOrder } = useCheckout();
  const [cartId, setCartId] = useState("");
  const [saasToken, setSaasToken] = useState("");
  const [orderId, setOrderId] = useState<string | null>(null);

  async function submit(): Promise<void> {
    const r = await placeOrder.mutateAsync({
      input: demoOrder(cartId),
      ...(saasToken ? { saasToken } : {}),
    });
    setOrderId(r.orderId ?? null);
  }

  return (
    <main>
      <h1>Checkout</h1>
      <input
        placeholder="cart id"
        value={cartId}
        onChange={(e) => setCartId(e.target.value)}
      />
      <input
        placeholder="saas token (optional)"
        value={saasToken}
        onChange={(e) => setSaasToken(e.target.value)}
      />
      <button disabled={!cartId || placeOrder.isPending} onClick={() => void submit()}>
        Place order
      </button>
      {orderId && <p>Order: {orderId}</p>}
      {placeOrder.isError && <p>Checkout failed.</p>}
    </main>
  );
}
```

Three things changed:
1. The 18-line order payload moved into a typed `demoOrder(cartId)` helper.
2. `saasToken` only goes into the mutation input when non-empty (the SDK accepts an undefined field but it's noise to send `""`).
3. The submit logic extracted to `submit()` — the JSX no longer carries an async arrow with the whole payload inline.

- [ ] **Step 2: Typecheck**

```bash
pnpm -F @viu/emporix-examples-next-app-router typecheck
```

Expected: clean. If the `CheckoutInput` import fails, the SDK build is stale — rebuild as in Task 1 Step 3.

- [ ] **Step 3: Drop auto-regenerated Next files**

```bash
git checkout -- examples/next-app-router/next-env.d.ts examples/next-app-router/tsconfig.json examples/next-app-router/tsconfig.tsbuildinfo 2>/dev/null || true
```

- [ ] **Step 4: Commit**

```bash
git add examples/next-app-router/app/checkout/page.tsx
git commit -m "refactor(examples): extract demoOrder helper; conditional saasToken in next checkout"
```

---

## Task 4: Mark `displayName` cross-example duplication

**Files:**
- Modify: `examples/vite-spa/src/App.tsx`
- Modify: `examples/next-app-router/app/page.tsx`

Background: both files contain identical 12-line `displayName(name, fallback)` helpers. Examples deliberately don't share a `src/` — each app must be self-contained so consumers can copy-paste one example into a fresh repo. A short comment locks this in so the duplication doesn't look accidental.

- [ ] **Step 1: Add the marker comment in `examples/vite-spa/src/App.tsx`**

Find:
```tsx
// Emporix product `name` is localized — a `{ [locale]: string }` map (or a
// plain string for some tenants). Render it defensively.
function displayName(name: unknown, fallback: string): string {
```

Replace with:
```tsx
// Emporix product `name` is localized — a `{ [locale]: string }` map (or a
// plain string for some tenants). Render it defensively.
// (Intentionally duplicated in examples/next-app-router/app/page.tsx — examples
//  are kept self-contained so each is copy-paste-friendly.)
function displayName(name: unknown, fallback: string): string {
```

- [ ] **Step 2: Add the matching comment in `examples/next-app-router/app/page.tsx`**

Find:
```tsx
// Emporix product `name` is localized — a `{ [locale]: string }` map (or a
// plain string for some tenants). Render it defensively.
function displayName(name: unknown, fallback: string): string {
```

Replace with:
```tsx
// Emporix product `name` is localized — a `{ [locale]: string }` map (or a
// plain string for some tenants). Render it defensively.
// (Intentionally duplicated in examples/vite-spa/src/App.tsx — examples are
//  kept self-contained so each is copy-paste-friendly.)
function displayName(name: unknown, fallback: string): string {
```

- [ ] **Step 3: Commit**

```bash
git add examples/vite-spa/src/App.tsx examples/next-app-router/app/page.tsx
git commit -m "docs(examples): mark displayName cross-example duplication as intentional"
```

---

## Final Verification

- [ ] **Step 1: Build everything**

```bash
pnpm -r build
```
Expected: green for all packages and examples.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```
Expected: green for all 6 projects.

- [ ] **Step 3: Run unit tests**

```bash
pnpm -r test
```
Expected: 143 SDK + 108 React = **251** tests pass. No example unit tests exist, so this stays at 251.

- [ ] **Step 4: E2E against `viu` tenant**

```bash
set -a; source e2e/.env.local; set +a; pnpm e2e
```
Expected: **6/6** passing in ~8s. The `guest-checkout.spec.ts` is the critical one — it exercises the refactored guest flow live.

If `guest-checkout.spec.ts` regresses, see Task 1 Step 4 for diagnostic hints.

- [ ] **Step 5: Sanity grep**

```bash
git grep -nE "wantCart|setWantCart" examples/ 2>/dev/null || echo "no leftover wantCart references"
```
Expected: no matches.

- [ ] **Step 6: Branch state**

```bash
git log --oneline origin/main..HEAD
```
Expected: 4 commits, in order:
1. vite-spa guest-checkout refactor
2. next-app-router guest-checkout refactor
3. next-app-router checkout cleanup
4. displayName marker comments

---

## Follow-up (out of scope, may emerge)

- If `useActiveCart` should pick up external storage changes (so the example can use it cleanly), that's a hook-design change — open a separate spec.
- A shared `examples/shared/` workspace for the `displayName` helper if a third example ever duplicates it. YAGNI for now.
- A `CheckoutInput` builder helper in the SDK if multiple consumers report assembling these payloads manually. YAGNI.
