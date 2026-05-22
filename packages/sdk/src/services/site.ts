import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";

const ANON: AuthContext = auth.anonymous();

/**
 * One site as returned by the Site Settings Service. Mirrors the public
 * SiteDto schema with the fields a storefront actually consumes.
 */
export interface Site {
  code: string;
  name: string;
  active: boolean;
  default: boolean;
  includesTax?: boolean;
  defaultLanguage: string;
  languages: string[];
  currency: string;
  availableCurrencies?: string[];
  homeBase: {
    address: {
      country: string;
      zipCode: string;
      street?: string;
      city?: string;
      state?: string;
    };
    timezone?: string;
  };
  shipToCountries: string[];
  cartCalculationScale?: number;
  metadata?: { version?: number };
}

/**
 * Read-only access to the tenant's site catalog. List returns active sites
 * visible to the storefront context (the `site_manage` scope is only needed
 * to read inactive sites).
 */
export class SiteService {
  constructor(private readonly ctx: ClientContext) {}

  /** Lists active sites. */
  async list(authCtx: AuthContext = ANON): Promise<Site[]> {
    return this.ctx.http.request<Site[]>({
      method: "GET",
      path: `/site/${this.ctx.tenant}/sites`,
      auth: authCtx,
    });
  }

  /** Retrieves one site by code. */
  async get(code: string, authCtx: AuthContext = ANON): Promise<Site> {
    return this.ctx.http.request<Site>({
      method: "GET",
      path: `/site/${this.ctx.tenant}/sites/${code}`,
      auth: authCtx,
    });
  }

  /**
   * Returns the tenant's default site (the one with `default: true`).
   * Throws if no default is configured — a tenant should always have one.
   */
  async current(authCtx: AuthContext = ANON): Promise<Site> {
    const sites = await this.list(authCtx);
    const def = sites.find((s) => s.default);
    if (!def) {
      throw new Error(
        `SiteService.current: no default site for tenant "${this.ctx.tenant}"`,
      );
    }
    return def;
  }
}
