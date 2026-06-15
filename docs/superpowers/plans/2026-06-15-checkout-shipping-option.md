# Checkout: select a delivery (shipping) option — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the `storefront-demo` shopper choose a delivery option from the shipping methods configured in Emporix, instead of the hardcoded "Free Shipping".

**Architecture:** Add a React hook `useShippingZones` that lists zones with active methods + fees in one call (the SDK service already accepts any auth context — no SDK change). A new `ShippingSelector` example component resolves the zone from the shipping country, picks the fee tier for the cart total, and reports the chosen method up to `Checkout.tsx`, which sends it in the `shipping` payload (free fallback when none resolves).

**Tech Stack:** TypeScript, React, @tanstack/react-query, Vitest + MSW (React unit tests), Vite (example), changesets.

**Spec:** `docs/superpowers/specs/2026-06-15-checkout-shipping-option-design.md`

---

## File structure

**React (`packages/react`)**
- Create `src/hooks/use-shipping.ts` — `useShippingZones` hook.
- Modify `src/hooks/index.ts` — export the hook.
- Modify `src/index.ts` — re-export the hook.
- Create `tests/use-shipping.test.tsx` — anonymous + customer tests.

**Docs / changeset**
- Modify `docs/react.md` — staleness table + checkout section.
- Create `.changeset/use-shipping-zones.md` (`@viu/emporix-sdk-react` minor).

**Example (`examples/storefront-demo`)**
- Create `src/checkout/ShippingSelector.tsx` — selector + pure helpers + `SelectedShipping` type.
- Modify `src/pages/Checkout.tsx` — wire the selector into state, the form, and the payload.

---

## Task 1: React — `useShippingZones` hook

**Files:**
- Create: `packages/react/src/hooks/use-shipping.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/use-shipping.test.tsx` (create)

React tests resolve `@viu/emporix-sdk` to `../sdk/src` via the vitest alias, so the SDK's existing `client.shipping.listZones` is available from source — no prebuild needed for tests.

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/use-shipping.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useShippingZones } from "../src/hooks/use-shipping";
import type { ReactNode } from "react";

const ZONES = [
  {
    id: "switzerland",
    default: true,
    name: { en: "Switzerland" },
    shipTo: [{ country: "CH" }],
    methods: [
      {
        id: "standard",
        name: { en: "Standard" },
        active: true,
        fees: [{ cost: { currency: "CHF", amount: 9.9 }, minOrderValue: { currency: "CHF", amount: 0 } }],
      },
    ],
  },
];

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
  http.get("https://api.emporix.io/shipping/acme/main/zones", () => HttpResponse.json(ZONES)),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={qc}>
      {children}
    </EmporixProvider>
  );
}

describe("useShippingZones", () => {
  it("lists shipping zones with methods for a guest (anonymous) session", async () => {
    const { result } = renderHook(() => useShippingZones({ site: "main" }), {
      wrapper: wrap(createMemoryStorage()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.id).toBe("switzerland");
    expect(result.current.data?.[0]?.methods?.[0]?.id).toBe("standard");
  });

  it("lists shipping zones for a logged-in customer", async () => {
    const { result } = renderHook(() => useShippingZones({ site: "main" }), {
      wrapper: wrap(createMemoryStorage({ initial: "cust" })),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.id).toBe("switzerland");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-shipping`
Expected: FAIL — the suite errors at import/transform time because
`../src/hooks/use-shipping` does not exist yet (module not found).

- [ ] **Step 3: Create the hook**

Create `packages/react/src/hooks/use-shipping.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { type ZoneList } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";
import { emporixKey } from "./internal/query-keys";

const SHIPPING_ZONES_STALE_TIME = 10 * 60_000; // 10 minutes — admin-configured.

/**
 * Lists shipping zones with their active methods + fees for the current session
 * (customer or guest). One call: `expand=methods,fees` + `activeMethods=true`.
 * The site defaults to the provider's active `siteCode`.
 */
export function useShippingZones(
  options: { site?: string; enabled?: boolean } = {},
): UseQueryResult<ZoneList> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  const { siteCode } = useReadSite();
  const site = options.site ?? siteCode;
  return useQuery({
    queryKey: emporixKey("shipping-zones", [site], { tenant: client.tenant, authKind: ctx.kind }),
    enabled: (options.enabled ?? true) && site !== null,
    queryFn: () => {
      if (site === null) throw new Error("useShippingZones requires a site code");
      return client.shipping.listZones(site, { expand: "methods,fees", activeMethods: "true" }, ctx);
    },
    staleTime: SHIPPING_ZONES_STALE_TIME,
  });
}
```

- [ ] **Step 4: Export the hook from `hooks/index.ts`**

In `packages/react/src/hooks/index.ts`, add this line directly after the
existing `export { useCheckout, usePaymentModes } from "./use-checkout";` line:

```ts
export { useShippingZones } from "./use-shipping";
```

- [ ] **Step 5: Re-export the hook from the package root**

In `packages/react/src/index.ts`, add `useShippingZones,` to the big
`export { … } from "./hooks/index";` list — directly after the `usePaymentModes,`
line:

```ts
  usePaymentModes,
  useShippingZones,
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-shipping`
Expected: PASS — both the guest and the customer tests pass.

- [ ] **Step 7: Create the changeset**

Create `.changeset/use-shipping-zones.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

Add `useShippingZones` — lists the tenant's configured shipping zones with their
active methods and fees in a single call (`expand=methods,fees`,
`activeMethods=true`). Auto-detects auth (customer token if stored, otherwise
anonymous), so storefronts can show delivery options to guests and customers
alike. The site defaults to the provider's active `siteCode`.
```

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/hooks/use-shipping.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-shipping.test.tsx .changeset/use-shipping-zones.md
git commit -m "feat(react): add useShippingZones hook"
```

---

## Task 2: Docs — document `useShippingZones`

**Files:**
- Modify: `docs/react.md`

- [ ] **Step 1: Add to the staleness table**

In `docs/react.md`, replace this row:

```markdown
| `useSites`, `useDefaultSite`, `usePaymentModes` | 10 min |
```

with:

```markdown
| `useSites`, `useDefaultSite`, `usePaymentModes`, `useShippingZones` | 10 min |
```

- [ ] **Step 2: Mention it in the checkout section**

In `docs/react.md`, replace this paragraph:

```markdown
`useCheckout()` returns `placeOrder` and `placeOrderFromQuote` mutations.
Auto-detects auth: customer if a token is stored, otherwise anonymous (for the
guest-checkout flow). `usePaymentModes()` works for guests and logged-in
customers alike — it auto-detects auth (customer token if stored, otherwise
anonymous), matching the public frontend payment-modes endpoint (a bearer token
is required, but no customer scope).
```

with:

```markdown
`useCheckout()` returns `placeOrder` and `placeOrderFromQuote` mutations.
Auto-detects auth: customer if a token is stored, otherwise anonymous (for the
guest-checkout flow). `usePaymentModes()` works for guests and logged-in
customers alike — it auto-detects auth (customer token if stored, otherwise
anonymous), matching the public frontend payment-modes endpoint (a bearer token
is required, but no customer scope).

`useShippingZones({ site? })` lists shipping zones with their active methods and
fees in one call (`expand=methods,fees`, `activeMethods=true`); it also
auto-detects auth and defaults the site to the provider's active `siteCode`. Use
it to let the shopper pick a delivery option: resolve the zone from the shipping
country, then read `zone.methods` and each method's `fees`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md
git commit -m "docs(docs): document useShippingZones hook"
```

---

## Task 3: Example — `ShippingSelector` component

**Files:**
- Create: `examples/storefront-demo/src/checkout/ShippingSelector.tsx`

- [ ] **Step 1: Create the component**

Create `examples/storefront-demo/src/checkout/ShippingSelector.tsx`:

```tsx
import { useEffect, useMemo } from "react";
import { useShippingZones } from "@viu/emporix-sdk-react";
import type { ZoneList, ShippingMethod } from "@viu/emporix-sdk";
import { Spinner } from "../components/ui/Spinner";
import { pickText } from "../lib/adapters";
import { money } from "../lib/format";

type ShippingZone = ZoneList[number];
type Fee = ShippingMethod["fees"][number];

/** The chosen delivery option, shaped for the checkout `shipping` payload. */
export type SelectedShipping = {
  methodId: string;
  zoneId: string;
  methodName: string;
  amount: number;
  shippingTaxCode?: string;
};

/** The zone whose `shipTo` covers `country`, else the default zone, else first. */
export function resolveZone(zones: ZoneList | undefined, country: string): ShippingZone | undefined {
  if (!zones || zones.length === 0) return undefined;
  const c = country.trim().toUpperCase();
  const byCountry = c
    ? zones.find((z) => (z.shipTo ?? []).some((s) => s.country?.toUpperCase() === c))
    : undefined;
  return byCountry ?? zones.find((z) => z.default) ?? zones[0];
}

/** The applicable fee: highest `minOrderValue` ≤ cart total, else the first fee. */
export function pickFee(fees: Fee[] | undefined, cartTotal: number): Fee | undefined {
  if (!fees || fees.length === 0) return undefined;
  const eligible = fees
    .filter((f) => (f.minOrderValue?.amount ?? 0) <= cartTotal)
    .sort((a, b) => (b.minOrderValue?.amount ?? 0) - (a.minOrderValue?.amount ?? 0));
  return eligible[0] ?? fees[0];
}

function toSelected(
  method: ShippingMethod,
  zone: ShippingZone,
  cartTotal: number | undefined,
): SelectedShipping | null {
  const fee = pickFee(method.fees, cartTotal ?? 0);
  if (!fee || !method.id || !zone.id) return null;
  return {
    methodId: method.id,
    zoneId: zone.id,
    methodName: pickText(method.name, method.id),
    amount: fee.cost.amount,
    ...(method.shippingTaxCode ? { shippingTaxCode: method.shippingTaxCode } : {}),
  };
}

function sameSelection(a: SelectedShipping | null, b: SelectedShipping | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.methodId === b.methodId && a.zoneId === b.zoneId && a.amount === b.amount;
}

/**
 * Lets the shopper pick a delivery option from the methods of the zone that
 * matches the shipping country. Reports a `SelectedShipping` via `onChange`, or
 * `null` when nothing resolves (the checkout then uses its free fallback).
 */
export function ShippingSelector({
  country,
  cartTotal,
  value,
  onChange,
}: {
  country: string;
  cartTotal: number | undefined;
  value: SelectedShipping | null;
  onChange: (s: SelectedShipping | null) => void;
}) {
  const { data: zones, isLoading, isError } = useShippingZones();

  const zone = useMemo(() => resolveZone(zones, country), [zones, country]);
  const methods = useMemo<ShippingMethod[]>(
    () => (zone?.methods ?? []).filter((m) => m.active !== false && (m.fees?.length ?? 0) > 0),
    [zone],
  );

  // Keep the parent's selection in sync with the resolved zone/methods and the
  // cart total. Idempotent: only pushes a change when the result actually
  // differs, so it converges instead of looping.
  useEffect(() => {
    if (!zone || methods.length === 0) {
      if (value !== null) onChange(null);
      return;
    }
    const current = value ? methods.find((m) => m.id === value.methodId) : undefined;
    const target = toSelected(current ?? methods[0], zone, cartTotal);
    if (!sameSelection(target, value)) onChange(target);
  }, [zone, methods, cartTotal, value, onChange]);

  return (
    <div className="stack" style={{ gap: "var(--s-3)" }}>
      <p className="eyebrow">Delivery</p>
      {isLoading ? (
        <Spinner label="Loading delivery options" />
      ) : isError || !zone || methods.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--step--1)" }}>
          No configured delivery options for this destination — using free shipping.
        </p>
      ) : (
        <div className="stack" style={{ gap: "var(--s-2)" }}>
          {methods.map((m) => {
            const fee = pickFee(m.fees, cartTotal ?? 0);
            return (
              <label
                key={m.id}
                className="cluster"
                style={{ gap: "var(--s-2)", alignItems: "center" }}
              >
                <input
                  type="radio"
                  name="shippingMethod"
                  value={m.id}
                  checked={value?.methodId === m.id}
                  onChange={() => onChange(toSelected(m, zone, cartTotal))}
                />
                <span>{pickText(m.name, m.id ?? "")}</span>
                {fee ? (
                  <span className="muted" style={{ fontSize: "var(--step--1)" }}>
                    · {money(fee.cost.amount, fee.cost.currency)}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build the packages, then typecheck the example**

The component imports the new `useShippingZones`, so the React package must be
rebuilt before the example (which typechecks against `dist/`):

Run:
```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-examples-storefront-demo typecheck
```
Expected: PASS — all three complete with no type errors.

- [ ] **Step 3: Commit**

```bash
git add examples/storefront-demo/src/checkout/ShippingSelector.tsx
git commit -m "feat(examples): add checkout ShippingSelector component"
```

---

## Task 4: Example — wire `ShippingSelector` into `Checkout.tsx`

**Files:**
- Modify: `examples/storefront-demo/src/pages/Checkout.tsx`

- [ ] **Step 1: Add the import**

In `examples/storefront-demo/src/pages/Checkout.tsx`, add this import directly
after the existing `import { PaymentSelector } from "../checkout/PaymentSelector";`
line:

```ts
import { ShippingSelector, type SelectedShipping } from "../checkout/ShippingSelector";
```

- [ ] **Step 2: Add selection state**

Directly after the existing line
`const [selectedModeId, setSelectedModeId] = useState<string | null>(null);`
add:

```ts
  const [selectedShipping, setSelectedShipping] = useState<SelectedShipping | null>(null);
```

- [ ] **Step 3: Build the shipping payload from the selection**

In `submit`, replace this line:

```ts
      shipping: { methodId: "free", zoneId: shipping.country, methodName: "Free Shipping", amount: 0 },
```

with:

```ts
      // Send the chosen delivery option; fall back to free shipping when none
      // resolved (no configured method for the destination).
      shipping: selectedShipping
        ? {
            methodId: selectedShipping.methodId,
            zoneId: selectedShipping.zoneId,
            methodName: selectedShipping.methodName,
            amount: selectedShipping.amount,
            ...(selectedShipping.shippingTaxCode ? { shippingTaxCode: selectedShipping.shippingTaxCode } : {}),
          }
        : { methodId: "free", zoneId: shipping.country, methodName: "Free Shipping", amount: 0 },
```

- [ ] **Step 4: Render the selector in the form**

Replace this line:

```tsx
          <PaymentSelector value={selectedModeId} onChange={setSelectedModeId} />
```

with:

```tsx
          <ShippingSelector
            country={shipping.country}
            cartTotal={total?.amount}
            value={selectedShipping}
            onChange={setSelectedShipping}
          />

          <PaymentSelector value={selectedModeId} onChange={setSelectedModeId} />
```

- [ ] **Step 5: Show the selected shipping cost in the summary**

In the summary aside, replace this block:

```tsx
          <hr className="rule" style={{ marginBlock: "var(--s-4)" }} />
          <div className="cart__total">
            <span className="eyebrow">Total</span>
            <span className="price" style={{ fontSize: "var(--step-2)" }}>{total ? money(total.amount, total.currency) : "—"}</span>
          </div>
```

with:

```tsx
          {selectedShipping && total ? (
            <div className="cart__total" style={{ paddingBlock: "var(--s-1)", fontSize: "var(--step--1)" }}>
              <span className="muted">Delivery · {selectedShipping.methodName}</span>
              <span className="price">{money(selectedShipping.amount, total.currency)}</span>
            </div>
          ) : null}
          <hr className="rule" style={{ marginBlock: "var(--s-4)" }} />
          <div className="cart__total">
            <span className="eyebrow">Total</span>
            <span className="price" style={{ fontSize: "var(--step-2)" }}>{total ? money(total.amount, total.currency) : "—"}</span>
          </div>
```

- [ ] **Step 6: Typecheck the example**

The packages were built in Task 3; typecheck the example:

Run: `pnpm -F @viu/emporix-examples-storefront-demo typecheck`
Expected: PASS — no type errors.

- [ ] **Step 7: Commit**

```bash
git add examples/storefront-demo/src/pages/Checkout.tsx
git commit -m "feat(examples): select a delivery option in checkout"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the React unit tests**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: PASS (all suites green, including `use-shipping`).

- [ ] **Step 2: Lint the React package**

Run: `pnpm -F @viu/emporix-sdk-react lint`
Expected: PASS (no eslint errors).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Confirm the changeset is present**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-sdk-react` to be bumped (at least `minor`).

- [ ] **Step 5: Optional manual check**

Start the example (`pnpm -F @viu/emporix-examples-storefront-demo dev`), add an
item to the cart, open Checkout, and confirm a "Delivery" section lists the
configured methods for the shipping country with their costs, and that changing
the country re-resolves the options. Placing an order is a **live** action
against the `viu` tenant — only do this intentionally.

---

## Self-review

**Spec coverage:**
- List configured shipping methods, pick one (guest + customer) → Tasks 1, 3
  (`useShippingZones` + `ShippingSelector`). ✓
- Resolve zone from shipping country (→ default → first) → Task 3 `resolveZone`. ✓
- Cost from fee tier (highest `minOrderValue` ≤ cart total) → Task 3 `pickFee`. ✓
- Send chosen method in `shipping`, free fallback → Task 4 Step 3. ✓
- No SDK change; hook passes customer-or-anonymous ctx → Task 1 (`useReadAuth`). ✓
- One call with `expand=methods,fees`, `activeMethods=true` → Task 1 queryFn. ✓
- Reuse `pickText` for localized names → Task 3 (imported from `../lib/adapters`). ✓
- React test (anonymous + customer) → Task 1. ✓
- `minor` changeset for `@viu/emporix-sdk-react` → Task 1 Step 7. ✓
- Docs (staleness table + checkout section) → Task 2. ✓
- Build-then-typecheck example, run suites/lint → Tasks 3, 4, 5. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to". Every code and
command step is concrete.

**Type consistency:** `SelectedShipping` defined in Task 3 is imported unchanged
in Task 4. `resolveZone`/`pickFee`/`toSelected`/`sameSelection` signatures are
internally consistent (`ShippingZone = ZoneList[number]`, `Fee = ShippingMethod["fees"][number]`).
`useShippingZones` returns `UseQueryResult<ZoneList>` (Task 1) and is consumed as
`data: zones` in Task 3. `ShippingSelector`'s `onChange: (s: SelectedShipping | null) => void`
is satisfied by `setSelectedShipping` (a `Dispatch<SetStateAction<SelectedShipping | null>>`).
`pickText(v, fallback)` and `money(amount, currency)` match their existing
signatures in `src/lib/adapters.ts` / `src/lib/format.ts`.
