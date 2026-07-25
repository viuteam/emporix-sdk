import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import { requireCustomer } from "../core/require-customer";
import type {
  PaymentModeFrontendResponse,
  AuthorizePaymentRequest,
  InitializePaymentRequest,
  InitializePaymentResponse,
  PaymentModeResponse,
  PaymentModeRequest,
  PaymentMethodUpdateRequest,
  PaymentTransactionResponse,
  AuthorizePaymentResponse,
  CaptureRequest,
  RefundRequest,
  CommonPaymentResponse,
} from "../generated/payment";

const ANON: AuthContext = auth.anonymous();
const SERVICE: AuthContext = auth.service();

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

/** A configured payment mode (admin view, `/paymentmodes/config`). */
export type PaymentModeConfig = PaymentModeResponse;

/** Body for creating a payment-mode configuration. */
export type PaymentModeCreateInput = PaymentModeRequest;

/** Body for updating a payment-mode configuration. */
export type PaymentModeUpdateInput = PaymentMethodUpdateRequest;

/** A payment transaction (generated). */
export type PaymentTransaction = PaymentTransactionResponse;

/** Result of a backend payment authorization. */
export type PaymentAuthorizeResult = AuthorizePaymentResponse;

/** Body for capturing an authorized payment. */
export type PaymentCaptureInput = CaptureRequest;

/** Body for refunding a captured payment. */
export type PaymentRefundInput = RefundRequest;

/**
 * Result of a refund/cancel operation. Business failures are reported in the
 * body (`successful: false` + `message`), not via HTTP status.
 */
export type PaymentActionResult = CommonPaymentResponse;

/** Result of a capture — like {@link PaymentActionResult} plus the provider's capture id. */
export type PaymentCaptureResult = {
  successful?: boolean;
  message?: string;
  captureId?: string;
};

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

  /**
   * Payment-mode **configuration** (`/paymentmodes/config`) — the admin view.
   * For the storefront view use {@link listPaymentModes} / {@link getMode}.
   * Defaults to service auth.
   */
  readonly modes = {
    /** Lists all configured payment modes. The endpoint takes no query parameters. */
    list: async (authCtx: AuthContext = SERVICE): Promise<PaymentModeConfig[]> =>
      this.ctx.http.request<PaymentModeConfig[]>({
        method: "GET",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config`,
        auth: authCtx,
      }),

    /** Retrieves one payment-mode configuration by id. */
    get: async (id: string, authCtx: AuthContext = SERVICE): Promise<PaymentModeConfig> =>
      this.ctx.http.request<PaymentModeConfig>({
        method: "GET",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config/${id}`,
        auth: authCtx,
      }),

    /** Creates a payment-mode configuration. Responds 200 with the created mode. */
    create: async (
      input: PaymentModeCreateInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PaymentModeConfig> =>
      this.ctx.http.request<PaymentModeConfig>({
        method: "POST",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config`,
        body: input,
        auth: authCtx,
      }),

    /** Updates a payment-mode configuration (PUT). Responds 200 with the updated mode. */
    update: async (
      id: string,
      input: PaymentModeUpdateInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PaymentModeConfig> =>
      this.ctx.http.request<PaymentModeConfig>({
        method: "PUT",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config/${id}`,
        body: input,
        auth: authCtx,
      }),

    /** Deletes a payment-mode configuration. */
    delete: async (id: string, authCtx: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/config/${id}`,
        auth: authCtx,
      });
    },
  };
}
