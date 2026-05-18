import type { ResolvedConfig, ServiceCredentials } from "./config";
import { EmporixAuthError } from "./errors";

/** Which token a call should use. */
export type AuthKind = "service" | "customer" | "anonymous" | "raw";

/** Caller-supplied, per-call auth selector. Never stored on the client. */
export type AuthContext =
  | { kind: "service"; credentials?: string }
  | { kind: "anonymous" }
  | { kind: "customer"; token: string }
  | { kind: "raw"; token: string };

/** An obtained anonymous storefront session. */
export interface AnonymousSession {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  expiresIn: number;
}

/** Supplies SDK-managed tokens (service/custom + anonymous). May be user-injected. */
export interface TokenProvider {
  /** Service/custom client-credentials token for the named credential set. */
  getToken(credentialSet: string): Promise<string>;
  /** Cached anonymous storefront session (preserves sessionId across refreshes). */
  getAnonymousToken(): Promise<AnonymousSession>;
  /** Refresh the anonymous session, preserving sessionId. */
  refreshAnonymous?(): Promise<AnonymousSession>;
  /** Invalidate a cached SDK-managed token so the next call re-auths. */
  invalidate?(credentialSet: string): void;
  /** Invalidate the cached anonymous session. */
  invalidateAnonymous?(): void;
}

/** Tiny constructors for {@link AuthContext}. */
export const auth = {
  /** Service/custom credential set (default `backend`). */
  service: (credentials?: string): AuthContext =>
    credentials === undefined ? { kind: "service" } : { kind: "service", credentials },
  /** Cached anonymous storefront token. */
  anonymous: (): AuthContext => ({ kind: "anonymous" }),
  /** Caller-owned customer bearer token. */
  customer: (token: string): AuthContext => ({ kind: "customer", token }),
  /** Exact token, no transformation (SSO / token-exchange). */
  raw: (token: string): AuthContext => ({ kind: "raw", token }),
};

/** Resolves an {@link AuthContext} to a concrete bearer token. */
export async function resolveToken(ctx: AuthContext, provider: TokenProvider): Promise<string> {
  switch (ctx.kind) {
    case "service":
      return provider.getToken(ctx.credentials ?? "backend");
    case "anonymous":
      return (await provider.getAnonymousToken()).accessToken;
    case "customer":
    case "raw":
      return ctx.token;
  }
}

interface CacheEntry {
  token: string;
  expiresAt: number;
  obtainedAt: number;
}

/** SDK-owned token provider: client-credentials service tokens + anonymous session. */
export class DefaultTokenProvider implements TokenProvider {
  private readonly serviceCache = new Map<string, CacheEntry>();
  private readonly serviceLocks = new Map<string, Promise<string>>();
  private anon: (AnonymousSession & { expiresAt: number }) | undefined;
  private anonLock: Promise<AnonymousSession> | undefined;

  constructor(private readonly cfg: ResolvedConfig) {}

  private creds(set: string): ServiceCredentials {
    if (set === "backend") return this.cfg.credentials.backend;
    const c = this.cfg.credentials.custom?.[set];
    if (!c) throw new Error(`Unknown credential set "${set}"`);
    return c;
  }

  private fresh(e: CacheEntry | undefined): boolean {
    if (!e) return false;
    const now = Date.now();
    if (now - e.obtainedAt >= this.cfg.cache.maxLifetimeSeconds * 1000) return false;
    return now < e.expiresAt;
  }

  async getToken(set: string): Promise<string> {
    // Surface an unknown credential set before entering the cache/lock path.
    this.creds(set);
    const cached = this.serviceCache.get(set);
    if (this.fresh(cached)) return cached!.token;
    const inflight = this.serviceLocks.get(set);
    if (inflight) return inflight;
    const p = this.requestServiceToken(set).finally(() => this.serviceLocks.delete(set));
    this.serviceLocks.set(set, p);
    return p;
  }

  private async requestServiceToken(set: string): Promise<string> {
    const c = this.creds(set);
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: c.clientId,
      client_secret: c.secret,
    });
    if (c.scope) body.set("scope", c.scope);
    const res = await fetch(`${this.cfg.host}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new EmporixAuthError(`Token request failed for "${set}"`, res.status, json);
    }
    const obtainedAt = Date.now();
    const ttl = Number((json.expires_in as number | undefined) ?? 3600);
    this.serviceCache.set(set, {
      token: json.access_token as string,
      obtainedAt,
      expiresAt: obtainedAt + (ttl - this.cfg.cache.expirationBufferSeconds) * 1000,
    });
    return this.serviceCache.get(set)!.token;
  }

  invalidate(set: string): void {
    this.serviceCache.delete(set);
  }

  // Anonymous path is implemented in the next task.
  async getAnonymousToken(): Promise<AnonymousSession> {
    throw new Error("not implemented yet");
  }
}
