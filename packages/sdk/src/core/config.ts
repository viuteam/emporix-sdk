import type { LoggerConfig } from "./logger";
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
  context?: { currency?: string; siteCode?: string; targetLocation?: string };
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
  };
}
