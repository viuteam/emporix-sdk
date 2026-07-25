import type {
  SiteDto,
  AddressDto,
  HomeBaseDto,
  ResourceLocation,
  Mixin,
  Mixins,
} from "../generated/site-settings-service";

/** A site's home-base address (generated `AddressDto`). */
export type SiteAddress = AddressDto;
/** A site's home base — address + optional geo/timezone (generated `HomeBaseDto`). */
export type SiteHomeBase = HomeBaseDto;

/**
 * A site as returned by the Site Settings Service. Mirrors the generated
 * `SiteDto`, but re-tightens `active`/`default` to required — the storefront
 * relies on both being present (see {@link SiteService.current}).
 */
export type Site = Omit<SiteDto, "active" | "default"> & {
  active: boolean;
  default: boolean;
};

/**
 * Body for creating or updating a site. This is the raw generated `SiteDto`
 * (with `active`/`default` optional) — unlike the read-side {@link Site},
 * which re-tightens both to required.
 */
export type SiteInput = SiteDto;

/** Id/location envelope returned when a site is created. */
export type SiteCreated = ResourceLocation;

/**
 * A single site mixin group's content. The spec defines no structure — it is an
 * open map of keys to values.
 */
export type SiteMixin = Mixin;

/** All mixin groups of a site, as a map of group name to content. */
export type SiteMixins = Mixins;

/** Id/location envelope returned when a site mixin is created. */
export type SiteMixinCreated = ResourceLocation;
