# Plan D — Generated Request Types (all services) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every SDK service method's request body uses the generated OpenAPI request type (aliased to a friendly public name) instead of a hand-written input interface. All ergonomic wrappers and input transformations are dropped — the facade passes the generated body through verbatim.

**Architecture:** Mirrors Plan A/B. Per service: import the generated request type, expose it under a friendly alias, change the method signature to take it, and pass it as the `body` unchanged. Drop `CheckoutInput`/`QuoteCheckoutInput`/`CheckoutCustomer`/`CheckoutAddress`/`CheckoutPaymentMethod`/`CartAddress`/`AuthorizePaymentInput` and the `{old,new}`→`{oldPassword,newPassword}` / `{orderId}`→`{order:{id}}` mappings. React hooks, examples, and tests are updated to send the generated shapes.

**Tech Stack:** TypeScript 5.x strict, tsup, vitest + msw, @testing-library/react + jsdom, Changesets.

**Spec basis:** the standing design preference recorded in memory ([[generated-types-request-and-response]]) — generated types for request **and** response. Single exception: `CustomerService.login` (no generated request type exists; the literal `{email,password}` stays, and its snake_case **response** mapping to `CustomerSession` is unchanged).

**Depends on:** Plan B merged to `main`.

**Branch:** create `feat/generated-request-types` from `main` before Task 1.

**Generated request-type bindings (verified via Explore):**

| Method | Generated request type | Notes |
|---|---|---|
| `customers.signup` | `CustomerSignup` | fields: email, password, customerDetails?, customerAddress?, signup? |
| `customers.login` | — (none) | keep literal `{ email; password }`; response `CustomerSession` unchanged |
| `customers.update` | `CustomerUpdateDto` | replaces `Partial<Customer>` |
| `customers.changePassword` | `PasswordChangeDto` | `{ currentPassword, newPassword }` — drop `{old,new}` |
| `customers.requestPasswordReset` | `PasswordResetRequestDto` | `{ email, site? }` |
| `customers.confirmPasswordReset` | `PasswordUpdate` | `{ token, newPassword }` |
| `customers.addresses.add` | `AddressCreateDto` | |
| `customers.addresses.update` | `AddressUpdateDto` | |
| `carts.create` | `CreateCart` | `currency` is **required** |
| `carts.addItem` | `CartItemRequest` | `{ product?, quantity?, ... }` — not `{productId,quantity}` |
| `carts.updateItem` | `UpdateCartItem` | |
| `carts.applyCoupon` | — (none) | keep `code: string` param, body `{ code }` |
| `carts.setShippingAddress` / `setBillingAddress` | `AddressRequest` | replaces `CartAddress` |
| `checkout.placeOrder` | `RequestCheckout` | replaces `CheckoutInput` |
| `checkout.placeOrderFromQuote` | `RequestFromQuoteCheckout` | replaces `QuoteCheckoutInput` |
| `payments.authorize` | `AuthorizePaymentRequest` | drop `{order:{id}}` construction |
| `products.*`, `categories.*` | — | no request bodies; **no change** |

---

### Task 1: Record exact generated request-type shapes

**Files:**
- Create: `docs/superpowers/plans/plan-d-type-bindings.md`

- [ ] **Step 1: Dump each generated request type's top-level fields**

Run:

```bash
cd packages/sdk/src/generated
for t in CustomerSignup CustomerUpdateDto PasswordChangeDto PasswordResetRequestDto PasswordUpdate AddressCreateDto AddressUpdateDto; do
  echo "=== $t ==="; awk "/^export type $t = /{f=1} f{print} f&&/^};/{exit} f&&/^export type $t = [A-Za-z]/{exit}" customer/types.gen.ts | head -25
done
for t in CreateCart CartItemRequest UpdateCartItem AddressRequest; do
  echo "=== $t ==="; awk "/^export type $t = /{f=1} f{print} f&&/^};/{exit} f&&/^export type $t = [A-Za-z]/{exit}" cart/types.gen.ts | head -25
done
for t in RequestCheckout RequestFromQuoteCheckout; do
  echo "=== $t ==="; awk "/^export type $t = /{f=1} f{print} f&&/^};/{exit}" checkout/types.gen.ts | head -30
done
echo "=== AuthorizePaymentRequest + base ==="
awk '/^export type AuthorizePaymentRequest = /{f=1} f{print} f&&/^};/{exit} f&&/^export type AuthorizePaymentRequest = [A-Za-z]/{exit}' payment/types.gen.ts | head -10
awk '/^export type AuthorizeFrontendPaymentRequest = /{f=1} f{print} f&&/^};/{exit}' payment/types.gen.ts | head -20
```

- [ ] **Step 2: Write the bindings doc**

Create `docs/superpowers/plans/plan-d-type-bindings.md` containing the table from this plan's header PLUS, for each generated request type, its top-level field names captured in Step 1 (paste the field list under each type name). This is the concrete reference every later task and every consumer-update step uses.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/plan-d-type-bindings.md
git commit -m "docs(sdk): record generated request-type bindings"
```

---

### Task 2: Customer service request types

**Files:**
- Modify: `packages/sdk/src/services/customer.ts`
- Test: `packages/sdk/tests/services/customer.test.ts`, `packages/sdk/tests/services/facade-coverage.test.ts`

- [ ] **Step 1: Update tests to the generated shapes (failing)**

In `packages/sdk/tests/services/customer.test.ts`, change the `changePassword` call (currently `{ old, new }`) to `{ currentPassword: "o", newPassword: "n" }`, and any `signup`/`update`/address call to the generated field names from `plan-d-type-bindings.md`. In `facade-coverage.test.ts` do the same for the customer block (`changePassword`, `addresses.add`/`update`, `update`). Keep `login` calls unchanged.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- customer`
Expected: FAIL (types/shape mismatch) until the service is swapped.

- [ ] **Step 3: Swap the service signatures**

In `packages/sdk/src/services/customer.ts`:

- Add to the generated import already present (`Customer as GeneratedCustomer, Address as GeneratedAddress`) the request types:
  ```ts
  import type {
    Customer as GeneratedCustomer,
    Address as GeneratedAddress,
    CustomerSignup,
    CustomerUpdateDto,
    PasswordChangeDto,
    PasswordResetRequestDto,
    PasswordUpdate,
    AddressCreateDto,
    AddressUpdateDto,
  } from "../generated/customer";
  ```
- Add friendly aliases near the existing type aliases:
  ```ts
  export type CustomerSignupInput = CustomerSignup;
  export type CustomerUpdateInput = CustomerUpdateDto;
  export type PasswordChangeInput = PasswordChangeDto;
  export type PasswordResetRequestInput = PasswordResetRequestDto;
  export type PasswordResetConfirmInput = PasswordUpdate;
  export type AddressCreateInput = AddressCreateDto;
  export type AddressUpdateInput = AddressUpdateDto;
  ```
- `signup(input: CustomerSignupInput, auth = {kind:"anonymous"})` → body `input` verbatim (drop the hand-typed object).
- `login` — **unchanged** (literal `{email;password}`, snake_case response mapping kept).
- `update(patch: CustomerUpdateInput, auth?)` → body `patch`.
- `changePassword(input: PasswordChangeInput, auth?)` → body `input` verbatim (delete the `{ oldPassword: input.old, newPassword: input.new }` mapping).
- `requestPasswordReset(input: PasswordResetRequestInput, ...)` → body `input`.
- `confirmPasswordReset(input: PasswordResetConfirmInput, ...)` → body `input`.
- `addresses.add(address: AddressCreateInput, auth?)` → body `address` (drop `Omit<Address,"id">`).
- `addresses.update(id, patch: AddressUpdateInput, auth?)` → body `patch`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- customer && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean. Fix any `facade-coverage.test.ts` fallout in this step.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/tests/services/customer.test.ts packages/sdk/tests/services/facade-coverage.test.ts
git commit -m "feat(customer): generated request types (login literal kept)"
```

---

### Task 3: Cart service request types

**Files:**
- Modify: `packages/sdk/src/services/cart.ts`
- Test: `packages/sdk/tests/services/cart.test.ts`, `packages/sdk/tests/services/facade-coverage.test.ts`

- [ ] **Step 1: Update tests to generated shapes (failing)**

In `cart.test.ts`, change `create({ currency: "EUR" }, ...)` — `CreateCart.currency` is required, so this still compiles; also update any `addItem`/`updateItem`/address calls to the generated field names from `plan-d-type-bindings.md` (e.g. `addItem` → `CartItemRequest` shape). Mirror in `facade-coverage.test.ts` cart block.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- cart`
Expected: FAIL until the service is swapped.

- [ ] **Step 3: Swap the service signatures**

In `packages/sdk/src/services/cart.ts`:

- Replace the `CartAddress` interface with imports + aliases:
  ```ts
  import type {
    Cart as GeneratedCart,
    CreateCart,
    CartItemRequest,
    UpdateCartItem,
    AddressRequest,
  } from "../generated/cart";
  export type Cart = GeneratedCart;
  export type CreateCartInput = CreateCart;
  export type CartItemInput = CartItemRequest;
  export type CartItemUpdate = UpdateCartItem;
  export type CartAddress = AddressRequest;
  ```
- `create(input: CreateCartInput | undefined, auth)` → body `input ?? {}`.
- `addItem(cartId, item: CartItemInput, auth)` → body `item`.
- `updateItem(cartId, itemId, patch: CartItemUpdate, auth)` → body `patch`.
- `applyCoupon(cartId, code: string, auth)` — **unchanged** (no generated type; body `{ code }`).
- `removeCoupon` — unchanged.
- `setShippingAddress(cartId, address: CartAddress, auth)` / `setBillingAddress` → body `address` (now `AddressRequest`).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- cart && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/tests/services/cart.test.ts packages/sdk/tests/services/facade-coverage.test.ts
git commit -m "feat(cart): generated request types for create/items/addresses"
```

---

### Task 4: Checkout service request types

**Files:**
- Modify: `packages/sdk/src/services/checkout.ts`
- Test: `packages/sdk/tests/services/checkout.test.ts`, `packages/sdk/tests/client-checkout.test.ts` (if it calls placeOrder)

- [ ] **Step 1: Update tests to RequestCheckout shape (failing)**

In `checkout.test.ts`, replace the `order` literal and the `placeOrderFromQuote` literal with values matching generated `RequestCheckout` / `RequestFromQuoteCheckout` top-level fields from `plan-d-type-bindings.md` (the shapes are close; adjust field nesting as recorded). Same for `client-checkout.test.ts` if present.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- checkout`
Expected: FAIL until swapped.

- [ ] **Step 3: Swap the service signatures**

In `packages/sdk/src/services/checkout.ts`:

- Replace the `CheckoutPaymentMethod`, `CheckoutAddress`, `CheckoutCustomer`, `CheckoutInput`, `QuoteCheckoutInput` interfaces with:
  ```ts
  import type {
    ResponseCheckout,
    RequestCheckout,
    RequestFromQuoteCheckout,
  } from "../generated/checkout";
  export type CheckoutResult = ResponseCheckout;
  export type CheckoutInput = RequestCheckout;
  export type QuoteCheckoutInput = RequestFromQuoteCheckout;
  ```
  (Keep `CheckoutOptions` — it is SDK-side: `saasToken`/`siteCode`, not a wire body.)
- `isGuest` currently reads `input.customer?.guest`. Confirm `RequestCheckout.customer` has a guest flag in `plan-d-type-bindings.md`; if the field name differs, update `isGuest` to read the generated field. If `RequestCheckout` has no guest flag, change `placeOrder` to accept guest detection via `CheckoutOptions` (add `guest?: boolean` to `CheckoutOptions`) and use that — record the decision in the commit message.
- `placeOrder(input: CheckoutInput, auth?, opts?)` and `placeOrderFromQuote(input: QuoteCheckoutInput, auth?, opts?)` → body `input` verbatim (already pass `input`).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- checkout && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/checkout.ts packages/sdk/tests/services/checkout.test.ts packages/sdk/tests/client-checkout.test.ts
git commit -m "feat(checkout): generated RequestCheckout/RequestFromQuoteCheckout inputs"
```

---

### Task 5: Payment service request type

**Files:**
- Modify: `packages/sdk/src/services/payment.ts`
- Test: `packages/sdk/tests/services/payment.test.ts`, `packages/sdk/tests/services/facade-coverage.test.ts`

- [ ] **Step 1: Update tests to AuthorizePaymentRequest shape (failing)**

In `payment.test.ts`, replace `authorize({ orderId: "EON1", paymentModeId: "m1", creditCardToken: "tok" })` with the generated `AuthorizePaymentRequest` shape from `plan-d-type-bindings.md` (e.g. `{ order: { id: "EON1" }, paymentModeId: "m1", ... }` per the recorded fields). Mirror in `facade-coverage.test.ts`.

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- payment`
Expected: FAIL until swapped.

- [ ] **Step 3: Swap the service signature**

In `packages/sdk/src/services/payment.ts`:

- Replace `AuthorizePaymentInput` with:
  ```ts
  import type {
    PaymentModeFrontendResponse,
    AuthorizePaymentRequest,
  } from "../generated/payment";
  export type PaymentMode = PaymentModeFrontendResponse;
  export type AuthorizePaymentInput = AuthorizePaymentRequest;
  ```
- `authorize(input: AuthorizePaymentInput, auth?)` → body `input` verbatim. Delete the `{ order: { id: input.orderId }, paymentModeId, creditCardToken }` construction. Keep `AuthorizePaymentResult` (provider-shaped result kept verbatim).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- payment && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/payment.ts packages/sdk/tests/services/payment.test.ts packages/sdk/tests/services/facade-coverage.test.ts
git commit -m "feat(payment): generated AuthorizePaymentRequest input"
```

---

### Task 6: Align react hooks, examples, exports, changeset, finish

**Files:**
- Modify: `packages/sdk/src/index.ts` (export new input aliases), `packages/react/src/hooks/use-customer-session.ts`, `use-cart-mutations.ts`, `use-checkout.ts`, `examples/next-app-router/app/actions.ts`, `examples/vite-spa/src/App.tsx`, react tests
- Create: `.changeset/generated-request-types.md`

- [ ] **Step 1: Export the new input aliases**

In `packages/sdk/src/index.ts`, add the new public input aliases to the existing per-service `export type { … }` blocks: `CustomerSignupInput, CustomerUpdateInput, PasswordChangeInput, PasswordResetRequestInput, PasswordResetConfirmInput, AddressCreateInput, AddressUpdateInput` (customer); `CreateCartInput, CartItemInput, CartItemUpdate, CartAddress` (cart); `CheckoutInput, QuoteCheckoutInput` already exported (now aliases); `AuthorizePaymentInput` already exported (now alias). Remove names that no longer exist (`CheckoutPaymentMethod`, `CheckoutAddress`, `CheckoutCustomer`).

- [ ] **Step 2: Full typecheck to surface every consumer break**

Run: `pnpm build && pnpm typecheck`
Expected: FAIL in `packages/react` and `examples/*` at the call sites listed in this plan's header.

- [ ] **Step 3: Fix react hooks to send generated shapes**

For each failing site, change the literal to the generated shape from `plan-d-type-bindings.md`, no `any`:
- `use-cart-mutations.ts`: `addItem` payload → `CartItemRequest` shape; `updateItem` → `UpdateCartItem`; `setShippingAddress`/`setBillingAddress` vars typed `CartAddress` (now `AddressRequest`); the optimistic-update placeholder cast already uses `NonNullable<Cart["items"]>[number]` — keep.
- `use-checkout.ts`: `CheckoutInput`/`QuoteCheckoutInput` are now `RequestCheckout`/`RequestFromQuoteCheckout`; the mutation variable types still resolve via the SDK aliases — adjust only if field access breaks.
- `use-customer-session.ts`: `login` unchanged; `signup` input now `CustomerSignup` — update its parameter type/forwarding.

- [ ] **Step 4: Fix examples + react tests**

Update `examples/next-app-router/app/actions.ts` (login unchanged — no change expected), `examples/vite-spa/src/App.tsx` (login unchanged), and every react test (`use-cart-mutations.test.tsx`, `use-checkout.test.tsx`, `use-customer-session.test.tsx`, `coverage.test.tsx`) to the generated request shapes from `plan-d-type-bindings.md`. Re-run `pnpm typecheck` until clean across SDK, react, and all three examples.

- [ ] **Step 5: Changeset**

Create `.changeset/generated-request-types.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

BREAKING: every service request body now uses the generated OpenAPI request
type (e.g. `carts.addItem` takes `CartItemRequest`, `checkout.placeOrder`
takes `RequestCheckout`, `payments.authorize` takes `AuthorizePaymentRequest`,
`customers.changePassword` takes `{ currentPassword, newPassword }`). All
ergonomic input wrappers and input transformations are removed; callers send
the exact wire shape. `CustomerService.login` keeps its literal
`{ email, password }` input and snake_case `CustomerSession` response (no
generated request type exists for it).
```

- [ ] **Step 6: Green gate**

Run: `pnpm build && pnpm typecheck && pnpm -r --filter "./packages/*" test`
Expected: all green; coverage ≥80% on `packages/*`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(sdk): align react + examples + tests with generated request types"
```

- [ ] **Step 8: Finish the branch**

Use **superpowers:finishing-a-development-branch** (verify tests → 4-option menu → execute choice).

---

## Self-Review

- **Coverage:** every request-body method in the Explore impact map has a task (customer T2, cart T3, checkout T4, payment T5); product/category explicitly excluded (no bodies); consumers/tests/exports/changeset in T6; bindings audit in T1. `login` exception explicit in T2/changeset.
- **Placeholder scan:** generated type names are fixed in the header table and the only deferred detail (exact field nesting) is captured by the concrete grep in T1 and recorded before any task consumes it — same accepted pattern as Plan A/B Task 1.
- **Type consistency:** friendly aliases (`CustomerSignupInput`, `CreateCartInput`, `CartItemInput`, `CartItemUpdate`, `CartAddress`, `CheckoutInput`, `QuoteCheckoutInput`, `AuthorizePaymentInput`, plus password/address aliases) are defined once per service and reused identically in signatures, `index.ts` exports, consumer fixes, tests, and the changeset. `CheckoutOptions` and `AuthorizePaymentResult` deliberately retained (SDK-side / provider-shaped).
