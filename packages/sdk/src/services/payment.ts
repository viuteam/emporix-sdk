import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixAuthError } from "../core/errors";

/** A frontend payment mode. */
export interface PaymentMode {
  id: string;
  code?: string;
  name?: string;
  [k: string]: unknown;
}

/** Post-checkout authorize request. */
export interface AuthorizePaymentInput {
  orderId: string;
  paymentModeId: string;
  creditCardToken?: string;
}

/** Post-checkout authorize result. */
export interface AuthorizePaymentResult {
  successful: boolean;
  paymentTransactionId?: string;
  authorizationToken?: string;
  requiresExternalPayment?: boolean;
  externalPaymentRedirectURL?: string;
  externalPaymentHttpMethod?: string;
  [k: string]: unknown;
}

function requireCustomer(auth: AuthContext | undefined): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "raw")) return auth;
  throw new EmporixAuthError("payment-gateway requires a customer or raw AuthContext");
}

/** Payment-Gateway: list frontend payment modes, authorize deferred payments. */
export class PaymentGatewayService {
  constructor(private readonly ctx: ClientContext) {}

  /** Lists configured frontend payment modes. */
  async listPaymentModes(auth?: AuthContext): Promise<PaymentMode[]> {
    return this.ctx.http.request<PaymentMode[]>({
      method: "GET",
      path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/frontend`,
      auth: requireCustomer(auth),
    });
  }

  /** Authorizes a post-checkout (deferred) payment for an existing order. */
  async authorize(
    input: AuthorizePaymentInput,
    auth?: AuthContext,
  ): Promise<AuthorizePaymentResult> {
    const body: Record<string, unknown> = {
      order: { id: input.orderId },
      paymentModeId: input.paymentModeId,
    };
    if (input.creditCardToken !== undefined) body.creditCardToken = input.creditCardToken;
    return this.ctx.http.request<AuthorizePaymentResult>({
      method: "POST",
      path: `/payment-gateway/${this.ctx.tenant}/payment/frontend/authorize`,
      auth: requireCustomer(auth),
      body,
    });
  }
}
