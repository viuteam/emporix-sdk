import { validateConfig, type EmporixConfig, type ResolvedConfig } from "./core/config";
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
import { CheckoutService } from "./services/checkout";
import { PaymentGatewayService } from "./services/payment";
import { PriceService } from "./services/price";
import { MediaService } from "./services/media";
import { SegmentService } from "./services/segment";
import { SiteService } from "./services/site";
import { SessionContextService } from "./services/session-context";
import { CompaniesService } from "./services/companies";
import { ContactsService } from "./services/contacts";
import { LocationsService } from "./services/locations";
import { CustomerGroupsService } from "./services/customer-groups";
import { OrdersService, SalesOrdersService } from "./services/orders";
import { AvailabilityService } from "./services/availability";
import { TenantConfigService } from "./services/tenant-config";
import { ClientConfigService } from "./services/client-config";
import { ShoppingListService } from "./services/shopping-list";
import { RagIndexerService } from "./services/ai-rag-indexer";
import { SequentialIdService } from "./services/sequential-id";
import { FeeService } from "./services/fee";
import { WebhookService } from "./services/webhook";
import { SDK_VERSION } from "./version";

/** The Emporix SDK entry point. One instance safely serves many concurrent shoppers. */
export class EmporixClient {
  readonly customers: CustomerService;
  readonly products: ProductService;
  readonly categories: CategoryService;
  readonly carts: CartService;
  readonly checkout: CheckoutService;
  readonly payments: PaymentGatewayService;
  readonly prices: PriceService;
  readonly media: MediaService;
  readonly segments: SegmentService;
  readonly sites: SiteService;
  readonly sessionContext: SessionContextService;
  readonly companies: CompaniesService;
  readonly contacts: ContactsService;
  readonly locations: LocationsService;
  readonly customerGroups: CustomerGroupsService;
  readonly orders: OrdersService;
  readonly salesOrders: SalesOrdersService;
  readonly availability: AvailabilityService;
  readonly tenantConfig: TenantConfigService;
  readonly clientConfig: ClientConfigService;
  readonly shoppingLists: ShoppingListService;
  readonly ragIndexer: RagIndexerService;
  readonly sequentialIds: SequentialIdService;
  readonly fees: FeeService;
  readonly webhooks: WebhookService;
  /** The validated tenant this client is bound to. */
  readonly tenant: string;
  /**
   * The token provider in use by this client. Exposed so React/Next hosts can
   * call `attachAnonymousStore` to wire session persistence. Treat as
   * read-only — replacing it after construction is not supported.
   */
  readonly tokenProvider: TokenProvider;
  /**
   * The validated config used to construct this client. Exposed so React /
   * Next hosts can read static settings such as `credentials.storefront.context`
   * (siteCode, currency, targetLocation) without re-plumbing them through the
   * Provider tree. Treat as read-only.
   */
  readonly config: ResolvedConfig;
  private readonly resolver: LevelResolver;

  constructor(config: EmporixConfig) {
    const cfg = validateConfig(config);
    this.tenant = cfg.tenant;
    this.config = cfg;

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
    this.tokenProvider = tokenProvider;

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
    this.checkout = new CheckoutService(mk("checkout"));
    this.payments = new PaymentGatewayService(mk("payment"));
    this.prices = new PriceService(mk("price"));
    this.media = new MediaService(mk("media"));
    this.segments = new SegmentService(mk("segment"), {
      products: this.products,
      categories: this.categories,
    });
    this.sites = new SiteService(mk("site"));
    this.sessionContext = new SessionContextService(mk("session-context"));
    this.companies = new CompaniesService(mk("customer-management"));
    this.contacts = new ContactsService(mk("customer-management"));
    this.locations = new LocationsService(mk("customer-management"));
    this.customerGroups = new CustomerGroupsService(mk("iam"));
    this.orders = new OrdersService(mk("orders"));
    this.salesOrders = new SalesOrdersService(mk("sales-orders"));
    this.availability = new AvailabilityService(mk("availability"));
    this.tenantConfig = new TenantConfigService(mk("configuration"));
    this.clientConfig = new ClientConfigService(mk("configuration"));
    this.shoppingLists = new ShoppingListService(mk("shopping-list"));
    this.ragIndexer = new RagIndexerService(mk("ai-rag-indexer"));
    this.sequentialIds = new SequentialIdService(mk("sequential-id"));
    this.fees = new FeeService(mk("fee"));
    this.webhooks = new WebhookService(mk("webhook"));
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
