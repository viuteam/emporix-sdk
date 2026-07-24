import type { EmporixConfig, ResolvedConfig } from "./core/config";
import type { TokenProvider, CustomerTokenRefresher } from "./core/auth";
import type { LogLevel, ServiceName } from "./core/logger";
import { createCore, type EmporixCore } from "./core/create-core";
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
import { CloudFunctionsService } from "./services/cloud-functions";
import { WebhookService } from "./services/webhook";
import { SchemaService } from "./services/schema";
import { AiService } from "./services/ai";
import { TaxService } from "./services/tax";
import { CouponService } from "./services/coupon";
import { RewardPointsService } from "./services/reward-points";
import { BrandService } from "./services/brand";
import { LabelService } from "./services/label";
import { CountryService } from "./services/country";
import { CurrencyService } from "./services/currency";
import { ShippingService } from "./services/shipping";
import { InvoiceService } from "./services/invoice";
import { ReturnsService } from "./services/returns";
import { SepaExportService } from "./services/sepa-export";
import { IndexingService } from "./services/indexing";
import { UnitHandlingService } from "./services/unit-handling";
import { CatalogService } from "./services/catalog";
import { VendorService } from "./services/vendor";
import { PickPackService } from "./services/pick-pack";
import { CustomerAdminService } from "./services/customer-admin";
import { ApprovalService } from "./services/approval";

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
  readonly cloudFunctions: CloudFunctionsService;
  readonly webhooks: WebhookService;
  readonly schemas: SchemaService;
  readonly ai: AiService;
  readonly taxes: TaxService;
  readonly coupons: CouponService;
  readonly rewardPoints: RewardPointsService;
  readonly brands: BrandService;
  readonly labels: LabelService;
  readonly countries: CountryService;
  readonly currencies: CurrencyService;
  readonly shipping: ShippingService;
  readonly invoices: InvoiceService;
  readonly returns: ReturnsService;
  readonly sepaExport: SepaExportService;
  readonly indexing: IndexingService;
  readonly units: UnitHandlingService;
  readonly catalogs: CatalogService;
  readonly vendors: VendorService;
  readonly pickPack: PickPackService;
  readonly customerAdmin: CustomerAdminService;
  readonly approvals: ApprovalService;
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
  private readonly core: EmporixCore;

  constructor(config: EmporixConfig) {
    const core = createCore(config);
    this.core = core;
    this.tenant = core.tenant;
    this.config = core.config;
    this.tokenProvider = core.tokenProvider;

    const mk = core.mk;
    this.customers = new CustomerService(mk(CustomerService.channel));
    this.products = new ProductService(mk(ProductService.channel));
    this.categories = new CategoryService(mk(CategoryService.channel));
    this.carts = new CartService(mk(CartService.channel));
    this.checkout = new CheckoutService(mk(CheckoutService.channel));
    this.payments = new PaymentGatewayService(mk(PaymentGatewayService.channel));
    this.prices = new PriceService(mk(PriceService.channel));
    this.media = new MediaService(mk(MediaService.channel));
    this.segments = new SegmentService(mk(SegmentService.channel), {
      products: this.products,
      categories: this.categories,
    });
    this.sites = new SiteService(mk(SiteService.channel));
    this.sessionContext = new SessionContextService(mk(SessionContextService.channel));
    this.companies = new CompaniesService(mk(CompaniesService.channel));
    this.contacts = new ContactsService(mk(ContactsService.channel));
    this.locations = new LocationsService(mk(LocationsService.channel));
    this.customerGroups = new CustomerGroupsService(mk(CustomerGroupsService.channel));
    this.orders = new OrdersService(mk(OrdersService.channel));
    this.salesOrders = new SalesOrdersService(mk(SalesOrdersService.channel));
    this.availability = new AvailabilityService(mk(AvailabilityService.channel));
    this.tenantConfig = new TenantConfigService(mk(TenantConfigService.channel));
    this.clientConfig = new ClientConfigService(mk(ClientConfigService.channel));
    this.shoppingLists = new ShoppingListService(mk(ShoppingListService.channel));
    this.ragIndexer = new RagIndexerService(mk(RagIndexerService.channel));
    this.sequentialIds = new SequentialIdService(mk(SequentialIdService.channel));
    this.fees = new FeeService(mk(FeeService.channel));
    this.cloudFunctions = new CloudFunctionsService(mk(CloudFunctionsService.channel));
    this.webhooks = new WebhookService(mk(WebhookService.channel));
    this.schemas = new SchemaService(mk(SchemaService.channel));
    this.ai = new AiService(mk(AiService.channel));
    this.taxes = new TaxService(mk(TaxService.channel));
    this.coupons = new CouponService(mk(CouponService.channel));
    this.rewardPoints = new RewardPointsService(mk(RewardPointsService.channel));
    this.brands = new BrandService(mk(BrandService.channel));
    this.labels = new LabelService(mk(LabelService.channel));
    this.countries = new CountryService(mk(CountryService.channel));
    this.currencies = new CurrencyService(mk(CurrencyService.channel));
    this.shipping = new ShippingService(mk(ShippingService.channel));
    this.invoices = new InvoiceService(mk(InvoiceService.channel));
    this.returns = new ReturnsService(mk(ReturnsService.channel));
    this.sepaExport = new SepaExportService(mk(SepaExportService.channel));
    this.indexing = new IndexingService(mk(IndexingService.channel));
    this.units = new UnitHandlingService(mk(UnitHandlingService.channel));
    this.catalogs = new CatalogService(mk(CatalogService.channel));
    this.vendors = new VendorService(mk(VendorService.channel));
    this.pickPack = new PickPackService(mk(PickPackService.channel));
    this.customerAdmin = new CustomerAdminService(mk(CustomerAdminService.channel));
    this.approvals = new ApprovalService(mk(ApprovalService.channel));
  }

  /**
   * Re-binds the storefront price context (currency / siteCode / targetLocation)
   * for anonymous pricing and invalidates the current anonymous session, so the
   * next request re-mints a token bound to the new context. Use this to switch
   * currency at runtime. Carts are currency-bound — clear the cart after a
   * currency change (the React `setCurrency` does this for you).
   *
   * Also sets the storefront `language` (an `Accept-Language` header on every
   * read); a language-only change does NOT re-mint the token.
   */
  setStorefrontContext(ctx: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  }): void {
    this.core.setStorefrontContext(ctx);
  }

  /** Sets the runtime log level globally or for one service. */
  setLogLevel(level: LogLevel, opts: { service?: ServiceName; force?: boolean } = {}): void {
    this.core.setLogLevel(level, opts);
  }

  /** Returns the effective log level for a service. */
  getLogLevel(service: ServiceName): LogLevel {
    return this.core.getLogLevel(service);
  }

  /**
   * Registers (or clears with `null`) a customer-token refresher. When set, a
   * `customer`-kind 401 triggers one refresh-and-retry. Off by default — the
   * customer token stays caller-owned. The React `EmporixProvider` wires this
   * automatically via `autoRefreshCustomerToken`.
   */
  setCustomerTokenRefresher(refresher: CustomerTokenRefresher | null): void {
    this.core.setCustomerTokenRefresher(refresher);
  }
}
