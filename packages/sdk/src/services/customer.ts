import type { ClientContext } from "../core/context";
import type { AuthContext, AnonymousSession } from "../core/auth";
import { EmporixAuthError } from "../core/errors";
import type {
  Customer as GeneratedCustomer,
  Address as GeneratedAddress,
} from "../generated/customer";

/**
 * Caller-owned customer session. Maps the Emporix `CustomerToken` wire shape to
 * idiomatic names: `access_token` → `customerToken`, `saas_token` →
 * `saasToken`. `saasToken` is a JWT required for the checkout (`saas-token`
 * header). The wire's `*_token` (snake_case) fields are canonical; the
 * camelCase variants are deprecated in the Emporix spec.
 */
export interface CustomerSession {
  customerToken: string;
  /** JWT required for completing checkout (sent as the `saas-token` header). */
  saasToken: string;
  refreshToken: string;
  /** Same session as the anonymous token — preserves the cart across login. */
  sessionId: string | undefined;
  /** Customer access-token lifetime in seconds. */
  expiresIn: number | undefined;
}

/** Customer profile as returned by the Customer service (all generated fields). */
export type Customer = GeneratedCustomer;

/** A customer address as returned by the Customer service (all generated fields). */
export type Address = GeneratedAddress;

function requireCustomer(auth: AuthContext | undefined): AuthContext {
  if (auth && (auth.kind === "customer" || auth.kind === "raw")) return auth;
  throw new EmporixAuthError("This operation requires a customer or raw AuthContext");
}

/** Customer signup, session, profile and addresses. */
export class CustomerService {
  constructor(private readonly ctx: ClientContext) {}

  /** Obtains an anonymous storefront session (accessToken + sessionId + refreshToken). */
  async anonymous(): Promise<AnonymousSession> {
    return this.ctx.tokenProvider.getAnonymousToken();
  }

  /** Registers a customer. Default auth: anonymous. */
  async signup(
    input: { email: string; password: string; firstName?: string; lastName?: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<Customer> {
    return this.ctx.http.request<Customer>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/signup`,
      auth,
      body: input,
    });
  }

  /**
   * Logs a customer in. Threads the anonymous token so the session (and its
   * cart) survives — losing it silently creates a new session per Emporix docs.
   * Wire `accessToken` is mapped to `customerToken`.
   */
  async login(
    creds: { email: string; password: string },
    opts: { anonymousToken?: string } = {},
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<CustomerSession> {
    const effective: AuthContext = opts.anonymousToken
      ? { kind: "raw", token: opts.anonymousToken }
      : auth;
    const wire = await this.ctx.http.request<{
      access_token?: string;
      saas_token?: string;
      refresh_token?: string;
      session_id?: string;
      expires_in?: number;
      // Deprecated camelCase variants (Emporix spec marks these deprecated).
      accessToken?: string;
      saasToken?: string;
      refreshToken?: string;
    }>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/login`,
      auth: effective,
      body: creds,
    });
    // Wire→facade mapping. snake_case is canonical; camelCase is the
    // deprecated fallback (see design §2 — vendored spec is source of truth).
    return {
      customerToken: wire.access_token ?? wire.accessToken ?? "",
      saasToken: wire.saas_token ?? wire.saasToken ?? "",
      refreshToken: wire.refresh_token ?? wire.refreshToken ?? "",
      sessionId: wire.session_id,
      expiresIn: wire.expires_in,
    };
  }

  /** Returns the authenticated customer. Requires customer/raw auth. */
  async me(auth?: AuthContext): Promise<Customer> {
    return this.ctx.http.request<Customer>({
      method: "GET",
      path: `/customer/${this.ctx.tenant}/me`,
      auth: requireCustomer(auth),
    });
  }

  /** Updates the authenticated customer. Requires customer/raw auth. */
  async update(patch: Partial<Customer>, auth?: AuthContext): Promise<Customer> {
    return this.ctx.http.request<Customer>({
      method: "PUT",
      path: `/customer/${this.ctx.tenant}/me`,
      auth: requireCustomer(auth),
      body: patch,
    });
  }

  /** Changes the password. Requires customer/raw auth. */
  async changePassword(input: { old: string; new: string }, auth?: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `/customer/${this.ctx.tenant}/password`,
      auth: requireCustomer(auth),
      body: { oldPassword: input.old, newPassword: input.new },
    });
  }

  /** Requests a password reset email. Default auth: anonymous. */
  async requestPasswordReset(
    input: { email: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/password/reset`,
      auth,
      body: input,
    });
  }

  /** Confirms a password reset. Default auth: anonymous. */
  async confirmPasswordReset(
    input: { token: string; newPassword: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/password/reset/confirm`,
      auth,
      body: input,
    });
  }

  /** Address sub-resource. All operations require customer/raw auth. */
  readonly addresses = {
    list: async (auth?: AuthContext): Promise<Address[]> =>
      this.ctx.http.request<Address[]>({
        method: "GET",
        path: `/customer/${this.ctx.tenant}/me/addresses`,
        auth: requireCustomer(auth),
      }),
    add: async (address: Omit<Address, "id">, auth?: AuthContext): Promise<Address> =>
      this.ctx.http.request<Address>({
        method: "POST",
        path: `/customer/${this.ctx.tenant}/me/addresses`,
        auth: requireCustomer(auth),
        body: address,
      }),
    update: async (id: string, patch: Partial<Address>, auth?: AuthContext): Promise<Address> =>
      this.ctx.http.request<Address>({
        method: "PUT",
        path: `/customer/${this.ctx.tenant}/me/addresses/${id}`,
        auth: requireCustomer(auth),
        body: patch,
      }),
    remove: async (id: string, auth?: AuthContext): Promise<void> =>
      this.ctx.http.request<void>({
        method: "DELETE",
        path: `/customer/${this.ctx.tenant}/me/addresses/${id}`,
        auth: requireCustomer(auth),
      }),
  };
}
