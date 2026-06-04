# IAM Codegen Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Replace the last hand-written `generated/` mirror (`iam`) with codegen from the now-available Emporix "IAM Service" spec, and ship the previously-deferred group member mutations (`addMember`/`removeMember`) now that the endpoint shapes are confirmed.

**Architecture:** Vendor the spec as `specs/iam.yml`, register it in `fetch-specs.ts`, regenerate `src/generated/iam/` via `scripts/generate.ts`. Re-point `customer-groups.ts` to the generated `GroupsQueryDocument` (aliased to the existing public `IamGroup`), add `addMember`/`removeMember`, add matching React hooks, fix the stale test.

**Tech Stack:** TypeScript, `@hey-api/openapi-ts`, Vitest + MSW, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-04-sdk-shape-normalization-design.md` (iam follow-up).

**Key facts (verified against the live spec):**
- Spec URL: `${BASE}/users-and-permissions/iam/api-reference/api.yml` (title "IAM Service").
- List item schema `GroupsQueryDocument`: `{ id, name(map), description(map), vendorId, accessControls[], templates[], code, userType('CUSTOMER'|'EMPLOYEE'), b2b{legalEntityId}, restrictions, mixins, metadata }`. **No `role` field** — the hand-written `IamGroup.role` was wrong; nothing reads it (only the stale test).
- Add member: `POST /iam/{tenant}/groups/{groupId}/users`, body `AssignmentCreateRequest` `{ userId(required), userType('CUSTOMER'|'EMPLOYEE') }` → `AssignmentIdResponse` `{ id }`.
- Remove member: `DELETE /iam/{tenant}/groups/{groupId}/users/{userId}` → 204.

---

## Task 1: Vendor spec + register in fetch-specs

**Files:** `packages/sdk/specs/iam.yml`, `packages/sdk/scripts/fetch-specs.ts`.

- [ ] **Step 1:** Add to `SPECS`: `iam: \`${BASE}/users-and-permissions/iam/api-reference/api.yml\``.
- [ ] **Step 2:** Copy the fetched spec to `packages/sdk/specs/iam.yml`.
- [ ] **Step 3:** Commit `chore(sdk): vendor IAM spec + register in fetch-specs`.

## Task 2: Generate types

- [ ] **Step 1:** `pnpm -F @viu/emporix-sdk generate` → logs `generated iam`; header becomes `// AUTO-GENERATED`.
- [ ] **Step 2:** Confirm generated names: `GroupsQueryDocument`, `AssignmentCreateRequest`, `AssignmentIdResponse`.
- [ ] **Step 3:** Typecheck (expected FAIL where `customer-groups.ts` / barrel import the old hand-written `IamGroup`/`IamGroupB2B`).

## Task 3: Re-point service + add mutations

**Files:** `packages/sdk/src/services/customer-groups.ts`, `packages/sdk/src/customer-groups.ts`.

- [ ] **Step 1:** Service: import `GroupsQueryDocument`, `AssignmentCreateRequest`, `AssignmentIdResponse`. `listForCompany` returns `GroupsQueryDocument[]`. Add `addMember(groupId, member: AssignmentCreateRequest, auth): Promise<{ id: string }>` (POST `.../groups/{groupId}/users`) and `removeMember(groupId, userId, auth): Promise<void>` (DELETE `.../groups/{groupId}/users/{userId}`). Drop the "deferred" doc note.
- [ ] **Step 2:** Barrel `src/customer-groups.ts`: `export type { GroupsQueryDocument as IamGroup, AssignmentCreateRequest as IamGroupMemberAssignment } from "./generated/iam"`. Drop `IamGroupB2B` (no generated counterpart, unused).
- [ ] **Step 3:** Typecheck SDK PASS.

## Task 4: React hooks

**Files:** `packages/react/src/hooks/use-company-mutations.ts`, `packages/react/src/index.ts`.

- [ ] **Step 1:** Add `useAddGroupMember()` → `{ groupId, member }` → `client.customerGroups.addMember`; `useRemoveGroupMember()` → `{ groupId, userId }` → `removeMember`. Invalidate `groups` queries on success (match existing predicate style).
- [ ] **Step 2:** Export both from `index.ts`.

## Task 5: Tests

**Files:** `packages/sdk/tests/services/customer-groups.test.ts`, `packages/react/tests/use-company-mutations.test.tsx`.

- [ ] **Step 1:** Fix stale list test: replace `role` with `code` in the mock + assertion (keep `b2b.legalEntityId` assertion). Add `addMember` (POST body + returns id) and `removeMember` (DELETE 204) tests.
- [ ] **Step 2:** React: add `useAddGroupMember`/`useRemoveGroupMember` tests.
- [ ] **Step 3:** `pnpm -F @viu/emporix-sdk test` + `pnpm -F @viu/emporix-sdk-react test` green.

## Task 6: Changeset, full verify, finish

- [ ] **Step 1:** `.changeset/iam-codegen.md` (`@viu/emporix-sdk` + `@viu/emporix-sdk-react` minor).
- [ ] **Step 2:** `pnpm -r typecheck && pnpm -r test && pnpm -r build`.
- [ ] **Step 3:** Commit `feat(sdk): generate IAM types, add group member mutations`.
- [ ] **Step 4:** REQUIRED SUB-SKILL `superpowers:finishing-a-development-branch`.

## Completion

After this, **no hand-written `generated/` mirrors remain** — the SDK shape-normalization effort is fully closed.
