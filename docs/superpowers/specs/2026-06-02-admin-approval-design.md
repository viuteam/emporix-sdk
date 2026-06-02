# Approval Service Binding — Design

**Date:** 2026-06-02
**Status:** Approved
**Scope:** Bind the Emporix **Approval Service** into `@viu/emporix-sdk` (core) +
`@viu/emporix-sdk-react` (hooks). This is the **last unbound spec** in the catalog —
after this, every Emporix OpenAPI service is bound.

## What this is

The Approval Service drives **B2B approval workflows**: when a buyer assembles a cart
or quote that needs sign-off (spend limits, role rules), an approval document is
created; an authorized approver then approves or rejects it. The whole surface is
**storefront-facing** — every endpoint authenticates with a `CustomerAccessToken`
(no OAuth2 / clientCredentials anywhere in the spec).

Base path: `/approval/{tenant}`.

## Auth model

Because **every** endpoint is customer-token-only, the core service does **not**
default to the service token. Methods follow the coupon/reward-points convention but
inverted: `auth` defaults to the **service** token only where the SDK convention
demands a trailing optional `auth`, *but* the documented and only-supported caller is
a customer token. To stay honest we keep the established signature shape
(`(…, auth: AuthContext = SERVICE)`) so the service composes with the rest of the SDK,
and the React hooks always pass `useCustomerOnlyCtx()`. Calling these methods with the
service token will 401 at Emporix — that is expected and documented.

> Rationale: matches every other service's method shape (trailing `auth`), keeps the
> wiring/logger/test harness identical, and the React layer — the real consumer —
> always supplies the customer context. Documented clearly in `docs/approval.md`.

## Endpoints → methods (`client.approvals`, `ApprovalService`)

| Method | HTTP | Path | Returns |
|---|---|---|---|
| `listApprovals(query?, auth?)` | GET | `/approvals` | `ApprovalList` (array) |
| `getApproval(approvalId, auth?)` | GET | `/approvals/{approvalId}` | `Approval` |
| `createApproval(input, auth?)` | POST | `/approvals` | `ApprovalCreated` (201) |
| `updateApproval(approvalId, ops, auth?)` | PATCH | `/approvals/{approvalId}` | `void` (204) |
| `deleteApproval(approvalId, auth?)` | DELETE | `/approvals/{approvalId}` | `void` (204) |
| `checkPermitted(input, auth?)` | POST | `/approval/permitted` | `ApprovalPermittedResult` |
| `searchApprovers(input, auth?)` | POST | `/search/users` | `ApprovalUsersResult` (array) |

**List query params** (all optional): `pageNumber`, `pageSize`, `sort`, `q`
(`Record<string, string | number>`, omitted when empty — coupon `listCoupons` pattern).

**Codegen-discovered refinements** (vs. the original design):
- **PATCH is a JSON-Patch op-array** (`updateApprovalRequest` = `type: array` of
  `{op, path, value?}`), returns **204**. So `updateApproval` takes a
  `PatchOperation[]` and resolves to `void` — exactly the returns `patchReturn`
  shape. The React hook is therefore named **`useUpdateApproval`** (sends a
  JSON-Patch op-array; an approver expresses approve/reject as a `replace` on
  `/status`), not `useDecideApproval` — honest to the wire format.
- **`/search/users` returns `user[]`** (`approvalSearchUsersResponse` = array of
  `user`), not an object.
- **Create body is a `oneOf`** of `createCartApprovalRequest | createQuoteApprovalRequest`
  (both `allOf` over `genericApprovalForCreate`).
- **Create response** is `approvalId` = `{ id?: string }`.

## Types (`approval-types.ts`, alias-first over generated `approval`)

All names alias the generated types (single source of truth; faithful
required/optional flags). Pinned at codegen time:

| Public type | Generated source | Notes |
|---|---|---|
| `Approval` | `GetApprovalResponse` | read shape (`id`, `status`, `action`, `resource`, `requestor`, `approver`, `expiryDate`, `metadata`) |
| `ApprovalList` | `Approval[]` | list endpoint returns a plain array |
| `ApprovalInput` | `CreateCartApprovalRequest \| CreateQuoteApprovalRequest` | create body (`oneOf`) |
| `ApprovalPatch` | `UpdateApprovalRequest` (already an op-array) | JSON-Patch body for PATCH |
| `ApprovalCreated` | `ApprovalId` | `{ id?: string }` |
| `ApprovalPermittedInput` | `ApprovalPermittedRequest` | `{ resourceType, resourceId, … }` |
| `ApprovalPermittedResult` | `ApprovalPermittedResponse` | `{ action, status, permitted, approvalId? }` |
| `ApprovalUsersQuery` | `SearchUsersRequest` | `{ resourceType, resourceId, … }` |
| `ApprovalUsersResult` | `User[]` | array of approver users |

If codegen emits `UpdateApprovalRequest` already as `Array<…>`, alias
`ApprovalPatch = UpdateApprovalRequest`; otherwise `= UpdateApprovalRequest[]`.
Resolve the exact form at codegen-verify time (Task 1).

## React hooks (`@viu/emporix-sdk-react`) — customer-only

All use `useCustomerOnlyCtx()` (throws without a stored customer token) and the
`emporixKey("approvals", […], { tenant, authKind })` key convention; mutations
invalidate `["emporix", "approvals"]`.

| Hook | Kind | Wraps |
|---|---|---|
| `useApprovals(opts?: { query? })` | `useQuery` → `ApprovalList` | `listApprovals` |
| `useApproval(approvalId?)` | `useQuery` → `Approval` (enabled when id set) | `getApproval` |
| `useCreateApproval()` | `useMutation<ApprovalCreated, unknown, ApprovalInput>` | `createApproval` |
| `useUpdateApproval()` | `useMutation<void, unknown, { approvalId; ops }>` | `updateApproval` |

`checkPermitted` and `searchApprovers` stay **core-only** (specialized pre-checks,
not part of the day-to-day list/view/decide loop). Easy to add hooks later if needed.

## Wiring

- `fetch-specs.ts`: add `"approval-service"` →
  `${BASE}/companies-and-customers/approval-service/approval-api-reference/api.yml`
  (note: `approval-api-reference`, not `api-reference`). Re-run `fetch:specs` + `generate`.
- `logger.ts`: add `| "approval"` to `ServiceName`.
- `client.ts`: import `ApprovalService`, `readonly approvals: ApprovalService`,
  `this.approvals = new ApprovalService(mk("approval"))`.
- `src/approval.ts` facade: `export * from "./services/approval"`.
- `src/index.ts` barrel: `export * from "./approval"`.
- React: `use-approvals.ts` + export from `hooks/index.ts`.
- `CLAUDE.md` service list: append `Approval`.

## Testing

- **sdk** `tests/services/approval-types.test.ts` — type-level alias assertions.
- **sdk** `tests/services/approval.test.ts` — MSW: each method's path/verb, customer
  token forwarded, list query serialization, PATCH sends op-array → 204 void, 404 →
  `EmporixNotFoundError`, `searchApprovers` returns array, `checkPermitted` returns
  `{ permitted }`.
- **sdk** `tests/services/approval-wiring.test.ts` — `client.approvals` is an
  `ApprovalService`; logger service name `"approval"`.
- **react** `tests/use-approvals.test.tsx` — customer-only: `useApprovals`/`useApproval`
  query with `cust-tok`; `useCreateApproval` posts + invalidates; `useUpdateApproval`
  patches; missing-token throws (customer-only guard).

## Changeset

`minor` bump on **both** `@viu/emporix-sdk` and `@viu/emporix-sdk-react` (new core
service + new React hooks).

## Out of scope

- No convenience approve/reject helpers that hard-code JSON-Patch paths (would guess
  the `/status` value enum). Consumers build the op-array; documented with an example.
- No hooks for `checkPermitted` / `searchApprovers` in this pass.
