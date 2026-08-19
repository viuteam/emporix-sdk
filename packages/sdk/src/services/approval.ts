import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Approval,
  ApprovalList,
  ApprovalInput,
  ApprovalPatch,
  ApprovalCreated,
  ApprovalPermittedInput,
  ApprovalPermittedResult,
  ApprovalUsersQuery,
  ApprovalUsersResult,
} from "./approval-types";

export type {
  Approval,
  ApprovalList,
  ApprovalInput,
  ApprovalPatch,
  ApprovalCreated,
  ApprovalPermittedInput,
  ApprovalPermittedResult,
  ApprovalUsersQuery,
  ApprovalUsersResult,
} from "./approval-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Approval Service (`/approval/{tenant}/…`): B2B cart/quote approval
 * workflows — list/view approvals, create an approval request, approve or reject
 * via JSON-Patch, plus permitted-checks and approver search.
 *
 * Every endpoint is **CustomerAccessToken-only**. The trailing `auth` keeps the
 * SDK's uniform method shape, but a customer token is required in practice — pass
 * `auth.customer(token)` (the React hooks supply the browser context). The
 * service token will be rejected by Emporix.
 */
export class ApprovalService {
  static readonly channel = "approval" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/approval/${this.ctx.tenant}`;
  }

  /** List approvals (paged via `pageNumber`/`pageSize`/`sort`/`q`). Returns an array. */
  async listApprovals(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<ApprovalList> {
    return this.ctx.http.request<ApprovalList>({
      method: "GET",
      path: `${this.base()}/approvals`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve a single approval by id. */
  async getApproval(approvalId: string, auth: AuthContext = SERVICE): Promise<Approval> {
    return this.ctx.http.request<Approval>({
      method: "GET",
      path: `${this.base()}/approvals/${encodeURIComponent(approvalId)}`,
      auth,
    });
  }

  /** Create an approval request (cart or quote). Returns the created `{ id }`. */
  async createApproval(input: ApprovalInput, auth: AuthContext = SERVICE): Promise<ApprovalCreated> {
    return this.ctx.http.request<ApprovalCreated>({
      method: "POST",
      path: `${this.base()}/approvals`,
      auth,
      body: input,
    });
  }

  /** Approve/reject/amend an approval via a JSON-Patch op-array (`PATCH`). */
  async updateApproval(
    approvalId: string,
    ops: ApprovalPatch,
    auth: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/approvals/${encodeURIComponent(approvalId)}`,
      auth,
      body: ops,
    });
  }

  /** Delete an approval by id. */
  async deleteApproval(approvalId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/approvals/${encodeURIComponent(approvalId)}`,
      auth,
    });
  }

  /** Check whether an operation on a resource is permitted / needs approval. */
  async checkPermitted(
    input: ApprovalPermittedInput,
    auth: AuthContext = SERVICE,
  ): Promise<ApprovalPermittedResult> {
    return this.ctx.http.request<ApprovalPermittedResult>({
      method: "POST",
      path: `${this.base()}/approval/permitted`,
      auth,
      body: input,
    });
  }

  /** Search for users eligible to approve a resource. Returns an array. */
  async searchApprovers(
    input: ApprovalUsersQuery,
    auth: AuthContext = SERVICE,
  ): Promise<ApprovalUsersResult> {
    return this.ctx.http.request<ApprovalUsersResult>({
      method: "POST",
      path: `${this.base()}/search/users`,
      auth,
      body: input,
    });
  }
}

/** The status transitions a client can request. `PENDING` and `EXPIRED` are set by Emporix. */
export type ApprovalDecision = "APPROVED" | "DECLINED" | "CLOSED";

/**
 * Builds the JSON-Patch for an approval decision, with both measured quirks baked in.
 *
 * Two things about this patch are counter-intuitive, both measured against tenant
 * `viu` on 2026-08-18:
 *
 * 1. **`replace` is lowercase.** The upstream spec shipped the enum uppercase and the
 *    live API answers `REPLACE` with 400. That is repaired at the spec level (see
 *    `scripts/spec-patches.ts`), so the type now guides you correctly.
 * 2. **The approver comment needs `add`, not `replace`.** `approverComment` does not
 *    exist on a fresh approval, and `replace` on an absent field answers
 *    `APPROVAL-400010` «Missing field "approverComment"». Because PATCH is atomic,
 *    that failure takes the status change down with it — the decision silently does
 *    not happen. `add` creates the field and overwrites it on a second decision, so
 *    it is correct in both cases. The upstream spec's own «Add comment by the
 *    approver» example agrees; only its enum did not.
 *
 * Status and comment travel in one request on purpose: since PATCH is atomic, a
 * rejection can never land without its reason.
 *
 * @example
 * await client.approvals.updateApproval(id, approvalStatusPatch("DECLINED", "Over budget"), auth);
 */
export function approvalStatusPatch(
  status: ApprovalDecision,
  approverComment?: string,
): ApprovalPatch {
  const comment = approverComment?.trim() ?? "";
  return [
    { op: "replace", path: "/status", value: status },
    // `as const` on both fields: the generated type narrows `path` to an enum too, so
    // a widened `string` from the spread would not be assignable.
    ...(comment !== ""
      ? [{ op: "add" as const, path: "/approverComment" as const, value: comment }]
      : []),
  ];
}
