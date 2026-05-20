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

/**
 * Persistence callback for anonymous sessions. `read` is called once on the
 * first need for an anonymous token to bootstrap a possibly-existing session;
 * `write` is called after every successful login or refresh. `write(null)`
 * means the SDK is invalidating the stored session.
 */
export interface AnonymousSessionStore {
  read(): { refreshToken: string; sessionId: string } | null;
  write(session: { refreshToken: string; sessionId: string } | null): void;
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
  /** Invalidate the cached anonymous session entirely (next call re-logs in). */
  invalidateAnonymous?(): void;
  /**
   * Mark the anonymous access token stale but keep the refresh token, so the
   * next {@link getAnonymousToken} refreshes (preserving sessionId) rather
   * than starting a brand-new session.
   */
  expireAnonymous?(): void;
  /**
   * Install a persistence adapter for the anonymous session. The host (e.g.
   * `EmporixProvider`) calls this at construction so the SDK can bootstrap
   * an existing session and persist refreshes. Idempotent: a later call
   * replaces the previous adapter.
   */
  attachAnonymousStore?(store: AnonymousSessionStore): void;
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
  private anonStore?: AnonymousSessionStore;

  constructor(private readonly cfg: ResolvedConfig) {}

  attachAnonymousStore(store: AnonymousSessionStore): void {
    this.anonStore = store;
    // Bootstrap `this.anon` from the store if we don't have it yet. The seeded
    // session has expiresAt = 0 so the next getAnonymousToken triggers a refresh
    // (which preserves sessionId) instead of a fresh login.
    if (!this.anon) {
      const persisted = store.read();
      if (persisted) {
        this.anon = {
          accessToken: "",
          refreshToken: persisted.refreshToken,
          sessionId: persisted.sessionId,
          expiresIn: 0,
          expiresAt: 0,
        };
      }
    }
  }

  private creds(set: string): ServiceCredentials {
    if (set === "backend") {
      const b = this.cfg.credentials.backend;
      if (!b?.clientId || !b.secret) {
        throw new EmporixAuthError(
          "A 'service' AuthContext was used but credentials.backend is not configured",
        );
      }
      return b;
    }
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

  private anonFresh(): boolean {
    return !!this.anon && Date.now() < this.anon.expiresAt;
  }

  async getAnonymousToken(): Promise<AnonymousSession> {
    if (this.anonFresh()) return this.stripExpiry(this.anon!);
    if (this.anonLock) return this.anonLock;
    // Token expired but a refresh token survives → refresh to keep the same
    // sessionId; only fall back to a brand-new login if the refresh fails.
    const canRefresh = !!this.anon?.refreshToken;
    const obtain = canRefresh
      ? this.fetchAnonymous("refresh").catch(() => this.fetchAnonymous("login"))
      : this.fetchAnonymous("login");
    const p = obtain.finally(() => {
      this.anonLock = undefined;
    });
    this.anonLock = p;
    return p;
  }

  /** Refreshes the anonymous session, preserving its sessionId. */
  async refreshAnonymous(): Promise<AnonymousSession> {
    if (!this.anon) return this.getAnonymousToken();
    return this.fetchAnonymous("refresh");
  }

  invalidateAnonymous(): void {
    this.anon = undefined;
    this.anonStore?.write(null);
  }

  /** Force a stale access token while keeping the refresh token + sessionId. */
  expireAnonymous(): void {
    if (this.anon) this.anon = { ...this.anon, expiresAt: 0 };
  }

  private stripExpiry(s: AnonymousSession & { expiresAt: number }): AnonymousSession {
    const { expiresAt: _expiresAt, ...rest } = s;
    return rest;
  }

  private async fetchAnonymous(mode: "login" | "refresh"): Promise<AnonymousSession> {
    const sf = this.cfg.credentials.storefront;
    if (!sf?.clientId) {
      throw new Error("credentials.storefront.clientId is required for anonymous tokens");
    }
    const url = new URL(`${this.cfg.host}/customerlogin/auth/anonymous/${mode}`);
    url.searchParams.set("tenant", this.cfg.tenant);
    url.searchParams.set("client_id", sf.clientId);
    // Context is config-fixed → single anon slot stays correct (no per-call ctx).
    const c = sf.context;
    if (c?.currency) url.searchParams.set("currency", c.currency);
    if (c?.siteCode) url.searchParams.set("siteCode", c.siteCode);
    if (c?.targetLocation) url.searchParams.set("targetLocation", c.targetLocation);
    if (mode === "refresh" && this.anon) {
      url.searchParams.set("refresh_token", this.anon.refreshToken);
    }
    const res = await fetch(url, { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new EmporixAuthError(`Anonymous token ${mode} failed`, res.status, json);
    }
    const obtainedAt = Date.now();
    this.anon = {
      accessToken: json.access_token as string,
      refreshToken: json.refresh_token as string,
      sessionId: json.sessionId as string,
      expiresIn: json.expires_in as number,
      expiresAt:
        obtainedAt +
        ((json.expires_in as number) - this.cfg.cache.expirationBufferSeconds) * 1000,
    };
    this.anonStore?.write({
      refreshToken: this.anon.refreshToken,
      sessionId: this.anon.sessionId,
    });
    return this.stripExpiry(this.anon);
  }
}
