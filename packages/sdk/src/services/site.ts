import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import type {
  Site,
  SiteInput,
  SiteCreated,
  SiteMixin,
  SiteMixins,
  SiteMixinCreated,
} from "./site-types";

export type {
  Site,
  SiteAddress,
  SiteHomeBase,
  SiteInput,
  SiteCreated,
  SiteMixin,
  SiteMixins,
  SiteMixinCreated,
} from "./site-types";

const ANON: AuthContext = auth.anonymous();
const SERVICE: AuthContext = auth.service();

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

  /** Lists just the tenant's site codes (`GET /siteslist`). Default auth: anonymous. */
  async listCodes(authCtx: AuthContext = ANON): Promise<string[]> {
    return this.ctx.http.request<string[]>({
      method: "GET",
      path: `/site/${this.ctx.tenant}/siteslist`,
      auth: authCtx,
    });
  }

  // --- Admin writes. Default auth: service. ---

  /** Creates a site (`POST /sites`). Default auth: service. */
  async create(input: SiteInput, authCtx: AuthContext = SERVICE): Promise<SiteCreated> {
    return this.ctx.http.request<SiteCreated>({
      method: "POST",
      path: `/site/${this.ctx.tenant}/sites`,
      body: input,
      auth: authCtx,
    });
  }

  /**
   * Partially updates a site (`PATCH /sites/{siteCode}`). The endpoint responds
   * 200 without a defined body, so nothing is returned — re-read with
   * {@link get} when the updated site is needed. Default auth: service.
   */
  async update(siteCode: string, input: SiteInput, authCtx: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `/site/${this.ctx.tenant}/sites/${siteCode}`,
      body: input,
      auth: authCtx,
    });
  }

  /**
   * Full-replaces a site (`PUT /sites/{siteCode}`). Like {@link update} it
   * returns nothing (200 with no defined body). `options.expand` is forwarded as
   * a query parameter. Default auth: service.
   */
  async replace(
    siteCode: string,
    input: SiteInput,
    options: { expand?: string } = {},
    authCtx: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `/site/${this.ctx.tenant}/sites/${siteCode}`,
      ...(options.expand === undefined ? {} : { query: { expand: options.expand } }),
      body: input,
      auth: authCtx,
    });
  }

  /** Deletes a site (`DELETE /sites/{siteCode}`). Default auth: service. */
  async delete(siteCode: string, authCtx: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/site/${this.ctx.tenant}/sites/${siteCode}`,
      auth: authCtx,
    });
  }

  /**
   * Site mixins (`/sites/{siteCode}/mixins`). Mixin content is an open map —
   * the spec defines no structure. Reads default to anonymous, writes to
   * service auth.
   */
  readonly mixins = {
    /** All mixin groups of a site, as a map of group name to content. */
    list: async (siteCode: string, authCtx: AuthContext = ANON): Promise<SiteMixins> =>
      this.ctx.http.request<SiteMixins>({
        method: "GET",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins`,
        auth: authCtx,
      }),

    /** One mixin group's content by name. */
    get: async (siteCode: string, mixinName: string, authCtx: AuthContext = ANON): Promise<SiteMixin> =>
      this.ctx.http.request<SiteMixin>({
        method: "GET",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins/${mixinName}`,
        auth: authCtx,
      }),

    /** Adds a mixin to a site. Default auth: service. */
    create: async (
      siteCode: string,
      input: SiteMixin,
      authCtx: AuthContext = SERVICE,
    ): Promise<SiteMixinCreated> =>
      this.ctx.http.request<SiteMixinCreated>({
        method: "POST",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins`,
        body: input,
        auth: authCtx,
      }),

    /**
     * Partially updates a mixin (PATCH). Responds 200 without a defined body,
     * so nothing is returned. Default auth: service.
     */
    update: async (
      siteCode: string,
      mixinName: string,
      input: SiteMixin,
      authCtx: AuthContext = SERVICE,
    ): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "PATCH",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins/${mixinName}`,
        body: input,
        auth: authCtx,
      });
    },

    /** Full-replaces a mixin (PUT). Returns nothing, like {@link update}. Default auth: service. */
    replace: async (
      siteCode: string,
      mixinName: string,
      input: SiteMixin,
      authCtx: AuthContext = SERVICE,
    ): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "PUT",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins/${mixinName}`,
        body: input,
        auth: authCtx,
      });
    },

    /** Removes a mixin from a site. Default auth: service. */
    delete: async (siteCode: string, mixinName: string, authCtx: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins/${mixinName}`,
        auth: authCtx,
      });
    },
  };
}
