# Cart Admin/Lifecycle CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 8 remaining cart operations (backend `search`/`delete`/`update`; storefront `getItem`/`listDiscounts`/`removeAllDiscounts`/`removeDiscountByIndex`/`getDeliveryRestrictions`) to `CartService`, completing coverage of `packages/sdk/specs/cart.yml`.

**Architecture:** Extend the existing `CartService` with flat methods (no sub-resource) — no client wiring, no constructor change. Auth is split: backend ops (`search`/`delete`/`update`) forward an unguarded `auth: AuthContext`; storefront ops keep the `requireCartAuth` (customer/anonymous) guard. Mutating ops re-fetch and return the updated `Cart`, except `delete` (returns `void`). Public types alias generated types 1:1.

**Tech Stack:** TypeScript, Vitest (`vi.fn()`-mocked `http.request`), `@hey-api/openapi-ts`-generated types under `src/generated/cart`.

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (additive).
- HTTP: `this.ctx.http.request<T>({ method, path, query?, body?, idempotent?, auth })`. Base path via `this.base()` = `` `/cart/${this.ctx.tenant}/carts` ``.
- **Argument order (cart-file convention):** required domain args, then `auth`, then any optional trailing param. So `search(query, auth, params = {})`.
- **Auth split:** `search`/`delete`/`update` take `auth: AuthContext` and forward it as-is (no guard — service or customer). All storefront ops call `requireCartAuth(auth)` first (throws `EmporixValidationError` on non-customer/anonymous). `requireCartAuth` already exists in `cart.ts`.
- `update` re-fetches via a **direct** `GET` using the same `auth` (NOT `this.get`, which guards with `requireCartAuth` and would reject a service token). Storefront discount deletes re-fetch via `this.get(cartId, cartAuth)`.
- Commitlint: scope must be `cart`; subject's first word is a lowercase verb.
- Do NOT modify existing methods (including `applyCoupon`/`removeCoupon`, `setShippingAddress`/`setBillingAddress`).

## File Structure

- **Modify** `packages/sdk/src/services/cart.ts` — extend the import from `../generated/cart`, add 5 public type aliases, add 8 methods at the end of the class.
- **Modify** `packages/sdk/src/index.ts:58-69` — add the 5 new type exports to the existing `./services/cart` type-export block.
- **Create** `packages/sdk/tests/services/cart-admin.test.ts` — `vi.fn()`-mocked path/method/auth assertions.
- **Create** `.changeset/cart-admin-crud.md` — minor changeset.

---

### Task 1: Backend ops (search / delete / update)

**Files:**
- Modify: `packages/sdk/src/services/cart.ts` (import block lines 4-18; type aliases after line 49; methods appended at end of class before the final `}`)
- Modify: `packages/sdk/src/index.ts` (the `./services/cart` type-export block)
- Test: `packages/sdk/tests/services/cart-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `CartService(ctx)`, `base()`, `AuthContext`, `Cart` alias.
- Produces:
  - `type CartSearchInput`, `CartSummary`, `CartUpdateInput`
  - `search(query: CartSearchInput, auth: AuthContext, params?: { pageNumber?: number; pageSize?: number; sort?: string; fields?: string }): Promise<CartSummary[]>`
  - `delete(cartId: string, auth: AuthContext): Promise<void>`
  - `update(cartId: string, input: CartUpdateInput, auth: AuthContext): Promise<Cart>`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/cart-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { CartService } from "../../src/services/cart";
import { EmporixValidationError } from "../../src/core/errors";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof CartService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): CartService => new CartService(ctxWith(req));
const B = "/cart/acme/carts";
const CUST = { kind: "customer", token: "T" } as const;
const SVC = { kind: "service" } as const;

describe("CartService backend ops", () => {
  it("search POSTs /carts/search with the q body and accepts a service auth", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "c1" }]);
    const res = await svc(s).search({ q: "status:ACTIVE" }, SVC, { pageSize: 10 });
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${B}/search`,
        body: { q: "status:ACTIVE" },
        auth: { kind: "service" },
        query: expect.objectContaining({ pageSize: 10 }),
      }),
    );
    expect(res).toEqual([{ id: "c1" }]);
  });

  it("delete DELETEs /carts/{cartId}", async () => {
    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("c1", SVC);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1`, auth: { kind: "service" } }));
  });

  it("update PUTs then re-fetches the cart with the same auth", async () => {
    const u = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "c1", items: [] });
    const res = await svc(u).update("c1", { addresses: [] } as never, CUST);
    expect(u.mock.calls[0][0]).toEqual(expect.objectContaining({ method: "PUT", path: `${B}/c1`, body: { addresses: [] }, auth: CUST }));
    expect(u.mock.calls[1][0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1`, auth: CUST }));
    expect(res).toEqual({ id: "c1", items: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- cart-admin`
Expected: FAIL — `search` / `delete` / `update` are not functions.

- [ ] **Step 3: Extend the generated-type import**

In `packages/sdk/src/services/cart.ts`, add the four new generated types to the existing `../generated/cart` import (lines 4-18):

```ts
import type {
  Cart as GeneratedCart,
  CreateCart,
  CreatedCart,
  CartItemRequest,
  UpdateCartItem,
  AddressRequest,
  AppliedDiscount,
  BatchResponse as GeneratedBatchResponse,
  SingleBatchResponse as GeneratedSingleBatchResponse,
  CartValidationResult as GeneratedCartValidationResult,
  CartItemResponse,
  CartItemsBatchUpdateRequest,
  CartItemsBatchUpdateResponse,
  Search,
  CartGetAll,
  UpdateCart,
  DiscountResponse,
  CartDtRestrictions,
} from "../generated/cart";
```

(`DiscountResponse` and `CartDtRestrictions` are consumed in Task 2 — importing them now keeps the import block edited once.)

- [ ] **Step 4: Add the type aliases**

In `cart.ts`, after the `CartItemsBatchUpdateResult` alias (line 49):

```ts
/** Body for searching carts (`POST /carts/search`) — a `q` filter. */
export type CartSearchInput = Search;

/** A cart summary as returned by `POST /carts/search`. */
export type CartSummary = CartGetAll;

/** Body for a full cart update (`PUT /carts/{id}`). */
export type CartUpdateInput = UpdateCart;

/** A discount entry as returned by `GET /carts/{id}/discounts`. */
export type CartDiscount = DiscountResponse;

/** Lead-time and non-delivery-time restrictions for a cart (`GET …/dtRestrictions`). */
export type CartDeliveryRestrictions = CartDtRestrictions;
```

- [ ] **Step 5: Add the backend methods**

Append inside the `CartService` class, after `merge` and before the class's closing brace:

```ts
  /**
   * Searches carts tenant-wide (`POST /carts/search`, body `{ q }`). This is a
   * backend/admin operation — a customer token cannot scan other customers'
   * carts, so `auth` is forwarded unguarded (pass a service token for admin
   * use). The server enforces scope (403 on insufficient).
   */
  async search(
    query: CartSearchInput,
    auth: AuthContext,
    params: { pageNumber?: number; pageSize?: number; sort?: string; fields?: string } = {},
  ): Promise<CartSummary[]> {
    return this.ctx.http.request<CartSummary[]>({
      method: "POST",
      path: `${this.base()}/search`,
      query: {
        ...(params.pageNumber === undefined ? {} : { pageNumber: params.pageNumber }),
        ...(params.pageSize === undefined ? {} : { pageSize: params.pageSize }),
        ...(params.sort === undefined ? {} : { sort: params.sort }),
        ...(params.fields === undefined ? {} : { fields: params.fields }),
      },
      body: query,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
      auth,
    });
  }

  /**
   * Deletes a cart (`DELETE /carts/{cartId}`). Backend/admin or owner
   * operation — `auth` is forwarded unguarded (service or customer). Returns
   * nothing; the cart no longer exists.
   */
  async delete(cartId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${cartId}`,
      auth,
    });
  }

  /**
   * Full-updates a cart (`PUT /carts/{cartId}`, body `UpdateCart`). Backend or
   * owner operation — `auth` is forwarded unguarded. The endpoint returns 204,
   * so the cart is re-fetched with the same `auth` (via a direct GET, not
   * `get()`, so a service token is not rejected by the cart-auth guard) and
   * returned.
   */
  async update(cartId: string, input: CartUpdateInput, auth: AuthContext): Promise<Cart> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${cartId}`,
      auth,
      body: input,
    });
    return this.ctx.http.request<Cart>({
      method: "GET",
      path: `${this.base()}/${cartId}`,
      auth,
    });
  }
```

- [ ] **Step 6: Export the new types**

In `packages/sdk/src/index.ts`, add the five new types to the `./services/cart` type-export block (lines 58-69):

```ts
export type {
  Cart,
  CartCreated,
  CartAddress,
  CreateCartInput,
  CartItemInput,
  CartItemUpdate,
  CartValidationResult,
  CartItem,
  CartItemsBatchUpdateInput,
  CartItemsBatchUpdateResult,
  CartSearchInput,
  CartSummary,
  CartUpdateInput,
  CartDiscount,
  CartDeliveryRestrictions,
} from "./services/cart";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- cart-admin`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/src/index.ts packages/sdk/tests/services/cart-admin.test.ts
git commit -m "feat(cart): add backend cart search, delete, update"
```

---

### Task 2: Storefront ops (getItem / discounts / delivery restrictions)

**Files:**
- Modify: `packages/sdk/src/services/cart.ts` (five methods appended after the backend methods)
- Test: `packages/sdk/tests/services/cart-admin.test.ts` (append two describe blocks)

**Interfaces:**
- Consumes: `requireCartAuth` (already in `cart.ts`), `this.get`, `CartItem`/`Cart`/`CartDiscount`/`CartDeliveryRestrictions` aliases.
- Produces:
  - `getItem(cartId: string, itemId: string, auth: AuthContext): Promise<CartItem>`
  - `listDiscounts(cartId: string, auth: AuthContext): Promise<CartDiscount[]>`
  - `removeAllDiscounts(cartId: string, auth: AuthContext): Promise<Cart>`
  - `removeDiscountByIndex(cartId: string, discountIndex: string, auth: AuthContext): Promise<Cart>`
  - `getDeliveryRestrictions(cartId: string, auth: AuthContext): Promise<CartDeliveryRestrictions>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/cart-admin.test.ts`:

```ts
describe("CartService storefront ops", () => {
  it("getItem/listDiscounts/getDeliveryRestrictions hit the right method+path", async () => {
    const g = vi.fn().mockResolvedValue({ id: "i1" });
    await svc(g).getItem("c1", "i1", CUST);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/c1/items/i1`, auth: CUST }));

    const l = vi.fn().mockResolvedValue([{ discountId: "d1" }]);
    await svc(l).listDiscounts("c1", CUST);
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/c1/discounts`, auth: CUST }));

    const dt = vi.fn().mockResolvedValue({ leadTime: 2 });
    await svc(dt).getDeliveryRestrictions("c1", CUST);
    expect(dt).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/c1/dtRestrictions`, auth: CUST }));
  });

  it("removeAllDiscounts DELETEs /discounts (no codes) then re-fetches the cart", async () => {
    const r = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "c1" });
    const res = await svc(r).removeAllDiscounts("c1", CUST);
    expect(r.mock.calls[0][0]).toEqual(expect.objectContaining({ method: "DELETE", path: `${B}/c1/discounts`, auth: CUST }));
    expect(r.mock.calls[0][0]).not.toHaveProperty("query");
    expect(r.mock.calls[1][0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1`, auth: CUST }));
    expect(res).toEqual({ id: "c1" });
  });

  it("removeDiscountByIndex DELETEs /discounts/{index} then re-fetches", async () => {
    const r = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "c1" });
    await svc(r).removeDiscountByIndex("c1", "0", CUST);
    expect(r.mock.calls[0][0]).toEqual(expect.objectContaining({ method: "DELETE", path: `${B}/c1/discounts/0`, auth: CUST }));
    expect(r.mock.calls[1][0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1`, auth: CUST }));
  });
});

describe("CartService auth split", () => {
  it("a storefront op rejects a service auth and makes no request", async () => {
    const r = vi.fn();
    await expect(svc(r).listDiscounts("c1", SVC)).rejects.toBeInstanceOf(EmporixValidationError);
    expect(r).not.toHaveBeenCalled();
  });

  it("a backend op accepts a service auth", async () => {
    const r = vi.fn().mockResolvedValue([]);
    await svc(r).search({}, SVC);
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "service" } }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- cart-admin`
Expected: FAIL — `getItem` / `listDiscounts` / … are not functions.

- [ ] **Step 3: Add the storefront methods**

Append inside the `CartService` class, after the `update` method (from Task 1) and before the class's closing brace:

```ts
  /** Fetches a single cart item's details (`GET /carts/{cartId}/items/{itemId}`). */
  async getItem(cartId: string, itemId: string, auth: AuthContext): Promise<CartItem> {
    return this.ctx.http.request<CartItem>({
      method: "GET",
      path: `${this.base()}/${cartId}/items/${itemId}`,
      auth: requireCartAuth(auth),
    });
  }

  /** Lists the discounts applied to a cart (`GET /carts/{cartId}/discounts`). */
  async listDiscounts(cartId: string, auth: AuthContext): Promise<CartDiscount[]> {
    return this.ctx.http.request<CartDiscount[]>({
      method: "GET",
      path: `${this.base()}/${cartId}/discounts`,
      auth: requireCartAuth(auth),
    });
  }

  /**
   * Removes all discounts from a cart (`DELETE /carts/{cartId}/discounts` with
   * no `codes` filter), then re-fetches and returns the updated cart. Use
   * `removeCoupon(code)` to remove a specific coupon by code.
   */
  async removeAllDiscounts(cartId: string, auth: AuthContext): Promise<Cart> {
    const cartAuth = requireCartAuth(auth);
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${cartId}/discounts`,
      auth: cartAuth,
    });
    return this.get(cartId, cartAuth);
  }

  /**
   * Removes a single discount by its index (`DELETE
   * /carts/{cartId}/discounts/{discountIndex}`), then re-fetches and returns
   * the updated cart.
   */
  async removeDiscountByIndex(cartId: string, discountIndex: string, auth: AuthContext): Promise<Cart> {
    const cartAuth = requireCartAuth(auth);
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${cartId}/discounts/${discountIndex}`,
      auth: cartAuth,
    });
    return this.get(cartId, cartAuth);
  }

  /** Retrieves the cart's lead-time and non-delivery-time restrictions (`GET /carts/{cartId}/dtRestrictions`). */
  async getDeliveryRestrictions(cartId: string, auth: AuthContext): Promise<CartDeliveryRestrictions> {
    return this.ctx.http.request<CartDeliveryRestrictions>({
      method: "GET",
      path: `${this.base()}/${cartId}/dtRestrictions`,
      auth: requireCartAuth(auth),
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- cart-admin`
Expected: PASS (8 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/tests/services/cart-admin.test.ts
git commit -m "feat(cart): add discount, item-detail and delivery-restriction reads"
```

---

### Task 3: Changeset + full verification

**Files:**
- Create: `.changeset/cart-admin-crud.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the release changeset; a green full test/typecheck/build run.

- [ ] **Step 1: Write the changeset**

Create `.changeset/cart-admin-crud.md`:

```md
---
"@viu/emporix-sdk": minor
---

Add the remaining cart operations to `client.carts`: backend `search` (POST
`/carts/search`), `delete`, and `update` (which take an unguarded auth so a
service token can manage any cart), plus storefront `getItem`, `listDiscounts`,
`removeAllDiscounts`, `removeDiscountByIndex`, and `getDeliveryRestrictions`
(which keep the customer/anonymous guard). Mutating ops re-fetch and return the
updated `Cart` (`delete` returns void). Existing cart methods are unchanged.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (existing suite + the new `cart-admin` tests).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 5: Commit**

```bash
git add .changeset/cart-admin-crud.md
git commit -m "chore(cart): add changeset for cart admin crud"
```

---

## Self-Review

**Spec coverage** — every spec operation maps to a task:

| Spec operation | Task |
|---|---|
| `search` (POST /carts/search) | 1 |
| `delete` (DELETE /carts/{cartId}) | 1 |
| `update` (PUT /carts/{cartId}) | 1 |
| `getItem` (GET /carts/{cartId}/items/{itemId}) | 2 |
| `listDiscounts` (GET /carts/{cartId}/discounts) | 2 |
| `removeAllDiscounts` (DELETE /carts/{cartId}/discounts) | 2 |
| `removeDiscountByIndex` (DELETE /carts/{cartId}/discounts/{discountIndex}) | 2 |
| `getDeliveryRestrictions` (GET /carts/{cartId}/dtRestrictions) | 2 |
| 5 public type aliases | 1 |
| Auth split (backend unguarded / storefront requireCartAuth) | 1, 2 (+ guard test) |
| Changeset (minor) | 3 |

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** method names in the tests match the implementations (`search`, `delete`, `update`, `getItem`, `listDiscounts`, `removeAllDiscounts`, `removeDiscountByIndex`, `getDeliveryRestrictions`). `auth` argument order is `(…, auth, params?)` throughout. Generated import names verified against `src/generated/cart/types.gen.ts` (`Search`, `CartGetAll`, `UpdateCart`, `DiscountResponse`, `CartDtRestrictions`). The index.ts export block is edited once (Task 1) with all five new types. ✓

**Auth-split correctness:** `update`/`search`/`delete` never call `requireCartAuth`, so a service token passes through (verified by the "backend op accepts a service auth" test). Storefront ops call `requireCartAuth`, which throws before any request on a service token (verified by the "storefront op rejects a service auth" test). `update`'s re-fetch uses a direct GET with the same `auth` rather than `this.get`, so a service-token update still returns the `Cart`. ✓
