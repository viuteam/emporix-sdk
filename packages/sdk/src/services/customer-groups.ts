import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  GroupsQueryDocument,
  AssignmentCreateRequest,
} from "../generated/iam";

/**
 * Access to IAM customer groups for a legal entity.
 *
 * `listForCompany` requires `iam.group_read`; the member mutations
 * (`addMember`/`removeMember`) require `iam.group_manage` — typically only
 * granted to Admin-group customers; a 403 surfaces as
 * `EmporixInsufficientScopeError`.
 */
export class CustomerGroupsService {
  static readonly channel = "iam" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/iam/${this.ctx.tenant}/groups`;
  }

  /** Lists customer groups belonging to one legal entity. */
  async listForCompany(legalEntityId: string, auth: AuthContext): Promise<GroupsQueryDocument[]> {
    return this.ctx.http.request<GroupsQueryDocument[]>({
      method: "GET",
      path: this.base(),
      query: { "b2b.legalEntityId": legalEntityId },
      auth,
    });
  }

  /** Adds a user (customer or employee) to a group. */
  async addMember(
    groupId: string,
    member: AssignmentCreateRequest,
    auth: AuthContext,
  ): Promise<{ id: string }> {
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: `${this.base()}/${groupId}/users`,
      auth,
      body: member,
    });
  }

  /** Removes a user from a group. */
  async removeMember(groupId: string, userId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${groupId}/users/${userId}`,
      auth,
    });
  }
}
