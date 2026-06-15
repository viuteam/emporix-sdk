# Checkout: separate billing/shipping address + configured payment selection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `storefront-demo` checkout so a shopper can optionally enter a billing address that differs from the shipping address and pick a payment option from the modes configured in Emporix — for guests and logged-in customers alike.

**Architecture:** Relax an over-strict customer-only auth check in the SDK (`listPaymentModes`) and React (`usePaymentModes`) so the public frontend payment-modes endpoint works with an anonymous token. Then rebuild the example checkout from one inline address form into focused components (`AddressFields`, `AddressSection`, `PaymentSelector`) orchestrated by `pages/Checkout.tsx`.

**Tech Stack:** TypeScript, React, @tanstack/react-query, Vitest + MSW (unit tests), Vite (example), changesets.

**Spec:** `docs/superpowers/specs/2026-06-15-checkout-address-payment-design.md`

---

## File structure

**SDK (`packages/sdk`)**
- Modify `src/services/payment.ts` — `listPaymentModes` defaults to anonymous auth.
- Modify `tests/services/payment.test.ts` — add anonymous-auth test.

**React (`packages/react`)**
- Modify `src/hooks/use-checkout.ts` — `usePaymentModes` resolves customer-or-anonymous auth.
- Create `tests/use-payment-modes.test.tsx` — anonymous + customer tests.

**Docs / repo notes**
- Modify `docs/react.md` — the `usePaymentModes` description.
- Modify `CLAUDE.md` — the "easy to get wrong" note.

**Changesets**
- Create `.changeset/payment-modes-anonymous.md` (`@viu/emporix-sdk` patch).
- Create `.changeset/use-payment-modes-anonymous.md` (`@viu/emporix-sdk-react` patch).

**Example (`examples/storefront-demo`)**
- Create `src/checkout/AddressFields.tsx` — pure controlled address fields + `AddressDraft` type.
- Create `src/checkout/AddressSection.tsx` — saved-address picker + manual entry.
- Create `src/checkout/PaymentSelector.tsx` — payment-mode radio list.
- Modify `src/pages/Checkout.tsx` — orchestration with billing toggle + payment selection.

---

## Task 1: SDK — allow `listPaymentModes` without a customer token

**Files:**
- Modify: `packages/sdk/src/services/payment.ts`
- Test: `packages/sdk/tests/services/payment.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("PaymentGatewayService", ...)` block in `packages/sdk/tests/services/payment.test.ts` (the MSW server already mocks the anonymous-login and the paymentmodes endpoint):

```ts
  it("listPaymentModes works with an anonymous context (no customer scope)", async () => {
    const modes = await svc().listPaymentModes({ kind: "anonymous" });
    expect(modes[0]?.code).toBe("card");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- payment`
Expected: FAIL — the new test rejects with `EmporixAuthError` ("This operation requires a customer or raw AuthContext"), thrown by `requireCustomer` inside `listPaymentModes`.

- [ ] **Step 3: Replace the implementation**

Overwrite `packages/sdk/src/services/payment.ts` with the following (changes: import the `auth` value, add an `ANON` default, drop `requireCustomer`/`EmporixAuthError` from `listPaymentModes`, rename the `authorize` param to avoid shadowing the imported `auth`):

```ts
import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import { requireCustomer } from "../core/require-customer";
import type {
  PaymentModeFrontendResponse,
  AuthorizePaymentRequest,
} from "../generated/payment";

const ANON: AuthContext = auth.anonymous();

/** A frontend payment mode (generated). */
export type PaymentMode = PaymentModeFrontendResponse;

/** Post-checkout authorize request (generated; caller sends the exact wire shape). */
export type AuthorizePaymentInput = AuthorizePaymentRequest;

/** Post-checkout authorize result. */
export interface AuthorizePaymentResult {
  successful: boolean;
  paymentTransactionId?: string;
  authorizationToken?: string;
  requiresExternalPayment?: boolean;
  externalPaymentRedirectURL?: string;
  externalPaymentHttpMethod?: string;
  [k: string]: unknown;
}

/** Payment-Gateway: list frontend payment modes, authorize deferred payments. */
export class PaymentGatewayService {
  static readonly channel = "payment" as const;
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Lists configured frontend payment modes. The endpoint requires a bearer
   * token but no customer scope ("No scope required"), so it defaults to an
   * anonymous context and works for guests and logged-in customers alike.
   */
  async listPaymentModes(authCtx: AuthContext = ANON): Promise<PaymentMode[]> {
    return this.ctx.http.request<PaymentMode[]>({
      method: "GET",
      path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/frontend`,
      auth: authCtx,
    });
  }

  /** Authorizes a post-checkout (deferred) payment for an existing order. */
  async authorize(
    input: AuthorizePaymentInput,
    authCtx?: AuthContext,
  ): Promise<AuthorizePaymentResult> {
    return this.ctx.http.request<AuthorizePaymentResult>({
      method: "POST",
      path: `/payment-gateway/${this.ctx.tenant}/payment/frontend/authorize`,
      auth: requireCustomer(authCtx),
      body: input,
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- payment`
Expected: PASS — all tests in `payment.test.ts` pass, including the new anonymous test and the existing `authorize requires customer/raw` test (still throws because `authorize` keeps `requireCustomer`).

- [ ] **Step 5: Create the changeset**

Create `.changeset/payment-modes-anonymous.md`:

```markdown
---
"@viu/emporix-sdk": patch
---

`client.payments.listPaymentModes` no longer requires a customer token. It now
defaults to an anonymous context, matching the public frontend payment-modes
endpoint (which needs a bearer token but no customer scope), so storefronts can
list configured payment modes for guests as well as logged-in customers.
```

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/payment.ts packages/sdk/tests/services/payment.test.ts .changeset/payment-modes-anonymous.md
git commit -m "fix(payment): list payment modes without a customer token"
```

---

## Task 2: React — `usePaymentModes` works for anonymous sessions

**Files:**
- Modify: `packages/react/src/hooks/use-checkout.ts`
- Test: `packages/react/tests/use-payment-modes.test.tsx` (create)

React tests resolve `@viu/emporix-sdk` to `../sdk/src` via the vitest alias, so Task 1's source change is already in effect here — no prebuild needed.

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/use-payment-modes.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { usePaymentModes } from "../src/hooks/use-checkout";
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
  http.get("https://api.emporix.io/payment-gateway/acme/paymentmodes/frontend", () =>
    HttpResponse.json([{ id: "m1", code: "card", integrationType: "OFFSITE" }]),
  ),
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

describe("usePaymentModes", () => {
  it("lists payment modes for a guest (anonymous) session", async () => {
    const { result } = renderHook(() => usePaymentModes(), {
      wrapper: wrap(createMemoryStorage()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.code).toBe("card");
  });

  it("lists payment modes for a logged-in customer", async () => {
    const { result } = renderHook(() => usePaymentModes(), {
      wrapper: wrap(createMemoryStorage({ initial: "cust" })),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.code).toBe("card");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-payment-modes`
Expected: FAIL — the guest test times out in `waitFor` because the current hook is gated on a customer token (`enabled: token !== null`), so for an anonymous session the query never runs and `isSuccess` stays `false`.

- [ ] **Step 3: Update the imports in `use-checkout.ts`**

In `packages/react/src/hooks/use-checkout.ts`, change the `@viu/emporix-sdk` import to drop the now-unused `auth` value and `AuthContext` type:

```ts
import {
  type CheckoutInput,
  type QuoteCheckoutInput,
  type CheckoutResult,
  type PaymentMode,
} from "@viu/emporix-sdk";
```

And delete the `useCustomerToken` import line entirely:

```ts
import { useCustomerToken } from "./internal/use-storage-snapshot";
```

- [ ] **Step 4: Delete the `customerOnlyCtx` helper**

Remove this block (including its leading comment) from `use-checkout.ts`:

```ts
// Lazy customer-only context resolver. Throws only when invoked — so the
// `enabled: token !== null` gate above the queryFn is the actual guard.
// Can't use the `useCustomerOnlyCtx` hook here because it would throw at
// hook-render time, before the enabled-gate kicks in.
function customerOnlyCtx(token: string | null): AuthContext {
  if (!token) throw new Error("usePaymentModes requires a logged-in customer token");
  return auth.customer(token);
}
```

- [ ] **Step 5: Rewrite `usePaymentModes`**

Replace the entire `usePaymentModes` function at the bottom of `use-checkout.ts` with:

```ts
/** Lists frontend payment modes for the current session (customer or guest). */
export function usePaymentModes(
  options: { enabled?: boolean } = {},
): UseQueryResult<PaymentMode[]> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  const { siteCode } = useReadSite();
  const { activeCompany } = useActiveCompany();
  return useQuery({
    queryKey: emporixKey(
      "payment-modes",
      [activeCompany?.id ?? null],
      { tenant: client.tenant, authKind: ctx.kind, siteCode },
    ),
    enabled: options.enabled ?? true,
    queryFn: () => client.payments.listPaymentModes(ctx),
    staleTime: PAYMENT_MODES_STALE_TIME,
  });
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-payment-modes`
Expected: PASS — both the guest and the customer tests pass.

- [ ] **Step 7: Create the changeset**

Create `.changeset/use-payment-modes-anonymous.md`:

```markdown
---
"@viu/emporix-sdk-react": patch
---

`usePaymentModes` now works for anonymous (guest) sessions, not only logged-in
customers. It auto-detects auth (customer token if stored, otherwise anonymous)
and the query is keyed by the resolved auth kind.
```

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/hooks/use-checkout.ts packages/react/tests/use-payment-modes.test.tsx .changeset/use-payment-modes-anonymous.md
git commit -m "fix(react): allow usePaymentModes for anonymous sessions"
```

---

## Task 3: Docs — note that `usePaymentModes` works for guests

**Files:**
- Modify: `docs/react.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update `docs/react.md`**

Replace this sentence (around line 426):

```markdown
guest-checkout flow). `usePaymentModes()` stays customer-only — payment-mode
listing requires an authenticated session.
```

with:

```markdown
guest-checkout flow). `usePaymentModes()` works for guests and logged-in
customers alike — it auto-detects auth (customer token if stored, otherwise
anonymous), matching the public frontend payment-modes endpoint (a bearer token
is required, but no customer scope).
```

- [ ] **Step 2: Update `CLAUDE.md`**

Replace this bullet (around line 57):

```markdown
- `useCheckout` auto-detects auth (customer if a token is stored, anonymous otherwise). `usePaymentModes` is intentionally customer-only — its helper `customerOnlyCtx` throws on missing token.
```

with:

```markdown
- `useCheckout` auto-detects auth (customer if a token is stored, anonymous otherwise). `usePaymentModes` likewise auto-detects auth (customer token if stored, otherwise anonymous) — the frontend payment-modes endpoint needs a bearer token but no customer scope, so guests see the configured modes too.
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md CLAUDE.md
git commit -m "docs(docs): note usePaymentModes works for guests"
```

---

## Task 4: Example — `AddressFields` component

**Files:**
- Create: `examples/storefront-demo/src/checkout/AddressFields.tsx`

- [ ] **Step 1: Create the component**

Create `examples/storefront-demo/src/checkout/AddressFields.tsx`:

```tsx
import { Field } from "../components/ui/Field";

export type AddressDraft = {
  contactName: string;
  companyName?: string;
  street: string;
  streetNumber?: string;
  zipCode: string;
  city: string;
  country: string;
  contactPhone?: string;
};

/** A blank address draft. Spread into `useState` so optional fields are "". */
export const EMPTY_ADDRESS: AddressDraft = {
  contactName: "",
  companyName: "",
  street: "",
  streetNumber: "",
  zipCode: "",
  city: "",
  country: "",
  contactPhone: "",
};

/**
 * Pure, controlled address field set. Holds no state and never persists — the
 * parent owns the `AddressDraft` and receives single-field patches via
 * `onChange`. `idPrefix` keeps input ids unique when two sections (shipping +
 * billing) render on the same page. Reused for both checkout addresses.
 */
export function AddressFields({
  value,
  onChange,
  idPrefix,
}: {
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  idPrefix: string;
}) {
  const set =
    (k: keyof AddressDraft) =>
    (e: { target: { value: string } }) =>
      onChange({ [k]: e.target.value });
  return (
    <div className="stack" style={{ gap: "var(--s-3)" }}>
      <Field
        id={`${idPrefix}-contactName`}
        label="Contact name"
        value={value.contactName}
        onChange={set("contactName")}
        autoComplete="name"
      />
      <Field
        id={`${idPrefix}-companyName`}
        label="Company (optional)"
        value={value.companyName ?? ""}
        onChange={set("companyName")}
        autoComplete="organization"
      />
      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <Field
          id={`${idPrefix}-street`}
          label="Street"
          value={value.street}
          onChange={set("street")}
          autoComplete="address-line1"
        />
        <Field
          id={`${idPrefix}-streetNumber`}
          label="No."
          value={value.streetNumber ?? ""}
          onChange={set("streetNumber")}
        />
      </div>
      <div className="cluster" style={{ gap: "var(--s-4)" }}>
        <Field
          id={`${idPrefix}-zipCode`}
          label="ZIP"
          value={value.zipCode}
          onChange={set("zipCode")}
          autoComplete="postal-code"
        />
        <Field
          id={`${idPrefix}-city`}
          label="City"
          value={value.city}
          onChange={set("city")}
          autoComplete="address-level2"
        />
        <Field
          id={`${idPrefix}-country`}
          label="Country"
          value={value.country}
          onChange={set("country")}
          autoComplete="country"
          placeholder="CH"
        />
      </div>
      <Field
        id={`${idPrefix}-contactPhone`}
        label="Phone (optional)"
        value={value.contactPhone ?? ""}
        onChange={set("contactPhone")}
        autoComplete="tel"
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the example**

Run: `pnpm -F @viu/emporix-examples-storefront-demo typecheck`
Expected: PASS (no type errors). The component is not imported anywhere yet, so this just confirms it compiles.

- [ ] **Step 3: Commit**

```bash
git add examples/storefront-demo/src/checkout/AddressFields.tsx
git commit -m "feat(examples): add checkout AddressFields component"
```

---

## Task 5: Example — `AddressSection` component

**Files:**
- Create: `examples/storefront-demo/src/checkout/AddressSection.tsx`

- [ ] **Step 1: Create the component**

Create `examples/storefront-demo/src/checkout/AddressSection.tsx`:

```tsx
import { useState } from "react";
import type { Address } from "@viu/emporix-sdk";
import { SelectField } from "../components/ui/Field";
import { AddressFields, type AddressDraft } from "./AddressFields";

/** Maps a saved customer `Address` onto an editable `AddressDraft`. */
function addressToDraft(a: Address): AddressDraft {
  return {
    contactName: a.contactName ?? "",
    companyName: a.companyName ?? "",
    street: a.street ?? "",
    streetNumber: a.streetNumber ?? "",
    zipCode: a.zipCode ?? "",
    city: a.city ?? "",
    country: a.country ?? "",
    contactPhone: a.contactPhone ?? "",
  };
}

/**
 * One titled address block. For logged-in customers with saved addresses it
 * shows a picker that copies the chosen address into the draft; everyone can
 * also edit the fields directly. `savedAddresses` is `undefined` for guests
 * (the `useCustomerAddresses` query is idle without a token).
 */
export function AddressSection({
  title,
  value,
  onChange,
  savedAddresses,
  idPrefix,
}: {
  title: string;
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  savedAddresses?: Address[];
  idPrefix: string;
}) {
  // "" = manual entry; otherwise the chosen saved-address id.
  const [picked, setPicked] = useState("");
  const saved = savedAddresses ?? [];
  return (
    <div className="stack" style={{ gap: "var(--s-3)" }}>
      <p className="eyebrow">{title}</p>
      {saved.length > 0 ? (
        <SelectField
          id={`${idPrefix}-saved`}
          label="Use a saved address"
          value={picked}
          onChange={(e) => {
            const id = e.target.value;
            setPicked(id);
            const hit = saved.find((a) => a.id === id);
            if (hit) onChange(addressToDraft(hit));
          }}
        >
          <option value="">Enter a new address…</option>
          {saved.map((a) => (
            <option key={a.id} value={a.id}>
              {[a.contactName, a.street, a.city].filter(Boolean).join(", ")}
            </option>
          ))}
        </SelectField>
      ) : null}
      <AddressFields value={value} onChange={onChange} idPrefix={idPrefix} />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the example**

Run: `pnpm -F @viu/emporix-examples-storefront-demo typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add examples/storefront-demo/src/checkout/AddressSection.tsx
git commit -m "feat(examples): add checkout AddressSection component"
```

---

## Task 6: Example — `PaymentSelector` component

**Files:**
- Create: `examples/storefront-demo/src/checkout/PaymentSelector.tsx`

- [ ] **Step 1: Create the component**

Create `examples/storefront-demo/src/checkout/PaymentSelector.tsx`:

```tsx
import { useEffect } from "react";
import { usePaymentModes } from "@viu/emporix-sdk-react";
import { Spinner } from "../components/ui/Spinner";

/**
 * Renders the tenant's configured frontend payment modes as a radio list and
 * reports the selected mode id (or `null` when none are available, which the
 * checkout maps to the demo "custom" provider). Default-selects the first mode.
 */
export function PaymentSelector({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (modeId: string | null) => void;
}) {
  const { data: modes, isLoading, isError } = usePaymentModes();

  useEffect(() => {
    if (value !== null) return;
    const first = modes?.[0];
    if (first?.id) onChange(first.id);
  }, [modes, value, onChange]);

  return (
    <div className="stack" style={{ gap: "var(--s-3)" }}>
      <p className="eyebrow">Payment</p>
      {isLoading ? (
        <Spinner label="Loading payment options" />
      ) : isError || !modes || modes.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--step--1)" }}>
          No configured payment modes available — using the demo “custom” provider.
        </p>
      ) : (
        <div className="stack" style={{ gap: "var(--s-2)" }}>
          {modes.map((m) => (
            <label
              key={m.id}
              className="cluster"
              style={{ gap: "var(--s-2)", alignItems: "center" }}
            >
              <input
                type="radio"
                name="paymentMode"
                value={m.id}
                checked={value === m.id}
                onChange={() => onChange(m.id ?? null)}
              />
              <span>{m.code ?? m.id}</span>
              {m.integrationType ? (
                <span className="muted" style={{ fontSize: "var(--step--1)" }}>
                  · {m.integrationType}
                </span>
              ) : null}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the example**

Run: `pnpm -F @viu/emporix-examples-storefront-demo typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add examples/storefront-demo/src/checkout/PaymentSelector.tsx
git commit -m "feat(examples): add checkout PaymentSelector component"
```

---

## Task 7: Example — wire the new components into `Checkout.tsx`

**Files:**
- Modify: `examples/storefront-demo/src/pages/Checkout.tsx`

- [ ] **Step 1: Replace `Checkout.tsx`**

Overwrite `examples/storefront-demo/src/pages/Checkout.tsx` with:

```tsx
import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  useActiveCart,
  useCheckout,
  useCustomerSession,
  useCustomerAddresses,
  useEmporix,
} from "@viu/emporix-sdk-react";
import { cartLines, cartTotal } from "../lib/adapters";
import { useProductNames } from "../lib/useProductNames";
import { money } from "../lib/format";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Loading } from "../components/ui/Spinner";
import { EmptyState } from "../components/ui/EmptyState";
import { useToast, errorMessage } from "../app/Toasts";
import { AddressSection } from "../checkout/AddressSection";
import { PaymentSelector } from "../checkout/PaymentSelector";
import { EMPTY_ADDRESS, type AddressDraft } from "../checkout/AddressFields";

export function Checkout() {
  const { storage, client } = useEmporix();
  const [orderId, setOrderId] = useState<string | null>(null);
  // Once the order is placed the cart is closed — stop bootstrapping, otherwise
  // `getCurrent` re-adopts the just-closed cart id and every later fetch 404s.
  const { data: cart, isLoading } = useActiveCart({ create: orderId === null });
  const { isAuthenticated, customer, saasToken } = useCustomerSession();
  const { placeOrder } = useCheckout();
  const { notify } = useToast();

  const cartId = (cart as { id?: string } | null)?.id;
  const lines = cartLines(cart);
  const total = cartTotal(cart);
  const names = useProductNames(lines.map((l) => l.productId));

  // A logged-in checkout must identify the customer by id — Emporix returns
  // "Cannot found customer" otherwise. Guest checkout omits it.
  const cust = customer as { id?: string; firstName?: string; lastName?: string } | null;
  const customerId = cust?.id;

  // Logged-in customers can pick from saved addresses; the query is idle (data
  // undefined) for guests, so the picker simply never appears.
  const { data: savedAddresses } = useCustomerAddresses();

  const [contact, setContact] = useState({
    email: "",
    firstName: cust?.firstName || "Guest",
    lastName: cust?.lastName || "Shopper",
  });
  const [shipping, setShipping] = useState<AddressDraft>({
    ...EMPTY_ADDRESS,
    contactName: `${cust?.firstName || "Guest"} ${cust?.lastName || "Shopper"}`,
    street: "Rämistrasse",
    streetNumber: "71",
    zipCode: "8006",
    city: "Zürich",
    country: "CH",
  });
  const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
  const [billing, setBilling] = useState<AddressDraft>({ ...EMPTY_ADDRESS });
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);

  const email = isAuthenticated
    ? (customer as { contactEmail?: string } | null)?.contactEmail ?? contact.email
    : contact.email;
  const setContactField =
    (k: keyof typeof contact) =>
    (e: { target: { value: string } }) =>
      setContact((c) => ({ ...c, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!cartId || !total) return;
    const billingAddr = billingSameAsShipping ? shipping : billing;
    const toAddress = (a: AddressDraft, type: "SHIPPING" | "BILLING") => ({
      contactName: a.contactName || `${contact.firstName} ${contact.lastName}`,
      ...(a.companyName ? { companyName: a.companyName } : {}),
      street: a.street,
      ...(a.streetNumber ? { streetNumber: a.streetNumber } : {}),
      zipCode: a.zipCode,
      city: a.city,
      country: a.country,
      ...(a.contactPhone ? { contactPhone: a.contactPhone } : {}),
      type,
    });
    const input = {
      cartId,
      customer: {
        // Logged-in customer must be identified by id; guest must not.
        ...(isAuthenticated && customerId ? { id: customerId } : {}),
        email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        guest: !isAuthenticated,
      },
      shipping: { methodId: "free", zoneId: shipping.country, methodName: "Free Shipping", amount: 0 },
      addresses: [toAddress(shipping, "SHIPPING"), toAddress(billingAddr, "BILLING")],
      // Send the chosen configured mode; fall back to the demo "custom" provider
      // when none is available.
      paymentMethods: selectedModeId
        ? [{ provider: "payment-gateway", customAttributes: { modeId: selectedModeId }, amount: total.amount }]
        : [{ provider: "custom", amount: total.amount }],
    };
    try {
      const r = await placeOrder.mutateAsync({
        input: input as never,
        // Customer checkout must carry the saasToken; guest doesn't need it.
        ...(isAuthenticated && saasToken ? { saasToken } : {}),
      });
      setOrderId((r as { orderId?: string }).orderId ?? null);
      // The cart is CLOSED on Emporix after a successful order — drop it
      // locally so `useActiveCart` stops querying the now-closed cart.
      storage.setCartId(null);
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  if (orderId !== null) {
    return (
      <div className="container" style={{ paddingBlock: "var(--s-8)" }}>
        <div className="center-col" style={{ gap: "var(--s-3)" }}>
          <p className="eyebrow">Order placed</p>
          <h1 className="serif">Thank you.</h1>
          <p className="muted">
            Your order <strong className="serif">{orderId}</strong> is confirmed.
          </p>
          <div className="cluster" style={{ marginTop: "var(--s-4)" }}>
            <Link to={`/account/orders/${encodeURIComponent(orderId)}`} className="btn btn--solid">View order</Link>
            <Link to="/" className="btn btn--outline">Continue shopping</Link>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <div className="container"><Loading label="Loading checkout" /></div>;
  }
  if (lines.length === 0) {
    return (
      <div className="container">
        <EmptyState title="Your bag is empty">
          Add something before checking out — <Link to="/" className="u-underline">browse</Link>.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <h2 className="serif" style={{ marginBottom: "var(--s-5)" }}>Checkout</h2>

      <div
        role="alert"
        style={{
          border: "1px solid var(--oxblood)",
          borderRadius: "var(--radius-lg)",
          padding: "var(--s-4)",
          marginBottom: "var(--s-6)",
          background: "color-mix(in oklab, var(--oxblood) 7%, var(--paper))",
        }}
      >
        <strong className="serif" style={{ color: "var(--oxblood)" }}>Live order.</strong>{" "}
        <span className="muted">Placing this order creates a real order in tenant <strong>{client.tenant}</strong>.</span>
      </div>

      <form onSubmit={submit} className="cart">
        <div className="stack" style={{ gap: "var(--s-5)" }}>
          <div className="stack">
            <p className="eyebrow">{isAuthenticated ? "Signed in" : "Guest"} contact</p>
            {!isAuthenticated ? (
              <Field label="Email" type="email" required value={contact.email} onChange={setContactField("email")} placeholder="you@example.com" />
            ) : (
              <p className="muted">{email}</p>
            )}
            <div className="cluster" style={{ gap: "var(--s-4)" }}>
              <Field label="First name" value={contact.firstName} onChange={setContactField("firstName")} />
              <Field label="Last name" value={contact.lastName} onChange={setContactField("lastName")} />
            </div>
          </div>

          <AddressSection
            title="Shipping address"
            value={shipping}
            onChange={(patch) => setShipping((s) => ({ ...s, ...patch }))}
            savedAddresses={savedAddresses}
            idPrefix="shipping"
          />

          <label className="cluster" style={{ gap: "var(--s-2)", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={billingSameAsShipping}
              onChange={(e) => setBillingSameAsShipping(e.target.checked)}
            />
            <span>Billing address same as shipping</span>
          </label>

          {!billingSameAsShipping ? (
            <AddressSection
              title="Billing address"
              value={billing}
              onChange={(patch) => setBilling((b) => ({ ...b, ...patch }))}
              savedAddresses={savedAddresses}
              idPrefix="billing"
            />
          ) : null}

          <PaymentSelector value={selectedModeId} onChange={setSelectedModeId} />
        </div>

        <aside className="cart__summary surface">
          <h3 className="serif">Summary</h3>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "var(--s-3)" }}>
            {lines.map((l) => (
              <li key={l.id} className="cart__total" style={{ paddingBlock: "var(--s-1)", fontSize: "var(--step--1)" }}>
                <span className="muted">{(names[l.productId] ?? l.name ?? l.productId)} × {l.quantity}</span>
                <span className="price">{l.lineTotal ? money(l.lineTotal.amount, l.lineTotal.currency) : ""}</span>
              </li>
            ))}
          </ul>
          <hr className="rule" style={{ marginBlock: "var(--s-4)" }} />
          <div className="cart__total">
            <span className="eyebrow">Total</span>
            <span className="price" style={{ fontSize: "var(--step-2)" }}>{total ? money(total.amount, total.currency) : "—"}</span>
          </div>
          <Button type="submit" variant="accent" block disabled={placeOrder.isPending || !total} style={{ marginTop: "var(--s-4)" }}>
            {placeOrder.isPending ? "Placing order…" : "Place order"}
          </Button>
        </aside>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Build the packages, then typecheck the example**

The example typechecks against the built `dist/` of the SDK + React packages, so rebuild them first:

Run:
```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-examples-storefront-demo typecheck
```
Expected: PASS — all three complete with no type errors.

- [ ] **Step 3: Commit**

```bash
git add examples/storefront-demo/src/pages/Checkout.tsx
git commit -m "feat(examples): support separate billing address and payment selection"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the SDK unit tests**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (all suites green).

- [ ] **Step 2: Run the React unit tests**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: PASS (all suites green, including `use-payment-modes` and the existing `use-checkout`).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Confirm the changesets are present**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-sdk` (patch) and `@viu/emporix-sdk-react` (patch).

- [ ] **Step 5: Optional manual check**

Start the example (`pnpm -F @viu/emporix-examples-storefront-demo dev`), add an item to the cart, open Checkout, and confirm: the "Billing address same as shipping" toggle reveals a second address block when unchecked, and the Payment section lists the tenant's configured modes (as a guest and when logged in). Placing an order is a **live** action against the `viu` tenant — only do this intentionally.

---

## Self-review

**Spec coverage:**
- Separate billing/shipping with toggle → Task 7 (`billingSameAsShipping`, second `AddressSection`). ✓
- Saved-address selection for logged-in, free-form for guests → Tasks 5 + 7 (`AddressSection` + `useCustomerAddresses`). ✓
- Payment options from Emporix for guests + customers → Tasks 1, 2, 6 (SDK/React auth relaxation + `PaymentSelector`). ✓
- Selected mode sent in payload (`payment-gateway` + `modeId`, `custom` fallback) → Task 7 `submit`. ✓
- SDK/React auth relaxation + changesets → Tasks 1, 2. ✓
- Docs/CLAUDE note updates → Task 3. ✓
- Tests (SDK anonymous, React anonymous+customer) → Tasks 1, 2. ✓
- Build-then-typecheck example, run suites → Tasks 7, 8. ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code and command step is concrete.

**Type consistency:** `AddressDraft` / `EMPTY_ADDRESS` defined in Task 4 are imported unchanged in Tasks 5 and 7. `usePaymentModes` signature unchanged (`(options?) => UseQueryResult<PaymentMode[]>`), so the Task 6 consumer matches. `onChange` patch type `(patch: Partial<AddressDraft>) => void` is consistent across `AddressFields` → `AddressSection` → `Checkout`. `PaymentSelector` `onChange: (modeId: string | null) => void` is satisfied by `setSelectedModeId` (a `Dispatch<SetStateAction<string | null>>`).
