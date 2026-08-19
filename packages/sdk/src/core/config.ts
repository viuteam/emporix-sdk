import type { Logger, LoggerConfig } from "./logger";
import type { TokenProvider } from "./auth";

/** Default Emporix API host. */
export const DEFAULT_HOST = "https://api.emporix.io";

/**
 * Tenant guard. Emporix docs only state "always lowercase"; the 3–16 char
 * `^[a-z][a-z0-9]+$` rule is an SDK-side guard, not a documented constraint.
 */
const TENANT_RE = /^[a-z][a-z0-9]{2,15}$/;

/** A client-credentials credential set (service / custom). */
export interface ServiceCredentials {
  clientId: string;
  secret: string;
  scope?: string;
}

/** Storefront credential — anonymous token needs the client id only, no secret. */
export interface StorefrontCredentials {
  clientId: string;
  /**
   * Session context bound at anonymous-login time. Required for
   * `prices.matchByContext` to resolve currency/site/country server-side.
   * `targetLocation` is an ISO country code.
   */
  context?: { currency?: string; siteCode?: string; targetLocation?: string; language?: string };
}

/** User-supplied SDK configuration. */
export interface EmporixConfig {
  tenant: string;
  host?: string;
  credentials: {
    /**
     * Service (client-credentials) credentials. Optional: storefront/SPA apps
     * use only `storefront` (anonymous) + caller-supplied customer tokens and
     * must never ship a backend secret. Required only when a `service`
     * AuthContext is actually used — enforced lazily by the TokenProvider.
     */
    backend?: ServiceCredentials;
    storefront?: StorefrontCredentials;
    custom?: Record<string, ServiceCredentials>;
  };
  tokenProvider?: TokenProvider;
  timeouts?: { connectMs?: number; readMs?: number };
  retry?: { maxAttempts?: number };
  cache?: { expirationBufferSeconds?: number; maxLifetimeSeconds?: number };
  logger?: LoggerConfig;
  /**
   * Replaces the global `fetch` for API requests. Receives the same arguments.
   *
   * Deliberately NOT used for token requests (`core/auth.ts`) or SSE
   * (`HttpClient.stream`): a cached token response would be a security defect,
   * and caching an event stream is meaningless. Those keep the global `fetch`,
   * which makes them structurally uncacheable rather than uncached by
   * convention.
   */
  fetch?: typeof globalThis.fetch;
}

/** Fully-resolved configuration with defaults applied. */
export interface ResolvedConfig {
  tenant: string;
  host: string;
  credentials: EmporixConfig["credentials"];
  tokenProvider: TokenProvider | undefined;
  timeouts: { connectMs: number; readMs: number };
  retry: { maxAttempts: number };
  cache: { expirationBufferSeconds: number; maxLifetimeSeconds: number };
  logger: LoggerConfig | undefined;
  fetch: typeof globalThis.fetch | undefined;
}

/**
 * `context` belongs inside `credentials.storefront`, and at the top level it is
 * silently lost.
 *
 * `EmporixConfig` has no top-level `context`, so such an object is dropped without a
 * word — and then `matchByContext` answers `[]` with no error, because the anonymous
 * token was minted without site, currency and country. Measured on tenant `viu`
 * (2026-08-18): 0 matches when misplaced, 1 when placed correctly. The expensive part
 * is the silence: it reads exactly like «no prices configured».
 *
 * A warning rather than a throw — configs that misplace it work today (badly), and a
 * throw would stop them on upgrade. `logger: false` is honoured as an explicit
 * request for silence; the object form of `LoggerConfig` carries no `warn` method, so
 * anything that is not a `Logger` instance falls back to the console.
 */
function warnOnMisplacedContext(input: EmporixConfig): void {
  if (!("context" in input)) return;
  const logger = input.logger;
  if (logger === false) return;
  const message =
    "EmporixConfig has no top-level `context` — it is being ignored. Move it into " +
    "`credentials.storefront.context`, otherwise the anonymous token carries no " +
    "site/currency/country and price matching returns an empty list without erroring.";
  if (logger && typeof (logger as Logger).warn === "function") {
    (logger as Logger).warn(message);
    return;
  }
  // Same escape hatch as the read-only-storage warning in `session-storage.ts`: this
  // has to reach a developer who configured no logger at all, which is exactly the
  // situation the mistake happens in.
  // eslint-disable-next-line no-console
  console.warn(`[emporix] ${message}`);
}

/** Validates user config and applies defaults. Throws on invalid tenant/credentials. */
export function validateConfig(input: EmporixConfig): ResolvedConfig {
  if (!TENANT_RE.test(input.tenant)) {
    throw new Error(
      `Invalid tenant "${input.tenant}": must be lowercase, 3–16 chars, match ^[a-z][a-z0-9]+$`,
    );
  }
  if (!input.credentials) {
    throw new Error("credentials is required (provide at least one of backend/storefront/custom)");
  }
  warnOnMisplacedContext(input);
  return {
    tenant: input.tenant,
    host: input.host ?? DEFAULT_HOST,
    credentials: input.credentials,
    tokenProvider: input.tokenProvider,
    timeouts: {
      connectMs: input.timeouts?.connectMs ?? 10_000,
      readMs: input.timeouts?.readMs ?? 60_000,
    },
    retry: { maxAttempts: input.retry?.maxAttempts ?? 3 },
    cache: {
      expirationBufferSeconds: input.cache?.expirationBufferSeconds ?? 60,
      maxLifetimeSeconds: input.cache?.maxLifetimeSeconds ?? 3600,
    },
    logger: input.logger,
    fetch: input.fetch,
  };
}
