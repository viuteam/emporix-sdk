# ProductService.listVariantChildren Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ProductService.listVariantChildren` / `listVariantChildrenAll` and the `useVariantChildren` React hook to resolve the VARIANT children of a PARENT_VARIANT product without hand-building the search query.

**Architecture:** Two thin methods on the existing `ProductService` that build the verified query `productType:VARIANT parentVariantId:{id}` and reuse the existing `search()` + `iterateAll` pagination. The array method delegates to the streaming method (DRY). A React `useQuery` hook mirrors the existing product hooks. No new types, no client wiring, no new subpath export.

**Tech Stack:** TypeScript, native `fetch` (via `HttpClient`), Vitest + MSW, `@tanstack/react-query` v5, changesets.

**Branch:** `feat/variant-children` (already created off `main`; the design spec `docs/superpowers/specs/2026-05-29-variant-children-design.md` is already committed here).

**Reference spec:** `docs/superpowers/specs/2026-05-29-variant-children-design.md`.

---

### Task 1: SDK — `listVariantChildren` + `listVariantChildrenAll` (TDD)

**Files:**
- Modify: `packages/sdk/src/services/product.ts` (add two methods to `ProductService`)
- Test: `packages/sdk/tests/services/product.test.ts` (append a new `describe` block)

- [ ] **Step 1: Write the failing tests**

Append this new top-level `describe` block to the **end** of `packages/sdk/tests/services/product.test.ts` (after the existing `describe("ProductService", …)` block's closing `});`). It reuses the file's existing `svc()` factory and `server`:

```ts
describe("ProductService.listVariantChildren", () => {
  it("resolves a parent with 3 children into a flat array", async () => {
    let seenQ: string | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQ = new URL(request.url).searchParams.get("q");
        return HttpResponse.json([{ id: "v1" }, { id: "v2" }, { id: "v3" }]);
      }),
    );
    const children = await svc().listVariantChildren("parent-1");
    expect(seenQ).toBe("productType:VARIANT parentVariantId:parent-1");
    expect(children.map((p) => p.id as string)).toEqual(["v1", "v2", "v3"]);
  });

  it("aggregates 250 children across 2 pages (default pageSize 200)", async () => {
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        calls += 1;
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        const size = Number(u.searchParams.get("pageSize") ?? "0");
        const count = page === 1 ? size : 50; // page 1 full (200), page 2 short (50)
        const start = (page - 1) * size;
        return HttpResponse.json(
          Array.from({ length: count }, (_, i) => ({ id: `v${start + i}` })),
        );
      }),
    );
    const children = await svc().listVariantChildren("parent-1");
    expect(children).toHaveLength(250);
    expect(calls).toBe(2);
  });

  it("returns an empty array (no throw) when the parent has no children", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products", () => HttpResponse.json([])),
    );
    await expect(svc().listVariantChildren("parent-empty")).resolves.toEqual([]);
  });

  it("encodes a parentVariantId with spaces and special characters", async () => {
    let seenQ: string | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQ = new URL(request.url).searchParams.get("q");
        return HttpResponse.json([]);
      }),
    );
    await svc().listVariantChildren("p 1&x");
    // searchParams.get decodes the value — proves the space and & were encoded
    // (otherwise the & would split the query string and truncate q).
    expect(seenQ).toBe("productType:VARIANT parentVariantId:p 1&x");
  });

  it("listVariantChildrenAll streams children across pages", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        const u = new URL(request.url);
        const page = Number(u.searchParams.get("pageNumber") ?? "1");
        const size = Number(u.searchParams.get("pageSize") ?? "0");
        const count = page === 1 ? size : 1;
        const start = (page - 1) * size;
        return HttpResponse.json(
          Array.from({ length: count }, (_, i) => ({ id: `v${start + i}` })),
        );
      }),
    );
    const ids: string[] = [];
    for await (const child of svc().listVariantChildrenAll("parent-1", { pageSize: 2 })) {
      ids.push(child.id as string);
    }
    expect(ids).toEqual(["v0", "v1", "v2"]); // page 1: v0,v1 (full) → page 2: v2 (short)
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk test -- product`
Expected: FAIL — `svc(...).listVariantChildren is not a function` (and `listVariantChildrenAll is not a function`).

- [ ] **Step 3: Implement the two methods**

In `packages/sdk/src/services/product.ts`, add both methods inside the `ProductService` class, immediately after the `searchByIds` method (before the class's closing `}`). `iterateAll`, `ANON`, `AuthContext`, and `Product` are already imported/defined in this file.

```ts
  /**
   * Streams the VARIANT children of a PARENT_VARIANT product, page by page,
   * via the search query `productType:VARIANT parentVariantId:<id>`. Default
   * pageSize 200. The query syntax (space-separated fields = implicit AND) is
   * encapsulated here so consumers don't build it themselves.
   */
  listVariantChildrenAll(
    parentVariantId: string,
    params: { pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): AsyncIterable<Product> {
    const pageSize = params.pageSize ?? 200;
    const q = `productType:VARIANT parentVariantId:${parentVariantId}`;
    return iterateAll<Product>((pageNumber) => this.search(q, { pageNumber, pageSize }, auth));
  }

  /**
   * Resolves ALL VARIANT children of a PARENT_VARIANT product into a flat
   * array (loads every page). Default pageSize 200. Returns `[]` when there are
   * no children — never throws.
   */
  async listVariantChildren(
    parentVariantId: string,
    params: { pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<Product[]> {
    const out: Product[] = [];
    for await (const child of this.listVariantChildrenAll(parentVariantId, params, auth)) {
      out.push(child);
    }
    return out;
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk test -- product`
Expected: PASS (all existing `ProductService` tests + the 5 new ones).

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/tests/services/product.test.ts
git commit -m "$(cat <<'EOF'
feat(product): add listVariantChildren and listVariantChildrenAll

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: React — `useVariantChildren` hook (TDD)

The React package resolves `@viu/emporix-sdk` to its built `dist/`, so build the SDK first (it now has `listVariantChildren`).

**Files:**
- Create: `packages/react/src/hooks/use-variant-children.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/use-variant-children.test.tsx`

- [ ] **Step 1: Build the SDK so the hook can resolve the new method**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: succeeds.

- [ ] **Step 2: Write the failing test**

Create `packages/react/tests/use-variant-children.test.tsx` (harness mirrors `tests/use-products.test.tsx`, tenant `acme`):

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useVariantChildren } from "../src/hooks/use-variant-children";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s",
    }),
  ),
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

describe("useVariantChildren", () => {
  it("fetches the variant children for a parent id", async () => {
    let seenQ: string | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQ = new URL(request.url).searchParams.get("q");
        return HttpResponse.json([{ id: "v1" }, { id: "v2" }]);
      }),
    );
    const { result } = renderHook(() => useVariantChildren("parent-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenQ).toBe("productType:VARIANT parentVariantId:parent-1");
    expect(result.current.data?.map((p) => p.id)).toEqual(["v1", "v2"]);
  });

  it("is disabled when parentVariantId is undefined", () => {
    const { result } = renderHook(() => useVariantChildren(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- variant-children`
Expected: FAIL — cannot resolve `../src/hooks/use-variant-children`.

- [ ] **Step 4: Implement the hook**

Create `packages/react/src/hooks/use-variant-children.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { type Product } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadAuth, type QueryOpts } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";
import { emporixKey } from "./internal/query-keys";

const VARIANT_CHILDREN_STALE_TIME = 60_000; // 1 minute — catalog data.

export type UseVariantChildrenOptions = QueryOpts & { pageSize?: number };

/**
 * Resolves the VARIANT children of a PARENT_VARIANT product via
 * `products.listVariantChildren`. The cache key contains `parentVariantId`.
 * Disabled until `parentVariantId` is a non-empty string.
 */
export function useVariantChildren(
  parentVariantId: string | undefined,
  options: UseVariantChildrenOptions = {},
): UseQueryResult<Product[]> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth(options.auth);
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: emporixKey(
      "variant-children",
      [parentVariantId, { pageSize: options.pageSize }],
      { tenant: client.tenant, authKind: ctx.kind, siteCode },
    ),
    enabled: typeof parentVariantId === "string" && parentVariantId !== "",
    queryFn: () =>
      client.products.listVariantChildren(
        parentVariantId as string,
        options.pageSize !== undefined ? { pageSize: options.pageSize } : {},
        ctx,
      ),
    staleTime: VARIANT_CHILDREN_STALE_TIME,
  });
}
```

- [ ] **Step 5: Export from the hooks barrel**

In `packages/react/src/hooks/index.ts`, add after the `use-products` export block (the one exporting `useProduct … useProductSearch`):

```ts
export { useVariantChildren } from "./use-variant-children";
export type { UseVariantChildrenOptions } from "./use-variant-children";
```

- [ ] **Step 6: Export from the package barrel**

In `packages/react/src/index.ts`, add `useVariantChildren,` to the big `export { … } from "./hooks/index";` list (after `useProductSearch,`). Then add its type to the existing meta type re-export — change:

```ts
export type { CompanySwitcherApi, UseMyOrdersOptions, UseMyOrdersInfiniteOptions } from "./hooks/index";
```

to:

```ts
export type {
  CompanySwitcherApi,
  UseMyOrdersOptions,
  UseMyOrdersInfiniteOptions,
  UseVariantChildrenOptions,
} from "./hooks/index";
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test -- variant-children`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: passes.

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/hooks/use-variant-children.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-variant-children.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): add useVariantChildren hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Docs

**Files:**
- Create: `docs/products.md`

- [ ] **Step 1: Write `docs/products.md`**

Create `docs/products.md`:

```markdown
# Products

`client.products` reads the Emporix Product Service. Standard reads: `get`,
`getByCode`, `list` / `listAll`, `search`, `searchByIds`.

## Variant children

Emporix products have a `productType` of `BASIC`, `PARENT_VARIANT`, `VARIANT`, or
`BUNDLE`. A `PARENT_VARIANT` product's variants are separate `VARIANT` products
that reference the parent via `parentVariantId`. The SDK encapsulates the search
query so you don't build it by hand.

```ts
// All variant children as a flat array (loads every page; default pageSize 200)
const children = await client.products.listVariantChildren("PARENT-1");

// Streaming, page by page — for large variant sets
for await (const variant of client.products.listVariantChildrenAll("PARENT-1")) {
  render(variant);
}
```

A parent with no children resolves to `[]` (it never throws). Internally this
runs `search("productType:VARIANT parentVariantId:<id>")` — space-separated
fields are combined with implicit AND, per Emporix's query-parameter syntax.

## React

```tsx
import { useVariantChildren } from "@viu/emporix-sdk-react";

function VariantPicker({ parentId }: { parentId: string }) {
  const { data: variants } = useVariantChildren(parentId);
  return <>{variants?.map((v) => <Option key={v.id} variant={v} />)}</>;
}
```

The hook defaults to the anonymous/customer token (override via `options.auth`),
uses a 60s stale time, and its cache key contains `parentVariantId`.
```

- [ ] **Step 2: Verify the doc exists**

Run: `test -f docs/products.md && echo OK`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add docs/products.md
git commit -m "$(cat <<'EOF'
docs(product): document variant children methods and hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Changeset + config flag

The branch is off `main`, which lacks the changeset-config flag that prevents the peer-dependency force-major. Add it here so both packages bump `minor` (`2.0.0 → 2.1.0`) instead of `major`.

**Files:**
- Modify: `.changeset/config.json`
- Create: `.changeset/variant-children.md`

- [ ] **Step 1: Add the peer-dependent flag to the changeset config**

In `.changeset/config.json`, add the experimental options object after the `privatePackages` line (so the trailing `}` of the file is preceded by it). The resulting tail of the file:

```json
  "ignore": ["@viu/emporix-examples-*"],
  "privatePackages": { "version": false, "tag": false },
  "___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH": {
    "onlyUpdatePeerDependentsWhenOutOfRange": true
  }
}
```

- [ ] **Step 2: Write the changeset**

Create `.changeset/variant-children.md`:

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add ProductService.listVariantChildren / listVariantChildrenAll and the
useVariantChildren React hook to resolve the VARIANT children of a
PARENT_VARIANT product without hand-building the search query.
```

- [ ] **Step 3: Verify the bump is minor (not major)**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-sdk` and `@viu/emporix-sdk-react` under **minor** (and nothing under major). If they appear under major, the config flag from Step 1 was not applied correctly — fix before committing.

- [ ] **Step 4: Commit**

```bash
git add .changeset/config.json .changeset/variant-children.md
git commit -m "$(cat <<'EOF'
chore(release): add variant-children changeset; scope peer-dependent majors

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Final verification (before finishing)

- [ ] Run the full unit suite: `pnpm -r test` — all green.
- [ ] Run repo typecheck: `pnpm typecheck` — green.
- [ ] Run lint: `pnpm lint` — green.
- [ ] Then invoke **superpowers:finishing-a-development-branch** to verify tests, present the merge/PR/keep/discard options, and execute the choice.

## Notes for the implementer

- The SDK method unit tests construct `ProductService` directly (no `EmporixClient`),
  so Task 1 needs no client wiring. The React test (Task 2) depends on a freshly
  built SDK `dist/` — build after Task 1.
- `iterateAll` drives `pageNumber` from 1 and stops when a page reports
  `hasNextPage: false` (which `search` sets via `items.length === pageSize`).
- Do not stage the pre-existing modified files under `examples/next-app-router/`
  (`next-env.d.ts`, `tsconfig*.json`, `tsbuildinfo`) — unrelated build artifacts.
- If the `feat/availability-service` branch merges to `main` before this one, the
  Task 4 config-flag change becomes a no-op (already present) — keep the changeset
  file regardless.
