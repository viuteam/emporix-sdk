import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { GroupsQueryDocument, AssignmentCreateRequest } from "../generated/iam";
import { IamService } from "./iam";

/**
 * Access to IAM customer groups for a legal entity. Thin B2B-friendly wrapper
 * over {@link IamService.groups}; kept for backward compatibility.
 *
 * `listForCompany` requires `iam.group_read`; the member mutations
 * (`addMember`/`removeMember`) require `iam.group_manage` — typically only
 * granted to Admin-group customers; a 403 surfaces as
 * `EmporixInsufficientScopeError`.
 */
export class CustomerGroupsService {
  static readonly channel = "iam" as const;
  private readonly iam: IamService;
  constructor(private readonly ctx: ClientContext) {
    this.iam = new IamService(ctx);
  }

  /** Lists customer groups belonging to one legal entity. */
  async listForCompany(legalEntityId: string, auth: AuthContext): Promise<GroupsQueryDocument[]> {
    return this.iam.groups.list(auth, { "b2b.legalEntityId": legalEntityId });
  }

  /** Adds a user (customer or employee) to a group. */
  async addMember(
    groupId: string,
    member: AssignmentCreateRequest,
    auth: AuthContext,
  ): Promise<{ id: string }> {
    // `addUser` returns `AssignmentIdResponse` (id optional); the original public
    // contract is `{ id: string }` (the old `request<{id:string}>` asserted the
    // same). Cast to preserve that contract — the wire body is identical.
    return (await this.iam.groups.addUser(groupId, member, auth)) as { id: string };
  }

  /**
   * Removes a user from a group. Uses `DELETE …/groups/{groupId}/users/{userId}`
   * directly — this endpoint is deprecated upstream and intentionally not
   * exposed on {@link IamService}, so it is not delegated. No non-deprecated
   * single-user removal exists.
   */
  async removeMember(groupId: string, userId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/iam/${this.ctx.tenant}/groups/${groupId}/users/${userId}`,
      auth,
    });
  }
}
