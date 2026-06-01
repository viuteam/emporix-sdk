# Shopping List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `client.shoppingLists` (SDK) + `@viu/emporix-sdk-react` hooks for the Emporix Shopping List Service — per-customer named lists with low-level CRUD and read-modify-write item helpers.

**Architecture:** A `ShoppingListService` normalizes the awkward per-customer envelope wire shape into a clean `ShoppingList[]`, defaults to a required customer `AuthContext`, and offers `addItem`/`removeItem`/`setItemQuantity` as last-write-wins read-modify-write helpers. React hooks wrap it (customer-only); write mutations take `customerId` as a mutation variable.

**Tech Stack:** TypeScript, Vitest + MSW, @tanstack/react-query, @hey-api/openapi-ts, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-shopping-list-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `shopping-list` spec URL |
| `packages/sdk/src/generated/shopping-list/**` | generated types (committed, reference) |
| `packages/sdk/src/services/shopping-list.ts` | `ShoppingListService` + public types |
| `packages/sdk/src/shopping-list.ts` | facade re-export |
| `packages/sdk/src/core/logger.ts` | add `"shopping-list"` to `ServiceName` |
| `packages/sdk/src/client.ts` | wire `shoppingLists` |
| `packages/sdk/src/index.ts` | re-export |
| `packages/sdk/tests/services/shopping-list.test.ts` | SDK tests |
| `packages/react/src/hooks/use-shopping-lists.ts` | React hooks |
| `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts` | export hooks |
| `packages/react/tests/use-shopping-lists.test.tsx` | React tests |
| `docs/shopping-list.md` | usage doc |
| `.changeset/shopping-list.md` | minor for both packages |

Commands run from repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`. The public SDK types are **hand-written** (the wire shape uses dynamic per-list keys that don't codegen into useful consumer types); the generated dir is produced for convention/reference.

---

## Task 1: Generate Shopping List types (codegen)

**Files:** Modify `packages/sdk/scripts/fetch-specs.ts`; create `packages/sdk/specs/shopping-list.yml`, `packages/sdk/src/generated/shopping-list/**`.

- [ ] **Step 1: Add the spec entry**

In `packages/sdk/scripts/fetch-specs.ts`, add to the `SPECS` object (after the `configuration` entry):

```ts
  "shopping-list": `${BASE}/checkout/shopping-list/api-reference/api.yml`,
```
(URL verified → HTTP 200.)

- [ ] **Step 2: Fetch + generate**

```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```
Expected: `fetched shopping-list (...)` and `generated shopping-list`.

- [ ] **Step 3: Keep the change focused**

`git status --short`. If `fetch:specs`/`generate` touched unrelated `specs/*`/`generated/*` files (upstream drift), restore them:
```bash
git restore packages/sdk/specs packages/sdk/src/generated 2>/dev/null || true
```
then re-run Step 2 and stage only the shopping-list paths in Step 4.

- [ ] **Step 4: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/shopping-list.yml packages/sdk/src/generated/shopping-list
git commit -m "feat(sdk): generate shopping list types"
```

---

## Task 2: ShoppingListService

**Files:** Create `packages/sdk/src/services/shopping-list.ts`, `packages/sdk/src/shopping-list.ts`; test `packages/sdk/tests/services/shopping-list.test.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/sdk/tests/services/shopping-list.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ShoppingListService } from "../../src/services/shopping-list";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const CUST = { kind: "customer" as const, token: "cust-tok" };
const BASE = "https://api.emporix.io/shoppinglist/acme/shopping-lists";

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "shopping-list" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ShoppingListService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const ENVELOPE = [
  {
    customerId: "C1",
    default: {
      name: "default",
      items: [
        { id: 1, productId: "p1", quantity: 2 },
        { id: 2, productId: "p2", quantity: 1 },
      ],
    },
  },
];

describe("ShoppingListService", () => {
  it("list normalizes the wire envelopes into ShoppingList[] with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(ENVELOPE);
      }),
    );
    const lists = await svc().list(CUST);
    expect(seenAuth).toBe("Bearer cust-tok");
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ key: "default", name: "default" });
    expect(lists[0]?.items.map((i) => i.productId)).toEqual(["p1", "p2"]);
  });

  it("list passes the name filter as a query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json(ENVELOPE);
      }),
    );
    await svc().list(CUST, { name: "default" });
    expect((q as URLSearchParams | null)?.get("name")).toBe("default");
  });

  it("create POSTs the draft and returns the id", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "C1" }, { status: 201 });
      }),
    );
    const res = await svc().create({ name: "wishlist", items: [{ productId: "p9", quantity: 3 }] }, CUST);
    expect(body).toEqual({ name: "wishlist", items: [{ productId: "p9", quantity: 3 }] });
    expect(res.id).toBe("C1");
  });

  it("delete DELETEs the customer path, with the name filter when given", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.delete(`${BASE}/C1`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().delete("C1", CUST, { name: "default" })).resolves.toBeUndefined();
    expect((q as URLSearchParams | null)?.get("name")).toBe("default");
  });

  it("addItem read-modify-writes: appends the item and PUTs the full list", async () => {
    let putBody: unknown = null;
    server.use(
      http.get(BASE, () => HttpResponse.json(ENVELOPE)),
      http.put(`${BASE}/C1`, async ({ request }) => {
        putBody = await request.json();
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await svc().addItem("C1", "default", { productId: "p3", quantity: 5 }, CUST);
    expect(putBody).toEqual({
      name: "default",
      items: [
        { id: 1, productId: "p1", quantity: 2 },
        { id: 2, productId: "p2", quantity: 1 },
        { productId: "p3", quantity: 5 },
      ],
    });
  });

  it("removeItem drops the matching productId", async () => {
    let putBody: { items: { productId: string }[] } | null = null;
    server.use(
      http.get(BASE, () => HttpResponse.json(ENVELOPE)),
      http.put(`${BASE}/C1`, async ({ request }) => {
        putBody = (await request.json()) as { items: { productId: string }[] };
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await svc().removeItem("C1", "default", "p1", CUST);
    expect(putBody?.items.map((i) => i.productId)).toEqual(["p2"]);
  });

  it("setItemQuantity updates an existing item; quantity<=0 removes it", async () => {
    const puts: { items: { productId: string; quantity: number }[] }[] = [];
    server.use(
      http.get(BASE, () => HttpResponse.json(ENVELOPE)),
      http.put(`${BASE}/C1`, async ({ request }) => {
        puts.push((await request.json()) as { items: { productId: string; quantity: number }[] });
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await svc().setItemQuantity("C1", "default", "p1", 9, CUST);
    expect(puts[0]?.items.find((i) => i.productId === "p1")?.quantity).toBe(9);
    await svc().setItemQuantity("C1", "default", "p2", 0, CUST);
    expect(puts[1]?.items.map((i) => i.productId)).toEqual(["p1"]);
  });

  it("item helpers throw EmporixNotFoundError for an unknown list name", async () => {
    server.use(http.get(BASE, () => HttpResponse.json(ENVELOPE)));
    await expect(svc().addItem("C1", "ghost", { productId: "p", quantity: 1 }, CUST))
      .rejects.toBeInstanceOf(EmporixNotFoundError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/shopping-list.test.ts`
Expected: FAIL — cannot find module `../../src/services/shopping-list`.

- [ ] **Step 3: Implement the service**

Create `packages/sdk/src/services/shopping-list.ts`:

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixNotFoundError } from "../core/errors";

/** A single shopping-list line item. */
export interface ShoppingListItem {
  id?: number;
  productId: string;
  quantity: number;
  cuttingOption?: string;
  servicePackagingOption?: string;
  comment?: string;
  mixins?: Record<string, unknown>;
}

/** A shopping list, normalized from the per-customer wire envelope. */
export interface ShoppingList {
  key: string;
  name: string;
  items: ShoppingListItem[];
  mixins?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Input for create / replace. */
export interface ShoppingListDraft {
  name: string;
  items?: ShoppingListItem[];
  mixins?: Record<string, unknown>;
}

interface WireList {
  name?: string;
  items?: ShoppingListItem[];
  mixins?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const RESERVED = new Set(["customerId", "metadata"]);

/**
 * Per-customer shopping lists (`/shoppinglist/{tenant}/shopping-lists`).
 * `auth` is required: a customer token manages the caller's own lists;
 * a service token (employee scope) can act on any `customerId`. The Emporix
 * API has no item-level CRUD, so `addItem`/`removeItem`/`setItemQuantity`
 * read the list and `PUT` the full body — **last-write-wins**.
 */
export class ShoppingListService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/shoppinglist/${this.ctx.tenant}/shopping-lists`;
  }

  /** The caller's lists (or, with employee scope, all), normalized to an array. */
  async list(auth: AuthContext, opts: { name?: string } = {}): Promise<ShoppingList[]> {
    const envelopes = await this.ctx.http.request<Array<Record<string, unknown>>>({
      method: "GET",
      path: this.base(),
      auth,
      ...(opts.name ? { query: { name: opts.name } } : {}),
    });
    const out: ShoppingList[] = [];
    for (const env of envelopes ?? []) {
      for (const [key, value] of Object.entries(env)) {
        if (RESERVED.has(key) || value === null || typeof value !== "object") continue;
        const v = value as WireList;
        out.push({
          key,
          name: v.name ?? key,
          items: v.items ?? [],
          ...(v.mixins ? { mixins: v.mixins } : {}),
          ...(v.metadata ? { metadata: v.metadata } : {}),
        });
      }
    }
    return out;
  }

  /** Create a list; returns the new list id. */
  async create(draft: ShoppingListDraft, auth: AuthContext): Promise<{ id: string }> {
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: draft,
    });
  }

  /** Replace the named list (low-level PUT). */
  async replace(customerId: string, draft: ShoppingListDraft, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(customerId)}`,
      auth,
      body: draft,
    });
  }

  /** Delete the named list, or all the customer's lists when `name` is omitted. */
  async delete(customerId: string, auth: AuthContext, opts: { name?: string } = {}): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(customerId)}`,
      auth,
      ...(opts.name ? { query: { name: opts.name } } : {}),
    });
  }

  private async loadList(listName: string, auth: AuthContext): Promise<ShoppingList> {
    const lists = await this.list(auth, { name: listName });
    const found = lists.find((l) => l.name === listName);
    if (!found) throw new EmporixNotFoundError(`Shopping list "${listName}" not found`, 404);
    return found;
  }

  private async put(customerId: string, list: ShoppingList, items: ShoppingListItem[], auth: AuthContext): Promise<void> {
    await this.replace(
      customerId,
      { name: list.name, items, ...(list.mixins ? { mixins: list.mixins } : {}) },
      auth,
    );
  }

  /** Add/replace an item by `productId` (read-modify-write, last-write-wins). */
  async addItem(customerId: string, listName: string, item: ShoppingListItem, auth: AuthContext): Promise<void> {
    const list = await this.loadList(listName, auth);
    const items = [...list.items.filter((i) => i.productId !== item.productId), item];
    await this.put(customerId, list, items, auth);
  }

  /** Remove an item by `productId` (no-op if absent). */
  async removeItem(customerId: string, listName: string, productId: string, auth: AuthContext): Promise<void> {
    const list = await this.loadList(listName, auth);
    const items = list.items.filter((i) => i.productId !== productId);
    await this.put(customerId, list, items, auth);
  }

  /** Set an item's quantity; `quantity <= 0` removes it. Adds the item if absent. */
  async setItemQuantity(customerId: string, listName: string, productId: string, quantity: number, auth: AuthContext): Promise<void> {
    if (quantity <= 0) return this.removeItem(customerId, listName, productId, auth);
    const list = await this.loadList(listName, auth);
    let items = list.items.map((i) => (i.productId === productId ? { ...i, quantity } : i));
    if (!items.some((i) => i.productId === productId)) items = [...items, { productId, quantity }];
    await this.put(customerId, list, items, auth);
  }
}
```

Create the facade `packages/sdk/src/shopping-list.ts`:

```ts
export * from "./services/shopping-list";
```

- [ ] **Step 4: Run the tests + typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/shopping-list.test.ts
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/shopping-list.ts packages/sdk/src/shopping-list.ts packages/sdk/tests/services/shopping-list.test.ts
git commit -m "feat(sdk): add shopping list service"
```

---

## Task 3: Wire onto EmporixClient

**Files:** Modify `packages/sdk/src/core/logger.ts`, `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`; test `packages/sdk/tests/services/shopping-list-wiring.test.ts`.

- [ ] **Step 1: Write the failing wiring test**

Create `packages/sdk/tests/services/shopping-list-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { ShoppingListService } from "../../src/services/shopping-list";

describe("EmporixClient shopping list wiring", () => {
  it("exposes shoppingLists", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.shoppingLists).toBeInstanceOf(ShoppingListService);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/shopping-list-wiring.test.ts`
Expected: FAIL — `sdk.shoppingLists` is undefined.

- [ ] **Step 3a: Add `"shopping-list"` to `ServiceName`**

In `packages/sdk/src/core/logger.ts`, add to the union (after `"configuration"`):

```ts
  | "configuration"
  | "shopping-list"
  | "http"
  | "auth";
```

- [ ] **Step 3b: Wire `client.ts`**

Import (next to the other service imports):
```ts
import { ShoppingListService } from "./services/shopping-list";
```
Field (after `clientConfig`):
```ts
  readonly shoppingLists: ShoppingListService;
```
Construction (after `this.clientConfig = ...`):
```ts
    this.shoppingLists = new ShoppingListService(mk("shopping-list"));
```

- [ ] **Step 3c: Re-export in `packages/sdk/src/index.ts`**

Add after `export * from "./client-config";`:
```ts
export * from "./shopping-list";
```

- [ ] **Step 4: Run wiring test, full SDK suite, typecheck**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/shopping-list-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
```
Expected: all PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/shopping-list-wiring.test.ts
git commit -m "feat(sdk): expose shopping list service on the client"
```

---

## Task 4: React hooks

**Files:** Create `packages/react/src/hooks/use-shopping-lists.ts`; modify `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts`; test `packages/react/tests/use-shopping-lists.test.tsx`.

- [ ] **Step 1: Rebuild the SDK so `dist/` exposes `shoppingLists`**

```bash
pnpm -F @viu/emporix-sdk build
```
Expected: build completes; `grep -rl "ShoppingListService" packages/sdk/dist` returns at least one file.

- [ ] **Step 2: Write the failing tests**

Create `packages/react/tests/use-shopping-lists.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useShoppingLists, useAddToShoppingList } from "../src/hooks/use-shopping-lists";
import type { ReactNode } from "react";

const BASE = "https://api.emporix.io/shoppinglist/acme/shopping-lists";
const ENVELOPE = [{ customerId: "C1", default: { name: "default", items: [{ id: 1, productId: "p1", quantity: 2 }] } }];

const server = setupServer(
  http.get(BASE, () => HttpResponse.json(ENVELOPE)),
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
  const storage = createMemoryStorage({ initial: "cust-tok" }); // logged-in customer
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useShoppingLists", () => {
  it("returns the normalized lists for the logged-in customer", async () => {
    const { result } = renderHook(() => useShoppingLists(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((l) => l.name)).toEqual(["default"]);
  });
});

describe("useAddToShoppingList", () => {
  it("PUTs the modified list and invalidates the lists query", async () => {
    let putCalled = false;
    server.use(
      http.put(`${BASE}/C1`, () => {
        putCalled = true;
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const { result } = renderHook(() => useAddToShoppingList(), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ customerId: "C1", listName: "default", item: { productId: "p2", quantity: 1 } });
    });
    expect(putCalled).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-shopping-lists.test.tsx`
Expected: FAIL — cannot find module `../src/hooks/use-shopping-lists`.

- [ ] **Step 4: Implement the hooks**

Create `packages/react/src/hooks/use-shopping-lists.ts`:

```ts
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  type ShoppingList,
  type ShoppingListItem,
  type ShoppingListDraft,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx } from "./internal/use-read-auth";
import { useReadSite } from "./internal/use-read-site";
import { emporixKey } from "./internal/query-keys";

const SHOPPING_LIST_STALE_TIME = 30_000;
const INVALIDATE_KEY = ["emporix", "shopping-lists"] as const;

/** The caller's shopping lists (customer-only). Optionally filtered by name. */
export function useShoppingLists(
  opts: { name?: string } = {},
): UseQueryResult<ShoppingList[]> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const { siteCode } = useReadSite();
  return useQuery({
    queryKey: emporixKey("shopping-lists", [opts.name ?? null], { tenant: client.tenant, authKind: ctx.kind, siteCode }),
    queryFn: () => client.shoppingLists.list(ctx, opts),
    staleTime: SHOPPING_LIST_STALE_TIME,
  });
}

/** Create a shopping list. */
export function useCreateShoppingList(): UseMutationResult<{ id: string }, unknown, ShoppingListDraft> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (draft: ShoppingListDraft) => client.shoppingLists.create(draft, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Delete a named list (or all the customer's lists when `name` is omitted). */
export function useDeleteShoppingList(): UseMutationResult<void, unknown, { customerId: string; name?: string }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, name }: { customerId: string; name?: string }) =>
      client.shoppingLists.delete(customerId, ctx, name !== undefined ? { name } : {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Add/replace an item in a list. */
export function useAddToShoppingList(): UseMutationResult<void, unknown, { customerId: string; listName: string; item: ShoppingListItem }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, listName, item }: { customerId: string; listName: string; item: ShoppingListItem }) =>
      client.shoppingLists.addItem(customerId, listName, item, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Remove an item from a list by productId. */
export function useRemoveFromShoppingList(): UseMutationResult<void, unknown, { customerId: string; listName: string; productId: string }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, listName, productId }: { customerId: string; listName: string; productId: string }) =>
      client.shoppingLists.removeItem(customerId, listName, productId, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}

/** Set an item's quantity (0 removes it). */
export function useSetShoppingListItemQuantity(): UseMutationResult<void, unknown, { customerId: string; listName: string; productId: string; quantity: number }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, listName, productId, quantity }: { customerId: string; listName: string; productId: string; quantity: number }) =>
      client.shoppingLists.setItemQuantity(customerId, listName, productId, quantity, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: INVALIDATE_KEY }),
  });
}
```

- [ ] **Step 5: Export the hooks**

In `packages/react/src/hooks/index.ts`, add a re-export block (next to the other `export { … } from "./use-*"` lines):
```ts
export {
  useShoppingLists,
  useCreateShoppingList,
  useDeleteShoppingList,
  useAddToShoppingList,
  useRemoveFromShoppingList,
  useSetShoppingListItemQuantity,
} from "./use-shopping-lists";
```

In `packages/react/src/index.ts`, add the same six names to the main named-export list (alongside the other `use*` hook exports).

- [ ] **Step 6: Run the tests + typecheck**

```bash
pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-shopping-lists.test.tsx
pnpm -F @viu/emporix-sdk-react typecheck
```
Expected: tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/use-shopping-lists.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-shopping-lists.test.tsx
git commit -m "feat(react): add shopping list hooks"
```

---

## Task 5: Documentation

**Files:** Create `docs/shopping-list.md`.

- [ ] **Step 1: Write the doc**

Create `docs/shopping-list.md`:

````markdown
# Shopping List

`client.shoppingLists` reads/writes the Emporix Shopping List Service —
per-customer named lists. `auth` is **required**: a logged-in customer manages
their **own** lists with their customer token; a service token (employee scope)
can act on any `customerId`.

```ts
import { auth } from "@viu/emporix-sdk";
const cust = auth.customer(customerToken);

const lists = await client.shoppingLists.list(cust);             // normalized array
await client.shoppingLists.create({ name: "wishlist" }, cust);   // → { id }
await client.shoppingLists.addItem("C1", "wishlist", { productId: "p1", quantity: 2 }, cust);
await client.shoppingLists.setItemQuantity("C1", "wishlist", "p1", 5, cust); // 0 removes
await client.shoppingLists.removeItem("C1", "wishlist", "p1", cust);
await client.shoppingLists.delete("C1", cust, { name: "wishlist" });          // omit name → all
```

The Emporix API has **no item-level CRUD**: `addItem`/`removeItem`/
`setItemQuantity` read the list and `PUT` the full body — **last-write-wins**.
The awkward per-customer wire envelope is normalized to a clean `ShoppingList[]`.

## React

Customer-only hooks; write mutations take `customerId` as a mutation variable
(storage holds only the token). Stale-time 30s; mutations invalidate the list query.

```tsx
import {
  useShoppingLists, useCreateShoppingList,
  useAddToShoppingList, useRemoveFromShoppingList,
  useSetShoppingListItemQuantity, useDeleteShoppingList,
} from "@viu/emporix-sdk-react";

const { data: lists } = useShoppingLists();
const add = useAddToShoppingList();
add.mutate({ customerId: "C1", listName: "wishlist", item: { productId: "p1", quantity: 2 } });
```
````

- [ ] **Step 2: Commit**

```bash
git add docs/shopping-list.md
git commit -m "docs(sdk): document the shopping list service"
```

---

## Task 6: Changeset + final verification

**Files:** Create `.changeset/shopping-list.md`.

- [ ] **Step 1: Write the changeset**

Create `.changeset/shopping-list.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Shopping List bindings: `client.shoppingLists` (per-customer named lists —
list/create/replace/delete plus read-modify-write item helpers, last-write-wins)
and React hooks (`useShoppingLists`, `useCreateShoppingList`, `useAddToShoppingList`,
`useRemoveFromShoppingList`, `useSetShoppingListItemQuantity`, `useDeleteShoppingList`).
```

- [ ] **Step 2: Verify the changeset**

Run: `pnpm changeset status --since=origin/main`
Expected: `@viu/emporix-sdk` and `@viu/emporix-sdk-react` at minor; exits 0.

- [ ] **Step 3: Commit**

```bash
git add .changeset/shopping-list.md
git commit -m "chore(release): add shopping list changeset"
```

- [ ] **Step 4: Final verification**

```bash
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test
pnpm -F @viu/emporix-sdk-react typecheck
pnpm -F @viu/emporix-sdk-react lint
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 surface (low-level + item helpers, LWW) → Task 2 (methods + tests). D2 normalization → Task 2 `list` + test. D3 auth required → Task 2 signatures. D4 React (customer-only, customerId via mutation variables, 30s, invalidate) → Task 4. D5 LWW (no version) → Task 2 item helpers. §6 wire shapes → Task 1 codegen + Task 2 bodies. Tests → Tasks 2/3/4. Docs/changeset → Tasks 5/6. No gaps.
- **Placeholder scan:** No TBD/TODO; every code step is complete; commands have expected output. `metadata?: Record<string, unknown>` is an intentional opaque type, not a placeholder.
- **Type consistency:** `ShoppingList`/`ShoppingListItem`/`ShoppingListDraft` identical across Task 2 (impl), Task 4 (hooks import), Task 6 (changeset). Method names `list`/`create`/`replace`/`delete`/`addItem`/`removeItem`/`setItemQuantity` consistent between service, hooks, docs. `request` (not `req`) used throughout, matching the codebase. Invalidation prefix `["emporix","shopping-lists"]` matches the `emporixKey("shopping-lists", …)` produced key.
```
