import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixAuthError } from "../core/errors";
import type { Match, MatchByContext, MatchResponse } from "../generated/price";

/** Session-context match request body (generated). */
export type PriceMatchByContextInput = MatchByContext;

/** Explicit-context match request body (generated). */
export type PriceMatchInput = Match;

/** A resolved price (full generated match-response schema). */
export type PriceMatch = MatchResponse;

const ANON: AuthContext = { kind: "anonymous" };
const SERVICE: AuthContext = { kind: "service" };

function requireContextAuth(auth: AuthContext | undefined): AuthContext {
  const a = auth ?? ANON;
  if (a.kind === "anonymous" || a.kind === "customer" || a.kind === "raw") return a;
  throw new EmporixAuthError(
    "match-prices-by-context requires an anonymous, customer, or raw AuthContext",
  );
}

/**
 * Price matching. The Cart service does not resolve prices — call this
 * explicitly before rendering money and again right before placing an order.
 * The SDK is stateless: it never caches or revalidates prices.
 */
export class PriceService {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Resolves prices using the session context bound to the bearer token
   * (currency/site/country were set at anonymous-login time). Default auth:
   * anonymous; pass a customer/raw context for personalized pricing.
   */
  async matchByContext(
    input: PriceMatchByContextInput,
    auth?: AuthContext,
  ): Promise<PriceMatch[]> {
    return this.ctx.http.request<PriceMatch[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/match-prices-by-context`,
      auth: requireContextAuth(auth),
      body: input,
    });
  }

  /**
   * Resolves prices from an explicit context. Default auth: service
   * (requires `price.price_read` / `price.price_manage`).
   */
  async match(input: PriceMatchInput, auth: AuthContext = SERVICE): Promise<PriceMatch[]> {
    return this.ctx.http.request<PriceMatch[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/match-prices`,
      auth,
      body: input,
    });
  }
}
