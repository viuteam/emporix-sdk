# Site-Settings Admin CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 11 missing site-settings operations to `SiteService` — site create/update/replace/delete, the site-codes read, and the six-method `mixins` sub-resource — completing coverage of `packages/sdk/specs/site-settings-service.yml`.

**Architecture:** Flat methods on the existing class plus a `readonly mixins = {…}` sub-resource of arrow functions. Writes default to a new `SERVICE` const; new reads default to the existing `ANON`. New public types are aliases in `site-types.ts`, re-exported from `services/site.ts` and listed in `index.ts`. No client wiring, no constructor change.

**Tech Stack:** TypeScript, Vitest (`vi.fn()`-mocked `http.request`), `@hey-api/openapi-ts`-generated types under `src/generated/site-settings-service`.

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (additive).
- HTTP: `this.ctx.http.request<T>({ method, path, query?, body?, auth })`. Paths inline: `` `/site/${this.ctx.tenant}/…` `` (no `base()` helper in this service).
- **The auth parameter must be named `authCtx`, never `auth`** — `auth` is the imported helper module in this file (`import { auth, type AuthContext }`), so shadowing it breaks `auth.service()`. Same trap as the payment service in #171.
- Auth: `const ANON: AuthContext = auth.anonymous()` exists at line 7. Add `const SERVICE: AuthContext = auth.service()` beside it. Writes end with `authCtx: AuthContext = SERVICE`; new reads end with `authCtx: AuthContext = ANON`.
- `update`/`replace` return **`void`** — both respond 200 with no defined body schema (generated `unknown`).
- Commitlint: `site` is NOT in the scope allowlist — use scope **`sdk`**. Subject's first word must be a lowercase verb.
- Do NOT modify `list`, `get`, `current`, or the existing `Site` type.

## File Structure

- **Modify** `packages/sdk/src/services/site-types.ts` — add 5 type aliases beside the existing `Site`.
- **Modify** `packages/sdk/src/services/site.ts` — extend the type import + re-export block, add the `SERVICE` const, add 5 flat methods and the `mixins` sub-resource (the class's closing `}` is at line 50).
- **Modify** `packages/sdk/src/index.ts:185` — extend the `./services/site` type export.
- **Create** `packages/sdk/tests/services/site-admin.test.ts`.
- **Create** `.changeset/site-settings-admin-crud.md`.

---

### Task 1: Types + site writes + codes read

**Files:**
- Modify: `packages/sdk/src/services/site-types.ts`
- Modify: `packages/sdk/src/services/site.ts` (imports lines 1-5; `SERVICE` after line 7; methods appended before the class's closing `}` on line 50)
- Modify: `packages/sdk/src/index.ts:185`
- Test: `packages/sdk/tests/services/site-admin.test.ts` (create)

**Interfaces:**
- Consumes: existing `SiteService(ctx)`, `auth` helper, `ANON`, `Site`.
- Produces (all 5 aliases, so Task 2 needs no type work):
  - `type SiteInput`, `SiteCreated`, `SiteMixin`, `SiteMixins`, `SiteMixinCreated`
  - `create(input: SiteInput, authCtx?: AuthContext): Promise<SiteCreated>`
  - `update(siteCode: string, input: SiteInput, authCtx?: AuthContext): Promise<void>`
  - `replace(siteCode: string, input: SiteInput, options?: { expand?: string }, authCtx?: AuthContext): Promise<void>`
  - `delete(siteCode: string, authCtx?: AuthContext): Promise<void>`
  - `listCodes(authCtx?: AuthContext): Promise<string[]>`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/services/site-admin.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { SiteService } from "../../src/services/site";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof SiteService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): SiteService => new SiteService(ctxWith(req));
const S = "/site/acme/sites";

describe("SiteService writes", () => {
  it("create/update/replace/delete hit the right method+path with SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue({ id: "main" });
    await svc(c).create({} as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: S, body: {}, auth: { kind: "service" } }),
    );

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).update("main", {} as never);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PATCH", path: `${S}/main`, body: {}, auth: { kind: "service" } }),
    );

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).replace("main", {} as never);
    expect(r).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${S}/main`, body: {}, auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("main");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${S}/main`, auth: { kind: "service" } }),
    );
  });

  it("replace sends the expand query only when given", async () => {
    const withExpand = vi.fn().mockResolvedValue(undefined);
    await svc(withExpand).replace("main", {} as never, { expand: "mixins" });
    expect(withExpand).toHaveBeenCalledWith(expect.objectContaining({ query: { expand: "mixins" } }));

    const without = vi.fn().mockResolvedValue(undefined);
    await svc(without).replace("main", {} as never);
    expect(without.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });

  it("listCodes GETs /siteslist with the ANON default", async () => {
    const l = vi.fn().mockResolvedValue(["main", "ch"]);
    const res = await svc(l).listCodes();
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/site/acme/siteslist", auth: { kind: "anonymous" } }),
    );
    expect(res).toEqual(["main", "ch"]);
  });

  it("honors an explicit auth override", async () => {
    const c = vi.fn().mockResolvedValue({ id: "main" });
    await svc(c).create({} as never, { kind: "raw", token: "X" });
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- site-admin`
Expected: FAIL — `create` / `update` / `replace` / `delete` / `listCodes` are not functions.

- [ ] **Step 3: Add the type aliases**

In `packages/sdk/src/services/site-types.ts`, replace the import line:

```ts
import type { SiteDto, AddressDto, HomeBaseDto } from "../generated/site-settings-service";
```

with:

```ts
import type {
  SiteDto,
  AddressDto,
  HomeBaseDto,
  ResourceLocation,
  Mixin,
  Mixins,
} from "../generated/site-settings-service";
```

and append at the end of the file (after the existing `Site` type):

```ts
/**
 * Body for creating or updating a site. This is the raw generated `SiteDto`
 * (with `active`/`default` optional) — unlike the read-side {@link Site},
 * which re-tightens both to required.
 */
export type SiteInput = SiteDto;

/** Id/location envelope returned when a site is created. */
export type SiteCreated = ResourceLocation;

/**
 * A single site mixin group's content. The spec defines no structure — it is an
 * open map of keys to values.
 */
export type SiteMixin = Mixin;

/** All mixin groups of a site, as a map of group name to content. */
export type SiteMixins = Mixins;

/** Id/location envelope returned when a site mixin is created. */
export type SiteMixinCreated = ResourceLocation;
```

- [ ] **Step 4: Update the service imports/re-exports and add the SERVICE const**

In `packages/sdk/src/services/site.ts`, replace lines 1-7:

```ts
import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import type { Site } from "./site-types";

export type { Site, SiteAddress, SiteHomeBase } from "./site-types";

const ANON: AuthContext = auth.anonymous();
```

with:

```ts
import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";
import type {
  Site,
  SiteInput,
  SiteCreated,
  SiteMixin,
  SiteMixins,
  SiteMixinCreated,
} from "./site-types";

export type {
  Site,
  SiteAddress,
  SiteHomeBase,
  SiteInput,
  SiteCreated,
  SiteMixin,
  SiteMixins,
  SiteMixinCreated,
} from "./site-types";

const ANON: AuthContext = auth.anonymous();
const SERVICE: AuthContext = auth.service();
```

- [ ] **Step 5: Add the write methods and the codes read**

Append inside the `SiteService` class — after `current` and before the class's closing `}`:

```ts
  /** Lists just the tenant's site codes (`GET /siteslist`). Default auth: anonymous. */
  async listCodes(authCtx: AuthContext = ANON): Promise<string[]> {
    return this.ctx.http.request<string[]>({
      method: "GET",
      path: `/site/${this.ctx.tenant}/siteslist`,
      auth: authCtx,
    });
  }

  // --- Admin writes. Default auth: service. ---

  /** Creates a site (`POST /sites`). Default auth: service. */
  async create(input: SiteInput, authCtx: AuthContext = SERVICE): Promise<SiteCreated> {
    return this.ctx.http.request<SiteCreated>({
      method: "POST",
      path: `/site/${this.ctx.tenant}/sites`,
      body: input,
      auth: authCtx,
    });
  }

  /**
   * Partially updates a site (`PATCH /sites/{siteCode}`). The endpoint responds
   * 200 without a defined body, so nothing is returned — re-read with
   * {@link get} when the updated site is needed. Default auth: service.
   */
  async update(siteCode: string, input: SiteInput, authCtx: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `/site/${this.ctx.tenant}/sites/${siteCode}`,
      body: input,
      auth: authCtx,
    });
  }

  /**
   * Full-replaces a site (`PUT /sites/{siteCode}`). Like {@link update} it
   * returns nothing (200 with no defined body). `options.expand` is forwarded as
   * a query parameter. Default auth: service.
   */
  async replace(
    siteCode: string,
    input: SiteInput,
    options: { expand?: string } = {},
    authCtx: AuthContext = SERVICE,
  ): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `/site/${this.ctx.tenant}/sites/${siteCode}`,
      ...(options.expand === undefined ? {} : { query: { expand: options.expand } }),
      body: input,
      auth: authCtx,
    });
  }

  /** Deletes a site (`DELETE /sites/{siteCode}`). Default auth: service. */
  async delete(siteCode: string, authCtx: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/site/${this.ctx.tenant}/sites/${siteCode}`,
      auth: authCtx,
    });
  }
```

- [ ] **Step 6: Export the new types**

In `packages/sdk/src/index.ts`, replace line 185:

```ts
export type { Site } from "./services/site";
```

with:

```ts
export type {
  Site,
  SiteInput,
  SiteCreated,
  SiteMixin,
  SiteMixins,
  SiteMixinCreated,
} from "./services/site";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- site-admin`
Expected: PASS (4 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/services/site-types.ts packages/sdk/src/services/site.ts packages/sdk/src/index.ts packages/sdk/tests/services/site-admin.test.ts
git commit -m "feat(sdk): add site write crud and site-codes read"
```

---

### Task 2: `sites.mixins` sub-resource

**Files:**
- Modify: `packages/sdk/src/services/site.ts` (`mixins` member appended after `delete`)
- Test: `packages/sdk/tests/services/site-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `SiteMixin`, `SiteMixins`, `SiteMixinCreated` from Task 1, `SERVICE`, `ANON`, `this.ctx`.
- Produces: `readonly mixins` with:
  - `list(siteCode: string, authCtx?: AuthContext): Promise<SiteMixins>`
  - `get(siteCode: string, mixinName: string, authCtx?: AuthContext): Promise<SiteMixin>`
  - `create(siteCode: string, input: SiteMixin, authCtx?: AuthContext): Promise<SiteMixinCreated>`
  - `update(siteCode: string, mixinName: string, input: SiteMixin, authCtx?: AuthContext): Promise<void>`
  - `replace(siteCode: string, mixinName: string, input: SiteMixin, authCtx?: AuthContext): Promise<void>`
  - `delete(siteCode: string, mixinName: string, authCtx?: AuthContext): Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/services/site-admin.test.ts`:

```ts
describe("SiteService.mixins", () => {
  it("reads default to ANON", async () => {
    const l = vi.fn().mockResolvedValue({ seo: {} });
    await svc(l).mixins.list("main");
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${S}/main/mixins`, auth: { kind: "anonymous" } }),
    );

    const g = vi.fn().mockResolvedValue({ title: "x" });
    await svc(g).mixins.get("main", "seo");
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${S}/main/mixins/seo`, auth: { kind: "anonymous" } }),
    );
  });

  it("writes default to SERVICE", async () => {
    const c = vi.fn().mockResolvedValue({ id: "seo" });
    const res = await svc(c).mixins.create("main", { seo: {} });
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${S}/main/mixins`, body: { seo: {} }, auth: { kind: "service" } }),
    );
    expect(res).toEqual({ id: "seo" });

    const u = vi.fn().mockResolvedValue(undefined);
    await svc(u).mixins.update("main", "seo", { title: "x" });
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PATCH", path: `${S}/main/mixins/seo`, body: { title: "x" }, auth: { kind: "service" } }),
    );

    const r = vi.fn().mockResolvedValue(undefined);
    await svc(r).mixins.replace("main", "seo", { title: "y" });
    expect(r).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: `${S}/main/mixins/seo`, body: { title: "y" }, auth: { kind: "service" } }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).mixins.delete("main", "seo");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${S}/main/mixins/seo`, auth: { kind: "service" } }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- site-admin`
Expected: FAIL — `mixins` is undefined.

- [ ] **Step 3: Add the `mixins` sub-resource**

Append inside the `SiteService` class after `delete` (from Task 1) and before the class's closing `}`:

```ts
  /**
   * Site mixins (`/sites/{siteCode}/mixins`). Mixin content is an open map —
   * the spec defines no structure. Reads default to anonymous, writes to
   * service auth.
   */
  readonly mixins = {
    /** All mixin groups of a site, as a map of group name to content. */
    list: async (siteCode: string, authCtx: AuthContext = ANON): Promise<SiteMixins> =>
      this.ctx.http.request<SiteMixins>({
        method: "GET",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins`,
        auth: authCtx,
      }),

    /** One mixin group's content by name. */
    get: async (siteCode: string, mixinName: string, authCtx: AuthContext = ANON): Promise<SiteMixin> =>
      this.ctx.http.request<SiteMixin>({
        method: "GET",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins/${mixinName}`,
        auth: authCtx,
      }),

    /** Adds a mixin to a site. Default auth: service. */
    create: async (
      siteCode: string,
      input: SiteMixin,
      authCtx: AuthContext = SERVICE,
    ): Promise<SiteMixinCreated> =>
      this.ctx.http.request<SiteMixinCreated>({
        method: "POST",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins`,
        body: input,
        auth: authCtx,
      }),

    /**
     * Partially updates a mixin (PATCH). Responds 200 without a defined body,
     * so nothing is returned. Default auth: service.
     */
    update: async (
      siteCode: string,
      mixinName: string,
      input: SiteMixin,
      authCtx: AuthContext = SERVICE,
    ): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "PATCH",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins/${mixinName}`,
        body: input,
        auth: authCtx,
      });
    },

    /** Full-replaces a mixin (PUT). Returns nothing, like {@link update}. Default auth: service. */
    replace: async (
      siteCode: string,
      mixinName: string,
      input: SiteMixin,
      authCtx: AuthContext = SERVICE,
    ): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "PUT",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins/${mixinName}`,
        body: input,
        auth: authCtx,
      });
    },

    /** Removes a mixin from a site. Default auth: service. */
    delete: async (siteCode: string, mixinName: string, authCtx: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/site/${this.ctx.tenant}/sites/${siteCode}/mixins/${mixinName}`,
        auth: authCtx,
      });
    },
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- site-admin`
Expected: PASS (6 tests total).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/site.ts packages/sdk/tests/services/site-admin.test.ts
git commit -m "feat(sdk): add site mixin crud"
```

---

### Task 3: Changeset + full verification

**Files:**
- Create: `.changeset/site-settings-admin-crud.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: the release changeset; a green full test/typecheck/build run.

- [ ] **Step 1: Write the changeset**

Create `.changeset/site-settings-admin-crud.md`:

```md
---
"@viu/emporix-sdk": minor
---

Add site-settings admin operations to `client.sites`: `create`, `update`
(PATCH), `replace` (PUT, with an optional `expand` query), `delete`,
`listCodes` (GET `/siteslist`), and a `sites.mixins` sub-resource
(`list`/`get`/`create`/`update`/`replace`/`delete`). Writes default to service
auth. `update`/`replace` return nothing — those endpoints respond 200 without a
defined body, so re-read with `get(siteCode)` when the updated site is needed.
The existing reads are unchanged.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS (existing suite + the new `site-admin` tests).

- [ ] **Step 3: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 5: Commit**

```bash
git add .changeset/site-settings-admin-crud.md
git commit -m "chore(sdk): add changeset for site-settings admin crud"
```

---

## Self-Review

**Spec coverage** — every operation maps to a task:

| Spec operation | Task |
|---|---|
| `create` (POST /sites) | 1 |
| `update` (PATCH /sites/{siteCode}) | 1 |
| `replace` (PUT /sites/{siteCode}) | 1 |
| `delete` (DELETE /sites/{siteCode}) | 1 |
| `listCodes` (GET /siteslist) | 1 |
| `mixins.list` (GET …/mixins) | 2 |
| `mixins.get` (GET …/mixins/{mixinName}) | 2 |
| `mixins.create` (POST …/mixins) | 2 |
| `mixins.update` (PATCH …/mixins/{mixinName}) | 2 |
| `mixins.replace` (PUT …/mixins/{mixinName}) | 2 |
| `mixins.delete` (DELETE …/mixins/{mixinName}) | 2 |
| 5 type aliases + index exports | 1 |
| Changeset (minor) | 3 |

11 new operations + 2 already wrapped (`list`, `get`) = 13 = the service's full
operation count; `current` is derived, not an endpoint. None deprecated. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** method names match between tests and implementations
(`create`, `update`, `replace`, `delete`, `listCodes`, `mixins.{list,get,create,update,replace,delete}`).
All 5 aliases are declared, re-exported and index-exported in Task 1 before
Task 2 consumes them. Generated import names verified against
`src/generated/site-settings-service/types.gen.ts` (`SiteDto`,
`ResourceLocation`, `Mixin`, `Mixins`). ✓

**Naming-collision check:** the auth parameter is `authCtx` in every new method,
so the imported `auth` helper stays reachable for `auth.service()`. The flat
`create`/`update`/`replace`/`delete` do not collide with the sub-resource's
same-named members because the latter live under `mixins`. ✓

**Return-shape correctness:** `update`/`replace` (both site and mixin) return
`void` because the 200 responses have no defined body; `create` returns
`ResourceLocation`; `delete` is 204; `listCodes` returns the bare `string[]`;
`mixins.list` returns the open `Mixins` map. `replace` omits the `query` key
entirely when `expand` is not given — asserted both ways. ✓
