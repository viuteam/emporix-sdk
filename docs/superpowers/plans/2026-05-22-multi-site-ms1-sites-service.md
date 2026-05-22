# Multi-Site MS-1 — Sites Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the foundational Site Settings Service binding — `client.sites.list/get/current` in the SDK, `useSites()` and `useDefaultSite()` in React — so storefronts can discover the active sites of a tenant.

**Architecture:** Mirrors the existing service patterns (ProductService, CategoryService): a `SiteService` class taking `ClientContext`, methods returning typed DTOs, anonymous-default auth. React hooks follow the established `useReadAuth` + `useQuery` pattern. No multi-site cache-key changes yet — those land in MS-2.

**Tech Stack:** TypeScript, native `fetch`, TanStack React Query v5, Vitest + MSW, pnpm workspaces.

**Context for the engineer:**
- Spec: `docs/superpowers/specs/2026-05-21-multi-site-foundation-design.md` — read MS-1 section first.
- Branch: `feat/multi-site-foundation` (already created off `main` at `3a1aa43`, spec already committed at `b242e9c`).
- Stage MS-1 only — MS-2/3/4 are separate plans, do not pre-implement them here.
- Existing service patterns: see `packages/sdk/src/services/category.ts` for the closest analog (read-only, anonymous-default, simple endpoint mapping).
- `ANON` constant: `auth.anonymous()` — imported from `../core/auth`. Used as default value for the `auth` parameter on every read method.
- `EmporixClient` registers services in `packages/sdk/src/client.ts:50-77` via `new ServiceName(mk("logger-name"))`. Add `sites` next to `media` / `segments`.
- `ServiceName` type lives in `packages/sdk/src/core/logger.ts` — must include `"site"` for the logger child to compile.
- SDK base URL for Site Settings: `GET /site/{tenant}/sites` (list), `GET /site/{tenant}/sites/{siteCode}` (get).
- Returns: 200 → `SiteDto[]` / `SiteDto`. Only active sites are returned without `site_manage` scope — anonymous storefront auth is sufficient.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/sdk/src/services/site.ts` | SiteService + Site type | **CREATE** |
| `packages/sdk/src/index.ts` | Public re-exports | Modify (add `Site`, `SiteService`) |
| `packages/sdk/src/client.ts` | EmporixClient wiring | Modify (new `sites` field) |
| `packages/sdk/src/core/logger.ts` | ServiceName union | Modify (add `"site"`) |
| `packages/sdk/tests/services/site.test.ts` | Service unit tests | **CREATE** |
| `packages/react/src/hooks/use-sites.ts` | useSites + useDefaultSite | **CREATE** |
| `packages/react/src/hooks/index.ts` | Hook re-exports | Modify |
| `packages/react/src/index.ts` | Package re-exports | Modify |
| `packages/react/tests/use-sites.test.tsx` | React hook tests | **CREATE** |
| `docs/react.md` | Public docs | Modify (new "Sites" section) |
| `.changeset/multi-site-ms1.md` | Release notes | **CREATE** (minor on both packages) |

---

## Task 1: Add `Site` type + `SiteService` class

**Files:**
- Create: `packages/sdk/src/services/site.ts`
- Create: `packages/sdk/tests/services/site.test.ts`
- Modify: `packages/sdk/src/core/logger.ts`

- [ ] **Step 1: Add `"site"` to the `ServiceName` union**

Open `packages/sdk/src/core/logger.ts`, find the `ServiceName` type. Add `"site"` to the union. Example (the existing names will differ — read the file first):

```ts
export type ServiceName =
  | "customer"
  | "product"
  | "category"
  | "cart"
  | "checkout"
  | "payment"
  | "price"
  | "media"
  | "segment"
  | "site"           // ← new
  | "http"
  | "auth";
```

(If the union is structured differently — e.g. as a string-literal array — adapt accordingly. The goal is `mk("site")` in `client.ts` typechecks.)

- [ ] **Step 2: Write the failing tests**

Create `packages/sdk/tests/services/site.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { SiteService } from "../../src/services/site";
import { auth } from "../../src/core/auth";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof SiteService>[0] {
  return {
    tenant: "viu",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("SiteService", () => {
  it("list() GETs /site/{tenant}/sites with anonymous auth by default", async () => {
    const request = vi.fn().mockResolvedValue([
      { code: "Netherlands", name: "Netherlands", active: true, default: true, defaultLanguage: "nl", languages: ["nl"], currency: "EUR", homeBase: { address: { country: "NL", zipCode: "1011" } }, shipToCountries: ["NL"] },
    ]);
    const svc = new SiteService(ctxWith(request));

    const sites = await svc.list();

    expect(sites).toHaveLength(1);
    expect(sites[0]?.code).toBe("Netherlands");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/site/viu/sites",
        auth: expect.objectContaining({ kind: "anonymous" }),
      }),
    );
  });

  it("list() honours an explicit AuthContext", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const svc = new SiteService(ctxWith(request));
    await svc.list(auth.customer("tok"));
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ kind: "customer" }) }),
    );
  });

  it("get(code) GETs /site/{tenant}/sites/{code}", async () => {
    const request = vi.fn().mockResolvedValue({
      code: "ThermoBrand_DE",
      name: "ThermoBrand Germany",
      active: true,
      default: false,
      defaultLanguage: "de",
      languages: ["en", "de"],
      currency: "EUR",
      homeBase: { address: { country: "DE", zipCode: "12345" } },
      shipToCountries: ["DE"],
    });
    const svc = new SiteService(ctxWith(request));
    const site = await svc.get("ThermoBrand_DE");
    expect(site.code).toBe("ThermoBrand_DE");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/site/viu/sites/ThermoBrand_DE",
      }),
    );
  });

  it("current() returns the site flagged default: true", async () => {
    const request = vi.fn().mockResolvedValue([
      { code: "X", name: "X", active: true, default: false, defaultLanguage: "en", languages: ["en"], currency: "EUR", homeBase: { address: { country: "DE", zipCode: "1" } }, shipToCountries: ["DE"] },
      { code: "Y", name: "Y", active: true, default: true,  defaultLanguage: "en", languages: ["en"], currency: "EUR", homeBase: { address: { country: "DE", zipCode: "1" } }, shipToCountries: ["DE"] },
      { code: "Z", name: "Z", active: true, default: false, defaultLanguage: "en", languages: ["en"], currency: "EUR", homeBase: { address: { country: "DE", zipCode: "1" } }, shipToCountries: ["DE"] },
    ]);
    const svc = new SiteService(ctxWith(request));
    const site = await svc.current();
    expect(site.code).toBe("Y");
  });

  it("current() throws a descriptive error when no site is flagged default", async () => {
    const request = vi.fn().mockResolvedValue([
      { code: "X", name: "X", active: true, default: false, defaultLanguage: "en", languages: ["en"], currency: "EUR", homeBase: { address: { country: "DE", zipCode: "1" } }, shipToCountries: ["DE"] },
    ]);
    const svc = new SiteService(ctxWith(request));
    await expect(svc.current()).rejects.toThrow(/no default site/i);
  });
});
```

- [ ] **Step 3: Run tests, expect failure**

Run: `pnpm -F @viu/emporix-sdk test -- site.test`
Expected: FAIL — `SiteService` cannot be imported from `../../src/services/site` (file doesn't exist).

- [ ] **Step 4: Create `packages/sdk/src/services/site.ts`**

```typescript
import type { ClientContext } from "../core/context";
import { auth, type AuthContext } from "../core/auth";

const ANON: AuthContext = auth.anonymous();

/**
 * One site as returned by the Site Settings Service. Mirrors the public
 * SiteDto schema with the fields a storefront actually consumes.
 */
export interface Site {
  code: string;
  name: string;
  active: boolean;
  default: boolean;
  includesTax?: boolean;
  defaultLanguage: string;
  languages: string[];
  currency: string;
  availableCurrencies?: string[];
  homeBase: {
    address: {
      country: string;
      zipCode: string;
      street?: string;
      city?: string;
      state?: string;
    };
    timezone?: string;
  };
  shipToCountries: string[];
  cartCalculationScale?: number;
  metadata?: { version?: number };
}

/**
 * Read-only access to the tenant's site catalog. List returns active sites
 * visible to the storefront context (the `site_manage` scope is only needed
 * to read inactive sites).
 */
export class SiteService {
  constructor(private readonly ctx: ClientContext) {}

  /** Lists active sites. */
  async list(authCtx: AuthContext = ANON): Promise<Site[]> {
    return this.ctx.http.request<Site[]>({
      method: "GET",
      path: `/site/${this.ctx.tenant}/sites`,
      auth: authCtx,
    });
  }

  /** Retrieves one site by code. */
  async get(code: string, authCtx: AuthContext = ANON): Promise<Site> {
    return this.ctx.http.request<Site>({
      method: "GET",
      path: `/site/${this.ctx.tenant}/sites/${code}`,
      auth: authCtx,
    });
  }

  /**
   * Returns the tenant's default site (the one with `default: true`).
   * Throws if no default is configured — a tenant should always have one.
   */
  async current(authCtx: AuthContext = ANON): Promise<Site> {
    const sites = await this.list(authCtx);
    const def = sites.find((s) => s.default);
    if (!def) {
      throw new Error(
        `SiteService.current: no default site for tenant "${this.ctx.tenant}"`,
      );
    }
    return def;
  }
}
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk test -- site.test`
Expected: PASS for all 5 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/site.ts packages/sdk/tests/services/site.test.ts packages/sdk/src/core/logger.ts
git commit -m "feat(sdk): add SiteService.list/get/current"
```

---

## Task 2: Wire `SiteService` into `EmporixClient`

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Add `sites` to `EmporixClient`**

In `packages/sdk/src/client.ts`:

1. Add to the imports block:
   ```ts
   import { SiteService } from "./services/site";
   ```

2. Add the field declaration next to the other `readonly` service fields:
   ```ts
   readonly sites: SiteService;
   ```

3. Add the instantiation inside the constructor, next to other services:
   ```ts
   this.sites = new SiteService(mk("site"));
   ```

- [ ] **Step 2: Re-export `Site` and `SiteService` from the SDK index**

In `packages/sdk/src/index.ts`, add:

```ts
export { SiteService, type Site } from "./services/site";
```

(Place the export in alphabetical-ish position next to the other service re-exports — match the existing style.)

- [ ] **Step 3: Verify build + typecheck**

Run:
```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk test
```
Expected: all green. The new `client.sites` exposure is now part of the public API.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): wire SiteService into EmporixClient as client.sites"
```

---

## Task 3: Add `useSites()` and `useDefaultSite()` React hooks

**Files:**
- Create: `packages/react/src/hooks/use-sites.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`
- Create: `packages/react/tests/use-sites.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/use-sites.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useSites, useDefaultSite } from "../src/hooks/use-sites";
import type { ReactNode } from "react";

const SITES = [
  { code: "ThermoBrand_DE", name: "ThermoBrand Germany", active: true,  default: false, defaultLanguage: "de", languages: ["en", "de"], currency: "EUR", homeBase: { address: { country: "DE", zipCode: "12345" } }, shipToCountries: ["DE"] },
  { code: "main",           name: "Main",                active: true,  default: true,  defaultLanguage: "de", languages: ["de"],       currency: "CHF", homeBase: { address: { country: "CH", zipCode: "8000" } },  shipToCountries: ["CH"] },
];

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/site/acme/sites", () => HttpResponse.json(SITES)),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useSites", () => {
  it("returns the list of active sites", async () => {
    const { result } = renderHook(() => useSites(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((s) => s.code)).toEqual(["ThermoBrand_DE", "main"]);
  });
});

describe("useDefaultSite", () => {
  it("returns the site flagged default: true", async () => {
    const { result } = renderHook(() => useDefaultSite(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.code).toBe("main");
  });
});
```

- [ ] **Step 2: Run tests, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-sites`
Expected: FAIL — `useSites`/`useDefaultSite` cannot be imported.

- [ ] **Step 3: Create `packages/react/src/hooks/use-sites.ts`**

```tsx
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Site } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";

/** Lists active sites for the tenant. */
export function useSites(options: QueryOpts = {}): UseQueryResult<Site[]> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "sites", { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.sites.list(ctx),
  });
}

/** Convenience: the tenant's default site (the one flagged `default: true`). */
export function useDefaultSite(options: QueryOpts = {}): UseQueryResult<Site> {
  const { client } = useEmporix();
  const { ctx, kind } = useReadAuth(options.auth);
  return useQuery({
    queryKey: ["emporix", "site-default", { tenant: client.tenant, authKind: kind }],
    queryFn: () => client.sites.current(ctx),
  });
}
```

- [ ] **Step 4: Add the new hooks to the re-export barrels**

In `packages/react/src/hooks/index.ts`, add next to other hook exports:

```ts
export { useSites, useDefaultSite } from "./use-sites";
```

In `packages/react/src/index.ts`, append `useSites` and `useDefaultSite` to the existing named-export list from `./hooks/index`.

- [ ] **Step 5: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-sites`
Expected: PASS for both tests.

- [ ] **Step 6: Run the full test suite to verify no regressions**

Run: `pnpm -r test`
Expected: 144 SDK (+5 from MS-1) + 110 React (+2 from MS-1) = ~254 tests.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/use-sites.ts \
        packages/react/src/hooks/index.ts \
        packages/react/src/index.ts \
        packages/react/tests/use-sites.test.tsx
git commit -m "feat(react): add useSites + useDefaultSite hooks"
```

---

## Task 4: Documentation + changeset

**Files:**
- Modify: `docs/react.md`
- Create: `.changeset/multi-site-ms1.md`

- [ ] **Step 1: Add a "Sites" subsection to `docs/react.md`**

Insert a new subsection **after** the existing "Customer account" section and before "Persistent guest cart". Find a similar section header for placement context:

```markdown
### Sites

For tenants with multiple storefront sites (countries, brands, or country/brand
combinations), the SDK exposes the Site Settings Service:

`useSites()` — lists the active sites for the tenant.

`useDefaultSite()` — convenience for "the site flagged as `default: true`".

```tsx
const { data: sites } = useSites();
const { data: defaultSite } = useDefaultSite();

return (
  <select defaultValue={defaultSite?.code}>
    {sites?.map((s) => (
      <option key={s.code} value={s.code}>{s.name}</option>
    ))}
  </select>
);
```

These hooks do **not** yet drive the active-site context — the active site
is still bound by `client.config.credentials.storefront.context.siteCode`.
Runtime site-switching arrives in MS-2 (`useSiteContext()` +
`setSite()`). See [the multi-site spec](./superpowers/specs/2026-05-21-multi-site-foundation-design.md)
for the roadmap.
```

- [ ] **Step 2: Create the changeset**

Create `.changeset/multi-site-ms1.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Site Settings Service binding — first stage of multi-site foundation.

**SDK**
- `client.sites.list()` — list active sites for the tenant.
- `client.sites.get(code)` — retrieve one site by code.
- `client.sites.current()` — convenience for the `default: true` site.
- New `Site` type mirroring the `SiteDto` schema (code, name, active,
  default, currency, languages, homeBase, shipToCountries, …).

**React**
- `useSites()` — list active sites.
- `useDefaultSite()` — the default site.

No breaking changes. The active-site runtime context (provider state,
`setSite`, cache-key migration) follows in MS-2.
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md .changeset/multi-site-ms1.md
git commit -m "docs(repo): document SiteService + useSites; MS-1 changeset"
```

---

## Final Verification

- [ ] **Step 1: Full monorepo green**

```bash
pnpm -r build
pnpm -r test
pnpm typecheck
```
Expected: all green. Test counts:
- `@viu/emporix-sdk`: was 143 → **148** (+5 site service tests)
- `@viu/emporix-sdk-react`: was 108 → **110** (+2 useSites tests)

- [ ] **Step 2: Sanity grep for public exports**

```bash
git grep -n "SiteService\|useSites\|useDefaultSite" packages/sdk/src/index.ts packages/react/src/index.ts
```
Expected: each symbol exported from its respective package index.

- [ ] **Step 3: E2E sanity (optional)**

```bash
set -a; source e2e/.env.local 2>/dev/null; set +a
pnpm e2e
```
Expected: 6/6 still passing. MS-1 is additive — no existing flow changes.

If `e2e/.env.local` is not configured, e2e skips cleanly.

- [ ] **Step 4: Confirm branch state**

```bash
git log --oneline origin/main..HEAD
```
Expected: 5 commits, in order:
1. spec (`b242e9c` — already there from prior turn)
2. SDK SiteService + tests
3. EmporixClient wiring
4. React useSites/useDefaultSite + tests
5. Docs + changeset

---

## Follow-ups (out of scope for MS-1)

- MS-2: `useSiteContext()` + cache-key migration (`docs/superpowers/plans/<date>-multi-site-ms2-…md` — open after MS-1 ships).
- MS-3: `client.sessionContext` + async `setSite`.
- MS-4: Currency auto-derive + `customerprefferedSite` honour at login.
- Site-switcher UI in `examples/vite-spa` + `examples/next-app-router` — landed alongside MS-2 once `setSite` exists.
