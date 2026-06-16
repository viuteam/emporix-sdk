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
