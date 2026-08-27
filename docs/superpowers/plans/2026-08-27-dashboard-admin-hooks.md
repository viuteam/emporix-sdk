# Dashboard Admin Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build brand and label administration into `examples/md-module` against the live tenant, then decide from that evidence which admin hooks belong in `@viu/emporix-sdk-react` and which do not.

**Architecture:** The hooks are written **inside the example first**, not in the package. Each read goes through the now-public `useEmporixQuery`; each write is a plain `useMutation` plus an explicit invalidate, because there is no write-side factory in React. Only after a second domain (labels) proves the shape generalises does the plan decide what to promote — and promotion goes to a new `./admin` entry point, never the package root.

**Tech Stack:** React 18.3 (pinned to the dashboard host), Vite + Module Federation, `@tanstack/react-query` v5, `@viu/emporix-sdk-react` (with `useEmporixQuery` public as of #307), Vitest + MSW.

**Spec:** No new spec. This plan acts on the analysis recorded in [PR #307](https://github.com/viuteam/emporix-sdk/pull/307) and on the SDK-side design docs that already cover these facades — [`2026-06-01-admin-config-services-design.md`](../specs/2026-06-01-admin-config-services-design.md) and its siblings. The domain was chosen by the user from four options; the criteria are in «Why brands and labels» below.

## Global Constraints

- **React 18.3, not 19.** The host supplies React through federation `shared`, so the module runs on the dashboard's copy. React 18 and 19 produce differently shaped elements; a 19 module in an 18 host throws React error #31. This is a format break, not an API question.
- **Federation `shared` uses the array form** — `shared: ["react", "react-dom"]`. The object form with `requiredVersion` fails because the dashboard provides React with no version metadata.
- **No `storage` prop on `EmporixProvider`, and `customerSession="external"`.** The host owns the token; the module must not write it into the dashboard's own `localStorage`.
- **Every admin facade method defaults its `auth` parameter to a `SERVICE` context** — client credentials with a secret, which a browser does not have. Always pass the context `useEmporixQuery` hands you, or an explicit `auth.customer(token)`. Calling a facade without a context is the single most likely bug in this plan.
- **Everything written into the repo is English** — comments, JSDoc, tests, changesets, commit messages, docs.
- Commitlint: scope from the allowlist (`examples`, `react`, `docs`, `repo`), first word after the scope a lowercase verb.
- **No credentials in source.** The dashboard token arrives from the host at runtime; for standalone `pnpm dev` it comes from an env var that stays out of git. Never hardcode one, never echo one.
- `@viu/emporix-examples-*` are in `.changeset/config.json` `ignore` — the example is never versioned or published. Only a promotion to `packages/react` needs a changeset.

## Why brands and labels

Chosen over catalogs/vendors, tenant-config/schema and invoices/quotes because it is the smallest surface that still exercises everything the promotion decision depends on:

| Needed to learn | Brands and labels give it |
|---|---|
| Read gating on the host token | `listBrands` is `SERVICE`-default; a storefront token 403s |
| Post-write invalidation | create/update/delete all change the list |
| Pagination through a loose query record | `listBrands(query: Record<string, string \| number>)` |
| Whether the shape generalises | labels are a second, structurally identical facade |
| What a scope failure looks like in the UI | reachable by pointing the module at a storefront token |

And it carries no financial or fulfilment risk: a wrong write creates a stray brand, not a stray order.

## The facades, read from source

Both services expose the same six operations, all defaulting to a `SERVICE` context
(`packages/sdk/src/services/brand.ts`, `label.ts`):

| Brand | Label | Shape |
|---|---|---|
| `listBrands(query, auth)` | `listLabels(query, auth)` | `query: Record<string, string \| number> = {}` → `BrandList` / `LabelList` |
| `getBrand(id, auth)` | `getLabel(id, auth)` | → `Brand` / `Label` |
| `createBrand(input, auth)` | `createLabel(input, auth)` | → the created entity |
| `updateBrand(id, input, auth)` | `updateLabel(id, input, auth)` | full replace |
| `patchBrand(id, patch, auth)` | `patchLabel(id, patch, auth)` | partial |
| `deleteBrand(id, auth)` | `deleteLabel(id, auth)` | → `void` |

Derive every input and patch type with `Parameters<…>` rather than restating it.

## File structure

**New in `examples/md-module/src/`:**

| File | Responsibility |
|---|---|
| `admin/useBrands.ts` | `useBrands`, `useBrand`, `useBrandMutations` |
| `admin/useLabels.ts` | `useLabels`, `useLabel`, `useLabelMutations` |
| `admin/BrandAdmin.tsx` | list + create/edit/delete UI |
| `admin/LabelAdmin.tsx` | the same for labels |
| `admin/ScopeError.tsx` | renders a 403 as «this token lacks the scope», not as a stack trace |
| `Nav.tsx` | switches between Products, Brands and Labels — the module renders one view today |

**New in `examples/md-module/tests/`:** `brands.test.ts`, `labels.test.ts` — MSW-backed, mirroring `packages/react/tests` conventions.

**Modified:** `src/RemoteComponent.tsx` (render `Nav` instead of `ProductList` directly), `README.md`.

**Only if Phase 4 decides to promote:** `packages/react/src/admin/` plus an `./admin` entry in `package.json` `exports` and `tsup.config.ts`.

---

## Phase 1 — Brands

### Task 1: Navigation shell

The module renders `<ProductList />` directly, so there is nowhere to put a second view.

**Files:**
- Create: `examples/md-module/src/Nav.tsx`
- Modify: `examples/md-module/src/RemoteComponent.tsx:70`

**Interfaces:**
- Produces: `<Nav />`, holding `useState<"products" | "brands" | "labels">("products")` and rendering the matching view.

- [ ] **Step 1: Write `Nav.tsx`**

Plain buttons and a `switch`, no router. A federation remote must not own history — the dashboard owns the URL, and a nested router fights it for the back button.

```tsx
import { useState } from "react";
import { ProductList } from "./ProductList";
import { BrandAdmin } from "./admin/BrandAdmin";
import { LabelAdmin } from "./admin/LabelAdmin";

type View = "products" | "brands" | "labels";

export function Nav(): React.JSX.Element {
  const [view, setView] = useState<View>("products");
  return (
    <>
      <nav>
        {(["products", "brands", "labels"] as const).map((v) => (
          <button key={v} type="button" disabled={v === view} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
      </nav>
      {view === "products" ? <ProductList /> : view === "brands" ? <BrandAdmin /> : <LabelAdmin />}
    </>
  );
}
```

- [ ] **Step 2: Render it from `RemoteComponent`**

Replace `<ProductList />` with `<Nav />` inside the existing `EmporixProvider`. Change nothing else in that file — the six things it gets right are documented in `packages/react/README.md` and every one is load-bearing.

- [ ] **Step 3: Verify it builds**

Run: `pnpm -F @viu/emporix-examples-md-module build`
Expected: success. It will fail until Tasks 2–5 create the two admin components — write stubs returning `null` if you want a green build in between, and delete them as the real ones land.

- [ ] **Step 4: Commit**

```bash
git add examples/md-module
git commit -m "feat(examples): add a view switcher to the dashboard module"
```

### Task 2: The brands read

**Files:**
- Create: `examples/md-module/src/admin/useBrands.ts`
- Create: `examples/md-module/tests/brands.test.ts`

**Interfaces:**
- Consumes: `useEmporix`, `useEmporixQuery` from `@viu/emporix-sdk-react`
- Produces:
```ts
export function useBrands(query?: Record<string, string | number>): UseQueryResult<BrandList>
export function useBrand(brandId: string | undefined): UseQueryResult<Brand>
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useBrands } from "../src/admin/useBrands";
import { wrapper, server } from "./support"; // MSW + EmporixProvider, per packages/react/tests

describe("useBrands", () => {
  it("issues no request without a token, and does not throw", async () => {
    const { result } = renderHook(() => useBrands(), { wrapper({ token: null }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.isError).toBe(false);
  });

  it("sends the host token as a bearer and returns the list", async () => {
    const { result } = renderHook(() => useBrands({ pageSize: 20 }), {
      wrapper({ token: "host-token" }),
    });
    await waitFor(() => expect(result.current.data?.length).toBe(1));
    expect(server.lastRequest()?.headers.get("authorization")).toBe("Bearer host-token");
  });

  /**
   * The key must sit under `["emporix", …]` or it drops out of the provider's
   * query defaults and out of `["emporix"]`-scoped invalidation — silently.
   * This is the whole reason the hook goes through the factory.
   */
  it("keys under the emporix namespace", async () => {
    const { result, queryClient } = renderHook(() => useBrands(), {
      wrapper({ token: "host-token" }),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const key = queryClient.getQueryCache().getAll()[0]?.queryKey ?? [];
    expect(key[0]).toBe("emporix");
    expect(key[1]).toBe("brands");
  });
});
```

Build `tests/support.ts` in this step by copying the MSW + provider harness from `packages/react/tests` — the example has no test setup yet, so add `vitest` and a `test` script to its `package.json` too.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-examples-md-module test`
Expected: FAIL — cannot resolve `../src/admin/useBrands`.

- [ ] **Step 3: Write the implementation**

```ts
import { useEmporix, useEmporixQuery } from "@viu/emporix-sdk-react";
import type { EmporixClient } from "@viu/emporix-sdk";

type BrandList = Awaited<ReturnType<EmporixClient["brands"]["listBrands"]>>;
type Brand = Awaited<ReturnType<EmporixClient["brands"]["getBrand"]>>;

/** 1 minute — brands change when a merchandiser changes them, not per render. */
const BRANDS_STALE = 60_000;

/**
 * Brands for the tenant.
 *
 * `mode: "customer"` because the host's token is a customer token whose scopes
 * reach this endpoint. `site: "none"` because brands are tenant-scoped — keying
 * by site would fragment the cache and bill once per site for one answer.
 *
 * The `ctx` must be passed: `listBrands` defaults its `auth` to a service
 * context, which is client credentials with a secret and does not exist here.
 */
export function useBrands(query: Record<string, string | number> = {}) {
  const { client } = useEmporix();
  return useEmporixQuery<BrandList, readonly [Record<string, string | number>]>({
    mode: "customer",
    site: "none",
    resource: "brands",
    args: [query],
    queryFn: (ctx) => client.brands.listBrands(query, ctx),
    staleTime: BRANDS_STALE,
  });
}

/** One brand by id. Disabled while the id is undefined. */
export function useBrand(brandId: string | undefined) {
  const { client } = useEmporix();
  return useEmporixQuery<Brand, readonly [string | null]>({
    mode: "customer",
    site: "none",
    resource: "brand",
    args: [brandId ?? null],
    enabled: typeof brandId === "string" && brandId !== "",
    queryFn: (ctx) => client.brands.getBrand(brandId as string, ctx),
    staleTime: BRANDS_STALE,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -F @viu/emporix-examples-md-module test`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/md-module
git commit -m "feat(examples): add brand reads to the dashboard module"
```

### Task 3: The brand writes

**Files:**
- Modify: `examples/md-module/src/admin/useBrands.ts`
- Modify: `examples/md-module/tests/brands.test.ts`

**Interfaces:**
- Produces:
```ts
export interface BrandMutations {
  create: UseMutationResult<Brand, unknown, BrandInput>;
  update: UseMutationResult<Brand, unknown, { id: string; input: BrandUpdate }>;
  patch: UseMutationResult<Brand, unknown, { id: string; patch: BrandUpdate }>;
  remove: UseMutationResult<void, unknown, string>;
}
export function useBrandMutations(): BrandMutations
```

- [ ] **Step 1: Write the failing test**

```ts
describe("useBrandMutations", () => {
  it("invalidates the list after a create so the table refreshes itself", async () => {
    const { result, queryClient } = renderHook(
      () => ({ list: useBrands(), m: useBrandMutations() }),
      { wrapper({ token: "host-token" }) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await result.current.m.create.mutateAsync({ name: "Acme" } as never);
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["emporix", "brands"] }),
    );
  });

  it("does not invalidate when the write fails", async () => {
    server.failNext(409);
    const { result, queryClient } = renderHook(() => useBrandMutations(), {
      wrapper({ token: "host-token" }),
    });
    const spy = vi.spyOn(queryClient, "invalidateQueries");
    await expect(result.current.create.mutateAsync({} as never)).rejects.toThrow();
    expect(spy).not.toHaveBeenCalled();
  });

  /**
   * A 403 is the expected answer when the module runs on a token without the
   * scope — a storefront token, or a dashboard user whose role was not granted
   * it. The mutation must surface it as an error the UI can name, not swallow it.
   */
  it("surfaces a scope failure as an error", async () => {
    server.failNext(403);
    const { result } = renderHook(() => useBrandMutations(), {
      wrapper({ token: "storefront-token" }),
    });
    await expect(result.current.create.mutateAsync({} as never)).rejects.toMatchObject({
      status: 403,
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-examples-md-module test -- brands`
Expected: FAIL — `useBrandMutations` is not exported.

- [ ] **Step 3: Write the implementation**

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { auth } from "@viu/emporix-sdk";

type BrandInput = Parameters<EmporixClient["brands"]["createBrand"]>[0];
type BrandUpdate = Parameters<EmporixClient["brands"]["updateBrand"]>[1];

/**
 * Brand writes.
 *
 * Plain `useMutation`: there is no write-side factory in `@viu/emporix-sdk-react`,
 * so the invalidate is explicit. It runs on success only — a failed write left
 * the server state alone, and refetching to establish that is a billed call for
 * an answer we already have.
 *
 * The context is built here rather than taken from a factory, so the token has
 * to be read at call time: a mutation object outlives the render it was created
 * in, and the host rotates the token.
 */
export function useBrandMutations(): BrandMutations {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const ctx = () => {
    const token = storage.getCustomerToken();
    if (token === null) throw new Error("brand mutations require the host token");
    return auth.customer(token);
  };
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["emporix", "brands"] });
    void qc.invalidateQueries({ queryKey: ["emporix", "brand"] });
  };

  return {
    create: useMutation({
      mutationFn: (input: BrandInput) => client.brands.createBrand(input, ctx()),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: BrandUpdate }) =>
        client.brands.updateBrand(v.id, v.input, ctx()),
      onSuccess: invalidate,
    }),
    patch: useMutation({
      mutationFn: (v: { id: string; patch: BrandUpdate }) =>
        client.brands.patchBrand(v.id, v.patch, ctx()),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => client.brands.deleteBrand(id, ctx()),
      onSuccess: invalidate,
    }),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm -F @viu/emporix-examples-md-module test`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add examples/md-module
git commit -m "feat(examples): add brand mutations to the dashboard module"
```

### Task 4: The brand admin UI

**Files:**
- Create: `examples/md-module/src/admin/BrandAdmin.tsx`, `examples/md-module/src/admin/ScopeError.tsx`

- [ ] **Step 1: Write `ScopeError.tsx`**

A 403 here is a configuration answer, not a crash, and it is the failure a dashboard operator will actually hit. Saying so beats a stack trace:

```tsx
export function ScopeError({ error }: { error: unknown }): React.JSX.Element | null {
  const status = (error as { status?: number } | null)?.status;
  if (status !== 403) return null;
  return (
    <p role="alert">
      This dashboard user's token does not carry the scope for this operation. Grant it in the
      Managed Dashboard's user administration — the module cannot widen its own scopes.
    </p>
  );
}
```

- [ ] **Step 2: Write `BrandAdmin.tsx`**

A table from `useBrands()`, a create form, and per-row edit and delete driven by `useBrandMutations()`. Render four states explicitly: `isPending`, `isError` (with `ScopeError` first, then the generic message), empty, and the table. Disable every button on `mutation.isPending`.

- [ ] **Step 3: Verify the build**

Run: `pnpm -F @viu/emporix-examples-md-module build`
Expected: success, and the federation remote entry is emitted.

- [ ] **Step 4: Commit**

```bash
git add examples/md-module
git commit -m "feat(examples): add the brand admin view to the dashboard module"
```

---

## Phase 2 — Labels, to test whether the shape generalises

### Task 5: Labels, mirroring brands

This task exists to answer one question: does the brand shape port to a second facade **without changes**? If it does, the promotion in Phase 4 is a mechanical wrapper. If it does not, the difference is the finding — record it rather than papering over it.

**Files:**
- Create: `examples/md-module/src/admin/useLabels.ts`, `examples/md-module/src/admin/LabelAdmin.tsx`, `examples/md-module/tests/labels.test.ts`

- [ ] **Step 1: Write the tests**

The same six cases as brands, with `labels` / `label` resources and `client.labels.*`. Copy them deliberately rather than parameterising: the point is to find out where the two diverge, and a shared table would hide exactly that.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -F @viu/emporix-examples-md-module test -- labels`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Mirror `useBrands.ts`. **Note anything that had to change** — a different pagination field, a required query parameter, a different error shape — in a comment at the top of the file. That note is Phase 4's input.

- [ ] **Step 4: Run the tests, then compare the two files**

Run: `pnpm -F @viu/emporix-examples-md-module test`
Expected: PASS, 12 tests.

Then run: `diff <(sed 's/[Bb]rand/X/g' src/admin/useBrands.ts) <(sed 's/[Ll]abel/X/g' src/admin/useLabels.ts)`
Expected: near-empty. **Record the actual diff in the commit message** — an empty diff is the evidence that a generic wrapper is possible; a large one is the evidence that it is not.

- [ ] **Step 5: Commit**

```bash
git add examples/md-module
git commit -m "feat(examples): add label administration to the dashboard module"
```

---

## Phase 3 — Live verification

### Task 6: Drive both views against the live tenant

Unit tests here mock the client, so they prove the wiring and nothing about the tenant. Every previous surprise in this repo came from the live run: a facade defaulting to a scope the browser lacks, a field named differently than the method suggests, a read that needs a server-only context.

- [ ] **Step 1: Get a dashboard token into the standalone module**

`pnpm dev` assembles `appState` from env vars. The token goes in an untracked env file — never in source, never echoed to a terminal, and the human pastes it. An agent must not ask for it in chat either.

- [ ] **Step 2: Verify the brand read**

Confirm: the request goes to the environment's API host with `Authorization: Bearer <host token>`, the table renders the tenant's real brands, and the cache key starts `["emporix", "brands"]`.

- [ ] **Step 3: Verify one full write cycle**

Create a brand named obviously for the test, confirm the table updates **without a manual reload**, then delete it. Leave the tenant as it was found and say so.

- [ ] **Step 4: Verify the scope failure deliberately**

Point the module at a **storefront** token and confirm the 403 renders through `ScopeError` rather than as a stack trace. This is the one path a real dashboard operator will hit, and it is only reachable on purpose.

- [ ] **Step 5: Record what was and was not exercised**

Write the findings into `examples/md-module/README.md`, including anything that could not be verified and why. «Not exercised because the tenant has no X» is a finding, not a gap to hide.

- [ ] **Step 6: Commit**

```bash
git add examples/md-module
git commit -m "docs(examples): record the live verification of the dashboard admin views"
```

---

## Phase 4 — The promotion decision

### Task 7: Decide what moves into the package

**Not a foregone conclusion.** This task can legitimately end with «nothing moves», and that outcome must be written down with its reasoning rather than left implicit.

- [ ] **Step 1: Answer the four questions on the evidence**

1. **Did the brand shape port to labels unchanged?** (Task 5's diff.) If not, a generic wrapper would have to model the difference, and one wrapper per facade is not obviously better than the twelve lines a consumer writes with the now-public factory.
2. **How much code would a consumer actually save?** Count the lines in `useBrands.ts` that are *not* the facade call. If the answer is «the `useEmporix` line and the resource string», the factory export was the whole win and hooks add packaging, not leverage.
3. **Is the cache-key convention the real value?** If a consumer can get it wrong, a wrapper prevents a silent bug and earns its place even when it saves few lines.
4. **How many facades would follow?** Two proven is not a mandate for twenty-one. Name the ones a real dashboard needs next, or admit the list is unknown.

- [ ] **Step 2: If the answer is «promote»**

Create `packages/react/src/admin/` with the brand and label hooks, add an `./admin` entry to `package.json` `exports` and to `tsup.config.ts`, and port the tests into `packages/react/tests/`.

**The root must not export them.** Importing an admin hook into a storefront fails with a **403 at runtime**, not a type error, and today's invariant is that everything reachable from the root is storefront-safe. The entry point is what carries the requirement, and tree-shaking keeps it free for storefronts that never import it.

Add a test asserting the root does **not** export them, mirroring `tests/public-factory.test.ts` — the boundary is the point, so it needs a guard.

Write a `minor` changeset for `@viu/emporix-sdk-react` naming the new entry, the scope requirement, and the runtime-403 failure mode.

- [ ] **Step 3: If the answer is «do not promote»**

Record it in `docs/react.md` next to the Managed Dashboard material: the factory is the supported path, the example is the reference implementation, and the reason hooks were not added. Written down, this stops the same question being reopened from scratch in three months.

- [ ] **Step 4: Verify the whole workspace either way**

```bash
pnpm -r build && pnpm test && pnpm typecheck && pnpm lint
```
Expected: all four exit 0. `pnpm test` filters `./packages/*` — do not substitute `pnpm -r test`, which would run the e2e suite against the live tenant.

- [ ] **Step 5: Commit**

```bash
git add packages docs examples .changeset
git commit -m "docs(react): record the admin-hook promotion decision"
```

---

## Release gate

Only Phase 4's promotion branch touches a published package. If it does:

1. `pnpm -r build && pnpm test && pnpm typecheck && pnpm lint` all exit 0.
2. `./admin` resolves from the built artifact — check `dist/admin.d.ts` exists and the root `dist/index.d.ts` does **not** name the admin hooks.
3. A changeset exists for `@viu/emporix-sdk-react`.
4. `gh pr checks <n>` all green, not pending.

## Decisions that are not mine

- **Whether the module ships to the real dashboard**, or stays a reference. Task 6 needs a dashboard token either way; deploying the remote is a separate call.
- **Which facades come after labels.** Task 7 asks for the list; only someone who knows the dashboard roadmap can supply it.
- **Whether a 403 should be handled centrally.** `ScopeError` is per-view here. A provider-level handler would be a package change and a different design conversation.

## Self-review

**Coverage.** All four points the analysis raised are assigned: the read path (Tasks 2, 5), the write path (Tasks 3, 5), the scope-failure surface (Tasks 4, 6), and the promotion question (Task 7). The factory export itself is already merged as #307 and is a precondition, not a task here.

**Placeholders.** Task 4 Step 2 and Task 5 Step 3 describe UI and a mirrored file rather than quoting them in full — deliberately: the first is presentational and the second must be written by hand *so that its diff against the brand file is the evidence Task 7 needs*. Every step that carries a decision or a facade contract quotes real code.

**Type consistency.** `BrandList`/`Brand`/`BrandInput`/`BrandUpdate` are derived from the facade in Task 2 and reused unchanged in Task 3. The `BrandMutations` interface in Task 3 is what `BrandAdmin.tsx` consumes in Task 4. The resource strings `"brands"` and `"brand"` are the same in the hooks, the invalidation and the key assertions.
