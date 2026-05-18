import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixAuthError } from "../core/errors";

/** A checkout payment method (exactly one per checkout). */
export interface CheckoutPaymentMethod {
  provider: "payment-gateway" | "custom" | "none";
  method?: string;
  amount?: number;
  customAttributes?: Record<string, unknown>;
}

/** A checkout address. Need ≥1 SHIPPING and ≥1 BILLING. */
export interface CheckoutAddress {
  contactName: string;
  street: string;
  zipCode: string;
  city: string;
  country: string;
  type: "SHIPPING" | "BILLING" | string;
  companyName?: string;
  streetNumber?: string;
  state?: string;
  contactPhone?: string;
  [k: string]: unknown;
}

/** Checkout customer block. `email` required; `guest:true` for guest checkout. */
export interface CheckoutCustomer {
  email: string;
  id?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  contactPhone?: string;
  company?: string;
  guest?: boolean;
  [k: string]: unknown;
}

/** `requestCheckout` body (cart-based). */
export interface CheckoutInput {
  cartId: string;
  customer: CheckoutCustomer;
  shipping: {
    methodId: string;
    zoneId: string;
    methodName: string;
    amount: number;
    shippingTaxCode?: string;
  };
  addresses: CheckoutAddress[];
  paymentMethods: CheckoutPaymentMethod[];
  currency?: string;
}

/** `requestFromQuoteCheckout` body (quote-based). */
export interface QuoteCheckoutInput {
  quoteId: string;
  paymentMethods: CheckoutPaymentMethod[];
  deliveryWindowId?: string;
}

/** `responseCheckout`. `paymentDetails` is provider-shaped (kept verbatim). */
export interface CheckoutResult {
  orderId: string;
  paymentDetails: Record<string, unknown> | null;
  checkoutId: string | null;
}

/** Options for a checkout call. */
export interface CheckoutOptions {
  /** Customer `saasToken` from `customers.login()` — required for logged-in checkout. */
  saasToken?: string;
  /** Site code (`?siteCode=`). */
  siteCode?: string;
}

function isGuest(customer: CheckoutCustomer | undefined): boolean {
  return customer?.guest === true;
}

function resolveAuth(auth: AuthContext | undefined, guest: boolean): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "raw")) return auth;
  if (guest && auth && auth.kind === "anonymous") return auth;
  throw new EmporixAuthError(
    "checkout requires a customer/raw AuthContext (or anonymous for a guest checkout)",
  );
}

/** Triggers Emporix checkout (atomic: validate → order → payment → close cart). */
export class CheckoutService {
  constructor(private readonly ctx: ClientContext) {}

  private headers(opts: CheckoutOptions, guest: boolean): Record<string, string> | undefined {
    if (guest || !opts.saasToken) return undefined;
    return { "saas-token": opts.saasToken };
  }

  private query(opts: CheckoutOptions): Record<string, string> | undefined {
    return opts.siteCode ? { siteCode: opts.siteCode } : undefined;
  }

  /** Checkout from a cart. Requires customer/raw auth (or anonymous for guest). */
  async placeOrder(
    input: CheckoutInput,
    auth?: AuthContext,
    opts: CheckoutOptions = {},
  ): Promise<CheckoutResult> {
    const guest = isGuest(input.customer);
    const headers = this.headers(opts, guest);
    const query = this.query(opts);
    return this.ctx.http.request<CheckoutResult>({
      method: "POST",
      path: `/checkout/${this.ctx.tenant}/checkouts/order`,
      auth: resolveAuth(auth, guest),
      ...(query ? { query } : {}),
      ...(headers ? { headers } : {}),
      body: input,
    });
  }

  /** Checkout from a quote. */
  async placeOrderFromQuote(
    input: QuoteCheckoutInput,
    auth?: AuthContext,
    opts: CheckoutOptions = {},
  ): Promise<CheckoutResult> {
    const headers = this.headers(opts, false);
    const query = this.query(opts);
    return this.ctx.http.request<CheckoutResult>({
      method: "POST",
      path: `/checkout/${this.ctx.tenant}/checkouts/order`,
      auth: resolveAuth(auth, false),
      ...(query ? { query } : {}),
      ...(headers ? { headers } : {}),
      body: input,
    });
  }
}
