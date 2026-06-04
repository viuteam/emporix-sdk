# Phase 2 — Order-v2 + SalesOrders Codegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the hand-written `order-v2` type mirror with codegen output from the genuine Emporix Order Service OpenAPI spec, so `OrdersService` and `SalesOrdersService` return the real API shape (`entries`, numeric `totalPrice` + `calculatedPrice`, `mixins.generalAttributes.orderNumber`, …).

**Architecture:** Vendor the spec into `packages/sdk/specs/order-v2.yml`; the existing `scripts/generate.ts` (`@hey-api/openapi-ts`) regenerates `src/generated/order-v2/` in place; then re-point the façade re-exports in `orders.ts`/`index.ts` to the generated names and replace the fictional test fixtures with the real shape.

**Tech Stack:** TypeScript, `@hey-api/openapi-ts`, Vitest + MSW, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-04-sdk-shape-normalization-design.md` (Phase 2). Verified live shape recorded there.

> ## ⛔ Blocker — must be resolved before Task 2
> `packages/sdk/specs/order-v2.yml` does **not** exist. It must be **vendored** — the genuine Emporix **Order Service** OpenAPI (covers `/orders`, `/orders/{id}`, `/orders/{id}/transitions`, `/salesorders/{id}`), like `price.yml` was vendored. Obtain it from the Emporix developer portal / API reference download. **Do not hand-author or reconstruct a spec** — codegen from a wrong spec is worse than the current verified mirror.

---

## File structure

- **Create** `packages/sdk/src/.../specs/order-v2.yml` → `packages/sdk/specs/order-v2.yml` — vendored spec (Task 1).
- **Replace** `packages/sdk/src/generated/order-v2/*` — codegen output (Task 2, generated; the hand-written `types.gen.ts` is overwritten).
- **Modify** `packages/sdk/src/services/orders.ts` — re-point `Order`/`OrderItem`/`OrderStatus`/`SalesOrderPatch`/… imports to the generated names.
- **Modify** `packages/sdk/src/index.ts` — adjust the order type re-exports if names change.
- **Modify** `packages/sdk/tests/services/orders.test.ts` + React `tests/use-my-orders*.test.tsx`, `use-order.test.tsx`, `use-reorder.test.tsx`, `use-cancel-order.test.tsx`, `use-order-transition.test.tsx` — replace fictional `items`/`{amount,currency}` fixtures with the real `entries`/numeric shape.
- **Create** `.changeset/order-v2-codegen.md`.

---

## Task 1: Vendor the Order Service OpenAPI spec  ⛔ BLOCKER

**Files:** Create `packages/sdk/specs/order-v2.yml`

- [ ] **Step 1: Obtain the genuine spec** — download the Emporix Order Service OpenAPI (YAML/JSON) from the developer portal. Confirm it documents `entries` (required), `calculatedPrice`, and the `/salesorders/{id}` path. Save verbatim as `packages/sdk/specs/order-v2.yml` (the filename → the generated output dir `order-v2`, keeping `../generated/order-v2` imports stable). If the source is JSON, it is valid YAML — `.yml` is fine for `@hey-api/openapi-ts`.

- [ ] **Step 2: Sanity-check the vendored file**

```bash
grep -nE "entries|salesorders|calculatedPrice|orderNumber" packages/sdk/specs/order-v2.yml | head
```
Expected: `entries` present; `/salesorders/{id}` path present.

- [ ] **Step 3: Commit the vendored spec**

```bash
git add packages/sdk/specs/order-v2.yml
git commit -m "chore(orders): vendor the Emporix Order Service OpenAPI spec"
```

---

## Task 2: Generate the types

**Files:** `packages/sdk/src/generated/order-v2/*` (generated)

- [ ] **Step 1: Run codegen**

```bash
pnpm -F @viu/emporix-sdk generate
```
Expected: logs `generated order-v2`; `src/generated/order-v2/types.gen.ts` now starts with `// AUTO-GENERATED — do not edit` (the hand-written "Not generated" header is gone).

- [ ] **Step 2: Inspect the generated order type names**

```bash
grep -nE "^export (type|interface) " packages/sdk/src/generated/order-v2/types.gen.ts | head -40
```
Record the generated names for: the order response schema, the order entry/line-item schema, the order status enum, and the sales-order patch body. These drive Task 3's re-export aliases.

- [ ] **Step 3: Typecheck (expected to FAIL)**

```bash
pnpm -F @viu/emporix-sdk typecheck
```
Expected: FAIL — `orders.ts` imports the old hand-written names (`Order`, `OrderItem`, `OrderStatus`, `SalesOrderPatch`) which no longer exist under those names. This is the signal for Task 3.

---

## Task 3: Re-point the service + façade re-exports

**Files:** `packages/sdk/src/services/orders.ts`, `packages/sdk/src/index.ts`

- [ ] **Step 1: Alias the generated names to the public type names**

In `packages/sdk/src/services/orders.ts`, update the import from `"../generated/order-v2"` to import the generated schema names recorded in Task 2 Step 2, and re-export them under the stable public names. Keep the public surface identical:
```ts
import type {
  <GeneratedOrder> as Order,
  <GeneratedOrderItem> as OrderItem,
  <GeneratedOrderStatus> as OrderStatus,
  <GeneratedSalesOrderPatch> as SalesOrderPatch,
  // …any other names orders.ts uses
} from "../generated/order-v2";
```
(Replace `<Generated…>` with the actual names from Task 2 Step 2. If the generated `OrderStatus` is a string union with the same members, no consumer change is needed.)

- [ ] **Step 2: Reconcile method return/body types**

The methods (`listMine`, `get`, `transition`, `cancel`, sales `get`/`update`) return `Order` / accept `SalesOrderPatch`. Ensure those aliases resolve. If the generated transition/patch body differs, adjust the method signatures to the generated body type (these are the real wire shapes).

- [ ] **Step 3: Adjust `index.ts` exports if names changed**

If `index.ts` re-exports any order type names that no longer exist, alias them the same way so the published type surface is stable.

- [ ] **Step 4: Typecheck**

```bash
pnpm -F @viu/emporix-sdk typecheck
```
Expected: PASS.

---

## Task 4: Replace the fictional test fixtures

**Files:** `packages/sdk/tests/services/orders.test.ts`, and React `packages/react/tests/{use-my-orders,use-my-orders-infinite,use-my-orders-b2b,use-order,use-reorder,use-cancel-order,use-order-transition}.test.tsx`

- [ ] **Step 1: Find the fictional fixtures**

```bash
grep -rnE "orderNumber|totalPrice:|items: \[" packages/sdk/tests/services/orders.test.ts packages/react/tests/use-my-orders*.test.tsx packages/react/tests/use-order*.test.tsx packages/react/tests/use-reorder.test.tsx
```
These currently use the invented `items` / `totalPrice: {amount,currency}` / top-level `orderNumber` shape.

- [ ] **Step 2: Rewrite each fixture to the real shape**

Replace mock order JSON with the verified live shape: `entries` (not `items`), `totalPrice` as a number + top-level `currency`, `orderNumber` under `mixins.generalAttributes`, `calculatedPrice` present. Use this minimal real-shape fixture as the template:
```ts
{
  id: "EON1",
  status: "CREATED",
  currency: "CHF",
  totalPrice: 10,
  created: "2026-06-04T00:00:00.000Z",
  entries: [
    {
      id: "e1",
      itemYrn: "urn:yaas:hybris:product:product:acme;p1",
      orderedAmount: 1,
      unitPrice: 10,
      totalPrice: 10,
      product: { id: "p1", name: "Widget" },
    },
  ],
  customer: { id: "c1", email: "a@b.co" },
  mixins: { generalAttributes: { orderNumber: "EON1" } },
}
```
Update each test's assertions to read the real fields (e.g. `data.entries[0].itemYrn`, `data.mixins.generalAttributes.orderNumber`).

- [ ] **Step 3: Run the order tests**

```bash
pnpm -F @viu/emporix-sdk test -- --run orders
pnpm -F @viu/emporix-sdk-react test -- --run order
```
Expected: PASS.

---

## Task 5: Live verify, changeset, full build

- [ ] **Step 1: Live-verify the order shape against `viu`** (already done for `/orders` this session — `entries`, numeric totals, `mixins.generalAttributes.orderNumber`). Additionally verify `/salesorders/{id}` with a **service token** (the storefront tokens can't read it) to confirm it shares the order-v2 shape.

- [ ] **Step 2: Write the changeset**

Create `.changeset/order-v2-codegen.md`:
```md
---
"@viu/emporix-sdk": minor
---

feat(orders): generate order-v2 types from the real OpenAPI spec

Replaces the hand-written order-v2 type mirror (which invented `items` /
`{amount,currency}` totals / top-level `orderNumber`) with codegen output from
the vendored Emporix Order Service spec. `OrdersService` and `SalesOrdersService`
now return the real API shape: `entries`, numeric `totalPrice` + `calculatedPrice`,
`orderNumber` under `mixins.generalAttributes`.
```

- [ ] **Step 3: Full build + repo verify**

```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -r typecheck && pnpm -r test
```
Expected: all green. The storefront demo's order adapters already tolerate the real shape (verified: `orderVM`/`orderItems` read `entries`/numeric), so the example still typechecks/builds.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/services/orders.ts packages/sdk/src/index.ts packages/sdk/tests .changeset/order-v2-codegen.md
git commit -m "feat(orders): generate order-v2 types, fix fixtures to the real shape"
```

---

## Completion

REQUIRED SUB-SKILL `superpowers:finishing-a-development-branch`. Branch `feat/order-v2-codegen` (off `main`). Push with `git push -u origin feat/order-v2-codegen`.

**Carry-over note:** the Phase 1 demo de-dup (`6e18281`, demo importing the SDK's `productIdFromYrn`) did not reach `main`. Re-apply it here or in a small follow-up if desired (the demo currently keeps a harmless local copy).
