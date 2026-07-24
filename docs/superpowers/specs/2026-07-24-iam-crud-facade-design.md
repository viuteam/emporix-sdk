# IAM CRUD Facade — Design

- **Date:** 2026-07-24
- **Status:** approved (design)
- **Scope:** `@viu/emporix-sdk` (core). React hooks are out of scope for this round (IAM is an admin/backend surface).

## 1. Motivation

The `iam` spec is vendored but intentionally unwrapped — only its group-membership sub-part is reached today via the B2B-focused `customer-groups.ts`. This design adds a first-class `IamService` (`client.iam`) covering the **current** IAM admin CRUD: users, user-groups, access-controls, scopes. The deprecated legacy-RBAC model (roles / permissions / resources / templates) and the individually-deprecated reads are **excluded**.

## 2. Goals / Non-goals

**Goals**
- New `client.iam` with four grouped sub-resources: `users`, `groups`, `accessControls`, `scopes`.
- All methods take a **required** `auth` argument (no default) — IAM ops need an explicit privileged token; "own/me" reads take the caller's customer token.
- De-duplicate group membership: `customer-groups.ts` delegates to `iam.groups` internally while keeping its public API unchanged.
- Alias generated `iam` types; never hand-author wire shapes.

**Non-goals**
- No deprecated surface: `/roles`, `/permissions`, `/resources`, `/templates`, and the deprecated reads `list-user-access-controls`, `retrieve-user-group` (user-side), `list-users-with-groups-vendor` are **not** wrapped.
- **No `removeUser` on `iam.groups`** — the only per-user group removal (`DELETE /groups/{groupId}/users/{userId}`) is deprecated; it is intentionally omitted. Group-side removal is available only as `removeAllUsers` (`DELETE /groups/{groupId}/users`, non-deprecated).
- No React hooks this round.

## 3. Decisions (from brainstorming)

- **API shape:** grouped sub-resources (Approach A), each hand-written (the resources' shapes differ too much for a shared generic class).
- **Auth:** required explicit `auth` on every method, no default.
- **customer-groups:** internal delegation (dedupe), public API of `client.customerGroups` unchanged — see §6.

## 4. Architecture

- New `packages/sdk/src/services/iam.ts` — `IamService` (channel `"iam"`), with four sub-resources exposed as lazy getters or plain object literals: `users`, `groups`, `accessControls`, `scopes`.
- Public types in `packages/sdk/src/services/iam-types.ts`, aliasing `../generated/iam` (e.g. `IamUser = UserResponse`, `IamUserCreate = UserCreateRequest`, `IamUserUpdate = UserUpdateRequest`, `IamGroup = GroupsQueryDocument`, `IamGroupCreate = GroupCreateRequest`, `IamGroupUpdate = GroupUpdateRequest`, `IamGroupMemberCreate = AssignmentCreateRequest`, `IamAccessControl = AccessControlQueryDocument`, `IamAccessControlUpsert = AccessControlUpsertRequest`, plus scope types confirmed at implementation).
- Every method wraps one live endpoint via `ctx.http.request`, path base `/iam/${ctx.tenant}/…`.

**Wiring** (as for existing services): add `"iam"` to the `ServiceName` union in `core/logger.ts`; register `readonly iam: IamService` + `this.iam = new IamService(mk(IamService.channel))` in `client.ts`; export `IamService` + public types from `index.ts`.

## 5. Sub-resource method surface

All methods end with a required `auth: AuthContext`. List reads return arrays (or a `PaginatedItems<T>` wrap where the endpoint paginates — confirmed per endpoint at implementation).

### `iam.users` (`/iam/{tenant}/users`)
| Method | HTTP | Path |
|---|---|---|
| `list(auth, query?)` | GET | `/users` |
| `create(input, auth)` | POST | `/users` |
| `get(userId, auth)` | GET | `/users/{userId}` |
| `getMe(auth)` | GET | `/users/me` |
| `update(userId, input, auth)` | PUT | `/users/{userId}` |
| `delete(userId, auth)` | DELETE | `/users/{userId}` |
| `getGroups(userId, auth)` | GET | `/users/{userId}/groups` |
| `getScopes(userId, auth)` | GET | `/users/{userId}/scopes` |
| `getMyScopes(auth)` | GET | `/users/me/scopes` |
| `getAccessControls(userId, auth)` | GET | `/users/{userId}/access-controls` |
| `getMyAccessControls(auth)` | GET | `/users/me/access-controls` |

### `iam.groups` (`/iam/{tenant}/groups`)
| Method | HTTP | Path |
|---|---|---|
| `list(auth, query?)` | GET | `/groups` |
| `create(input, auth)` | POST | `/groups` |
| `get(groupId, auth)` | GET | `/groups/{groupId}` |
| `update(groupId, input, auth)` | PUT | `/groups/{groupId}` |
| `delete(groupId, auth)` | DELETE | `/groups/{groupId}` |
| `listUsers(groupId, auth)` | GET | `/groups/{groupId}/users` |
| `addUser(groupId, input, auth)` | POST | `/groups/{groupId}/users` |
| `updateUser(groupId, userType, userId, input, auth)` | PUT | `/groups/{groupId}/users/{userType}/{userId}` |
| `removeAllUsers(groupId, auth)` | DELETE | `/groups/{groupId}/users` |
| `listAccessControls(groupId, auth)` | GET | `/groups/{groupId}/access-controls` |

*(No per-user `removeUser` — see §2 non-goals.)*

### `iam.accessControls` (`/iam/{tenant}/access-controls`)
| Method | HTTP | Path |
|---|---|---|
| `list(auth)` | GET | `/access-controls` |
| `get(id, auth)` | GET | `/access-controls/{id}` |
| `upsert(id, input, auth)` | PUT | `/access-controls/{id}` |
| `delete(id, auth)` | DELETE | `/access-controls/{id}` |

### `iam.scopes` (`/iam/{tenant}/scopes`)
| Method | HTTP | Path |
|---|---|---|
| `list(auth)` | GET | `/scopes` |
| `get(scopeId, auth)` | GET | `/scopes/{scopeId}` |
| `upsertCustom(scopeId, input, auth)` | PUT | `/scopes/{scopeId}` |
| `deleteCustom(scopeId, auth)` | DELETE | `/scopes/{scopeId}` |

## 6. customer-groups delegation

`CustomerGroupsService` keeps its public API (`listForCompany`, `addMember`, `removeMember`) and holds a private `IamService` (constructed from the same `ClientContext`). Delegation:

- `listForCompany(legalEntityId, auth)` → `iam.groups.list(auth, { legalEntityId })`.
- `addMember(groupId, …, auth)` → `iam.groups.addUser(groupId, …, auth)`.
- `removeMember(groupId, userId, auth)` — **unchanged**. It keeps calling `DELETE /iam/{tenant}/groups/{groupId}/users/{userId}` directly, because `iam.groups` intentionally omits that deprecated endpoint. This is pre-existing behavior; the delegation refactor does not touch it.

Net effect: no behavior change for `client.customerGroups`; the two delegated methods stop duplicating request-building.

## 7. Auth

Every `iam.*` method requires an explicit `auth: AuthContext` (mirrors `client.quotes` and today's `customer-groups`). Admin ops receive a `service`/admin token; `getMe`/`getMyScopes`/`getMyAccessControls` receive the caller's customer token. No defaulting — an omitted token is a compile error, not a silent anonymous call.

## 8. Testing

- MSW unit tests per method: assert HTTP method, path, and that the caller's bearer is forwarded.
- `expectTypeOf` checks that public aliases match the generated shapes.
- One delegation test: `customerGroups.listForCompany`/`addMember` hit the `iam` group paths (proving delegation), and `removeMember` still hits the per-user path.

## 9. Risks / open items

- Exact response types for list endpoints (array vs paginated) and the `scopes` request/response type names are confirmed against `generated/iam` during implementation; the aliases in §4 are the expected names.
- `updateUser` uses the `{userType}/{userId}` path (`PUT-iam-update-user-to-group`); confirm the body type (`AssignmentCreateRequest` or a dedicated update DTO) at implementation.
- `removeMember` remaining on a deprecated endpoint is a known, accepted carry-over (no non-deprecated single-user removal exists upstream).
