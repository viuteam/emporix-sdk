import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixNotFoundError, EmporixValidationError } from "../core/errors";
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

/** A cart as returned by the Cart service (all generated fields). */
export type Cart = GeneratedCart;

/** The cart-create response (`{ cartId, yrn }`, generated). */
export type CartCreated = CreatedCart;

/** Generated request bodies (caller sends the exact wire shape). */
export type CreateCartInput = CreateCart;
export type CartItemInput = CartItemRequest;
export type CartItemUpdate = UpdateCartItem;

/** Per-entry result of `addItemsBatch`. `status` is HTTP-style per entry (e.g. 201 = added, 4xx = failed). */
export type CartItemBatchEntry = GeneratedSingleBatchResponse;
/** Response shape of `addItemsBatch` — one entry per input item, matching by `index`. */
export type CartItemsBatchResponse = GeneratedBatchResponse;

/** An address payload for cart shipping/billing (generated). */
export type CartAddress = AddressRequest;

/** Result of validating a cart's items (generated). */
export type CartValidationResult = GeneratedCartValidationResult;

/** A single cart item as returned by the Cart service (generated). */
export type CartItem = CartItemResponse;

/** Request body for updating multiple cart items (generated). */
export type CartItemsBatchUpdateInput = CartItemsBatchUpdateRequest;

/** Per-entry response for a multi-item update (generated). */
export type CartItemsBatchUpdateResult = CartItemsBatchUpdateResponse;

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

function requireCartAuth(auth: AuthContext | undefined): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "anonymous")) return auth;
  throw new EmporixValidationError(
    "CartService requires an explicit { kind: 'customer' } or { kind: 'anonymous' } AuthContext",
  );
}

function requireCustomerAuth(auth: AuthContext | undefined): AuthContext {
  if (auth && auth.kind === "customer") return auth;
  throw new EmporixValidationError("cart.merge requires a { kind: 'customer' } AuthContext");
}

/** Cart operations. Every method requires an explicit customer/anonymous context. */
export class CartService {
  static readonly channel = "cart" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/cart/${this.ctx.tenant}/carts`;
  }

  /** Creates a cart. */
  async create(
    input: CreateCartInput | undefined,
    auth: AuthContext,
  ): Promise<CartCreated> {
    return this.ctx.http.request<CartCreated>({
      method: "POST",
      path: this.base(),
      auth: requireCartAuth(auth),
      body: input ?? {},
    });
  }

  /** Fetches a cart by id. */
  async get(cartId: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "GET",
      path: `${this.base()}/${cartId}`,
      auth: requireCartAuth(auth),
    });
  }

  /** Returns the current cart for the session, or null if none. */
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

  /** Adds an item. */
  async addItem(
    cartId: string,
    item: CartItemInput,
    auth: AuthContext,
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "POST",
      path: `${this.base()}/${cartId}/items`,
      auth: requireCartAuth(auth),
      body: item,
    });
  }

  /**
   * Adds multiple items in a single request via `POST /carts/{id}/itemsBatch`.
   * Server-side limit is 200 entries per call — callers handling larger sets
   * must chunk. The response carries a per-entry `status` (HTTP-style: 201
   * for added, 4xx/5xx for failed) and `index` matching the input position;
   * partial failures do **not** throw — inspect `status` per entry.
   */
  async addItemsBatch(
    cartId: string,
    items: CartItemInput[],
    auth: AuthContext,
  ): Promise<CartItemsBatchResponse> {
    return this.ctx.http.request<CartItemsBatchResponse>({
      method: "POST",
      path: `${this.base()}/${cartId}/itemsBatch`,
      auth: requireCartAuth(auth),
      body: items,
    });
  }

  /**
   * Updates an item. By default this is a **full replace** — the server expects
   * the complete item (e.g. `itemYrn` + the `price` row). Pass
   * `{ partial: true }` to send a **partial update** (`?partial=true`), e.g. a
   * quantity-only change with just `{ quantity }`.
   */
  async updateItem(
    cartId: string,
    itemId: string,
    patch: CartItemUpdate,
    auth: AuthContext,
    opts: { partial?: boolean } = {},
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "PUT",
      path: `${this.base()}/${cartId}/items/${itemId}`,
      auth: requireCartAuth(auth),
      body: patch,
      ...(opts.partial ? { query: { partial: "true" } } : {}),
    });
  }

  /** Removes an item. */
  async removeItem(cartId: string, itemId: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "DELETE",
      path: `${this.base()}/${cartId}/items/${itemId}`,
      auth: requireCartAuth(auth),
    });
  }

  /** Empties the cart. */
  async clear(cartId: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "DELETE",
      path: `${this.base()}/${cartId}/items`,
      auth: requireCartAuth(auth),
    });
  }

  /**
   * Applies a coupon by code. Coupon application goes through the cart's
   * `discounts` endpoint (`POST …/discounts` with a coupon-code-only payload) —
   * the live API has no `…/coupons` path. The apply response only carries the
   * applied-discount reference (`{ discountId, discountIndex }`), so the updated
   * cart is re-fetched and returned to preserve the `Cart` contract.
   */
  async applyCoupon(cartId: string, code: string, auth: AuthContext): Promise<Cart> {
    const cartAuth = requireCartAuth(auth);
    await this.ctx.http.request<AppliedDiscount>({
      method: "POST",
      path: `${this.base()}/${cartId}/discounts`,
      auth: cartAuth,
      body: { code },
    });
    return this.get(cartId, cartAuth);
  }

  /**
   * Removes a coupon by code via `DELETE …/discounts?codes=<code>` — the live
   * API has no `…/coupons/<code>` path. The delete responds 204 No Content, so
   * the updated cart is re-fetched and returned.
   */
  async removeCoupon(cartId: string, code: string, auth: AuthContext): Promise<Cart> {
    const cartAuth = requireCartAuth(auth);
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${cartId}/discounts`,
      query: { codes: code },
      auth: cartAuth,
    });
    return this.get(cartId, cartAuth);
  }

  /** Validates the cart's items (pricing/consistency checks). */
  async validate(cartId: string, auth: AuthContext): Promise<CartValidationResult> {
    return this.ctx.http.request<CartValidationResult>({
      method: "GET",
      path: `${this.base()}/${cartId}/validate`,
      auth: requireCartAuth(auth),
    });
  }

  /** Lists the items in a cart with calculated prices. */
  async listItems(cartId: string, auth: AuthContext): Promise<CartItem[]> {
    return this.ctx.http.request<CartItem[]>({
      method: "GET",
      path: `${this.base()}/${cartId}/items`,
      auth: requireCartAuth(auth),
    });
  }

  /** Refreshes a cart and its items (re-prices), then returns the updated cart. */
  async refresh(cartId: string, auth: AuthContext): Promise<Cart> {
    const cartAuth = requireCartAuth(auth);
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${cartId}/refresh`,
      auth: cartAuth,
    });
    return this.get(cartId, cartAuth);
  }

  /** Changes the cart's site (re-prices to the new site's currency), then returns the updated cart. */
  async changeSite(cartId: string, siteCode: string, auth: AuthContext): Promise<Cart> {
    const cartAuth = requireCartAuth(auth);
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/${cartId}/changeSite`,
      auth: cartAuth,
      body: { siteCode },
    });
    return this.get(cartId, cartAuth);
  }

  /** Changes the cart's currency (re-prices), then returns the updated cart. */
  async changeCurrency(cartId: string, currency: string, auth: AuthContext): Promise<Cart> {
    const cartAuth = requireCartAuth(auth);
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/${cartId}/changeCurrency`,
      auth: cartAuth,
      body: { currency },
    });
    return this.get(cartId, cartAuth);
  }

  /**
   * Updates multiple cart items in one request (`PUT …/itemsBatch`). Like
   * `addItemsBatch`, the response carries a per-entry `status`; partial failures
   * do not throw — inspect each entry.
   */
  async updateItemsBatch(
    cartId: string,
    items: CartItemsBatchUpdateInput,
    auth: AuthContext,
  ): Promise<CartItemsBatchUpdateResult> {
    return this.ctx.http.request<CartItemsBatchUpdateResult>({
      method: "PUT",
      path: `${this.base()}/${cartId}/itemsBatch`,
      auth: requireCartAuth(auth),
      body: items,
    });
  }

  /** Sets the shipping address. */
  async setShippingAddress(
    cartId: string,
    address: CartAddress,
    auth: AuthContext,
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "PUT",
      path: `${this.base()}/${cartId}/shipping-address`,
      auth: requireCartAuth(auth),
      body: address,
    });
  }

  /** Sets the billing address. */
  async setBillingAddress(
    cartId: string,
    address: CartAddress,
    auth: AuthContext,
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "PUT",
      path: `${this.base()}/${cartId}/billing-address`,
      auth: requireCartAuth(auth),
      body: address,
    });
  }

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
}
