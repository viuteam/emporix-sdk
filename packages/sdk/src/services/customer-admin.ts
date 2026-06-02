import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  AdminCustomer,
  AdminCustomerList,
  AdminCustomerInput,
  AdminCustomerUpdate,
  AdminCustomerPatch,
  AdminCustomerCreated,
  AdminCustomerSearchQuery,
  AdminCustomerAddress,
  AdminCustomerAddressList,
  AdminCustomerAddressInput,
  AdminCustomerAddressUpdate,
} from "./customer-admin-types";

export type {
  AdminCustomer,
  AdminCustomerList,
  AdminCustomerInput,
  AdminCustomerUpdate,
  AdminCustomerPatch,
  AdminCustomerCreated,
  AdminCustomerSearchQuery,
  AdminCustomerAddress,
  AdminCustomerAddressList,
  AdminCustomerAddressInput,
  AdminCustomerAddressUpdate,
} from "./customer-admin-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Customer Service — tenant/seller-managed customer profiles and
 * addresses (`/customer/{tenant}/customers`). Server-side; defaults to the
 * service token. Distinct from the storefront `client.customers`.
 */
export class CustomerAdminService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/customer/${this.ctx.tenant}/customers`;
  }

  private customerPath(customerNumber: string): string {
    return `${this.base()}/${encodeURIComponent(customerNumber)}`;
  }

  private addressPath(customerNumber: string, addressId: string): string {
    return `${this.customerPath(customerNumber)}/addresses/${encodeURIComponent(addressId)}`;
  }

  // --- Customers ---

  /** List customers. */
  async listCustomers(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<AdminCustomerList> {
    return this.ctx.http.request<AdminCustomerList>({
      method: "GET",
      path: this.base(),
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Search customers (`POST /customers/search`). */
  async searchCustomers(query: AdminCustomerSearchQuery, auth: AuthContext = SERVICE): Promise<AdminCustomerList> {
    return this.ctx.http.request<AdminCustomerList>({ method: "POST", path: `${this.base()}/search`, auth, body: query });
  }

  /** Retrieve a customer profile by number. */
  async getCustomer(customerNumber: string, auth: AuthContext = SERVICE): Promise<AdminCustomer> {
    return this.ctx.http.request<AdminCustomer>({ method: "GET", path: this.customerPath(customerNumber), auth });
  }

  /** Create a customer. */
  async createCustomer(input: AdminCustomerInput, auth: AuthContext = SERVICE): Promise<AdminCustomerCreated> {
    return this.ctx.http.request<AdminCustomerCreated>({ method: "POST", path: this.base(), auth, body: input });
  }

  /** Upsert a customer profile by number (`PUT`). */
  async upsertCustomer(customerNumber: string, input: AdminCustomerUpdate, auth: AuthContext = SERVICE): Promise<AdminCustomerCreated> {
    return this.ctx.http.request<AdminCustomerCreated>({ method: "PUT", path: this.customerPath(customerNumber), auth, body: input });
  }

  /** Partially update a customer profile (`PATCH`). */
  async patchCustomer(customerNumber: string, patch: AdminCustomerPatch, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "PATCH", path: this.customerPath(customerNumber), auth, body: patch });
  }

  /** Delete a customer profile. */
  async deleteCustomer(customerNumber: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "DELETE", path: this.customerPath(customerNumber), auth });
  }

  // --- Addresses ---

  /** List a customer's addresses. */
  async listAddresses(customerNumber: string, auth: AuthContext = SERVICE): Promise<AdminCustomerAddressList> {
    return this.ctx.http.request<AdminCustomerAddressList>({
      method: "GET",
      path: `${this.customerPath(customerNumber)}/addresses`,
      auth,
    });
  }

  /** Retrieve one address. */
  async getAddress(customerNumber: string, addressId: string, auth: AuthContext = SERVICE): Promise<AdminCustomerAddress> {
    return this.ctx.http.request<AdminCustomerAddress>({ method: "GET", path: this.addressPath(customerNumber, addressId), auth });
  }

  /** Add an address. */
  async addAddress(customerNumber: string, input: AdminCustomerAddressInput, auth: AuthContext = SERVICE): Promise<AdminCustomerCreated> {
    return this.ctx.http.request<AdminCustomerCreated>({
      method: "POST",
      path: `${this.customerPath(customerNumber)}/addresses`,
      auth,
      body: input,
    });
  }

  /** Upsert an address by id (`PUT`). */
  async upsertAddress(customerNumber: string, addressId: string, input: AdminCustomerAddressUpdate, auth: AuthContext = SERVICE): Promise<AdminCustomerCreated> {
    return this.ctx.http.request<AdminCustomerCreated>({ method: "PUT", path: this.addressPath(customerNumber, addressId), auth, body: input });
  }

  /** Partially update an address by id (`PATCH`). */
  async patchAddress(customerNumber: string, addressId: string, patch: AdminCustomerAddressUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "PATCH", path: this.addressPath(customerNumber, addressId), auth, body: patch });
  }

  /** Delete an address by id. */
  async deleteAddress(customerNumber: string, addressId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "DELETE", path: this.addressPath(customerNumber, addressId), auth });
  }

  /** Add tags to an address (`?tags=` query). */
  async addAddressTags(customerNumber: string, addressId: string, tags: string[], auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.addressPath(customerNumber, addressId)}/tags`,
      auth,
      query: { tags: tags.join(",") },
    });
  }

  /** Remove tags from an address (`?tags=` query). */
  async removeAddressTags(customerNumber: string, addressId: string, tags: string[], auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.addressPath(customerNumber, addressId)}/tags`,
      auth,
      query: { tags: tags.join(",") },
    });
  }
}
