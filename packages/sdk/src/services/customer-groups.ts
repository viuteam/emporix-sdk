import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { IamGroup } from "../generated/iam";

/**
 * Read-only access to IAM customer groups for a legal entity.
 *
 * Member-management endpoints (`addMember`/`removeMember`) are deferred —
 * the exact IAM path/body shape isn't in the SDK input set yet. They will
 * land in a small follow-up plan once the API reference is confirmed.
 */
export class CustomerGroupsService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/iam/${this.ctx.tenant}/groups`;
  }

  /** Lists customer groups belonging to one legal entity. */
  async listForCompany(legalEntityId: string, auth: AuthContext): Promise<IamGroup[]> {
    return this.ctx.http.request<IamGroup[]>({
      method: "GET",
      path: this.base(),
      query: { "b2b.legalEntityId": legalEntityId },
      auth,
    });
  }
}
