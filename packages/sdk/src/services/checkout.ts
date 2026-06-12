import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixAuthError } from "../core/errors";
import type {
  ResponseCheckout,
  RequestCheckout,
  RequestFromQuoteCheckout,
  CustomerJson,
} from "../generated/checkout";

/** `requestCheckout` body (cart-based, generated). */
export type CheckoutInput = RequestCheckout;

/** `requestFromQuoteCheckout` body (quote-based, generated). */
export type QuoteCheckoutInput = RequestFromQuoteCheckout;

/** `responseCheckout` — the full generated checkout response. */
export type CheckoutResult = ResponseCheckout;

/** Options for a checkout call. */
export interface CheckoutOptions {
  /** Customer `saasToken` from `customers.login()` — required for logged-in checkout. */
  saasToken?: string;
  /** Site code (`?siteCode=`). */
  siteCode?: string;
}

function isGuest(customer: CustomerJson | undefined): boolean {
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
  static readonly channel = "checkout" as const;
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
