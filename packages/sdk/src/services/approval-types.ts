/**
 * Public types for the Approval Service — stable names aliased over the generated
 * `approval-service` types (single source of truth; faithful required/optional flags).
 *
 * Every endpoint is CustomerAccessToken-only (B2B cart/quote approval workflows).
 *
 * Deprecated upstream (since 2026-05-26, removal 2026-11-30) — these fields carry
 * `@deprecated` in the generated types; prefer the replacements:
 * - `totalPrice.amount` / `subTotalPrice.amount` → `netValue` / `grossValue` / `taxValue`
 * - `itemYrn` → `itemId`
 * - `itemPrice.amount` → `calculatedPrice` and `unitPrice`
 */
import type {
  GetApprovalResponse,
  CreateCartApprovalRequest,
  CreateQuoteApprovalRequest,
  UpdateApprovalRequest,
  ApprovalId,
  ApprovalPermittedRequest,
  ApprovalPermittedResponse,
  SearchUsersRequest,
  User,
} from "../generated/approval-service";

/** An approval document (read shape). */
export type Approval = GetApprovalResponse;
/** Response of `listApprovals` — a plain array of approvals. */
export type ApprovalList = Approval[];
/** Create body (`POST /approvals`) — a cart or quote approval request. */
export type ApprovalInput = CreateCartApprovalRequest | CreateQuoteApprovalRequest;
/** Partial-update body (`PATCH /approvals/{id}`) — a JSON-Patch op-array. */
export type ApprovalPatch = UpdateApprovalRequest;
/** `POST /approvals` 201 response — the created approval's `{ id }`. */
export type ApprovalCreated = ApprovalId;
/** Body for `checkPermitted` (`POST /approval/permitted`). */
export type ApprovalPermittedInput = ApprovalPermittedRequest;
/** Result of `checkPermitted` — `{ permitted, action, status?, approvalId? }`. */
export type ApprovalPermittedResult = ApprovalPermittedResponse;
/** Body for `searchApprovers` (`POST /search/users`). */
export type ApprovalUsersQuery = SearchUsersRequest;
/** Result of `searchApprovers` — a plain array of approver users. */
export type ApprovalUsersResult = User[];
