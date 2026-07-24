# IAM CRUD Facade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `client.iam` — a CRUD facade for the current IAM admin surface (users, user-groups, access-controls, scopes) — and route `customer-groups.ts` through it, without exposing any deprecated endpoint.

**Architecture:** One `IamService` (channel `"iam"`, already in the `ServiceName` union) with four sub-resources exposed as `readonly` object literals (`users`, `groups`, `accessControls`, `scopes`), mirroring the `customer.addresses` pattern (arrow-fn methods capture `this.ctx`). Every method takes a required trailing `auth: AuthContext` and wraps one live endpoint via `ctx.http.request`. `CustomerGroupsService` gains a private `IamService` and delegates `listForCompany`/`addMember` to it; `removeMember` is untouched.

**Tech Stack:** TypeScript, generated `iam` types (`src/generated/iam`), Vitest with `vi.fn()`-mocked `http.request` (no MSW/token-provider needed — the facade is a thin request builder), `expectTypeOf` for type-level checks.

## Global Constraints

- Backward-compatible: only add `IamService`; `customerGroups` public API (`listForCompany`/`addMember`/`removeMember`) stays identical.
- Never hand-author wire shapes — alias generated types from `src/generated/iam/types.gen.ts`.
- **No deprecated surface:** do NOT wrap `/roles`, `/permissions`, `/resources`, `/templates`, nor `list-user-access-controls`, `retrieve-user-group` (user-side), `list-users-with-groups-vendor`, nor the deprecated per-user `DELETE /groups/{groupId}/users/{userId}`.
- All `iam.*` methods end with a required `auth: AuthContext` (no default).
- List methods return plain arrays (the endpoint body is an array; pagination is via query params + `X-Total-Count`), matching `customerGroups.listForCompany`.
- Commit scope: `sdk`. Subject first word a lowercase verb. Footer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Verify: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/iam.test.ts` (single file); `pnpm -F @viu/emporix-sdk build`; `pnpm -r test`; `pnpm typecheck`.
- Test tenant `acme`; test auth `const AUTH = { kind: "raw", token: "T" } as const;` (raw passes the token straight through as the bearer — no token-provider call).

## File Structure

- Create `packages/sdk/src/services/iam-types.ts` — public type aliases over `generated/iam`.
- Create `packages/sdk/src/services/iam.ts` — `IamService` + four sub-resources.
- Modify `packages/sdk/src/client.ts` — register `readonly iam`.
- Modify `packages/sdk/src/index.ts` — export `IamService` + public types.
- Modify `packages/sdk/src/services/customer-groups.ts` — delegate to `iam`.
- Create `packages/sdk/tests/services/iam.test.ts` — vi-mock unit tests.
- Modify `packages/sdk/tests/services/customer-groups.test.ts` — delegation assertions.

---

## Task 1: Types + service scaffold + wiring

**Files:** Create `iam-types.ts`, `iam.ts`; Modify `client.ts`, `index.ts`; Test `tests/services/iam.test.ts`.

**Interfaces:**
- Produces `IamService` (channel `"iam"`) with empty-but-present `users`/`groups`/`accessControls`/`scopes`; public types (see below).

- [ ] **Step 1: Write the failing test** (`tests/services/iam.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";
import { IamService } from "../../src/services/iam";

const AUTH = { kind: "raw", token: "T" } as const;

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof IamService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("IamService scaffold", () => {
  it("exposes the four sub-resources", () => {
    const iam = new IamService(ctxWith(vi.fn()));
    expect(typeof iam.users).toBe("object");
    expect(typeof iam.groups).toBe("object");
    expect(typeof iam.accessControls).toBe("object");
    expect(typeof iam.scopes).toBe("object");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find module '../../src/services/iam'`)

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/iam.test.ts`

- [ ] **Step 3: Implement**

Create `iam-types.ts`:

```ts
import type {
  UserResponse,
  UserExtendedResponse,
  UserCreateRequest,
  UserUpdateRequest,
  UserScopesResponse,
  UserIdResponse,
  GroupsQueryDocument,
  GroupCreateRequest,
  GroupUpdateRequest,
  GroupIdResponse,
  AssignmentCreateRequest,
  AssignmentIdResponse,
  AccessControlQueryDocument,
  AccessControlUpsertRequest,
  AccessControlIdResponse,
  CustomScopeQueryDocument,
  CustomScopeUpsertRequest,
  CustomScopeIdResponse,
} from "../generated/iam";

/** A user as returned by IAM (list item / summary). */
export type IamUser = UserResponse;
/** A user with its group memberships (single-user GET). */
export type IamUserDetail = UserExtendedResponse;
export type IamUserCreate = UserCreateRequest;
export type IamUserUpdate = UserUpdateRequest;
export type IamUserScopes = UserScopesResponse;
export type IamUserCreated = UserIdResponse;

/** A user group. */
export type IamGroup = GroupsQueryDocument;
export type IamGroupCreate = GroupCreateRequest;
export type IamGroupUpdate = GroupUpdateRequest;
export type IamGroupCreated = GroupIdResponse;
/** Body to add/assign a user to a group. */
export type IamGroupMemberInput = AssignmentCreateRequest;
export type IamGroupMemberCreated = AssignmentIdResponse;

export type IamAccessControl = AccessControlQueryDocument;
export type IamAccessControlUpsert = AccessControlUpsertRequest;
export type IamAccessControlCreated = AccessControlIdResponse;

export type IamScope = CustomScopeQueryDocument;
export type IamScopeUpsert = CustomScopeUpsertRequest;
export type IamScopeCreated = CustomScopeIdResponse;
```

> Confirm each alias name against `generated/iam` while wiring — if a create/upsert response differs (id-object vs entity vs 204), adjust the alias here and the method's return type together. Runtime is unaffected (the `request<T>` generic is a cast).

Create `iam.ts` (scaffold — sub-resources filled in later tasks):

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  IamUser, IamUserDetail, IamUserCreate, IamUserUpdate, IamUserScopes, IamUserCreated,
  IamGroup, IamGroupCreate, IamGroupUpdate, IamGroupCreated, IamGroupMemberInput, IamGroupMemberCreated,
  IamAccessControl, IamAccessControlUpsert, IamAccessControlCreated,
  IamScope, IamScopeUpsert, IamScopeCreated,
} from "./iam-types";

export type * from "./iam-types";

/**
 * IAM admin CRUD: users, user-groups, access-controls, scopes. Every method
 * requires an explicit `auth` (admin/service token; `getMe*` take the caller's
 * customer token). The deprecated legacy-RBAC model (roles/permissions/
 * resources/templates) is intentionally not wrapped.
 */
export class IamService {
  static readonly channel = "iam" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/iam/${this.ctx.tenant}`;
  }

  readonly users = {
    // filled in Task 4
  };

  readonly groups = {
    // filled in Task 5
  };

  readonly accessControls = {
    // filled in Task 2
  };

  readonly scopes = {
    // filled in Task 3
  };
}
```

In `client.ts`: add `import { IamService } from "./services/iam";`, a field `readonly iam: IamService;`, and in the constructor `this.iam = new IamService(mk(IamService.channel));` (next to `this.customerGroups = …`).

In `index.ts`: `export { IamService } from "./services/iam";` and `export type { IamUser, IamUserDetail, IamUserCreate, IamUserUpdate, IamUserScopes, IamUserCreated, IamGroup, IamGroupCreate, IamGroupUpdate, IamGroupCreated, IamGroupMemberInput, IamGroupMemberCreated, IamAccessControl, IamAccessControlUpsert, IamAccessControlCreated, IamScope, IamScopeUpsert, IamScopeCreated } from "./services/iam";`

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/iam.ts packages/sdk/src/services/iam-types.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/iam.test.ts
git commit -m "feat(sdk): scaffold IamService (client.iam) + types + wiring"
```

---

## Task 2: `iam.accessControls`

**Files:** Modify `iam.ts`; Test `iam.test.ts`.
**Interfaces:** Produces `accessControls.{list,get,upsert,delete}`.

- [ ] **Step 1: Failing test** — add to `iam.test.ts`:

```ts
describe("iam.accessControls", () => {
  const iam = () => new IamService(ctxWith(req));
  let req: ReturnType<typeof vi.fn>;

  it("list GETs /access-controls with the bearer", async () => {
    req = vi.fn().mockResolvedValue([{ id: "ac1" }]);
    const r = await new IamService(ctxWith(req)).accessControls.list(AUTH);
    expect(r[0]?.id).toBe("ac1");
    expect(req).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET", path: "/iam/acme/access-controls", auth: AUTH,
    }));
  });

  it("get / upsert / delete hit /access-controls/{id}", async () => {
    const g = vi.fn().mockResolvedValue({ id: "ac1" });
    await new IamService(ctxWith(g)).accessControls.get("ac1", AUTH);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/access-controls/ac1" }));

    const u = vi.fn().mockResolvedValue({ id: "ac1" });
    await new IamService(ctxWith(u)).accessControls.upsert("ac1", { } as never, AUTH);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/iam/acme/access-controls/ac1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(d)).accessControls.delete("ac1", AUTH);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/iam/acme/access-controls/ac1" }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — fill `readonly accessControls` in `iam.ts`:

```ts
readonly accessControls = {
  list: async (auth: AuthContext): Promise<IamAccessControl[]> =>
    this.ctx.http.request<IamAccessControl[]>({
      method: "GET", path: `${this.base()}/access-controls`, auth,
    }),
  get: async (id: string, auth: AuthContext): Promise<IamAccessControl> =>
    this.ctx.http.request<IamAccessControl>({
      method: "GET", path: `${this.base()}/access-controls/${id}`, auth,
    }),
  upsert: async (id: string, input: IamAccessControlUpsert, auth: AuthContext): Promise<IamAccessControlCreated> =>
    this.ctx.http.request<IamAccessControlCreated>({
      method: "PUT", path: `${this.base()}/access-controls/${id}`, auth, body: input,
    }),
  delete: async (id: string, auth: AuthContext): Promise<void> => {
    await this.ctx.http.request<void>({
      method: "DELETE", path: `${this.base()}/access-controls/${id}`, auth,
    });
  },
};
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/iam.ts packages/sdk/tests/services/iam.test.ts
git commit -m "feat(sdk): add iam.accessControls CRUD"
```

---

## Task 3: `iam.scopes`

**Files:** Modify `iam.ts`; Test `iam.test.ts`.
**Interfaces:** Produces `scopes.{list,get,upsertCustom,deleteCustom}`.

- [ ] **Step 1: Failing test** — add to `iam.test.ts`:

```ts
describe("iam.scopes", () => {
  it("list / get / upsertCustom / deleteCustom", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "s1" }]);
    await new IamService(ctxWith(l)).scopes.list(AUTH);
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/scopes" }));

    const g = vi.fn().mockResolvedValue({ id: "s1" });
    await new IamService(ctxWith(g)).scopes.get("s1", AUTH);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/scopes/s1" }));

    const u = vi.fn().mockResolvedValue({ id: "s1" });
    await new IamService(ctxWith(u)).scopes.upsertCustom("s1", {} as never, AUTH);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/iam/acme/scopes/s1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(d)).scopes.deleteCustom("s1", AUTH);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/iam/acme/scopes/s1" }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — fill `readonly scopes`:

```ts
readonly scopes = {
  list: async (auth: AuthContext): Promise<IamScope[]> =>
    this.ctx.http.request<IamScope[]>({
      method: "GET", path: `${this.base()}/scopes`, auth,
    }),
  get: async (scopeId: string, auth: AuthContext): Promise<IamScope> =>
    this.ctx.http.request<IamScope>({
      method: "GET", path: `${this.base()}/scopes/${scopeId}`, auth,
    }),
  upsertCustom: async (scopeId: string, input: IamScopeUpsert, auth: AuthContext): Promise<IamScopeCreated> =>
    this.ctx.http.request<IamScopeCreated>({
      method: "PUT", path: `${this.base()}/scopes/${scopeId}`, auth, body: input,
    }),
  deleteCustom: async (scopeId: string, auth: AuthContext): Promise<void> => {
    await this.ctx.http.request<void>({
      method: "DELETE", path: `${this.base()}/scopes/${scopeId}`, auth,
    });
  },
};
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/iam.ts packages/sdk/tests/services/iam.test.ts
git commit -m "feat(sdk): add iam.scopes CRUD"
```

---

## Task 4: `iam.users`

**Files:** Modify `iam.ts`; Test `iam.test.ts`.
**Interfaces:** Produces `users.{list,create,get,getMe,update,delete,getGroups,getScopes,getMyScopes,getAccessControls,getMyAccessControls}`.

- [ ] **Step 1: Failing test** — add to `iam.test.ts`:

```ts
describe("iam.users", () => {
  it("core CRUD hits the right method/path", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "u1" }]);
    await new IamService(ctxWith(l)).users.list(AUTH);
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/users" }));

    const c = vi.fn().mockResolvedValue({ id: "u1" });
    await new IamService(ctxWith(c)).users.create({} as never, AUTH);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/iam/acme/users" }));

    const g = vi.fn().mockResolvedValue({ id: "u1" });
    await new IamService(ctxWith(g)).users.get("u1", AUTH);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/users/u1" }));

    const me = vi.fn().mockResolvedValue({ id: "me" });
    await new IamService(ctxWith(me)).users.getMe(AUTH);
    expect(me).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/users/me" }));

    const u = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(u)).users.update("u1", {} as never, AUTH);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/iam/acme/users/u1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(d)).users.delete("u1", AUTH);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/iam/acme/users/u1" }));
  });

  it("scoped reads hit the right sub-paths", async () => {
    const cases: [(iam: IamService) => Promise<unknown>, string][] = [
      [(i) => i.users.getGroups("u1", AUTH), "/iam/acme/users/u1/groups"],
      [(i) => i.users.getScopes("u1", AUTH), "/iam/acme/users/u1/scopes"],
      [(i) => i.users.getMyScopes(AUTH), "/iam/acme/users/me/scopes"],
      [(i) => i.users.getAccessControls("u1", AUTH), "/iam/acme/users/u1/access-controls"],
      [(i) => i.users.getMyAccessControls(AUTH), "/iam/acme/users/me/access-controls"],
    ];
    for (const [call, path] of cases) {
      const r = vi.fn().mockResolvedValue([]);
      await call(new IamService(ctxWith(r)));
      expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path }));
    }
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — fill `readonly users`:

```ts
readonly users = {
  list: async (auth: AuthContext, query?: Record<string, string | number>): Promise<IamUser[]> =>
    this.ctx.http.request<IamUser[]>({
      method: "GET", path: `${this.base()}/users`, auth, ...(query ? { query } : {}),
    }),
  create: async (input: IamUserCreate, auth: AuthContext): Promise<IamUserCreated> =>
    this.ctx.http.request<IamUserCreated>({
      method: "POST", path: `${this.base()}/users`, auth, body: input,
    }),
  get: async (userId: string, auth: AuthContext): Promise<IamUserDetail> =>
    this.ctx.http.request<IamUserDetail>({
      method: "GET", path: `${this.base()}/users/${userId}`, auth,
    }),
  getMe: async (auth: AuthContext): Promise<IamUserDetail> =>
    this.ctx.http.request<IamUserDetail>({
      method: "GET", path: `${this.base()}/users/me`, auth,
    }),
  update: async (userId: string, input: IamUserUpdate, auth: AuthContext): Promise<void> => {
    await this.ctx.http.request<void>({
      method: "PUT", path: `${this.base()}/users/${userId}`, auth, body: input,
    });
  },
  delete: async (userId: string, auth: AuthContext): Promise<void> => {
    await this.ctx.http.request<void>({
      method: "DELETE", path: `${this.base()}/users/${userId}`, auth,
    });
  },
  getGroups: async (userId: string, auth: AuthContext): Promise<IamGroup[]> =>
    this.ctx.http.request<IamGroup[]>({
      method: "GET", path: `${this.base()}/users/${userId}/groups`, auth,
    }),
  getScopes: async (userId: string, auth: AuthContext): Promise<IamUserScopes> =>
    this.ctx.http.request<IamUserScopes>({
      method: "GET", path: `${this.base()}/users/${userId}/scopes`, auth,
    }),
  getMyScopes: async (auth: AuthContext): Promise<IamUserScopes> =>
    this.ctx.http.request<IamUserScopes>({
      method: "GET", path: `${this.base()}/users/me/scopes`, auth,
    }),
  getAccessControls: async (userId: string, auth: AuthContext): Promise<IamAccessControl[]> =>
    this.ctx.http.request<IamAccessControl[]>({
      method: "GET", path: `${this.base()}/users/${userId}/access-controls`, auth,
    }),
  getMyAccessControls: async (auth: AuthContext): Promise<IamAccessControl[]> =>
    this.ctx.http.request<IamAccessControl[]>({
      method: "GET", path: `${this.base()}/users/me/access-controls`, auth,
    }),
};
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/iam.ts packages/sdk/tests/services/iam.test.ts
git commit -m "feat(sdk): add iam.users CRUD + scoped reads"
```

---

## Task 5: `iam.groups`

**Files:** Modify `iam.ts`; Test `iam.test.ts`.
**Interfaces:** Produces `groups.{list,create,get,update,delete,listUsers,addUser,updateUser,removeAllUsers,listAccessControls}`. (No per-user `removeUser` — deprecated.)

- [ ] **Step 1: Failing test** — add to `iam.test.ts`:

```ts
describe("iam.groups", () => {
  it("group CRUD", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "g1" }]);
    await new IamService(ctxWith(l)).groups.list(AUTH, { "b2b.legalEntityId": "le1" });
    expect(l).toHaveBeenCalledWith(expect.objectContaining({
      method: "GET", path: "/iam/acme/groups", query: { "b2b.legalEntityId": "le1" },
    }));

    const c = vi.fn().mockResolvedValue({ id: "g1" });
    await new IamService(ctxWith(c)).groups.create({} as never, AUTH);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/iam/acme/groups" }));

    const g = vi.fn().mockResolvedValue({ id: "g1" });
    await new IamService(ctxWith(g)).groups.get("g1", AUTH);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/groups/g1" }));

    const u = vi.fn().mockResolvedValue({ id: "g1" });
    await new IamService(ctxWith(u)).groups.update("g1", {} as never, AUTH);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/iam/acme/groups/g1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(d)).groups.delete("g1", AUTH);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/iam/acme/groups/g1" }));
  });

  it("membership + access-controls", async () => {
    const lu = vi.fn().mockResolvedValue([{ id: "u1" }]);
    await new IamService(ctxWith(lu)).groups.listUsers("g1", AUTH);
    expect(lu).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/groups/g1/users" }));

    const a = vi.fn().mockResolvedValue({ id: "as1" });
    await new IamService(ctxWith(a)).groups.addUser("g1", {} as never, AUTH);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/iam/acme/groups/g1/users" }));

    const uu = vi.fn().mockResolvedValue({ id: "as1" });
    await new IamService(ctxWith(uu)).groups.updateUser("g1", "employee", "u1", {} as never, AUTH);
    expect(uu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/iam/acme/groups/g1/users/employee/u1" }));

    const ra = vi.fn().mockResolvedValue(undefined);
    await new IamService(ctxWith(ra)).groups.removeAllUsers("g1", AUTH);
    expect(ra).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/iam/acme/groups/g1/users" }));

    const lac = vi.fn().mockResolvedValue([{ id: "ac1" }]);
    await new IamService(ctxWith(lac)).groups.listAccessControls("g1", AUTH);
    expect(lac).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/iam/acme/groups/g1/access-controls" }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — fill `readonly groups`:

```ts
readonly groups = {
  list: async (auth: AuthContext, query?: Record<string, string | number>): Promise<IamGroup[]> =>
    this.ctx.http.request<IamGroup[]>({
      method: "GET", path: `${this.base()}/groups`, auth, ...(query ? { query } : {}),
    }),
  create: async (input: IamGroupCreate, auth: AuthContext): Promise<IamGroupCreated> =>
    this.ctx.http.request<IamGroupCreated>({
      method: "POST", path: `${this.base()}/groups`, auth, body: input,
    }),
  get: async (groupId: string, auth: AuthContext): Promise<IamGroup> =>
    this.ctx.http.request<IamGroup>({
      method: "GET", path: `${this.base()}/groups/${groupId}`, auth,
    }),
  update: async (groupId: string, input: IamGroupUpdate, auth: AuthContext): Promise<void> => {
    await this.ctx.http.request<void>({
      method: "PUT", path: `${this.base()}/groups/${groupId}`, auth, body: input,
    });
  },
  delete: async (groupId: string, auth: AuthContext): Promise<void> => {
    await this.ctx.http.request<void>({
      method: "DELETE", path: `${this.base()}/groups/${groupId}`, auth,
    });
  },
  listUsers: async (groupId: string, auth: AuthContext): Promise<IamUser[]> =>
    this.ctx.http.request<IamUser[]>({
      method: "GET", path: `${this.base()}/groups/${groupId}/users`, auth,
    }),
  addUser: async (groupId: string, input: IamGroupMemberInput, auth: AuthContext): Promise<IamGroupMemberCreated> =>
    this.ctx.http.request<IamGroupMemberCreated>({
      method: "POST", path: `${this.base()}/groups/${groupId}/users`, auth, body: input,
    }),
  updateUser: async (
    groupId: string, userType: string, userId: string, input: IamGroupMemberInput, auth: AuthContext,
  ): Promise<IamGroupMemberCreated> =>
    this.ctx.http.request<IamGroupMemberCreated>({
      method: "PUT", path: `${this.base()}/groups/${groupId}/users/${userType}/${userId}`, auth, body: input,
    }),
  removeAllUsers: async (groupId: string, auth: AuthContext): Promise<void> => {
    await this.ctx.http.request<void>({
      method: "DELETE", path: `${this.base()}/groups/${groupId}/users`, auth,
    });
  },
  listAccessControls: async (groupId: string, auth: AuthContext): Promise<IamAccessControl[]> =>
    this.ctx.http.request<IamAccessControl[]>({
      method: "GET", path: `${this.base()}/groups/${groupId}/access-controls`, auth,
    }),
};
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/iam.ts packages/sdk/tests/services/iam.test.ts
git commit -m "feat(sdk): add iam.groups CRUD + membership"
```

---

## Task 6: Route `customer-groups` through `iam`

**Files:** Modify `customer-groups.ts`; Test `tests/services/customer-groups.test.ts`.

**Interfaces:**
- Consumes `IamService.groups.list`/`.addUser`.
- Produces: `CustomerGroupsService` public API unchanged (`listForCompany`, `addMember`, `removeMember`).

- [ ] **Step 1: Update tests** — the existing `customer-groups.test.ts` asserts the same paths; confirm they still pass and add a delegation guard. Add:

```ts
it("listForCompany forwards the b2b.legalEntityId query (delegated to iam.groups.list)", async () => {
  server.use(
    http.get("https://api.emporix.io/iam/acme/groups", ({ request }) => {
      const q = new URL(request.url).searchParams.get("b2b.legalEntityId");
      return HttpResponse.json([{ id: "g1", legalEntityId: q }]);
    }),
  );
  const r = await harness().listForCompany("le-1", CUST);
  expect(r[0]?.id).toBe("g1");
});
```

(Reuse the file's existing `harness()`/`server`/`CUST`. The existing `addMember`/`removeMember` tests remain valid — the paths are unchanged.)

- [ ] **Step 2: Run — expect the existing tests to still pass; new one FAIL only if paths drift**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/customer-groups.test.ts`

- [ ] **Step 3: Implement** — refactor `customer-groups.ts` to delegate:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { GroupsQueryDocument, AssignmentCreateRequest } from "../generated/iam";
import { IamService } from "./iam";

/**
 * Access to IAM customer groups for a legal entity. Thin B2B-friendly wrapper
 * over {@link IamService.groups}; kept for backward compatibility.
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
    return this.iam.groups.addUser(groupId, member, auth);
  }

  /**
   * Removes a user from a group. Uses `DELETE …/groups/{groupId}/users/{userId}`
   * directly — this endpoint is deprecated upstream and intentionally not
   * exposed on `IamService`, so it is not delegated. No non-deprecated
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
```

> `addMember`'s return type stays `{ id: string }` (its original public signature); `iam.groups.addUser` returns `IamGroupMemberCreated` (an `AssignmentIdResponse` — an `{ id }`-shaped object), which is assignable. If typecheck complains, wrap: `const r = await this.iam.groups.addUser(...); return { id: r.id };`.

- [ ] **Step 4: Run — expect PASS** (whole customer-groups suite green)
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer-groups.ts packages/sdk/tests/services/customer-groups.test.ts
git commit -m "refactor(sdk): route customerGroups list/add through iam.groups"
```

---

## Task 7: Finalize — verify, changeset, PR

**Files:** Create `.changeset/iam-crud-facade.md`.

- [ ] **Step 1: Build + full test + typecheck**

Run: `pnpm -F @viu/emporix-sdk build && pnpm -r test && pnpm typecheck` — all green.

- [ ] **Step 2: Changeset**

Create `.changeset/iam-crud-facade.md`:

```markdown
---
"@viu/emporix-sdk": minor
---

Add `client.iam` — a CRUD facade for the current IAM admin surface: `iam.users`
(list/create/get/getMe/update/delete + group/scope/access-control reads),
`iam.groups` (CRUD + membership + access-controls), `iam.accessControls`
(list/get/upsert/delete), `iam.scopes` (list/get/upsertCustom/deleteCustom).
Every method takes a required `auth`. `client.customerGroups` now delegates its
list/add operations to `iam.groups` (public API unchanged). The deprecated
legacy-RBAC model (roles/permissions/resources/templates) is not wrapped.
```

- [ ] **Step 3: Commit**

```bash
git add .changeset/iam-crud-facade.md
git commit -m "chore(sdk): add changeset for iam crud facade"
```

- [ ] **Step 4: Push + PR** (base `main`, branch `feat/iam-crud-facade`). PR body summarizes the sub-resources + the customer-groups delegation + the deprecated exclusions; ends with the Claude Code footer.

---

## Self-review checklist for the implementer

- Confirm each generated alias in `iam-types.ts` resolves (build). If a create/upsert response or an update's 204-vs-body differs from the plan's guess, adjust the alias **and** the method return type together — runtime is unaffected.
- Verify `getMe`/`getMyScopes`/`getMyAccessControls` paths are `/users/me…` (own-context; caller passes a customer token at runtime).
- Ensure NO deprecated endpoint slipped in (no `removeUser`, no `/roles|/permissions|/resources|/templates`).
- `customerGroups` public signatures byte-for-byte unchanged.
