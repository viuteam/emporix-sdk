import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Site,
  SiteList,
  FindSiteInput,
  Zone,
  ZoneList,
  ShippingMethod,
  ShippingMethodList,
  ShippingGroup,
  ShippingGroupList,
  CgRelation,
  CgRelationList,
  QuoteInput,
  QuoteResult,
  QuoteSlotInput,
  MinimumFee,
  ResourceCreated,
} from "./shipping-types";

export type {
  Site,
  SiteList,
  FindSiteInput,
  Zone,
  ZoneList,
  ShippingMethod,
  ShippingMethodList,
  ShippingGroup,
  ShippingGroupList,
  CgRelation,
  CgRelationList,
  QuoteInput,
  QuoteResult,
  QuoteSlotInput,
  MinimumFee,
  ResourceCreated,
} from "./shipping-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Shipping Service (`/shipping/{tenant}/…`), Phase 1 — config: sites,
 * zones, methods, cost/quote, groups, customer-group relations. Server-side;
 * defaults to the service token. Most methods are site-scoped and take `site`
 * first; `findSites` is tenant-level. Delivery scheduling is Phase 2.
 */
export class ShippingService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/shipping/${this.ctx.tenant}`;
  }

  private siteBase(site: string): string {
    return `${this.base()}/${encodeURIComponent(site)}`;
  }

  // --- Sites ---

  /** Find shipping-related sites by postal code (`POST /findSite`). */
  async findSites(input: FindSiteInput, auth: AuthContext = SERVICE): Promise<SiteList> {
    return this.ctx.http.request<SiteList>({
      method: "POST",
      path: `${this.base()}/findSite`,
      auth,
      body: input,
    });
  }

  // --- Zones ---

  /** List shipping zones for a site. */
  async listZones(
    site: string,
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<ZoneList> {
    return this.ctx.http.request<ZoneList>({
      method: "GET",
      path: `${this.siteBase(site)}/zones`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one shipping zone. */
  async getZone(site: string, zoneId: string, auth: AuthContext = SERVICE): Promise<Zone> {
    return this.ctx.http.request<Zone>({
      method: "GET",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}`,
      auth,
    });
  }

  /** Create a shipping zone. */
  async createZone(site: string, zone: Zone, auth: AuthContext = SERVICE): Promise<ResourceCreated> {
    return this.ctx.http.request<ResourceCreated>({
      method: "POST",
      path: `${this.siteBase(site)}/zones`,
      auth,
      body: zone,
    });
  }

  /** Replace a shipping zone. */
  async updateZone(site: string, zoneId: string, zone: Zone, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}`,
      auth,
      body: zone,
    });
  }

  /** Partially update a shipping zone. */
  async patchZone(site: string, zoneId: string, patch: Zone, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a shipping zone. */
  async deleteZone(site: string, zoneId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}`,
      auth,
    });
  }

  // --- Methods (per zone) ---

  /** List shipping methods of a zone. */
  async listMethods(
    site: string,
    zoneId: string,
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<ShippingMethodList> {
    return this.ctx.http.request<ShippingMethodList>({
      method: "GET",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one shipping method. */
  async getMethod(site: string, zoneId: string, methodId: string, auth: AuthContext = SERVICE): Promise<ShippingMethod> {
    return this.ctx.http.request<ShippingMethod>({
      method: "GET",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods/${encodeURIComponent(methodId)}`,
      auth,
    });
  }

  /** Create a shipping method in a zone. */
  async createMethod(site: string, zoneId: string, method: ShippingMethod, auth: AuthContext = SERVICE): Promise<ResourceCreated> {
    return this.ctx.http.request<ResourceCreated>({
      method: "POST",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods`,
      auth,
      body: method,
    });
  }

  /** Replace a shipping method. */
  async updateMethod(site: string, zoneId: string, methodId: string, method: ShippingMethod, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods/${encodeURIComponent(methodId)}`,
      auth,
      body: method,
    });
  }

  /** Partially update a shipping method. */
  async patchMethod(site: string, zoneId: string, methodId: string, patch: ShippingMethod, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods/${encodeURIComponent(methodId)}`,
      auth,
      body: patch,
    });
  }

  /** Delete a shipping method. */
  async deleteMethod(site: string, zoneId: string, methodId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.siteBase(site)}/zones/${encodeURIComponent(zoneId)}/methods/${encodeURIComponent(methodId)}`,
      auth,
    });
  }

  // --- Cost / quote ---

  /** Calculate the final shipping cost (`POST /quote`). */
  async quote(site: string, input: QuoteInput, auth: AuthContext = SERVICE): Promise<QuoteResult> {
    return this.ctx.http.request<QuoteResult>({
      method: "POST",
      path: `${this.siteBase(site)}/quote`,
      auth,
      body: input,
    });
  }

  /** Calculate the minimum shipping cost (`POST /quote/minimum`). */
  async quoteMinimum(site: string, input: QuoteInput, auth: AuthContext = SERVICE): Promise<MinimumFee> {
    return this.ctx.http.request<MinimumFee>({
      method: "POST",
      path: `${this.siteBase(site)}/quote/minimum`,
      auth,
      body: input,
    });
  }

  /** Calculate the shipping cost for a given slot (`POST /quote/slot`). */
  async quoteSlot(site: string, input: QuoteSlotInput, auth: AuthContext = SERVICE): Promise<MinimumFee> {
    return this.ctx.http.request<MinimumFee>({
      method: "POST",
      path: `${this.siteBase(site)}/quote/slot`,
      auth,
      body: input,
    });
  }

  // --- Groups ---

  /** List shipping groups for a site. */
  async listGroups(
    site: string,
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<ShippingGroupList> {
    return this.ctx.http.request<ShippingGroupList>({
      method: "GET",
      path: `${this.siteBase(site)}/groups`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one shipping group. */
  async getGroup(site: string, groupId: string, auth: AuthContext = SERVICE): Promise<ShippingGroup> {
    return this.ctx.http.request<ShippingGroup>({
      method: "GET",
      path: `${this.siteBase(site)}/groups/${encodeURIComponent(groupId)}`,
      auth,
    });
  }

  /** Create a shipping group. */
  async createGroup(site: string, group: ShippingGroup, auth: AuthContext = SERVICE): Promise<ResourceCreated> {
    return this.ctx.http.request<ResourceCreated>({
      method: "POST",
      path: `${this.siteBase(site)}/groups`,
      auth,
      body: group,
    });
  }

  /** Replace a shipping group. */
  async updateGroup(site: string, groupId: string, group: ShippingGroup, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.siteBase(site)}/groups/${encodeURIComponent(groupId)}`,
      auth,
      body: group,
    });
  }

  /** Delete a shipping group. */
  async deleteGroup(site: string, groupId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.siteBase(site)}/groups/${encodeURIComponent(groupId)}`,
      auth,
    });
  }

  // --- Customer-group relations ---

  /** List customer-group relations for a site. */
  async listCgRelations(
    site: string,
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<CgRelationList> {
    return this.ctx.http.request<CgRelationList>({
      method: "GET",
      path: `${this.siteBase(site)}/cgrelations`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a customer's customer-group relations. */
  async getCgRelations(site: string, customerId: string, auth: AuthContext = SERVICE): Promise<CgRelation> {
    return this.ctx.http.request<CgRelation>({
      method: "GET",
      path: `${this.siteBase(site)}/cgrelations/${encodeURIComponent(customerId)}`,
      auth,
    });
  }

  /** Create a customer-group relation. */
  async createCgRelation(site: string, relation: CgRelation, auth: AuthContext = SERVICE): Promise<ResourceCreated> {
    return this.ctx.http.request<ResourceCreated>({
      method: "POST",
      path: `${this.siteBase(site)}/cgrelations`,
      auth,
      body: relation,
    });
  }

  /** Update a customer's customer-group relations. */
  async updateCgRelations(site: string, customerId: string, relation: CgRelation, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.siteBase(site)}/cgrelations/${encodeURIComponent(customerId)}`,
      auth,
      body: relation,
    });
  }

  /** Delete a customer's customer-group relation. */
  async deleteCgRelation(site: string, customerId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.siteBase(site)}/cgrelations/${encodeURIComponent(customerId)}`,
      auth,
    });
  }
}
