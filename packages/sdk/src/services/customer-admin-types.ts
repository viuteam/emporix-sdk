/**
 * Public types for the tenant-managed Customer Service (admin/seller view).
 * Names are prefixed `AdminCustomer*` to avoid barrel collisions with the
 * storefront `client.customers` types (`Customer` / `Address`).
 */
import type {
  CustomerForSellerDto,
  CustomerSignupBySellerDto,
  CustomerUpdateBySellerDto,
  CustomerPatchBySellerDto,
  ResourceLocation,
  Address as GenAddress,
  Address2,
  AddressUpdateDto,
  PasswordMigrationRetentionConfigRequest,
  PasswordMigrationRetentionConfigResponse,
  CustomerImportDto,
  CustomerImportAccountDto,
  LegacyAuth,
  CustomerBulkItemResponse,
} from "../generated/customer-service";
import type { QueryFor } from "../core/query";

/** A customer profile (seller/admin read shape). */
export type AdminCustomer = CustomerForSellerDto;
/** List of customers. */
export type AdminCustomerList = AdminCustomer[];
/** Create body (`POST /customers`). */
export type AdminCustomerInput = CustomerSignupBySellerDto;
/** Upsert body (`PUT /customers/{num}`). */
export type AdminCustomerUpdate = CustomerUpdateBySellerDto;
/** Partial-update body (`PATCH /customers/{num}`). */
export type AdminCustomerPatch = CustomerPatchBySellerDto;
/** Create/upsert response — a resource location. */
export type AdminCustomerCreated = ResourceLocation;
/** Search body (`POST /customers/search`). `q` accepts a raw DSL string or a built filter. */
export type AdminCustomerSearchQuery = Record<string, unknown> & {
  q?: QueryFor<"CUSTOMER">;
};

/** A customer address (read). */
export type AdminCustomerAddress = GenAddress;
/** List of customer addresses. */
export type AdminCustomerAddressList = AdminCustomerAddress[];
/** Add-address body (`POST …/addresses`). */
export type AdminCustomerAddressInput = Address2;
/** Upsert/patch address body (`PUT`/`PATCH …/addresses/{id}`). */
export type AdminCustomerAddressUpdate = AddressUpdateDto;

/**
 * The tenant's password-migration retention window (read shape). Every field is
 * optional upstream — an unconfigured tenant answers with an empty object.
 */
export type AdminPasswordMigrationRetention = PasswordMigrationRetentionConfigResponse;
/**
 * Body for `configurePasswordMigrationRetention`. `retentionEndDate` is required.
 * `emailReminderDate` defaults to 7 days before it (or tomorrow, when that would
 * already be past); `emailNotificationsEnabled` defaults to `true`.
 */
export type AdminPasswordMigrationRetentionInput = PasswordMigrationRetentionConfigRequest;

/**
 * One customer of the bulk-import body. Extends the create shape with an `account`
 * block; every inherited profile field is optional, so `account.email` is the only
 * hard requirement.
 */
export type AdminCustomerImport = CustomerImportDto;
/**
 * The `account` block of an import item. Provide **exactly one** of `passwordHash`
 * or `legacyAuth` — the type permits both, the service does not.
 */
export type AdminCustomerImportAccount = CustomerImportAccountDto;
/** A legacy password hash carried by an import item. */
export type AdminCustomerLegacyAuth = LegacyAuth;
/**
 * One entry of the `207` import result. `code` is the per-item HTTP status, so a
 * `409` here is a rejected customer inside an otherwise successful call.
 */
export type AdminCustomerImportResult = CustomerBulkItemResponse;
