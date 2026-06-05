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

/**
 * Supplies a fresh customer token when a `customer`-kind request 401s. The host
 * (e.g. EmporixProvider) implements this; the SDK never refreshes the
 * caller-owned customer token unless a refresher is registered.
 */
export interface CustomerTokenRefresher {
  /**
   * Called on a `customer`-kind 401. Receives the token that just failed;
   * returns a fresh customer token to retry with, or `null` to give up (the
   * 401 then propagates as EmporixAuthError).
   */
  refresh(expiredToken: string): Promise<string | null>;
}

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
  /**
   * Override the storefront context (currency/site/country) used for the next
   * anonymous login, then invalidate the current anonymous session so it
   * re-mints with the new context. No-op for providers without anon support.
   */
  setAnonymousContext?(ctx: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
  }): void;
  /**
   * Subscribe to token-refresh events. Optional — implementations may no-op.
   * Returns an unsubscribe function. `DefaultTokenProvider` emits for the
   * anonymous-login / anonymous-refresh paths.
   */
  onRefresh?(
    listener: (event: { kind: "anonymous" | "customer"; success: boolean }) => void,
  ): () => void;
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

/**
 * Late-bindable, single-flight holder for an optional
 * {@link CustomerTokenRefresher}. Single-flight is required because Emporix
 * rotates the refresh token on each refresh — concurrent refreshes would
 * invalidate each other. Off (returns `null`) until a refresher is set.
 */
export class CustomerRefreshRegistry {
  private refresher: CustomerTokenRefresher | null = null;
  private inflight: Promise<string | null> | null = null;

  set(refresher: CustomerTokenRefresher | null): void {
    this.refresher = refresher;
  }

  get enabled(): boolean {
    return this.refresher !== null;
  }

  /** Concurrent callers share one in-flight refresh. */
  refresh(expiredToken: string): Promise<string | null> {
    if (!this.refresher) return Promise.resolve(null);
    if (this.inflight) return this.inflight;
    const p = Promise.resolve(this.refresher.refresh(expiredToken)).finally(() => {
      this.inflight = null;
    });
    this.inflight = p;
    return p;
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
  private contextOverride:
    | { currency?: string; siteCode?: string; targetLocation?: string }
    | undefined;
  private readonly refreshListeners = new Set<
    (event: { kind: "anonymous" | "customer"; success: boolean }) => void
  >();

  constructor(private readonly cfg: ResolvedConfig) {}

  onRefresh(
    listener: (event: { kind: "anonymous" | "customer"; success: boolean }) => void,
  ): () => void {
    this.refreshListeners.add(listener);
    return () => {
      this.refreshListeners.delete(listener);
    };
  }

  private notifyRefresh(kind: "anonymous" | "customer", success: boolean): void {
    for (const l of this.refreshListeners) {
      try {
        l({ kind, success });
      } catch {
        // Never let a telemetry listener break the auth path.
      }
    }
  }

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

  setAnonymousContext(ctx: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
  }): void {
    const base = this.contextOverride ?? this.cfg.credentials.storefront?.context ?? {};
    this.contextOverride = { ...base, ...ctx };
    this.invalidateAnonymous();
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
    // Context is the runtime override (set via setAnonymousContext) if present,
    // else the config-fixed context.
    const c = this.contextOverride ?? sf.context;
    if (c?.currency) url.searchParams.set("currency", c.currency);
    if (c?.siteCode) url.searchParams.set("siteCode", c.siteCode);
    if (c?.targetLocation) url.searchParams.set("targetLocation", c.targetLocation);
    if (mode === "refresh" && this.anon) {
      url.searchParams.set("refresh_token", this.anon.refreshToken);
    }
    try {
      const res = await fetch(url, { method: "GET" });
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        this.notifyRefresh("anonymous", false);
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
      this.notifyRefresh("anonymous", true);
      return this.stripExpiry(this.anon);
    } catch (err) {
      // Re-throw EmporixAuthError as-is; for non-Emporix errors (network), also notify.
      if (!(err instanceof EmporixAuthError)) {
        this.notifyRefresh("anonymous", false);
      }
      throw err;
    }
  }
}
// Customer-token refreshes happen via client.customers.refresh() and don't
// route through this TokenProvider — only the anonymous flow notifies.
// React-side useCustomerSession.refresh emits its own telemetry event in a
// follow-up if needed.
