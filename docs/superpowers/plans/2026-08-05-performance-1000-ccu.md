# 1'000-CCU-Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three code findings from the 1'000-CCU analysis that bite first under this load profile — session-read amplification, uncached public route, session read in the TTFB path — plus make the HTTP timeouts configurable.

**Architecture:** Three of the four fixes live in the `@viu/emporix-sdk-next` package so that every consumer gets them and not just the example. The per-request memo uses a `WeakMap` anchored on the request-scoped object from `await cookies()` — no `react` import, so that the React dependency removed in [#216](https://github.com/viuteam/emporix-sdk/pull/216) stays removed. Only **read-only** handles are shared; mutable handles stay per call, because `emporixLogin` deliberately builds two and flushes in between.

**Tech Stack:** TypeScript, Next 16 (App Router, Node runtime), Vitest + MSW, pnpm workspace, Changesets.

## Global Constraints

- `@viu/emporix-sdk-next` imports **no** `react` and **no** `@tanstack/react-query` — pinned by `packages/next/tests/no-react-dependency.test.ts`. Any solution that breaks that is wrong.
- Node-runtime-only in the next package (`node:crypto` in `cookie-crypto.ts`). No Edge.
- Commitlint scopes: only `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. **`next` is not an allowed scope.** First word after the scope in lowercase.
- Every PR against `main` needs a changeset — the gate runs unconditionally (`changeset-check.yml:26`).
- Feature branch per task group, PR against `main`, no merge without approval.
- **Do not run load tests.** Verification happens through unit tests and, where necessary, manual counting in the dev-server log.
- Examples typecheck against `dist/`: after SDK/next changes, `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-next build` before the example typecheck.

## Baseline measurement (from the analysis, do not re-measure)

| Path | Current | Target after this plan |
|---|---|---|
| Session reads per `/cart` page view | 7 | **2** (proxy + one render read) |
| Emporix calls per typeahead keystroke | 1 | **0** on a cache hit |
| TTFB blocked by session/Redis | yes | no (Suspense island) |
| `readMs` | 60 s | 8 s in the example, default unchanged |

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/next/src/request-scope.ts` | **new.** Per-request memo via `WeakMap`, anchored on an arbitrary request-scoped object. Knows nothing about session semantics. | 1 |
| `packages/next/src/session-cookies.ts` | `emporixSessionHandle` shares read-only handles via the memo; body extracted into `buildHandle`. | 1 |
| `packages/next/src/public-route.ts` | The upstream `fetch` gets tags + `revalidate`, the response gets `Cache-Control`. | 2 |
| `packages/next/src/client.ts` | `GetEmporixClientOptions.timeouts` including the memo key. | 3 |
| `packages/next/src/session-client.ts` | `WithEmporixSessionOptions.timeouts` passed to `newGuestClient`. | 3 |
| `examples/next-server-first/app/emporix.ts` | Central timeout values for the example. | 3 |
| `examples/next-server-first/app/lib/category-index.ts` | **new.** Pre-processed index (id → label/path/children) in `unstable_cache`, instead of a 378 KiB raw tree per render. | 4 |
| `examples/next-server-first/app/components/header.tsx` | Static shell; the session-reading part moves into `session-nav.tsx`. | 5 |
| `examples/next-server-first/app/components/session-nav.tsx` | **new.** The only part of the header that reads the session — behind `Suspense`. | 5 |

---

### Task 1: Per-request memo for read-only session handles

The core. On `/cart`, seven handles are built today, six of them read-only, each with its own `await cookies()`, `await headers()`, cookie parsing plus AES-GCM — and in store mode with its own Redis `read`. Evidence: `token-proxy.ts:75`, `header.tsx:20`, `header.tsx:21`, `language-switcher.tsx:16`, `cart/page.tsx:20`, `site-context.ts:53`, `session-client.ts:102`.

**Files:**
- Create: `packages/next/src/request-scope.ts`
- Modify: `packages/next/src/session-cookies.ts:112-221` (body of `emporixSessionHandle`)
- Test: `packages/next/tests/request-scope.test.ts` (new), `packages/next/tests/session-store.test.ts` (check the existing expectations)

**Interfaces:**
- Produces: `requestScoped<T>(anchor: object, key: string, build: () => Promise<T>): Promise<T>` — memoizes the **promise**, so that concurrent callers share the same build.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write a failing test for the memo**

`packages/next/tests/request-scope.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { requestScoped } from "../src/request-scope";

describe("requestScoped", () => {
  it("builds once per anchor and key", async () => {
    const anchor = {};
    let builds = 0;
    const build = async () => {
      builds += 1;
      return { n: builds };
    };
    const a = await requestScoped(anchor, "k", build);
    const b = await requestScoped(anchor, "k", build);
    expect(a).toBe(b);
    expect(builds).toBe(1);
  });

  it("keeps different keys apart", async () => {
    const anchor = {};
    const a = await requestScoped(anchor, "read", async () => ({ mode: "read" }));
    const b = await requestScoped(anchor, "write", async () => ({ mode: "write" }));
    expect(a).not.toBe(b);
  });

  it("keeps different anchors apart — one request must not see another's", async () => {
    const first = await requestScoped({}, "k", async () => ({ id: 1 }));
    const second = await requestScoped({}, "k", async () => ({ id: 2 }));
    expect(first).not.toEqual(second);
  });

  it("shares one in-flight build between concurrent callers", async () => {
    const anchor = {};
    let builds = 0;
    const build = async () => {
      builds += 1;
      await new Promise((r) => setTimeout(r, 10));
      return { builds };
    };
    const [a, b] = await Promise.all([
      requestScoped(anchor, "k", build),
      requestScoped(anchor, "k", build),
    ]);
    expect(a).toBe(b);
    expect(builds).toBe(1);
  });

  it("does not cache a rejected build", async () => {
    const anchor = {};
    let calls = 0;
    const build = async () => {
      calls += 1;
      if (calls === 1) throw new Error("store down");
      return { ok: true };
    };
    await expect(requestScoped(anchor, "k", build)).rejects.toThrow("store down");
    // A transient store failure must not poison the whole request.
    await expect(requestScoped(anchor, "k", build)).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd packages/next && npx vitest run tests/request-scope.test.ts`
Expected: FAIL — «Failed to resolve import "../src/request-scope"».

- [ ] **Step 3: Implement `request-scope.ts`**

```ts
/**
 * Per-request memoization without React.
 *
 * `react`'s `cache()` would be the obvious tool and is deliberately not used:
 * this package has no React dependency and keeps it that way (see
 * `tests/no-react-dependency.test.ts`). `AsyncLocalStorage` is no help either —
 * it needs someone to open the context, and Next gives a library no hook that
 * wraps a render.
 *
 * What is left is an anchor that Next already scopes to the request: the object
 * returned by `await cookies()`. Keying a `WeakMap` on it gives exactly
 * request lifetime, and the entry dies with the request because nothing else
 * holds the anchor.
 *
 * The stored value is the **promise**, not the result — that is what makes two
 * concurrent callers share one build instead of racing.
 */
const scopes = new WeakMap<object, Map<string, Promise<unknown>>>();

export function requestScoped<T>(
  anchor: object,
  key: string,
  build: () => Promise<T>,
): Promise<T> {
  let slot = scopes.get(anchor);
  if (slot === undefined) {
    slot = new Map();
    scopes.set(anchor, slot);
  }
  const hit = slot.get(key);
  if (hit !== undefined) return hit as Promise<T>;

  // A rejection is NOT cached: a transient store outage would otherwise poison
  // every later read in the same request, turning one blip into a broken page.
  const made = build().catch((e: unknown) => {
    slot!.delete(key);
    throw e;
  });
  slot.set(key, made);
  return made;
}
```

- [ ] **Step 4: Run the test, confirm it is green**

Run: `cd packages/next && npx vitest run tests/request-scope.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Switch `emporixSessionHandle` over to the memo**

In `packages/next/src/session-cookies.ts`, move the existing function body into `buildHandle` and replace the public function with this:

```ts
export async function emporixSessionHandle(
  opts: { readOnly?: boolean; store?: EmporixSessionStore } = {},
): Promise<EmporixSessionHandle> {
  const jar = await cookies();
  const readOnly = opts.readOnly ?? false;

  // Only READ-ONLY handles are shared, and that is not a half measure.
  // `emporixLogin` builds a mutable handle, flushes it, and then lets
  // `onboardCart` build a SECOND one that must read what the first wrote — the
  // ordering trap the package README draws. Sharing mutable handles would
  // collapse those two into one and break login in store mode.
  //
  // Six of the seven handles a page view builds are read-only, so this still
  // takes /cart from seven session reads to one per render.
  if (!readOnly) return buildHandle(jar, opts);

  // The store is keyed coarsely (`cookie` vs `store`) because an app has one
  // session store — `examples/next-server-first` holds it in a module const.
  // Two different stores in one process would share an entry; that is a
  // documented limit, not an oversight.
  const key = `ro|${opts.store === undefined ? "cookie" : "store"}`;
  return requestScoped(jar, key, () => buildHandle(jar, opts));
}
```

`buildHandle` gets the signature `async function buildHandle(jar: Awaited<ReturnType<typeof cookies>>, opts: { readOnly?: boolean; store?: EmporixSessionStore }): Promise<EmporixSessionHandle>` and contains today's code from `const readOnly = opts.readOnly ?? false;` onwards unchanged — including `await isSecure()` and the store hydration.

Add the import: `import { requestScoped } from "./request-scope";`

- [ ] **Step 6: Write a failing test for the shared handle**

Add to `packages/next/tests/session-store.test.ts` (the `fakeStore` there already does not count reads — hence a dedicated counter):

```ts
it("reads the store ONCE for two read-only handles in the same request", async () => {
  const store = fakeStore();
  let reads = 0;
  const counting = { ...store, read: async (id: string) => { reads += 1; return store.read(id); } };
  bag.set("emporix.sid", { name: "emporix.sid", value: "sid-1" });

  const a = await emporixSessionHandle({ readOnly: true, store: counting });
  const b = await emporixSessionHandle({ readOnly: true, store: counting });

  expect(a).toBe(b);
  expect(reads).toBe(1);
});

it("still builds a fresh handle for every MUTABLE call", async () => {
  // emporixLogin depends on this: it flushes handle 1 and expects handle 2 to
  // read the flushed record.
  const store = fakeStore();
  const a = await emporixSessionHandle({ store });
  const b = await emporixSessionHandle({ store });
  expect(a).not.toBe(b);
});
```

- [ ] **Step 7: Run the tests**

Run: `cd packages/next && npx vitest run tests/session-store.test.ts tests/session-client.test.ts tests/session-auth.test.ts`
Expected: PASS. If `session-auth.test.ts` breaks, the read-only boundary is implemented wrongly — do not adjust the test, check the code.

- [ ] **Step 8: Full suite plus typecheck**

Run: `pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next build && pnpm typecheck`
Expected: everything green, 10/10 projects.

- [ ] **Step 9: Verify the anchor identity manually**

The unit tests prove the memo, not that Next hands out the same `cookies()` object per request — that is an implementation detail and has to be checked once against a running server.

```bash
cd examples/next-server-first
# Temporarily in app/session-store.ts: add console.log("[redis] GET", id) inside read().
EMPORIX_SESSION_REDIS_URL=redis://localhost:6379 pnpm dev
# Then hit /cart and count the GET lines per request.
```

Expected: **2** lines per page view (proxy plus one render read), 7 before. If 7 still show up, the anchor assumption is wrong — then switch Task 1 over to `react`'s `cache()` and re-open the peerDependency question (see «Open decision point»). Remove the `console.log` afterwards.

- [ ] **Step 10: Commit**

```bash
git add packages/next/src/request-scope.ts packages/next/src/session-cookies.ts packages/next/tests/
git commit -m "perf(repo): share the read-only session handle within one request"
```

---

### Task 2: Cache the public route

`public-route.ts:71-77` calls `globalThis.fetch` without `next: { tags, revalidate }` and sets no `Cache-Control`. The doc comment at `:25-26` claims the opposite («cached by Next once for all visitors»). This is the route the typeahead hits on every keystroke.

**Files:**
- Modify: `packages/next/src/public-route.ts:34-83`
- Test: `packages/next/tests/public-route.test.ts`

**Interfaces:**
- Consumes: `emporixTagsForUrl(url: string, tenant: string): string[]` (unchanged).
- Produces: `createEmporixPublicRoute(opts?: { tenant?: string; revalidate?: number })` — signature unchanged, behavior cached.

- [ ] **Step 1: Write a failing test**

Add to `packages/next/tests/public-route.test.ts`:

```ts
it("tags the upstream fetch so Next caches it for all visitors", async () => {
  let seenInit: (RequestInit & { next?: { tags?: string[]; revalidate?: number } }) | undefined;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    seenInit = init as typeof seenInit;
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));

  const route = createEmporixPublicRoute({ tenant: "viu", revalidate: 600 });
  const res = await route(sameOriginRequest("/api/emporix/product/viu/products?q=shirt"), {
    params: Promise.resolve({ path: ["product", "viu", "products"] }),
  });

  expect(res.status).toBe(200);
  expect(seenInit?.next?.revalidate).toBe(600);
  expect(seenInit?.next?.tags).toContain("emporix:products");
});

it("lets a CDN cache the response too", async () => {
  // Without this header the response is private by default and every visitor
  // re-enters the Node process for the same public answer.
  const res = await routeWithStubbedUpstream({ revalidate: 600 });
  expect(res.headers.get("Cache-Control")).toBe(
    "public, s-maxage=600, stale-while-revalidate=60",
  );
});
```

Create `sameOriginRequest` and `routeWithStubbedUpstream` as local helpers in the file; `sameOriginRequest` sets `Origin` and `Host` to the same value so that `assertSameOrigin` passes — the existing file already has a pattern for this, which gets reused.

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd packages/next && npx vitest run tests/public-route.test.ts`
Expected: FAIL — `seenInit?.next` is `undefined`, `Cache-Control` is `null`.

- [ ] **Step 3: Implement**

In `public-route.ts`, replace the `fetch` call and the response:

```ts
    const tags = emporixTagsForUrl(upstream, tenant);
    if (tags.length === 0) {
      return new Response("forbidden", { status: 403 });
    }

    const revalidate = opts.revalidate ?? 3600;
    const client = getEmporixClient({
      tenant,
      ...(opts.revalidate !== undefined ? { revalidate: opts.revalidate } : {}),
    });
    const session = await client.tokenProvider.getAnonymousToken();

    // Tagged and revalidated like every other cacheable Emporix GET. Without
    // this the route was an uncached passthrough: one billed Emporix call per
    // typeahead keystroke, for data every visitor shares. The same webhook that
    // invalidates a Server Component's catalog read invalidates this.
    const res = await fetch(upstream, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
      next: { tags, revalidate },
    } as RequestInit & { next: { tags: string[]; revalidate: number } });

    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/json",
        // The Node process is not the only cache in front of this. A public,
        // shared answer belongs in the CDN too.
        "Cache-Control": `public, s-maxage=${revalidate}, stale-while-revalidate=60`,
      },
    });
```

Along with that, fix the wrong comment at `:25-26` and `:61-62` — it is now allowed to be true.

- [ ] **Step 4: Run the tests**

Run: `cd packages/next && npx vitest run tests/public-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Check that error responses are not cached**

An additional test, so that a 500 from upstream does not stick in the CDN for an hour:

```ts
it("does not let a CDN cache an upstream error", async () => {
  const res = await routeWithStubbedUpstream({ status: 502 });
  expect(res.status).toBe(502);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
});
```

Implementation: `const cacheable = res.status >= 200 && res.status < 300;` and set the header accordingly.

- [ ] **Step 6: Commit**

```bash
git add packages/next/src/public-route.ts packages/next/tests/public-route.test.ts
git commit -m "perf(repo): cache the public catalog route instead of passing it through"
```

---

### Task 3: Make the timeouts configurable and set them in the example

`readMs` is 60 s (`packages/sdk/src/core/config.ts:93`). At 1'000 CCU that lets a slow upstream hold sockets and event-loop tasks for a minute per request. The default stays (changing it would be breaking for existing consumers), but it has to be settable from the outside — today neither `getEmporixClient` nor `withEmporixSession` accepts timeouts.

**Files:**
- Modify: `packages/next/src/client.ts:47-133` (option plus memo key)
- Modify: `packages/next/src/session-client.ts:12-34` and `:105-127` (option passed to `newGuestClient`)
- Modify: `examples/next-server-first/app/emporix.ts` (values), `app/lib/site-context.ts:64-69` (pass through)
- Test: `packages/next/tests/client.test.ts`, `packages/next/tests/session-client.test.ts`

**Interfaces:**
- Produces: `GetEmporixClientOptions.timeouts?: { connectMs?: number; readMs?: number }` and `WithEmporixSessionOptions.timeouts?: { connectMs?: number; readMs?: number }`.

- [ ] **Step 1: Write a failing test**

In `packages/next/tests/client.test.ts`:

```ts
it("passes timeouts through and keys the memo on them", () => {
  const fast = getEmporixClient({ timeouts: { readMs: 8_000 } });
  const slow = getEmporixClient({ timeouts: { readMs: 30_000 } });
  expect(fast.config.timeouts.readMs).toBe(8_000);
  expect(slow.config.timeouts.readMs).toBe(30_000);
  // Two different budgets must not collapse into one instance.
  expect(fast).not.toBe(slow);
  expect(getEmporixClient({ timeouts: { readMs: 8_000 } })).toBe(fast);
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd packages/next && npx vitest run tests/client.test.ts`
Expected: FAIL — `timeouts` is not a known field (TS error, or `readMs` stays 60000).

- [ ] **Step 3: Add the option in `client.ts`**

```ts
  /**
   * Per-request budgets. The SDK default is 10 s to headers and 60 s to the end
   * of the body — generous, and at high concurrency that is the problem: a slow
   * upstream holds a socket and an event-loop task for a minute per request.
   * A storefront should pick something it would actually wait for.
   */
  timeouts?: { connectMs?: number; readMs?: number };
```

Add it to the memo key (otherwise two budgets share one instance):

```ts
  const key = `${tenant}|${clientId}|${host ?? ""}|${tagged}|${revalidate}|${JSON.stringify(opts.context ?? {})}|${JSON.stringify(opts.timeouts ?? {})}`;
```

And pass it through when constructing: `...(opts.timeouts !== undefined ? { timeouts: opts.timeouts } : {}),`

- [ ] **Step 4: The same in `session-client.ts`**

`WithEmporixSessionOptions` gets the same field with the same comment, `newGuestClient` passes it through to `new EmporixClient`, and the customer path forwards it automatically via `getEmporixClient({ ...opts, tagged: false })` (which already spreads everything).

- [ ] **Step 5: Run the tests**

Run: `cd packages/next && npx vitest run tests/client.test.ts tests/session-client.test.ts`
Expected: PASS.

- [ ] **Step 6: Set them in the example**

`examples/next-server-first/app/emporix.ts`:

```ts
/**
 * What this storefront is willing to wait for.
 *
 * The SDK default is 60 s to the end of the body. Nobody waits a minute for a
 * cart page, and at 1'000 concurrent users that budget is what turns one slow
 * Emporix minute into a process full of parked requests. 8 s is above the p99
 * of every call this app makes and far below «the user already left».
 */
export const TIMEOUTS = { connectMs: 3_000, readMs: 8_000 } as const;
```

In `app/lib/site-context.ts`, add to `emporixOptions()`: `timeouts: TIMEOUTS,` — and pass it at every `getEmporixClient({ context: … })` site. Affected: `app/page.tsx:31`, `app/search/page.tsx`, `app/product/[id]/page.tsx:33`, `app/category/[id]/page.tsx:37`, `app/lib/category-tree.ts:27`.

- [ ] **Step 7: Typecheck across the example**

Run: `pnpm -F @viu/emporix-sdk-next build && pnpm -F @viu/emporix-examples-next-server-first typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/next/src/client.ts packages/next/src/session-client.ts packages/next/tests/ examples/next-server-first/app/
git commit -m "perf(repo): make the request budgets configurable and pick sane ones in the demo"
```

---

### Task 4: The category tree as a pre-processed index

`category-tree.ts:20` documents 1'631 nodes / 378 KiB. The data cache saves the network call, not the `JSON.parse` per render (`http.ts:154`) and not the walk over 1'631 nodes in `findCategory` (`category/[id]/page.tsx:55`). At ~40 category renders/s that comes to ~15 MB/s of parsing.

**Files:**
- Create: `examples/next-server-first/app/lib/category-index.ts`
- Modify: `examples/next-server-first/app/category/[id]/page.tsx:44-57`, `app/categories/page.tsx:17`
- Test: `examples/next-server-first/tests/category-index.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface CategoryEntry { id: string; label: string; path: { id: string; label: string }[]; children: { id: string; label: string }[]; }
  function categoryIndex(): Promise<{ roots: { id: string; label: string }[]; byId: Record<string, CategoryEntry> }>
  ```
- Consumes: `categoryTree()` from `app/lib/category-tree.ts`, `findCategory` from `app/lib/category-walk.ts` (the latter is replaced by the index, but stays around for `categories/page.tsx` until Step 5 removes it).

- [ ] **Step 1: Write a failing test**

`examples/next-server-first/tests/category-index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildIndex } from "../app/lib/category-index";

const TREE = [
  {
    id: "root",
    name: { en: "Root" },
    subcategories: [
      { id: "kid", name: { en: "Kid" }, subcategories: [{ id: "grandkid", name: { en: "Grandkid" } }] },
    ],
  },
];

describe("buildIndex", () => {
  it("flattens every node into a lookup", () => {
    const idx = buildIndex(TREE as never);
    expect(Object.keys(idx.byId).sort()).toEqual(["grandkid", "kid", "root"]);
  });

  it("carries the breadcrumb path, root first", () => {
    const idx = buildIndex(TREE as never);
    expect(idx.byId["grandkid"]?.path.map((p) => p.id)).toEqual(["root", "kid"]);
  });

  it("carries the direct children only", () => {
    const idx = buildIndex(TREE as never);
    expect(idx.byId["root"]?.children.map((c) => c.id)).toEqual(["kid"]);
    expect(idx.byId["grandkid"]?.children).toEqual([]);
  });

  it("lists the roots", () => {
    expect(buildIndex(TREE as never).roots.map((r) => r.id)).toEqual(["root"]);
  });

  it("survives a node without subcategories or name", () => {
    // The tenant's tree has 1'631 nodes; assuming every one is well-formed is
    // how a single missing field 500s a category page.
    const idx = buildIndex([{ id: "bare" }] as never);
    expect(idx.byId["bare"]).toEqual({ id: "bare", label: "bare", path: [], children: [] });
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd examples/next-server-first && npx vitest run tests/category-index.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `category-index.ts`**

```ts
import { unstable_cache } from "next/cache";
import type { CategoryNode } from "@viu/emporix-sdk";
import { pickText } from "@viu/emporix-examples-shared";
import { categoryTree } from "./category-tree";

export interface CategoryEntry {
  id: string;
  label: string;
  /** Ancestors, root first. Empty for a root. */
  path: { id: string; label: string }[];
  children: { id: string; label: string }[];
}

export interface CategoryIndex {
  roots: { id: string; label: string }[];
  byId: Record<string, CategoryEntry>;
}

/**
 * Flattens the tree once so a page render does not walk 1'631 nodes.
 *
 * Exported separately from the cached wrapper so it is testable without Next —
 * `unstable_cache` needs a request scope, a pure function does not.
 */
export function buildIndex(roots: CategoryNode[]): CategoryIndex {
  const byId: Record<string, CategoryEntry> = {};
  const label = (n: CategoryNode): string => pickText(n.name) || n.id || "";

  const walk = (node: CategoryNode, path: { id: string; label: string }[]): void => {
    const id = node.id;
    if (id === undefined) return;
    const kids = node.subcategories ?? [];
    byId[id] = {
      id,
      label: label(node),
      path,
      children: kids
        .filter((k) => k.id !== undefined)
        .map((k) => ({ id: k.id as string, label: label(k) })),
    };
    const next = [...path, { id, label: label(node) }];
    for (const k of kids) walk(k, next);
  };

  for (const r of roots) walk(r, []);
  return {
    roots: roots.filter((r) => r.id !== undefined).map((r) => ({ id: r.id as string, label: label(r) })),
    byId,
  };
}

/**
 * The index for this request, cached for an hour.
 *
 * Two caches stack here on purpose: the SDK's tagged fetch keeps the 378 KiB
 * tree out of the network, and this keeps the parse and the walk out of the
 * render. The `emporix:categories` tag invalidates the inner one; the hour
 * bounds this one, so a webhook-driven category change shows up within the hour
 * rather than instantly. That is the trade the flat index buys.
 */
export const categoryIndex = unstable_cache(
  async (): Promise<CategoryIndex> => buildIndex(await categoryTree()),
  ["emporix-category-index"],
  { revalidate: 3600, tags: ["emporix:categories"] },
);
```

- [ ] **Step 4: Run the tests**

Run: `cd examples/next-server-first && npx vitest run tests/category-index.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Switch the category page over to the index**

In `app/category/[id]/page.tsx`, replace `categoryTree()` plus `findCategory`:

```ts
  const index = await categoryIndex();
  const entry = index.byId[id];
  if (entry === undefined) notFound();
  const children = entry.children;
```

The breadcrumb comes from `entry.path`. In `app/categories/page.tsx`, replace `categoryTree()` with `categoryIndex()` and `roots`. Afterwards, check whether `app/lib/category-walk.ts` is still used anywhere — if not, delete it along with its test (check `tests/category-tree.test.ts`, do not remove it blindly).

- [ ] **Step 6: Typecheck plus example tests**

Run: `pnpm -F @viu/emporix-examples-next-server-first typecheck && cd examples/next-server-first && npx vitest run`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add examples/next-server-first/app/lib/ examples/next-server-first/app/category examples/next-server-first/app/categories examples/next-server-first/tests/
git commit -m "perf(examples): flatten the category tree into a cached index"
```

---

### Task 5: The header as a Suspense island

The header reads the session in `header.tsx:20-21` and sits in the root layout. That makes **every** page's TTFB wait on the session read — after Task 1 only one of them, but in store mode still a Redis round trip before the first byte.

**Files:**
- Create: `examples/next-server-first/app/components/session-nav.tsx`
- Modify: `examples/next-server-first/app/components/header.tsx`
- Test: manual check (Step 5) — no unit test, because the benefit is streaming behavior and not a return value.

**Interfaces:**
- Produces: `SessionNav(): Promise<React.JSX.Element>` — the session-dependent part (cart badge, login/account/logout).
- Consumes: `cartCount(handle)` from `app/lib/cart-session.ts`, `emporixSessionHandle`, `emporixSession`.

- [ ] **Step 1: Create `session-nav.tsx`**

```tsx
import { emporixSession, emporixSessionHandle } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { cartCount } from "../lib/cart-session";
import { logout } from "../actions/auth";

/**
 * The only part of the shell that reads the session.
 *
 * Split out of `Header` so it can sit behind `Suspense`: the static shell — logo,
 * search box, links — flushes to the browser immediately, and the cart badge
 * streams in when the session read is done. Before this split the whole page's
 * TTFB waited on a Redis round trip that the visitor did not need to see the
 * page.
 *
 * Still zero Emporix calls: the count comes from the session, «am I logged in»
 * from whether a token is stored.
 */
export async function SessionNav(): Promise<React.JSX.Element> {
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  const { customerToken } = await emporixSession(STORE_OPT);
  const count = cartCount(handle);

  return (
    <>
      <a href="/cart" className="u-underline">
        Cart{count > 0 ? ` (${count})` : ""}
      </a>
      {customerToken === null ? (
        <a href="/login" className="u-underline">
          Login
        </a>
      ) : (
        <>
          <a href="/account" className="u-underline">
            Account
          </a>
          <form action={logout} style={{ display: "inline" }}>
            <button type="submit" className="btn btn--ghost btn--sm">
              Log out
            </button>
          </form>
        </>
      )}
    </>
  );
}
```

- [ ] **Step 2: Turn `header.tsx` into the static shell**

`async` goes away, the two session reads disappear, and the navigation part becomes:

```tsx
        <nav
          className="cluster"
          style={{ gap: "var(--s-4)", marginLeft: "auto", fontSize: "var(--step--1)" }}
        >
          <LanguageSwitcher />
          <a href="/categories" className="u-underline">
            Categories
          </a>
          {/* The fallback is a real link, not a spinner: a shell that reflows
              when the badge arrives is worse than one that starts complete.
              Same width, same position, no layout shift. */}
          <Suspense fallback={<a href="/cart" className="u-underline">Cart</a>}>
            <SessionNav />
          </Suspense>
          <a href="/debug" className="u-underline">
            Debug
          </a>
        </nav>
```

Imports: `import { Suspense } from "react";` and `import { SessionNav } from "./session-nav";`. The doc comment at the top of the file has to move along with it — it claims «zero Emporix calls», which still holds, but the reasoning «putting the header in the root layout costs nothing per page view» needs the addition that the session part now streams.

Note: `LanguageSwitcher` also reads the session, in `language-switcher.tsx:16`. After Task 1 it shares the handle with `SessionNav`, but it still blocks the shell. Pulling it into the same `Suspense` boundary is the next step, once the measurement in Step 5 shows it to be a blocker.

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @viu/emporix-examples-next-server-first typecheck`
Expected: PASS.

- [ ] **Step 4: Example tests**

Run: `cd examples/next-server-first && npx vitest run`
Expected: PASS (unchanged — none of the three tests touches the header).

- [ ] **Step 5: Check the streaming manually**

```bash
cd examples/next-server-first && pnpm dev
curl -N -s -o /dev/null -w "TTFB %{time_starttransfer}s total %{time_total}s\n" http://localhost:3000/categories
```

Expected: `time_starttransfer` clearly smaller than `time_total` — the shell arrives before the session part. If the two are equal, the streaming is not taking effect (most common cause: an `await` above the `Suspense` boundary in the layout).

- [ ] **Step 6: Commit**

```bash
git add examples/next-server-first/app/components/
git commit -m "perf(examples): stream the session part of the header"
```

---

### Task 6: Docs, changesets, PR

**Files:**
- Modify: `packages/next/README.md` (the «How the session is managed» section plus the public-route docs)
- Modify: `docs/nextjs.md` — does not exist; instead `packages/next/README.md` and `examples/next-server-first/README.md`
- Create: `.changeset/session-handle-request-scope.md`, `.changeset/public-route-caching.md`, `.changeset/configurable-timeouts.md`

- [ ] **Step 1: Extend the next README**

Under «How the session is managed», a paragraph that names the new invariant: read-only handles are shared per request, mutable ones are not, and why (login ordering). Plus, in the public-route section: the response is now tagged and CDN-cacheable, errors are `no-store`.

- [ ] **Step 2: Write the changesets**

```markdown
---
"@viu/emporix-sdk-next": minor
---

Share the read-only session handle within one request. A page view built up to
seven handles for the same record — six of them read-only — so in store mode it
cost seven Redis reads, and in cookie mode seven parses plus seven AES-GCM
opens. They now resolve to one, memoized on the request-scoped object
`await cookies()` returns.

Mutable handles are deliberately NOT shared: `emporixLogin` builds one, flushes
it, and lets the cart onboarding build a second that must read what the first
wrote. Sharing them would collapse that ordering and break login in store mode.

No React: `cache()` would have been the obvious tool and would have re-added the
dependency this package removed in 0.7.0.
```

The same for the public route (`patch` is not enough — the behavior changes visibly, so `minor`) and the timeouts (`minor`, new option).

- [ ] **Step 3: Full verification**

```bash
pnpm -r build && pnpm typecheck && pnpm -r test && pnpm lint
```
Expected: everything green. Name the numbers in the PR text, do not claim «everything green».

- [ ] **Step 4: Open the PR**

```bash
git push -u origin perf/1000-ccu
gh pr create --base main --title "perf(repo): the four fixes the 1'000-CCU analysis found" --body-file <path>
```

Carry the before/after table from «Baseline measurement» in the PR text and note **explicitly** what is **not** verified: no load test was run, the numbers come from code analysis plus the manual counting in Task 1 Step 9 and Task 5 Step 5.

---

## Deliberately not in this plan

**ISR for catalog pages — its own plan, its own PR.** The chosen scope was «header as a Suspense island, catalog on ISR». The first part is Task 5 here. The second is not reachable with today's code: every catalog page calls `siteContext()` (`app/lib/site-context.ts:53`), which reads the language from a cookie, and a cookie read makes the route irrevocably dynamic. Putting `revalidate` on top of that changes nothing.

Real ISR needs the language **in the URL** instead of in the cookie — a `[lang]` segment with `generateStaticParams`, plus a header that no longer reads the session server-side. That is a routing rebuild with an effect on every link and on the language switcher, which is why it lives in **[2026-08-05-catalog-isr.md](./2026-08-05-catalog-isr.md)** and has been implemented as its own PR: [#221](https://github.com/viuteam/emporix-sdk/pull/221).

Ordering: Task 5 of this plan (the Suspense island) and the ISR plan both touch `header.tsx`. The ISR plan turns the header into a client component and thereby replaces the Suspense island. Anyone implementing both builds the ISR plan **after** Task 5 and throws the island away in the process — or skips Task 5 if the ISR PR is coming up anyway.

What Task 5 delivers instead: the pages stay dynamic, but the session read no longer blocks the first byte, and the upstream data is shared through the data cache anyway. The CDN gain on ~60 % of the page views stays open until the i18n routing lands.

**49 HttpClients per guest request** (`client.ts:128-179` × `create-core.ts:71`). Real, but not proven to be a bottleneck — ~2'500 allocations/s is little for V8. The fix (lazy getters instead of 49 fields) touches the public shape of `EmporixClient` and should only be built once a profile shows it. Without a load test that profile does not exist, so it stands here as a note and not as a task.

**Circuit breaker in the SDK.** During an Emporix brownout, the three retry attempts triple the load (`http.ts:213-231`). A breaker is the right answer, but it needs a decision about the error budget, the half-open behavior and whether it applies per origin or per service — its own spec, not a task in a performance plan.

**Emporix rate limit.** Not documented in the repo (`grep` across `packages/` and `docs/`: only reactive 429 handling). Has to be asked of Emporix before 1'000 CCU is promised — that is a contractual question, not a code one.

**Images.** `<img>` instead of `next/image` (`product-grid.tsx:34`, `product/[id]/page.tsx:81`). Costs no server capacity, hence not in this plan; still open for LCP and Emporix egress.

## Open decision point

Task 1 Step 9 verifies the assumption that `await cookies()` hands out the same object per request. If it does not hold, there are two ways out, and both need a decision:

1. `react`'s `cache()` in the next package — guaranteed to work, but brings back `react` as a peerDependency, which 0.7.0 has just removed.
2. Move the memo into the app — the package stays React-free, every consumer has to build the fix themselves.

## Self-Review

**Spec coverage:** session amplification → Task 1. Public route → Task 2. Timeouts → Task 3. Tree parsing → Task 4. TTFB/streaming → Task 5. Docs/release → Task 6. ISR, lazy services, breaker, rate limit, images → explicitly excluded with a justification. No gap against the top-5 list of the analysis.

**Placeholder scan:** no «TBD», no «add error handling», every code step contains the actual code. Task 5 deliberately has no unit test, with a justification and a verifiable manual check instead of an empty test step.

**Type consistency:** `requestScoped(anchor, key, build)` from Task 1 is used in `session-cookies.ts` with exactly that signature. `CategoryIndex.byId[id]` in Task 4 Step 5 matches the type defined in Step 3. `SessionNav` from Task 5 Step 1 is imported under the same name in Step 2. `TIMEOUTS` from Task 3 Step 6 is used in `emporixOptions()` and at five `getEmporixClient` sites, all of them named explicitly.
