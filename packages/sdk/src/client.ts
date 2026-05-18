import { validateConfig, type EmporixConfig } from "./core/config";
import { DefaultTokenProvider, type TokenProvider } from "./core/auth";
import { HttpClient } from "./core/http";
import {
  LevelResolver,
  createConsoleLogger,
  createNoopLogger,
  type Logger,
  type LogLevel,
  type ServiceName,
  type LoggerObjectConfig,
} from "./core/logger";
import type { ClientContext } from "./core/context";
import { CustomerService } from "./services/customer";
import { ProductService } from "./services/product";
import { CategoryService } from "./services/category";
import { CartService } from "./services/cart";

const SDK_VERSION = "0.0.0";

/** The Emporix SDK entry point. One instance safely serves many concurrent shoppers. */
export class EmporixClient {
  readonly customers: CustomerService;
  readonly products: ProductService;
  readonly categories: CategoryService;
  readonly carts: CartService;
  private readonly resolver: LevelResolver;

  constructor(config: EmporixConfig) {
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
    this.resolver = new LevelResolver(loggerObj);
    const root =
      baseLogger ??
      createConsoleLogger(this.resolver, {
        sdk: "emporix",
        sdkVersion: SDK_VERSION,
        tenant: cfg.tenant,
      });

    const tokenProvider: TokenProvider = cfg.tokenProvider ?? new DefaultTokenProvider(cfg);

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
      }),
    });

    this.customers = new CustomerService(mk("customer"));
    this.products = new ProductService(mk("product"));
    this.categories = new CategoryService(mk("category"));
    this.carts = new CartService(mk("cart"));
  }

  /** Sets the runtime log level globally or for one service. */
  setLogLevel(level: LogLevel, opts: { service?: ServiceName; force?: boolean } = {}): void {
    this.resolver.set(level, opts.service, opts.force ?? false);
  }

  /** Returns the effective log level for a service. */
  getLogLevel(service: ServiceName): LogLevel {
    return this.resolver.get(service);
  }
}
