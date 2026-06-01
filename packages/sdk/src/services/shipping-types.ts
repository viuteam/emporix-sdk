/**
 * Public types for the Shipping Service (Phase 1 — config). Stable names aliased
 * over the generated `shipping` types. Zone/Method/Group/CgRelation use the same
 * schema for read and write bodies; creates return `ResourceCreated`.
 */
import type {
  Site as GenSite,
  Sites,
  FindSiteRequest,
  Zone as GenZone,
  Zones,
  Method as GenMethod,
  Methods,
  Group as GenGroup,
  GroupList,
  CgRelation as GenCgRelation,
  CgRelationList as GenCgRelationList,
  QuotePayload,
  QuoteResponse,
  QuoteSlot,
  MinimumFee as GenMinimumFee,
  ResourceCreatedResponse,
} from "../generated/shipping";

/** A shipping-related site. */
export type Site = GenSite;
/** `findSites` response (array of sites). */
export type SiteList = Sites;
/** `findSites` request body. */
export type FindSiteInput = FindSiteRequest;

/** A shipping zone (read + write body). */
export type Zone = GenZone;
/** List of shipping zones. */
export type ZoneList = Zones;

/** A shipping method (read + write body). */
export type ShippingMethod = GenMethod;
/** List of shipping methods. */
export type ShippingMethodList = Methods;

/** A shipping group (read + write body). */
export type ShippingGroup = GenGroup;
/** List of shipping groups. */
export type ShippingGroupList = GroupList;

/** A customer-group relation (read + write body). */
export type CgRelation = GenCgRelation;
/** List of customer-group relations. */
export type CgRelationList = GenCgRelationList;

/** Body for `quote` / `quoteMinimum`. */
export type QuoteInput = QuotePayload;
/** `quote` result. */
export type QuoteResult = QuoteResponse;
/** Body for `quoteSlot`. */
export type QuoteSlotInput = QuoteSlot;
/** `quoteMinimum` / `quoteSlot` result. */
export type MinimumFee = GenMinimumFee;

/** Shared create response (resource location). */
export type ResourceCreated = ResourceCreatedResponse;
