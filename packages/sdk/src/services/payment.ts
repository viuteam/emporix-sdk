import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import { requireCustomer } from "../core/require-customer";
import type {
  PaymentModeFrontendResponse,
  AuthorizePaymentRequest,
  InitializePaymentRequest,
  InitializePaymentResponse,
} from "../generated/payment";

const ANON: AuthContext = auth.anonymous();

/** A frontend payment mode (generated). */
export type PaymentMode = PaymentModeFrontendResponse;

/** Post-checkout authorize request (generated; caller sends the exact wire shape). */
export type AuthorizePaymentInput = AuthorizePaymentRequest;

/** Frontend payment-initialize request (generated). */
export type InitializePaymentInput = InitializePaymentRequest;

/** Frontend payment-initialize response (generated). */
export type InitializePaymentResult = InitializePaymentResponse;

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

/** Payment-Gateway: list frontend payment modes, authorize deferred payments. */
export class PaymentGatewayService {
  static readonly channel = "payment" as const;
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Lists configured frontend payment modes. The endpoint requires a bearer
   * token but no customer scope ("No scope required"), so it defaults to an
   * anonymous context and works for guests and logged-in customers alike.
   */
  async listPaymentModes(authCtx: AuthContext = ANON): Promise<PaymentMode[]> {
    return this.ctx.http.request<PaymentMode[]>({
      method: "GET",
      path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/frontend`,
      auth: authCtx,
    });
  }

  /** Authorizes a post-checkout (deferred) payment for an existing order. */
  async authorize(
    input: AuthorizePaymentInput,
    authCtx?: AuthContext,
  ): Promise<AuthorizePaymentResult> {
    return this.ctx.http.request<AuthorizePaymentResult>({
      method: "POST",
      path: `/payment-gateway/${this.ctx.tenant}/payment/frontend/authorize`,
      auth: requireCustomer(authCtx),
      body: input,
    });
  }

  /** Retrieves a single frontend payment mode by id. Defaults to anonymous (no scope required). */
  async getMode(id: string, authCtx: AuthContext = ANON): Promise<PaymentMode> {
    return this.ctx.http.request<PaymentMode>({
      method: "GET",
      path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/frontend/${id}`,
      auth: authCtx,
    });
  }

  /** Initializes a payment from the frontend. Defaults to anonymous (no scope required). */
  async initialize(
    input: InitializePaymentInput,
    authCtx: AuthContext = ANON,
  ): Promise<InitializePaymentResult> {
    return this.ctx.http.request<InitializePaymentResult>({
      method: "POST",
      path: `/payment-gateway/${this.ctx.tenant}/payment/frontend/initialize`,
      auth: authCtx,
      body: input,
    });
  }
}
