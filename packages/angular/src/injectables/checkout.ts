import { inject, signal, type Injector, type Signal } from "@angular/core";
import { injectQueryClient, type CreateQueryResult } from "@tanstack/angular-query-experimental";
import {
  auth,
  type AuthContext,
  type CheckoutInput,
  type CheckoutResult,
  type EmporixClient,
  type EmporixStorage,
} from "@viu/emporix-sdk";
import { EMPORIX_CLIENT, EMPORIX_STORAGE } from "../tokens";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { injectEmporixSite } from "../site";

type PaymentModesResult = Awaited<ReturnType<EmporixClient["payments"]["listPaymentModes"]>>;
type PaymentModeResult = Awaited<ReturnType<EmporixClient["payments"]["getMode"]>>;
type ShippingZonesResult = Awaited<ReturnType<EmporixClient["shipping"]["listZones"]>>;
type PaymentInitResult = Awaited<ReturnType<EmporixClient["payments"]["initialize"]>>;

/** 10 minutes — both are admin-configured and change rarely. */
const CONFIG_STALE = 10 * 60_000;

export interface CheckoutOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: CheckoutOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * The storefront's payment modes.
 *
 * **`read-auth`, not `customer`.** The frontend payment-modes endpoint needs a
 * bearer token but no customer scope, so guests see the configured modes too.
 * Gating this on a login would hide every payment option from guest checkout —
 * which is the mistake the mode names exist to prevent.
 */
export function injectPaymentModes(
  opts: CheckoutOpts = {},
): CreateQueryResult<PaymentModesResult> {
  const { client } = injectEmporix();
  return injectEmporixQuery<PaymentModesResult, readonly []>(
    () => ({
      resource: "payment-modes",
      args: [] as const,
      site: "none",
      mode: "read-auth",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.payments.listPaymentModes(ctx),
      staleTime: CONFIG_STALE,
    }),
    pass(opts),
  );
}

/**
 * One payment mode by id.
 *
 * `site: "none"` like {@link injectPaymentModes}, and for a checkable reason:
 * both endpoints are `/payment-gateway/{tenant}/paymentmodes/frontend[/{id}]` —
 * tenant in the path, no site anywhere. The answer cannot vary by site, so
 * keying by one would fragment the cache and bill once per site for the same
 * response. React keys both with `site: "full"`; that is the deviation, not this.
 */
export function injectPaymentMode(
  id: Signal<string>,
  opts: CheckoutOpts = {},
): CreateQueryResult<PaymentModeResult> {
  const { client } = injectEmporix();
  return injectEmporixQuery<PaymentModeResult, readonly [string]>(
    () => ({
      resource: "payment-mode",
      args: [id()] as const,
      site: "none",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && id() !== "",
      queryFn: (ctx) => client.payments.getMode(id(), ctx),
      staleTime: CONFIG_STALE,
    }),
    pass(opts),
  );
}

/**
 * Shipping zones for the active site, expanded with methods and fees.
 *
 * The expansion is not optional: without `methods,fees` a caller gets zones it
 * cannot price, and resolving a delivery option needs both.
 */
export function injectShippingZones(
  opts: CheckoutOpts = {},
): CreateQueryResult<ShippingZonesResult> {
  const { client } = injectEmporix();
  const site = injectEmporixSite();
  return injectEmporixQuery<ShippingZonesResult, readonly [string | null]>(
    () => ({
      resource: "shipping-zones",
      args: [site.siteCode()] as const,
      site: "none",
      mode: "read-auth",
      enabled: (opts.enabled ?? true) && site.siteCode() !== null,
      queryFn: (ctx) =>
        client.shipping.listZones(
          site.siteCode() as string,
          { expand: "methods,fees", activeMethods: "true" },
          ctx,
        ),
      staleTime: CONFIG_STALE,
    }),
    pass(opts),
  );
}

/**
 * Checkout: place an order from a cart.
 *
 * Four things Emporix rejects otherwise, all handled or surfaced here:
 *
 * - **`customer.id` present exactly when signed in.** A customer checkout without
 *   it answers «Cannot found customer»; a guest sending one claims an account it
 *   does not own. The caller owns that field — this cannot fix it for them, but
 *   the doc says so where they will read it.
 * - **The `saas-token` header on a customer checkout.** Taken from the session
 *   automatically, because it comes from login and a refresh cannot re-mint it.
 * - **One `SHIPPING` and one `BILLING` address**, in `input.addresses`.
 * - **The cart is closed on success.** This drops the local cart id, because a
 *   kept id makes every later cart read 404 with nothing to bootstrap over.
 */
export interface EmporixCheckout {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  /** The last successful result, so a caller can render the order id. */
  result: Signal<CheckoutResult | null>;
  placeOrder(input: CheckoutInput): Promise<CheckoutResult>;
}

export function injectCheckout(): EmporixCheckout {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const site = injectEmporixSite();
  const qc = injectQueryClient();

  const isPending = signal(false);
  const error = signal<Error | null>(null);
  const result = signal<CheckoutResult | null>(null);

  return {
    isPending: isPending.asReadonly(),
    error: error.asReadonly(),
    result: result.asReadonly(),
    async placeOrder(input) {
      error.set(null);
      isPending.set(true);
      try {
        const token = storage.getCustomerToken();
        const ctx: AuthContext = token !== null ? auth.customer(token) : auth.anonymous();
        const saasToken = storage.getSaasToken?.() ?? null;
        const siteCode = site.siteCode();
        const placed = await client.checkout.placeOrder(input, ctx, {
          // Only for a customer checkout — a guest has none and sending one is
          // meaningless.
          ...(token !== null && saasToken !== null ? { saasToken } : {}),
          ...(siteCode !== null ? { siteCode } : {}),
        });
        result.set(placed);
        // Emporix closed the cart. Keeping the id locally would make every later
        // cart read 404 with a stale, non-null id that nothing bootstraps over.
        storage.setCartId(null);
        await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
        await qc.invalidateQueries({ queryKey: ["emporix", "my-orders"] });
        return placed;
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

/** Starts a payment against a configured mode. */
export interface EmporixInitializePayment {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  initialize(input: Parameters<EmporixClient["payments"]["initialize"]>[0]): Promise<PaymentInitResult>;
}

export function injectInitializePayment(): EmporixInitializePayment {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const isPending = signal(false);
  const error = signal<Error | null>(null);

  return {
    isPending: isPending.asReadonly(),
    error: error.asReadonly(),
    async initialize(input) {
      error.set(null);
      isPending.set(true);
      try {
        const token = storage.getCustomerToken();
        const ctx: AuthContext = token !== null ? auth.customer(token) : auth.anonymous();
        return await client.payments.initialize(input, ctx);
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
