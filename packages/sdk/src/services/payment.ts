import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixAuthError } from "../core/errors";
import type {
  PaymentModeFrontendResponse,
  AuthorizePaymentRequest,
} from "../generated/payment";

/** A frontend payment mode (generated). */
export type PaymentMode = PaymentModeFrontendResponse;

/** Post-checkout authorize request (generated; caller sends the exact wire shape). */
export type AuthorizePaymentInput = AuthorizePaymentRequest;

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
    return this.ctx.http.request<AuthorizePaymentResult>({
      method: "POST",
      path: `/payment-gateway/${this.ctx.tenant}/payment/frontend/authorize`,
      auth: requireCustomer(auth),
      body: input,
    });
  }
}
