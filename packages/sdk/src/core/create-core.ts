import { validateConfig, type EmporixConfig, type ResolvedConfig } from "./config";
import {
  DefaultTokenProvider,
  CustomerRefreshRegistry,
  type TokenProvider,
  type CustomerTokenRefresher,
} from "./auth";
import { HttpClient } from "./http";
import {
  LevelResolver,
  createConsoleLogger,
  createNoopLogger,
  type Logger,
  type LogLevel,
  type ServiceName,
  type LoggerObjectConfig,
} from "./logger";
import type { ClientContext } from "./context";
import { SDK_VERSION } from "../version";

/** The service-agnostic core shared by `EmporixClient` and `createEmporixClient`. */
export interface EmporixCore {
  readonly tenant: string;
  readonly config: ResolvedConfig;
  readonly tokenProvider: TokenProvider;
  setStorefrontContext(ctx: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  }): void;
  setLogLevel(level: LogLevel, opts?: { service?: ServiceName; force?: boolean }): void;
  getLogLevel(service: ServiceName): LogLevel;
  setCustomerTokenRefresher(refresher: CustomerTokenRefresher | null): void;
  /** Internal: builds a per-service ClientContext (logger child + HttpClient). */
  mk(service: ServiceName): ClientContext;
}

/** Validates config and assembles the shared infrastructure (no services). */
export function createCore(config: EmporixConfig): EmporixCore {
  const cfg = validateConfig(config);

  let loggerObj: LoggerObjectConfig = {};
  let baseLogger: Logger | undefined;
  if (cfg.logger === false) {
    baseLogger = createNoopLogger();
  } else if (cfg.logger && typeof (cfg.logger as Logger).child === "function") {
    baseLogger = cfg.logger as Logger;
  } else if (cfg.logger) {
    loggerObj = cfg.logger as LoggerObjectConfig;
  }
  const resolver = new LevelResolver(loggerObj);
  const root =
    baseLogger ??
    createConsoleLogger(resolver, {
      sdk: "emporix",
      sdkVersion: SDK_VERSION,
      tenant: cfg.tenant,
    });

  const tokenProvider: TokenProvider = cfg.tokenProvider ?? new DefaultTokenProvider(cfg);
  const customerRefresh = new CustomerRefreshRegistry();
  const requestContext: { language?: string | undefined } = {
    language: cfg.credentials.storefront?.context?.language,
  };

  const mk = (service: ServiceName): ClientContext => ({
    tenant: cfg.tenant,
    tokenProvider,
    logger: root.child({ service }),
    http: new HttpClient({
      host: cfg.host,
      provider: tokenProvider,
      logger: root.child({ service: "http" }),
      retry: cfg.retry,
      timeouts: cfg.timeouts,
      customerRefresh,
      requestContext,
    }),
  });

  return {
    tenant: cfg.tenant,
    config: cfg,
    tokenProvider,
    mk,
    setStorefrontContext(ctx) {
      if (ctx.language !== undefined) {
        requestContext.language = ctx.language || undefined;
      }
      const { language: _language, ...priceContext } = ctx;
      if (Object.keys(priceContext).length > 0) {
        tokenProvider.setAnonymousContext?.(priceContext);
      }
    },
    setLogLevel(level, opts = {}) {
      resolver.set(level, opts.service, opts.force ?? false);
    },
    getLogLevel(service) {
      return resolver.get(service);
    },
    setCustomerTokenRefresher(refresher) {
      customerRefresh.set(refresher);
    },
  };
}
