import type { ClientContext } from "../core/context";
import type { AuthContext, AnonymousSession } from "../core/auth";
import { EmporixAuthError } from "../core/errors";
import { requireCustomer } from "../core/require-customer";
import type {
  Customer as GeneratedCustomer,
  Address as GeneratedAddress,
  CustomerSignup,
  CustomerUpdateDto,
  PasswordChangeDto,
  PasswordResetRequestDto,
  PasswordUpdate,
  AddressCreateDto,
  AddressUpdateDto,
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
  /** Only set by `socialLogin`: the IdP access token echoed by Emporix. */
  socialAccessToken?: string;
  /** Only set by `socialLogin`: the IdP ID token echoed by Emporix. */
  socialIdToken?: string;
}

/** Customer profile as returned by the Customer service (all generated fields). */
export type Customer = GeneratedCustomer;

/** A customer address as returned by the Customer service (all generated fields). */
export type Address = GeneratedAddress;

/** Generated request bodies (caller sends the exact wire shape). */
export type CustomerSignupInput = CustomerSignup;
export type CustomerUpdateInput = CustomerUpdateDto;
export type PasswordChangeInput = PasswordChangeDto;
export type PasswordResetRequestInput = PasswordResetRequestDto;
export type PasswordResetConfirmInput = PasswordUpdate;
export type AddressCreateInput = AddressCreateDto;
export type AddressUpdateInput = AddressUpdateDto;

/** Union of the wire shapes the four session endpoints return. snake_case is
 * canonical; camelCase is the deprecated fallback (vendored spec, design §2). */
interface WireSession {
  access_token?: string;
  saas_token?: string;
  refresh_token?: string;
  session_id?: string;
  expires_in?: string | number;
  accessToken?: string;
  saasToken?: string;
  refreshToken?: string;
  social_access_token?: string;
  social_id_token?: string;
}

/** Wire→facade mapping shared by login/refresh/socialLogin/exchangeToken.
 * Throws instead of fabricating an empty session: `customerToken: ""` would
 * read as authenticated downstream and 401-loop every subsequent call. */
function toSession(
  endpoint: string,
  wire: WireSession,
  opts: { carrySaasToken?: string } = {},
): CustomerSession {
  const customerToken = wire.access_token ?? wire.accessToken;
  if (!customerToken) {
    throw new EmporixAuthError(`${endpoint}: response missing access_token`, undefined, wire);
  }
  return {
    customerToken,
    saasToken: wire.saas_token ?? wire.saasToken ?? opts.carrySaasToken ?? "",
    refreshToken: wire.refresh_token ?? wire.refreshToken ?? "",
    sessionId: wire.session_id,
    expiresIn: wire.expires_in != null ? Number(wire.expires_in) : undefined,
    ...(wire.social_access_token ? { socialAccessToken: wire.social_access_token } : {}),
    ...(wire.social_id_token ? { socialIdToken: wire.social_id_token } : {}),
  };
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
    input: CustomerSignupInput,
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
    const wire = await this.ctx.http.request<WireSession>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/login`,
      auth: effective,
      body: creds,
    });
    return toSession("login", wire);
  }

  /**
   * Refreshes an authenticated customer session via its refresh token,
   * preserving the same `sessionId`. Calls
   * `GET /customer/{tenant}/refreshauthtoken?refreshToken=…`, which **must be
   * authorized with an anonymous token** (default auth: anonymous) — not the
   * expired customer token. The refresh response does **not** include a
   * `saas_token`; pass the original `saasToken` to carry it forward (it has
   * its own, independent lifetime).
   */
  async refresh(
    input: { refreshToken: string; saasToken?: string; legalEntityId?: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<CustomerSession> {
    const query: Record<string, string> = { refreshToken: input.refreshToken };
    if (input.legalEntityId) query.legalEntityId = input.legalEntityId;
    const wire = await this.ctx.http.request<WireSession>({
      method: "GET",
      path: `/customer/${this.ctx.tenant}/refreshauthtoken`,
      query,
      auth,
    });
    // Refresh does not return a saas_token — carry the original forward.
    return toSession(
      "refresh",
      wire,
      input.saasToken !== undefined ? { carrySaasToken: input.saasToken } : {},
    );
  }

  /**
   * Logs the customer out server-side: `GET /customer/{tenant}/logout?
   * accessToken=…` authorized with the customer token. Invalidates the
   * access token (204 No Content). Requires customer/raw auth — the token is
   * sent both as the bearer and the `accessToken` query param (per Emporix).
   */
  async logout(auth?: AuthContext): Promise<void> {
    const ctx = requireCustomer(auth);
    const token = (ctx as { token: string }).token;
    await this.ctx.http.request<void>({
      method: "GET",
      path: `/customer/${this.ctx.tenant}/logout`,
      query: { accessToken: token },
      auth: ctx,
    });
  }

  /**
   * Authorization-Code SSO: exchanges the IdP `code` for an Emporix customer
   * session via `POST /customer/{tenant}/socialLogin`. The browser performs
   * the IdP redirect itself; the SDK only does this Emporix exchange.
   * Default auth: anonymous (Emporix requires an anonymous Bearer). The
   * response has no `session_id` and returns `expires_in` as a string —
   * normalized to a number here.
   */
  async socialLogin(
    input: { code: string; redirectUri: string; codeVerifier?: string; sessionId?: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<CustomerSession> {
    const query: Record<string, string> = {
      code: input.code,
      redirect_uri: input.redirectUri,
    };
    if (input.codeVerifier) query.code_verifier = input.codeVerifier;
    const wire = await this.ctx.http.request<WireSession>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/socialLogin`,
      query,
      auth,
      ...(input.sessionId ? { headers: { "session-id": input.sessionId } } : {}),
    });
    return toSession("socialLogin", wire);
  }

  /**
   * RFC 8693 token exchange: exchanges an external IdP JWT for an Emporix
   * customer session via `POST /customer/{tenant}/exchangeauthtoken`.
   * Emporix uses a proprietary query-param wire (not the RFC form body).
   * Default auth: anonymous. `config` selects a site-specific IdP config
   * (multi-site); omit for the tenant default. Returns `session_id` and a
   * fresh `saas_token`; `expires_in` is an integer (normalized anyway).
   */
  async exchangeToken(
    input: { subjectToken: string; config?: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<CustomerSession> {
    const query: Record<string, string> = { subjectAccessToken: input.subjectToken };
    if (input.config) query.config = input.config;
    const wire = await this.ctx.http.request<WireSession>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/exchangeauthtoken`,
      query,
      auth,
    });
    return toSession("exchangeToken", wire);
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
  async update(patch: CustomerUpdateInput, auth?: AuthContext): Promise<Customer> {
    return this.ctx.http.request<Customer>({
      method: "PUT",
      path: `/customer/${this.ctx.tenant}/me`,
      auth: requireCustomer(auth),
      body: patch,
    });
  }

  /** Changes the password. Requires customer/raw auth. */
  async changePassword(input: PasswordChangeInput, auth?: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `/customer/${this.ctx.tenant}/password`,
      auth: requireCustomer(auth),
      body: input,
    });
  }

  /** Requests a password reset email. Default auth: anonymous. */
  async requestPasswordReset(
    input: PasswordResetRequestInput,
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
    input: PasswordResetConfirmInput,
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
    add: async (address: AddressCreateInput, auth?: AuthContext): Promise<Address> =>
      this.ctx.http.request<Address>({
        method: "POST",
        path: `/customer/${this.ctx.tenant}/me/addresses`,
        auth: requireCustomer(auth),
        body: address,
      }),
    update: async (id: string, patch: AddressUpdateInput, auth?: AuthContext): Promise<Address> =>
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
