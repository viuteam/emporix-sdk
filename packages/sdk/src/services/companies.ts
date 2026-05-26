import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  LegalEntity,
  LegalEntityCreate,
  LegalEntityUpdate,
} from "../generated/customer-management";

/**
 * Storefront-customer access to Legal Entities.
 *
 * `listMine`/`get` require `customermanagement.legalentity_read_own` on the
 * customer token. `create`/`update`/`delete` require the corresponding
 * `_manage` scopes — typically only granted to Admin-group customers; a 403
 * surfaces as `EmporixInsufficientScopeError`.
 */
export class CompaniesService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/customer-management/${this.ctx.tenant}/legal-entities`;
  }

  /** Lists the legal entities the calling customer is assigned to. */
  async listMine(auth: AuthContext): Promise<LegalEntity[]> {
    return this.ctx.http.request<LegalEntity[]>({
      method: "GET",
      path: this.base(),
      auth,
    });
  }

  /** Fetches a single legal entity by id. */
  async get(legalEntityId: string, auth: AuthContext): Promise<LegalEntity> {
    return this.ctx.http.request<LegalEntity>({
      method: "GET",
      path: `${this.base()}/${legalEntityId}`,
      auth,
    });
  }

  /** Creates a legal entity. Requires `customermanagement.legalentity_manage`. */
  async create(input: LegalEntityCreate, auth: AuthContext): Promise<{ id: string }> {
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /** Patches a legal entity. */
  async update(
    legalEntityId: string,
    patch: LegalEntityUpdate,
    auth: AuthContext,
  ): Promise<LegalEntity> {
    return this.ctx.http.request<LegalEntity>({
      method: "PATCH",
      path: `${this.base()}/${legalEntityId}`,
      auth,
      body: patch,
    });
  }

  /** Deletes a legal entity (async cascade on the server). */
  async delete(legalEntityId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${legalEntityId}`,
      auth,
    });
  }
}
