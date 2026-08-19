# Customer password-migration facade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the four new Emporix Customer Service operations — the password-migration retention config (GET/POST/DELETE) and bulk customer import — on `client.customerAdmin`, with typed inputs, behavioural tests and docs.

**Architecture:** All four land on the existing `CustomerAdminService`. They belong to the same upstream service (`customer-service.yml`), share its channel and its service-token default, and splitting them into a second facade would fragment one Emporix service across two SDK surfaces for no gain. The retention path sits outside `base()` (`/config/…`, not `/customers/…`), so it gets its own private path helper. Public types are thin aliases of the generated schemas, prefixed `Admin*` like the rest of the file.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`-generated types, changesets.

**Spec:** The upstream OpenAPI change itself — [PR #272](https://github.com/viuteam/emporix-sdk/pull/272), branch `chore/emporix-api-sync`, which adds 325 lines to `packages/sdk/specs/customer-service.yml` and 315 to `packages/sdk/src/generated/customer-service/types.gen.ts`. There is no local design doc; the spec diff and this plan are the contract.

## Prerequisite — not a task

**PR #272 must be merged before this work starts.** Every type alias below imports from `packages/sdk/src/generated/customer-service`, and those types only exist on that branch. Branch from `main` after the merge. If you branch earlier, Task 1 fails at the first import with «has no exported member».

## Global Constraints

- **Everything committed is English** — code, JSDoc, changeset, commit message, PR body, docs prose, test names. No exceptions.
- **commitlint:** scope from the allowlist (use `sdk` for facade work, `docs` for doc-only commits); the first word after the scope must be a lowercase verb; **body lines must not exceed 100 characters** — hard-wrap them.
- **`exactOptionalPropertyTypes: true`** and **`noUncheckedIndexedAccess: true`** repo-wide (`tsconfig.base.json:8-9`). Never assign `undefined` to an optional property; index access yields `T | undefined`.
- **Facades type inputs with generated schemas too,** not only outputs. Every request body below is an alias of a generated type, never a hand-written interface.
- **Branch** `feat/customer-password-migration`, PR against `main`. **Never merge the PR and never publish.**
- **Auth:** all four operations default to `SERVICE`. They are server-side only.

## Upstream contract, verbatim

Two new paths in `packages/sdk/specs/customer-service.yml`:

| Method | Path | Scope | Success |
|---|---|---|---|
| `GET` | `/customer/{tenant}/config/password-migration-retention` | `customer.import_read` | `200` `PasswordMigrationRetentionConfigResponse` |
| `POST` | `/customer/{tenant}/config/password-migration-retention` | `customer.import_manage` | `200` `PasswordMigrationRetentionConfigResponse` |
| `DELETE` | `/customer/{tenant}/config/password-migration-retention` | `customer.import_manage` | `204` `void` |
| `POST` | `/customer/{tenant}/customers/import` | `customer.import_manage` | **`207`** `Array<CustomerBulkItemResponse>` |

Generated shapes (already on the branch, do not redeclare them):

```ts
PasswordMigrationRetentionConfigRequest = {
  retentionEndDate: string;            // required
  emailReminderDate?: string;
  emailNotificationsEnabled?: boolean;
}
PasswordMigrationRetentionConfigResponse = {   // all three optional
  retentionEndDate?: string;
  emailReminderDate?: string;
  emailNotificationsEnabled?: boolean;
}
CustomerImportDto        = CustomerCreateDto & { id?: string; contactEmail?: string; account: CustomerImportAccountDto }
CustomerImportAccountDto = { email: string; passwordHash?: string; legacyAuth?: LegacyAuth }
LegacyAuth               = { algorithm: 'hybris-sha512-uid-salt'; hash: string }
CustomerBulkItemResponse = { index?: number; id?: string; code?: number }
```

`CustomerCreateDto` has **no required fields**, so an import item needs only `account.email`.

Domain rules from the spec's own descriptions, which the JSDoc and docs must carry because no type expresses them:

- An import item must provide **exactly one** of `account.passwordHash` or `account.legacyAuth`.
- Importing with `legacyAuth` **requires an active retention config** for the tenant. Configure first, import second — the reverse order fails.
- Legacy hashes are silently migrated to Emporix hashes on the customer's first successful login.
- When the window ends, remaining unmigrated accounts require a password reset and their legacy credentials are cleared.
- `emailReminderDate` defaults to 7 days before `retentionEndDate`, or to tomorrow when that default would fall on or before today. `emailNotificationsEnabled` defaults to `true`.
- `DELETE` is for after the migration window. The config can instead be re-`POST`ed with an earlier `retentionEndDate` to finish sooner.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `packages/sdk/src/services/customer-admin-types.ts` | modify | 6 new `Admin*` aliases of the generated schemas |
| `packages/sdk/src/services/customer-admin.ts` | modify | 1 private path helper, 4 methods, type re-exports |
| `packages/sdk/tests/services/customer-admin.test.ts` | **create** | behavioural MSW tests — this file does not exist yet; `customer-admin-wiring.test.ts` is a 14-line wiring smoke test and stays untouched |
| `docs/customer-admin.md` | modify | two new sections after «Addresses» |
| `.changeset/customer-password-migration.md` | create | `@viu/emporix-sdk` minor |

No React work. All four operations need a service token with `customer.import_*` scopes, so there is no customer or anonymous variant to hook — the same reason `docs/approval.md` and `docs/import.md` each carry a «Why there is no React hook» section. `packages/react` contains no `customerAdmin` references today and gains none here.

---

### Task 1: Password-migration retention config

**Files:**
- Modify: `packages/sdk/src/services/customer-admin-types.ts`
- Modify: `packages/sdk/src/services/customer-admin.ts`
- Create: `packages/sdk/tests/services/customer-admin.test.ts`
- Modify: `docs/customer-admin.md`

**Interfaces:**
- Consumes: `PasswordMigrationRetentionConfigRequest`, `PasswordMigrationRetentionConfigResponse` from `../generated/customer-service`.
- Produces: `AdminPasswordMigrationRetention`, `AdminPasswordMigrationRetentionInput`; methods `getPasswordMigrationRetention(auth?)`, `configurePasswordMigrationRetention(input, auth?)`, `deletePasswordMigrationRetention(auth?)`. Task 2 reuses the test file's `svc()` factory and its `server` setup from this task.

- [ ] **Step 1: Write the failing tests**

Create `packages/sdk/tests/services/customer-admin.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CustomerAdminService } from "../../src/services/customer-admin";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc(): CustomerAdminService {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "customer-admin" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CustomerAdminService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const CONFIG = "https://api.emporix.io/customer/acme/config/password-migration-retention";

describe("CustomerAdminService password-migration retention", () => {
  it("getPasswordMigrationRetention GETs the config path with the service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(CONFIG, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ retentionEndDate: "2027-01-31", emailNotificationsEnabled: true });
      }),
    );
    const config = await svc().getPasswordMigrationRetention();
    expect(seenAuth).toBe("Bearer svc-tok");
    expect(config).toEqual({ retentionEndDate: "2027-01-31", emailNotificationsEnabled: true });
  });

  it("configurePasswordMigrationRetention POSTs the body and returns the stored config", async () => {
    let body: unknown = null;
    server.use(
      http.post(CONFIG, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          retentionEndDate: "2027-01-31",
          emailReminderDate: "2027-01-24",
          emailNotificationsEnabled: true,
        });
      }),
    );
    const config = await svc().configurePasswordMigrationRetention({ retentionEndDate: "2027-01-31" });
    expect(body).toEqual({ retentionEndDate: "2027-01-31" });
    expect(config.emailReminderDate).toBe("2027-01-24");
  });

  it("deletePasswordMigrationRetention DELETEs and resolves on 204", async () => {
    let called = false;
    server.use(
      http.delete(CONFIG, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().deletePasswordMigrationRetention()).resolves.toBeUndefined();
    expect(called).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/customer-admin.test.ts`
Expected: FAIL — `svc(...).getPasswordMigrationRetention is not a function`.

- [ ] **Step 3: Add the type aliases**

Append to the import block in `packages/sdk/src/services/customer-admin-types.ts`:

```ts
  PasswordMigrationRetentionConfigRequest,
  PasswordMigrationRetentionConfigResponse,
```

and append to the end of the file:

```ts
/**
 * The tenant's password-migration retention window (read shape). Every field is
 * optional upstream — an unconfigured tenant answers with an empty object.
 */
export type AdminPasswordMigrationRetention = PasswordMigrationRetentionConfigResponse;
/**
 * Body for `configurePasswordMigrationRetention`. `retentionEndDate` is required.
 * `emailReminderDate` defaults to 7 days before it (or tomorrow, when that would
 * already be past); `emailNotificationsEnabled` defaults to `true`.
 */
export type AdminPasswordMigrationRetentionInput = PasswordMigrationRetentionConfigRequest;
```

- [ ] **Step 4: Add the path helper and the three methods**

In `packages/sdk/src/services/customer-admin.ts`, add both names to the `import type { … }` block **and** to the `export type { … }` re-export block, then add the helper next to `base()`:

```ts
  private configPath(): string {
    return `/customer/${this.ctx.tenant}/config/password-migration-retention`;
  }
```

and this section at the end of the class:

```ts
  // --- Password-migration retention ---

  /**
   * Retrieves the tenant's password-migration retention config. Requires the
   * `customer.import_read` scope. An unconfigured tenant answers with an empty
   * object rather than a 404.
   */
  async getPasswordMigrationRetention(auth: AuthContext = SERVICE): Promise<AdminPasswordMigrationRetention> {
    return this.ctx.http.request<AdminPasswordMigrationRetention>({
      method: "GET",
      path: this.configPath(),
      auth,
    });
  }

  /**
   * Creates or updates the retention config (`POST`). Requires the
   * `customer.import_manage` scope. **Call this before importing customers with
   * `legacyAuth`** — that import is rejected without an active config. Re-POST with
   * an earlier `retentionEndDate` to shorten a running window.
   */
  async configurePasswordMigrationRetention(
    input: AdminPasswordMigrationRetentionInput,
    auth: AuthContext = SERVICE,
  ): Promise<AdminPasswordMigrationRetention> {
    return this.ctx.http.request<AdminPasswordMigrationRetention>({
      method: "POST",
      path: this.configPath(),
      auth,
      body: input,
    });
  }

  /**
   * Removes the retention config. Requires the `customer.import_manage` scope.
   * Intended for after the migration window: when the window ends, unmigrated
   * accounts need a password reset and their legacy credentials are cleared.
   */
  async deletePasswordMigrationRetention(auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({ method: "DELETE", path: this.configPath(), auth });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/customer-admin.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Document it**

Append to `docs/customer-admin.md`, after the «Addresses» section and before the closing `auth`-argument paragraph:

````markdown
## Password-migration retention

Migrating customers from a legacy shop means importing their old password hashes.
To avoid storing those indefinitely, Emporix gates the import behind a **retention
window**: configure one, import inside it, and each legacy hash is silently replaced
with an Emporix hash on that customer's first successful login.

```ts
await client.customerAdmin.configurePasswordMigrationRetention({
  retentionEndDate: "2027-01-31",       // required
  emailReminderDate: "2027-01-24",      // default: 7 days before the end date
  emailNotificationsEnabled: true,      // default: true
});

const config = await client.customerAdmin.getPasswordMigrationRetention();
await client.customerAdmin.deletePasswordMigrationRetention();
```

- **Configure before you import.** An import carrying `legacyAuth` is rejected
  while no active config exists.
- **When the window ends,** remaining unmigrated accounts require a password reset
  and their legacy credentials are cleared. With `emailNotificationsEnabled`, those
  customers get a reset mail, plus a reminder on `emailReminderDate` asking them to
  log in once so the migration can happen quietly.
- **To finish sooner,** re-`POST` the config with an earlier `retentionEndDate`
  rather than deleting it.
- **Scopes:** `customer.import_read` to read, `customer.import_manage` to write or
  delete. A service client without them gets a `403`.
````

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/customer-admin-types.ts \
        packages/sdk/src/services/customer-admin.ts \
        packages/sdk/tests/services/customer-admin.test.ts \
        docs/customer-admin.md
git commit -m "feat(sdk): expose the password-migration retention config"
```

---

### Task 2: Bulk customer import

**Files:**
- Modify: `packages/sdk/src/services/customer-admin-types.ts`
- Modify: `packages/sdk/src/services/customer-admin.ts`
- Modify: `packages/sdk/tests/services/customer-admin.test.ts`
- Modify: `docs/customer-admin.md`

**Interfaces:**
- Consumes: `CustomerImportDto`, `CustomerImportAccountDto`, `LegacyAuth`, `CustomerBulkItemResponse` from `../generated/customer-service`; the `svc()` factory and `server` from Task 1's test file.
- Produces: `AdminCustomerImport`, `AdminCustomerImportAccount`, `AdminCustomerLegacyAuth`, `AdminCustomerImportResult`; method `importCustomers(input: AdminCustomerImport[], auth?)` returning `Promise<AdminCustomerImportResult[]>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/sdk/tests/services/customer-admin.test.ts`:

```ts
const IMPORT = "https://api.emporix.io/customer/acme/customers/import";

describe("CustomerAdminService importCustomers", () => {
  it("POSTs the array to /customers/import and returns the 207 result", async () => {
    let body: unknown = null;
    server.use(
      http.post(IMPORT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ index: 0, id: "C1", code: 201 }], { status: 207 });
      }),
    );
    const results = await svc().importCustomers([
      { account: { email: "a@example.com", passwordHash: "argon2-hash" }, firstName: "Ada" },
    ]);
    expect(body).toEqual([
      { account: { email: "a@example.com", passwordHash: "argon2-hash" }, firstName: "Ada" },
    ]);
    expect(results).toEqual([{ index: 0, id: "C1", code: 201 }]);
  });

  it("surfaces per-item failures from the 207 as data instead of throwing", async () => {
    server.use(
      http.post(IMPORT, () =>
        HttpResponse.json(
          [
            { index: 0, id: "C1", code: 201 },
            { index: 1, code: 409 },
          ],
          { status: 207 },
        ),
      ),
    );
    const results = await svc().importCustomers([
      { account: { email: "a@example.com", passwordHash: "h" } },
      { account: { email: "b@example.com", passwordHash: "h" } },
    ]);
    expect(results).toHaveLength(2);
    expect(results.filter((r) => (r.code ?? 0) >= 400)).toEqual([{ index: 1, code: 409 }]);
  });

  it("accepts a legacyAuth account instead of a passwordHash", async () => {
    let body: unknown = null;
    server.use(
      http.post(IMPORT, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([{ index: 0, id: "C2", code: 201 }], { status: 207 });
      }),
    );
    await svc().importCustomers([
      {
        account: {
          email: "legacy@example.com",
          legacyAuth: { algorithm: "hybris-sha512-uid-salt", hash: "deadbeef" },
        },
      },
    ]);
    expect(body).toEqual([
      {
        account: {
          email: "legacy@example.com",
          legacyAuth: { algorithm: "hybris-sha512-uid-salt", hash: "deadbeef" },
        },
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/customer-admin.test.ts`
Expected: FAIL on the three new tests — `svc(...).importCustomers is not a function`. The three retention tests from Task 1 still pass.

- [ ] **Step 3: Add the type aliases**

Append to the import block in `packages/sdk/src/services/customer-admin-types.ts`:

```ts
  CustomerImportDto,
  CustomerImportAccountDto,
  LegacyAuth,
  CustomerBulkItemResponse,
```

and append to the end of the file:

```ts
/**
 * One customer of the bulk-import body. Extends the create shape with an `account`
 * block; every inherited profile field is optional, so `account.email` is the only
 * hard requirement.
 */
export type AdminCustomerImport = CustomerImportDto;
/**
 * The `account` block of an import item. Provide **exactly one** of `passwordHash`
 * or `legacyAuth` — the type permits both, the service does not.
 */
export type AdminCustomerImportAccount = CustomerImportAccountDto;
/** A legacy password hash carried by an import item. */
export type AdminCustomerLegacyAuth = LegacyAuth;
/**
 * One entry of the `207` import result. `code` is the per-item HTTP status, so a
 * `409` here is a rejected customer inside an otherwise successful call.
 */
export type AdminCustomerImportResult = CustomerBulkItemResponse;
```

- [ ] **Step 4: Add the method**

In `packages/sdk/src/services/customer-admin.ts`, add all four names to the `import type { … }` block **and** to the `export type { … }` re-export block, then add to the class:

```ts
  // --- Bulk import ---

  /**
   * Bulk-imports customers (`POST /customers/import`). Requires the
   * `customer.import_manage` scope.
   *
   * Responds **207 Multi-Status**: per-item failures do **not** throw — inspect each
   * entry's `code`. Each item must carry exactly one of `account.passwordHash` or
   * `account.legacyAuth`, and importing `legacyAuth` requires an active retention
   * config (see `configurePasswordMigrationRetention`).
   */
  async importCustomers(
    input: AdminCustomerImport[],
    auth: AuthContext = SERVICE,
  ): Promise<AdminCustomerImportResult[]> {
    return this.ctx.http.request<AdminCustomerImportResult[]>({
      method: "POST",
      path: `${this.base()}/import`,
      auth,
      body: input,
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/customer-admin.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Document it**

Append to `docs/customer-admin.md`, after the «Password-migration retention» section:

````markdown
## Bulk customer import

```ts
const results = await client.customerAdmin.importCustomers([
  {
    firstName: "Ada",
    lastName: "Lovelace",
    account: { email: "ada@example.com", passwordHash: "<an Emporix-format hash>" },
  },
  {
    account: {
      email: "legacy@example.com",
      legacyAuth: { algorithm: "hybris-sha512-uid-salt", hash: "<legacy hash>" },
    },
  },
]);

const rejected = results.filter((r) => (r.code ?? 0) >= 400);
```

- **207 Multi-Status: partial failures do not throw.** The call resolves and each
  entry carries its own `code`. Code that only catches a rejected promise will
  report a clean import while individual customers were refused — always inspect
  the entries.
- **Exactly one credential per item.** `account.passwordHash` or
  `account.legacyAuth`, never both and never neither.
- **`legacyAuth` needs an active retention config.** See
  [Password-migration retention](#password-migration-retention).
- **Scope:** `customer.import_manage`.

## Why there is no React hook

All four operations above need a service (clientCredentials) token carrying
`customer.import_read` or `customer.import_manage`. There is no customer or
anonymous variant, so nothing here can run in a browser — the same reason the
[Import Service](./import.md) and [Approval Service](./approval.md) have no hooks.
Drive them from a server route, a script, or a job.
````

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/customer-admin-types.ts \
        packages/sdk/src/services/customer-admin.ts \
        packages/sdk/tests/services/customer-admin.test.ts \
        docs/customer-admin.md
git commit -m "feat(sdk): expose bulk customer import"
```

---

### Task 3: Changeset, repo-wide verification and PR

**Files:**
- Create: `.changeset/customer-password-migration.md`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: a pushed branch and an open PR. Nothing downstream.

- [ ] **Step 1: Write the changeset**

Create `.changeset/customer-password-migration.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

feat(sdk): expose the customer password-migration endpoints

`client.customerAdmin` gains the four operations Emporix added to the Customer
Service: `getPasswordMigrationRetention`, `configurePasswordMigrationRetention`
and `deletePasswordMigrationRetention` for the retention window, plus
`importCustomers` for the bulk import.

Together they cover migrating customers off a legacy shop. Configure a retention
window, import customers carrying `legacyAuth`, and each legacy password hash is
replaced with an Emporix hash on that customer's first successful login. Without
an active config the import is rejected — the order matters.

`importCustomers` answers **207 Multi-Status**, so per-item failures arrive as
data with their own `code` rather than throwing. Inspect every entry.

All four need a service token with `customer.import_read` or
`customer.import_manage`, so there are no React hooks — see `docs/customer-admin.md`.
```

- [ ] **Step 2: Verify the changeset gate would pass**

Run: `pnpm changeset status --since=origin/main`
Expected: `@viu/emporix-sdk` listed under «packages to be bumped at minor», exit 0.

- [ ] **Step 3: Run the full repo verification**

Run each and read the output — do not skim:

```bash
pnpm -r test
pnpm typecheck
pnpm -r lint
```

Expected: all green. The sdk suite gains 6 tests over its previous count. If
`typecheck` fails inside `examples/`, build the packages first
(`pnpm -r --filter "./packages/*" build`) — the examples compile against `dist/`.

- [ ] **Step 4: Commit and push**

```bash
git add .changeset/customer-password-migration.md
git commit -m "chore(sdk): add changeset for the password-migration endpoints"
git push origin feat/customer-password-migration
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --base main --head feat/customer-password-migration \
  --title "feat(sdk): expose the customer password-migration endpoints"
```

The body must state: the four operations and their scopes; that the retention
config is a precondition for a `legacyAuth` import; that `importCustomers` answers
207 and does not throw on per-item failures; the test counts actually observed; and
that **nothing is verified against a live tenant** (see below).

**Do not merge the PR.**

---

## Verification gap — state it, do not paper over it

Every test here is MSW-mocked. That proves the SDK sends the right method, path,
body and token, and that a 207 body is returned rather than thrown. It proves
**nothing** about the tenant's behaviour:

- Whether the `viu` tenant's service client actually holds `customer.import_read`
  and `customer.import_manage`. If it does not, every one of these calls answers
  `403` and no unit test would have noticed.
- Whether an unconfigured tenant really answers `200` with an empty object rather
  than `404`. The spec implies the former; only a live call settles it.
- The real rejection code when `legacyAuth` is imported without an active config.

A live check needs a sandbox tenant and a service client with those scopes. Until
then the PR should say so plainly rather than implying end-to-end confidence.
