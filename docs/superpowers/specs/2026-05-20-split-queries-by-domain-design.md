# Split `hooks/queries.ts` by Service Domain — Design

## Context

`packages/react/src/hooks/queries.ts` is the only file in the hooks barrel whose name is technology-bezogen (`queries`) rather than domain-bezogen (every other file follows `use-<domain>.ts`). It currently holds **8 hooks across 3 domains** — Product (3), Category (4), Cart (1) — which makes finding hooks unintuitive and breaks the established convention.

A side effect of this layout: when the Pagination-Harmonization PR added `useCategoriesInfinite`, it was easy to miss the re-export step. Today, `useCategoriesInfinite` is defined in `queries.ts:103` but never re-exported from `hooks/index.ts` or `src/index.ts` — **external consumers cannot import it**. Splitting by domain makes the export chain easier to reason about and lets us fix this bug as part of the same change.

## Goals

- Replace `hooks/queries.ts` with domain-aligned files matching the existing pattern.
- Preserve all public hook exports byte-for-byte at the package root (`@viu/emporix-sdk-react`) — no consumer code change required.
- Add the missing `useCategoriesInfinite` export to both `hooks/index.ts` and `src/index.ts`.
- Update the one internal cross-file import (`use-product-media.ts` imports `useProduct` from `./queries`).
- Move `useCart` into the cart-related file rather than letting it be the only Cart hook outside `use-cart-mutations.ts`. Rename that file to `use-cart.ts` so it holds all Cart hooks (read + mutations + create).

## Non-Goals

- Behavioral changes to any hook — return types, query keys, mutation flows all stay identical.
- Renaming public hook function names (keep `useProduct`, `useCart`, etc.).
- Splitting `use-my-segments.ts` (it already follows the domain pattern with 7 hooks).
- Splitting `use-cart-mutations.ts` into per-mutation files — the cart-mutations API is a cohesive unit.

## Architecture

### File layout — before

```
packages/react/src/hooks/
├── index.ts                  ← barrel; re-exports for `@viu/emporix-sdk-react`
├── queries.ts                ← ❌ 8 hooks, 3 domains, technology-named
├── use-cart-mutations.ts     ← useCartMutations + useCreateCart
├── use-checkout.ts
├── use-customer-session.ts
├── use-match-prices.ts
├── use-my-segments.ts
├── use-product-media.ts      ← imports useProduct from ./queries
```

### File layout — after

```
packages/react/src/hooks/
├── index.ts                  ← updated re-exports; also exports useCategoriesInfinite
├── use-products.ts           ← useProduct, useProducts, useProductsInfinite
├── use-categories.ts         ← useCategory, useCategories, useCategoriesInfinite, useCategoryTree
├── use-cart.ts               ← useCart (read) + useCartMutations + useCreateCart  ← renamed from use-cart-mutations.ts
├── use-checkout.ts
├── use-customer-session.ts
├── use-match-prices.ts
├── use-my-segments.ts
├── use-product-media.ts      ← imports useProduct from "./use-products"
```

### Shared helper

`queries.ts` defines a private `useReadAuth(override?)` helper used by every read hook to pick the right `AuthContext` (customer if a token is in storage, anonymous otherwise). After the split, three files need this helper.

**Decision:** extract it into `hooks/internal/use-read-auth.ts` so each domain file imports the same helper. Single source of truth.

```typescript
// packages/react/src/hooks/internal/use-read-auth.ts
import { auth, type AuthContext } from "@viu/emporix-sdk";
import { useEmporix } from "../../provider";

export function useReadAuth(override?: AuthContext): { ctx: AuthContext; kind: string } {
  const { storage } = useEmporix();
  if (override) return { ctx: override, kind: override.kind };
  const token = storage.getCustomerToken();
  return token
    ? { ctx: auth.customer(token), kind: "customer" }
    : { ctx: auth.anonymous(), kind: "anonymous" };
}

export interface QueryOpts {
  auth?: AuthContext;
}
```

The `QueryOpts` interface is re-extracted here too (identical to its definition in `queries.ts`).

### Public-API contract

The package root (`@viu/emporix-sdk-react`) and the hooks barrel (`./hooks`) **continue to re-export every existing hook** plus the now-fixed `useCategoriesInfinite`. Consumer imports like `import { useProduct } from "@viu/emporix-sdk-react"` are unaffected.

### Test updates

Tests in `packages/react/tests/` import either from the package root or from specific hook files. After the split:

- Imports from `"../src/hooks/queries"` become imports from `"../src/hooks/use-products"`, `"../src/hooks/use-categories"`, or `"../src/hooks/use-cart"` depending on the hook.
- Imports from `"../src/hooks/use-cart-mutations"` become `"../src/hooks/use-cart"`.

Test bodies stay the same — no behavioral assertions change.

## Data Flow

No runtime data flow change. The hooks issue the same HTTP calls, populate the same React-Query cache under the same query-keys, and return the same shapes. The change is structural only.

## Risk / Compatibility

| Change | Risk | Mitigation |
|---|---|---|
| File renames + moves | Imports break | All in-repo imports updated atomically in the same PR; tests catch any miss |
| `useCategoriesInfinite` newly exported | Low — additive | Documented in changeset; consumers can ignore if they don't need it |
| `use-cart-mutations.ts` → `use-cart.ts` rename | Internal-only path; no public API consumer should import that path directly | If any consumer was doing `import "@viu/emporix-sdk-react/hooks/use-cart-mutations"` (unusual), they'd break — but that's not a published path; the package only publishes the barrel |
| Helper extraction `useReadAuth` | Pure refactor; same behavior | Existing tests cover the read path |

**Changeset:** patch for `@viu/emporix-sdk-react` (pure refactor with one additive fix). No SDK change.

## File Structure

| File | Change |
|---|---|
| `packages/react/src/hooks/queries.ts` | **DELETE** |
| `packages/react/src/hooks/use-products.ts` | **CREATE** — useProduct, useProducts, useProductsInfinite |
| `packages/react/src/hooks/use-categories.ts` | **CREATE** — useCategory, useCategories, useCategoriesInfinite, useCategoryTree |
| `packages/react/src/hooks/use-cart.ts` | **RENAME** from `use-cart-mutations.ts`; absorb `useCart` (read) from queries.ts |
| `packages/react/src/hooks/use-cart-mutations.ts` | **DELETE** (content moved to use-cart.ts) |
| `packages/react/src/hooks/internal/use-read-auth.ts` | **CREATE** — extracted `useReadAuth` + `QueryOpts` |
| `packages/react/src/hooks/use-product-media.ts:2` | Update import path |
| `packages/react/src/hooks/index.ts` | Re-export from new file paths; add `useCategoriesInfinite` |
| `packages/react/src/index.ts` | Add `useCategoriesInfinite` to the root export list |
| `packages/react/tests/queries.test.tsx` | **RENAME** to mirror the domain split (or split into `use-products.test.tsx`, `use-categories.test.tsx`, `use-cart.test.tsx`) — see plan for the per-test mapping |
| `packages/react/tests/use-cart-mutations.test.tsx` | Update imports; no rename necessary (already domain-named) |
| `packages/react/tests/use-product-media.test.tsx` | If it imports from `../src/hooks/queries`, update |
| `packages/react/tests/use-categories-infinite.test.tsx` | Update imports |
| `.changeset/split-queries-by-domain.md` | Patch changeset with notice about `useCategoriesInfinite` now being exported |

## Out-of-scope follow-ups

- Splitting `use-my-segments.ts` (7 hooks) — it follows the convention; leave as-is unless someone reports finding-hooks pain.
- Per-hook test files: today we have one test file per current hook-file plus some specific behavior files (`use-categories-infinite.test.tsx`). Whether to keep that pattern or fold the new domain tests into `use-products.test.tsx` + `use-categories.test.tsx` is decided in the plan.
