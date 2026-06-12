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
  DeliveryWindowList,
  DeliveryWindowValidation,
  DeliveryTime,
  DeliveryTimeList,
  DeliveryTimeInput,
  DeliveryTimeUpdate,
  DeliverySlot,
  DeliverySlotList,
  DeliveryCycleInput,
  ShippingPatch,
  DeliveryCreated,
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
  DeliveryWindow,
  DeliveryWindowList,
  DeliveryWindowValidation,
  DeliveryTime,
  DeliveryTimeList,
  DeliveryTimeInput,
  DeliveryTimeUpdate,
  DeliverySlot,
  DeliverySlotList,
  DeliveryCycleInput,
  ShippingPatch,
  DeliveryCreated,
} from "./shipping-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Shipping Service (`/shipping/{tenant}/…`), Phase 1 — config: sites,
 * zones, methods, cost/quote, groups, customer-group relations. Server-side;
 * defaults to the service token. Most methods are site-scoped and take `site`
 * first; `findSites` is tenant-level. Delivery scheduling is Phase 2.
 */
export class ShippingService {
  static readonly channel = "shipping" as const;
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

  // --- Phase 2: delivery windows ---

  /** Retrieve delivery windows for a delivery area + cart. */
  async getAreaDeliveryWindows(deliveryAreaId: string, cartId: string, auth: AuthContext = SERVICE): Promise<DeliveryWindowList> {
    return this.ctx.http.request<DeliveryWindowList>({
      method: "GET",
      path: `${this.base()}/areaDeliveryTimes/${encodeURIComponent(deliveryAreaId)}/${encodeURIComponent(cartId)}`,
      auth,
    });
  }

  /** Retrieve delivery windows for a cart. */
  async getCartDeliveryWindows(cartId: string, auth: AuthContext = SERVICE): Promise<DeliveryWindowList> {
    return this.ctx.http.request<DeliveryWindowList>({
      method: "GET",
      path: `${this.base()}/actualDeliveryWindows/${encodeURIComponent(cartId)}`,
      auth,
    });
  }

  /** Increment the delivery-window counter. */
  async incrementDeliveryWindowCounter(input: DeliveryWindowValidation, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/actualDeliveryWindows/incrementCounter`,
      auth,
      body: input,
    });
  }

  /** Validate a delivery window. Resolves when valid; throws otherwise. */
  async validateDeliveryWindow(input: DeliveryWindowValidation, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/deliveryWindowValidation`,
      auth,
      body: input,
    });
  }

  // --- Phase 2: delivery times ---

  /** List all delivery times. */
  async listDeliveryTimes(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<DeliveryTimeList> {
    return this.ctx.http.request<DeliveryTimeList>({
      method: "GET",
      path: `${this.base()}/delivery-times`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one delivery time. */
  async getDeliveryTime(deliveryTimeId: string, auth: AuthContext = SERVICE): Promise<DeliveryTime> {
    return this.ctx.http.request<DeliveryTime>({
      method: "GET",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}`,
      auth,
    });
  }

  /** Create a delivery time. */
  async createDeliveryTime(input: DeliveryTimeInput, auth: AuthContext = SERVICE): Promise<DeliveryCreated> {
    return this.ctx.http.request<DeliveryCreated>({
      method: "POST",
      path: `${this.base()}/delivery-times`,
      auth,
      body: input,
    });
  }

  /** Create multiple delivery times (`POST /delivery-times/bulk`). */
  async createDeliveryTimesBulk(inputs: DeliveryTimeInput[], auth: AuthContext = SERVICE): Promise<DeliveryCreated[]> {
    return this.ctx.http.request<DeliveryCreated[]>({
      method: "POST",
      path: `${this.base()}/delivery-times/bulk`,
      auth,
      body: inputs,
    });
  }

  /** Replace a delivery time. */
  async updateDeliveryTime(deliveryTimeId: string, input: DeliveryTimeUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a delivery time (JSON-Patch op array). */
  async patchDeliveryTime(deliveryTimeId: string, ops: ShippingPatch, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}`,
      auth,
      body: ops,
    });
  }

  /** Delete a delivery time. */
  async deleteDeliveryTime(deliveryTimeId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}`,
      auth,
    });
  }

  // --- Phase 2: delivery time slots ---

  /** List slots of a delivery time. */
  async listSlots(deliveryTimeId: string, auth: AuthContext = SERVICE): Promise<DeliverySlotList> {
    return this.ctx.http.request<DeliverySlotList>({
      method: "GET",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots`,
      auth,
    });
  }

  /** Retrieve one slot. */
  async getSlot(deliveryTimeId: string, slotId: string, auth: AuthContext = SERVICE): Promise<DeliverySlot> {
    return this.ctx.http.request<DeliverySlot>({
      method: "GET",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots/${encodeURIComponent(slotId)}`,
      auth,
    });
  }

  /** Create a slot in a delivery time. */
  async createSlot(deliveryTimeId: string, input: DeliverySlot, auth: AuthContext = SERVICE): Promise<DeliveryCreated> {
    return this.ctx.http.request<DeliveryCreated>({
      method: "POST",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots`,
      auth,
      body: input,
    });
  }

  /** Replace a slot. */
  async updateSlot(deliveryTimeId: string, slotId: string, input: DeliverySlot, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots/${encodeURIComponent(slotId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a slot (JSON-Patch op array). */
  async patchSlot(deliveryTimeId: string, slotId: string, ops: ShippingPatch, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots/${encodeURIComponent(slotId)}`,
      auth,
      body: ops,
    });
  }

  /** Delete a slot. */
  async deleteSlot(deliveryTimeId: string, slotId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots/${encodeURIComponent(slotId)}`,
      auth,
    });
  }

  /** Delete all slots of a delivery time. */
  async deleteAllSlots(deliveryTimeId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots`,
      auth,
    });
  }

  // --- Phase 2: delivery cycles ---

  /** Generate a delivery cycle (`POST /delivery-cycles/generate`). Returns the cycle id. */
  async generateDeliveryCycle(input: DeliveryCycleInput, auth: AuthContext = SERVICE): Promise<string> {
    return this.ctx.http.request<string>({
      method: "POST",
      path: `${this.base()}/delivery-cycles/generate`,
      auth,
      body: input,
    });
  }
}
