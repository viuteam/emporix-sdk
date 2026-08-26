import { computed, inject, signal, type Injector, type Signal } from "@angular/core";
import { injectQueryClient, type CreateQueryResult } from "@tanstack/angular-query-experimental";
import {
  EmporixError,
  EmporixNotFoundError,
  type AuthContext,
  type Cart,
  type CartAddress,
  type CartCreated,
  type CartItem,
  type CartItemInput,
  type CartItemUpdate,
  type CartValidationResult,
  type CreateCartInput,
  type EmporixClient,
  type EmporixStorage,
} from "@viu/emporix-sdk";
import { EMPORIX_CLIENT, EMPORIX_STORAGE } from "../tokens";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { injectEmporixSite } from "../site";
import { cartIdSignal } from "../storage-signal";
import { ctxFor, writeBundle } from "../write-bundle";

export interface CartOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: CartOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * A cart by id, falling back to the stored cart id.
 *
 * A 404 here is not a transient error: Emporix allows one open cart per site and
 * placing an order closes it, so every other device still holding that id reads a
 * cart that is gone — permanently, because a stale id is not `null` and nothing
 * bootstraps over it. This drops the id when the server says the cart is gone,
 * turning a dead end into a fresh cart on the next read.
 *
 * Silent on purpose: there is nothing left to show the shopper and nothing they
 * could do about it.
 */
export function injectCart(
  cartId?: Signal<string | null>,
  opts: CartOpts = {},
): CreateQueryResult<Cart> {
  const { client, storage } = injectEmporix();
  const qc = injectQueryClient();
  const stored = cartIdSignal(storage, pass(opts));
  const resolved = computed(() => cartId?.() ?? stored());

  return injectEmporixQuery<Cart, readonly [string | null]>(
    () => ({
      resource: "cart",
      args: [resolved()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && resolved() !== null,
      queryFn: async (ctx) => {
        const id = resolved() as string;
        try {
          return await client.carts.get(id, ctx);
        } catch (e) {
          if (e instanceof EmporixNotFoundError && storage.getCartId() === id) {
            // Only while `id` is still the stored one: a caller passing some
            // other cart's id must not be able to wipe this session's cart.
            storage.setCartId(null);
            // Held with staleTime Infinity, so without this the next bootstrap
            // would re-adopt the same dead cart out of the cache.
            qc.removeQueries({ queryKey: ["emporix", "cart-bootstrap"] });
          }
          throw e;
        }
      },
    }),
    pass(opts),
  );
}

/** The line items of a cart. */
export function injectCartItems(
  cartId: Signal<string | null>,
  opts: CartOpts = {},
): CreateQueryResult<CartItem[]> {
  const { client } = injectEmporix();
  return injectEmporixQuery<CartItem[], readonly [string | null]>(
    () => ({
      resource: "cart-items",
      args: [cartId()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && cartId() !== null,
      queryFn: (ctx) => client.carts.listItems(cartId() as string, ctx),
    }),
    pass(opts),
  );
}

/**
 * Validates a cart against current stock and pricing.
 *
 * `staleTime: 0` is the point of this read, not an oversight: the answer is about
 * right-now availability, and a cached «valid» is the one result that must never
 * be served from memory — it is what the checkout button trusts.
 */
export function injectCartValidation(
  cartId: Signal<string | null>,
  opts: CartOpts = {},
): CreateQueryResult<CartValidationResult> {
  const { client } = injectEmporix();
  return injectEmporixQuery<CartValidationResult, readonly [string | null]>(
    () => ({
      resource: "cart-validation",
      args: [cartId()] as const,
      site: "full",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && cartId() !== null,
      queryFn: (ctx) => client.carts.validate(cartId() as string, ctx),
      staleTime: 0,
    }),
    pass(opts),
  );
}

/**
 * The shopper's active cart, created on demand.
 *
 * `create: true` is what makes an empty storage produce a cart rather than
 * nothing. The resulting id is written to storage, which is what re-keys every
 * other cart read — no manual subscription needed anywhere.
 */
export function injectActiveCart(
  opts: CartOpts & { create?: boolean; type?: string; legalEntityId?: string } = {},
): CreateQueryResult<Cart | null> {
  const { client, storage } = injectEmporix();
  const site = injectEmporixSite();
  const stored = cartIdSignal(storage, pass(opts));

  return injectEmporixQuery<Cart | null, readonly [string | null, string | null]>(
    () => ({
      resource: "cart-bootstrap",
      args: [stored(), site.siteCode()] as const,
      site: "full",
      mode: "read-auth",
      // A cart is always site-bound; without a site there is nothing to create.
      enabled: (opts.enabled ?? true) && site.siteCode() !== null,
      queryFn: async (ctx) => {
        const siteCode = site.siteCode() as string;
        const existing = stored();
        if (existing !== null) return client.carts.get(existing, ctx);
        if (opts.create !== true) return null;
        const cart = await client.carts.getCurrent(ctx, {
          siteCode,
          ...(opts.type !== undefined ? { type: opts.type } : {}),
          ...(opts.legalEntityId !== undefined ? { legalEntityId: opts.legalEntityId } : {}),
          create: true,
        });
        // `Cart` exposes `id`; only `CartCreated` exposes `cartId`. Writing the
        // wrong one leaves storage holding `undefined` and every read disabled.
        if (cart?.id !== undefined) storage.setCartId(cart.id);
        return cart;
      },
    }),
    pass(opts),
  );
}

/** Creates a cart explicitly and adopts it as the active one. */
export interface EmporixCreateCart {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  create(input?: CreateCartInput): Promise<CartCreated>;
}

export function injectCreateCart(): EmporixCreateCart {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const qc = injectQueryClient();
  const isPending = signal(false);
  const error = signal<Error | null>(null);

  return {
    isPending: isPending.asReadonly(),
    error: error.asReadonly(),
    async create(input) {
      error.set(null);
      isPending.set(true);
      try {
        const created = await client.carts.create(input, ctxFor(storage));
        // `cartId` here, not `id` — this is the one response shape that uses it.
        if (created.cartId !== undefined) storage.setCartId(created.cartId);
        await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
        return created;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        error.set(err);
        throw err;
      } finally {
        isPending.set(false);
      }
    },
  };
}

/**
 * Cart writes.
 *
 * The cart id is resolved at **call time**, not at construction: a component that
 * renders before `injectActiveCart` has bootstrapped would otherwise capture
 * `null` and every write would fail. Throws a named error when storage is still
 * empty at call time, which is the only case a caller can actually act on.
 *
 * **No optimistic updates.** React's `useCartMutations` patches the cache and
 * rolls back on failure; this invalidates instead. That is a deliberate gap, not
 * an oversight: optimistic cart surgery has to be right per operation or it shows
 * the shopper a basket that does not exist, and inventing it here without the
 * per-operation tests React has would be worse than a refetch.
 */
export interface EmporixCartMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  addItem(item: CartItemInput): Promise<Cart>;
  updateItem(v: { itemId: string; patch: CartItemUpdate; partial?: boolean }): Promise<Cart>;
  removeItem(itemId: string): Promise<Cart>;
  clear(): Promise<unknown>;
  applyCoupon(code: string): Promise<unknown>;
  removeCoupon(code: string): Promise<unknown>;
  refresh(): Promise<unknown>;
  changeSite(siteCode: string): Promise<unknown>;
  changeCurrency(currency: string): Promise<unknown>;
  /**
   * Both address setters read the cart, merge and write back, because the API has
   * no per-type endpoint and `PUT /carts/{id}` **replaces** the whole `addresses`
   * array — sending one type alone leaves the other an empty stub.
   *
   * There is a known open issue on this path against the live tenant (it has
   * answered 404). It is wired for completeness; verify against your tenant
   * before relying on it, or use the SDK's `setAddresses` to write both types in
   * one request.
   */
  setShippingAddress(address: CartAddress): Promise<unknown>;
  setBillingAddress(address: CartAddress): Promise<unknown>;
}

export function injectCartMutations(cartId?: Signal<string | null>): EmporixCartMutations {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const b = writeBundle([
    ["emporix", "cart"],
    ["emporix", "cart-items"],
  ]);

  /**
   * Stays here rather than moving into `writeBundle`: resolving a cart id at
   * call time is a cart concern, and every other bundle takes its ids from the
   * caller.
   */
  const resolveId = (): string => {
    const id = cartId?.() ?? storage.getCartId();
    if (id === null || id === undefined) {
      throw new EmporixError(
        "injectCartMutations: no cartId available — bootstrap a cart first (injectActiveCart({ create: true }))",
      );
    }
    return id;
  };

  /** Thrown inside the bundle's `write`, so a missing cart id lands on `error()`. */
  const write = <T>(work: (id: string, ctx: AuthContext) => Promise<T>): Promise<T> =>
    b.write((ctx) => work(resolveId(), ctx));

  return {
    isPending: b.isPending,
    error: b.error,
    addItem: (item) => write((id, ctx) => client.carts.addItem(id, item, ctx)),
    updateItem: (v) =>
      write((id, ctx) =>
        client.carts.updateItem(
          id,
          v.itemId,
          v.patch,
          ctx,
          v.partial !== undefined ? { partial: v.partial } : {},
        ),
      ),
    removeItem: (itemId) => write((id, ctx) => client.carts.removeItem(id, itemId, ctx)),
    clear: () => write((id, ctx) => client.carts.clear(id, ctx)),
    applyCoupon: (code) => write((id, ctx) => client.carts.applyCoupon(id, code, ctx)),
    removeCoupon: (code) => write((id, ctx) => client.carts.removeCoupon(id, code, ctx)),
    refresh: () => write((id, ctx) => client.carts.refresh(id, ctx)),
    changeSite: (siteCode) => write((id, ctx) => client.carts.changeSite(id, siteCode, ctx)),
    changeCurrency: (currency) =>
      write((id, ctx) => client.carts.changeCurrency(id, currency, ctx)),
    setShippingAddress: (address) =>
      write((id, ctx) => client.carts.setShippingAddress(id, address, ctx)),
    setBillingAddress: (address) =>
      write((id, ctx) => client.carts.setBillingAddress(id, address, ctx)),
  };
}
