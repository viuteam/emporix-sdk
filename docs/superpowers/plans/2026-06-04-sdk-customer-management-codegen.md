# Phase 4 — customer-management Codegen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps use `- [ ]`.

**Goal:** Replace the hand-written `customer-management` type mirror (B2B legal-entities / contact-assignments / locations) with codegen from the vendored Emporix "Customer Management Service" spec, so the Companies/Contacts/Locations services return the real API shape.

**Architecture:** Vendor the spec (repo dir `client-management`, API title "Customer Management Service") as `specs/customer-management.yml`; `scripts/generate.ts` regenerates `src/generated/customer-management/` in place; re-point the façade re-exports in `companies.ts`/`contacts.ts`/`locations.ts` (+ their barrels and `index.ts`) to the generated names; fix any tests.

**Tech Stack:** TypeScript, `@hey-api/openapi-ts`, Vitest + MSW, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-04-sdk-shape-normalization-design.md` (Phase 4).

**Note:** The repo's `customer-management` dir is a *different* API (customer login/signup); the B2B one is `client-management` (title "Customer Management Service"). The SDK module name stays `customer-management`.

---

## Task 1: Vendor spec + register in fetch-specs (done in discovery)

**Files:** `packages/sdk/specs/customer-management.yml` (vendored), `packages/sdk/scripts/fetch-specs.ts` (SPECS entry).

- [ ] **Step 1: Sanity-check + commit**
```bash
grep -nE "/customer-management/|legal-entities|contact-assignments|locations" packages/sdk/specs/customer-management.yml | head
git add packages/sdk/specs/customer-management.yml packages/sdk/scripts/fetch-specs.ts
git commit -m "chore(sdk): vendor the Customer Management (B2B) OpenAPI spec"
```

---

## Task 2: Generate the types

- [ ] **Step 1: Codegen** — `pnpm -F @viu/emporix-sdk generate` → logs `generated customer-management`; the file header becomes `// AUTO-GENERATED`.

- [ ] **Step 2: Record generated names**
```bash
grep -nE "^export (type|interface) " packages/sdk/src/generated/customer-management/types.gen.ts | grep -iE "legalentity|contactassignment|location|customergroup|metadata|accountlimit" | head -40
```
Map the old hand-written names → generated names: `LegalEntity`, `LegalEntityCreate`, `LegalEntityUpdate`, `LegalEntityType`, `ContactAssignment`, `ContactAssignmentCreate`, `ContactAssignmentUpdate`, `ContactAssignmentType`, `Location`, `LocationCreate`, `LocationUpdate`, `LocationType`, `ContactDetails`, `AccountLimit`, `LegalInfo`, `CustomerGroupRef`, `ResourceId`, `Metadata`.

- [ ] **Step 3: Typecheck (expected FAIL)** — `pnpm -F @viu/emporix-sdk typecheck` fails where `companies.ts`/`contacts.ts`/`locations.ts` (and their `src/*.ts` barrels) import names that changed.

---

## Task 3: Re-point the service + façade re-exports

**Files:** `packages/sdk/src/services/{companies,contacts,locations}.ts`, `packages/sdk/src/{companies,contacts,locations}.ts`, `packages/sdk/src/index.ts`.

- [ ] **Step 1: For each service file**, update the `from "../generated/customer-management"` import to the generated names (alias to the public names where they differ, e.g. `import type { LegalEntityDto as LegalEntity }`). Keep the public type surface stable. Reconcile method body/return types to the generated shapes.

- [ ] **Step 2: Update the barrels** `src/companies.ts`, `src/contacts.ts`, `src/locations.ts` (they re-export the types) to the generated/aliased names; drop any re-exported names that have no generated counterpart (only if unused — check with `grep -rIl "\bName\b" packages/react/src examples/*/src packages/sdk/src/services`).

- [ ] **Step 3: `index.ts`** — adjust any customer-management type re-exports that changed.

- [ ] **Step 4: Typecheck** — `pnpm -F @viu/emporix-sdk typecheck` PASS.

---

## Task 4: Fix tests

**Files:** `packages/sdk/tests/services/{companies,contacts,locations}.test.ts`, React `packages/react/tests/{use-my-companies,use-company-*,use-customer-addresses?}.test.tsx`.

- [ ] **Step 1: Run** `pnpm -F @viu/emporix-sdk test` and `pnpm -F @viu/emporix-sdk-react test`; for each failing assertion that reads a renamed/reshaped field, update the fixture/assertion to the real generated shape (verify field names against the vendored spec / generated types).

- [ ] **Step 2: Rebuild + react/demo typecheck** — `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build && pnpm -r typecheck`.

---

## Task 5: Changeset, live verify, full build

- [ ] **Step 1: Changeset** `.changeset/customer-management-codegen.md`:
```md
---
"@viu/emporix-sdk": minor
---

feat(sdk): generate customer-management types from the real OpenAPI spec

Replaces the hand-written customer-management mirror (B2B legal-entities /
contact-assignments / locations) with codegen output from the vendored
"Customer Management Service" spec. Companies/Contacts/Locations now return the
real API shape.
```

- [ ] **Step 2: Live verify** — with a customer that has a legal entity on the tenant (B2B), confirm `client.companies.listMine(...)` returns the real shape. If no B2B setup is available, note it as deferred and rely on the generated-from-spec types + green unit tests.

- [ ] **Step 3: Full verify** — `pnpm -r typecheck && pnpm -r test && pnpm -r build`.

- [ ] **Step 4: Commit**
```bash
git add packages/sdk/src .changeset/customer-management-codegen.md packages/sdk/tests
git commit -m "feat(sdk): generate customer-management types, fix consumers"
```

---

## Completion

REQUIRED SUB-SKILL `superpowers:finishing-a-development-branch`. Branch `feat/customer-management-codegen` (off `main`). After this, only `iam` remains hand-written (minimal, partial — a small follow-up).
