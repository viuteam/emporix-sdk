import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import type { Site } from "./site-types";

export type { Site, SiteAddress, SiteHomeBase } from "./site-types";

const ANON: AuthContext = auth.anonymous();

/**
 * Read-only access to the tenant's site catalog. List returns active sites
 * visible to the storefront context (the `site_manage` scope is only needed
 * to read inactive sites).
 */
export class SiteService {
  static readonly channel = "site" as const;
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
