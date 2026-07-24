import type { SiteDto, AddressDto, HomeBaseDto } from "../generated/site-settings-service";

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
