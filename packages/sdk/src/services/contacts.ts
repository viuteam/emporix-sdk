import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  ContactAssignment,
  ContactAssignmentCreate,
  ContactAssignmentUpdate,
} from "../generated/customer-management";

/**
 * Manages contact assignments linking customers to legal entities.
 *
 * `listForCompany` requires `customermanagement.contactassignment_read`;
 * `assign`/`update`/`unassign` require `_manage`. The query param
 * `legalEntityId` scopes the list to one company.
 */
export class ContactsService {
  static readonly channel = "customer-management" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/customer-management/${this.ctx.tenant}/contact-assignments`;
  }

  /** Lists contact assignments for one legal entity. */
  async listForCompany(legalEntityId: string, auth: AuthContext): Promise<ContactAssignment[]> {
    return this.ctx.http.request<ContactAssignment[]>({
      method: "GET",
      path: this.base(),
      query: { legalEntityId },
      auth,
    });
  }

  /** Creates a contact assignment. */
  async assign(input: ContactAssignmentCreate, auth: AuthContext): Promise<{ id: string }> {
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: input,
    });
  }

  /**
   * Patches a contact assignment. PATCH endpoint, so the body is a partial of
   * the generated `ContactAssignmentUpdate` shape.
   */
  async update(
    contactAssignmentId: string,
    patch: Partial<ContactAssignmentUpdate>,
    auth: AuthContext,
  ): Promise<ContactAssignment> {
    return this.ctx.http.request<ContactAssignment>({
      method: "PATCH",
      path: `${this.base()}/${contactAssignmentId}`,
      auth,
      body: patch,
    });
  }

  /** Deletes a contact assignment. */
  async unassign(contactAssignmentId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${contactAssignmentId}`,
      auth,
    });
  }
}
