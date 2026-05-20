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
} from "../generated/cart";

/** A cart as returned by the Cart service (all generated fields). */
export type Cart = GeneratedCart;

/** The cart-create response (`{ cartId, yrn }`, generated). */
export type CartCreated = CreatedCart;

/** Generated request bodies (caller sends the exact wire shape). */
export type CreateCartInput = CreateCart;
export type CartItemInput = CartItemRequest;
export type CartItemUpdate = UpdateCartItem;

/** An address payload for cart shipping/billing (generated). */
export type CartAddress = AddressRequest;

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

  /** Updates an item. */
  async updateItem(
    cartId: string,
    itemId: string,
    patch: CartItemUpdate,
    auth: AuthContext,
  ): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "PUT",
      path: `${this.base()}/${cartId}/items/${itemId}`,
      auth: requireCartAuth(auth),
      body: patch,
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

  /** Applies a coupon. */
  async applyCoupon(cartId: string, code: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "POST",
      path: `${this.base()}/${cartId}/coupons`,
      auth: requireCartAuth(auth),
      body: { code },
    });
  }

  /** Removes a coupon. */
  async removeCoupon(cartId: string, code: string, auth: AuthContext): Promise<Cart> {
    return this.ctx.http.request<Cart>({
      method: "DELETE",
      path: `${this.base()}/${cartId}/coupons/${code}`,
      auth: requireCartAuth(auth),
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
}
