# PriceService.matchByContextChunked Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `PriceService.matchByContextChunked` (and a new `useMatchPricesChunked` React hook) that splits a large `match-prices-by-context` request's `items` into bounded-concurrency chunks and aggregates the results.

**Architecture:** A thin method on the existing `PriceService` that slices `input.items`, runs `matchByContext` per chunk through a fixed-size worker pool (never more than `concurrency` in flight), and concatenates results. Per-chunk failures either degrade gracefully (default) or reject (opt-in). A new React hook wraps it without touching `useMatchPrices`.

**Tech Stack:** TypeScript, native `fetch` (via `HttpClient`), Vitest + MSW, `@tanstack/react-query` v5, changesets.

**Branch:** `feat/price-chunking` (already created off `main`; the design spec `docs/superpowers/specs/2026-05-29-price-chunking-design.md` is already committed here).

**Reference spec:** `docs/superpowers/specs/2026-05-29-price-chunking-design.md`.

---

### Task 1: SDK — `matchByContextChunked` (TDD)

**Files:**
- Modify: `packages/sdk/src/services/price.ts` (add the options interface + method)
- Modify: `packages/sdk/src/index.ts` (export the options type)
- Test: `packages/sdk/tests/services/price.test.ts` (append a `describe` block)

- [ ] **Step 1: Write the failing tests**

Append this new top-level `describe` block to the **end** of `packages/sdk/tests/services/price.test.ts` (after the existing `describe("PriceService.match", …)` block's closing `});`). It reuses the file's existing `svc()` factory and `server` (which already mocks anonymous-login + `/oauth/token`).

```ts
describe("PriceService.matchByContextChunked", () => {
  const mkInput = (n: number) => ({
    items: Array.from({ length: n }, (_, i) => ({
      itemId: { itemType: "PRODUCT", id: `p${i}` },
      quantity: { quantity: 1 },
    })),
  });

  // Echoes one MatchResponse per received item, keyed by itemRef.id.
  const echoHandler = (onRequest?: () => void) =>
    http.post(
      "https://api.emporix.io/price/acme/match-prices-by-context",
      async ({ request }) => {
        onRequest?.();
        const body = (await request.json()) as {
          items?: { itemId?: { id?: string } }[];
        };
        const items = body.items ?? [];
        return HttpResponse.json(
          items.map((it) => ({
            priceId: `pr-${it.itemId?.id}`,
            itemRef: { itemType: "PRODUCT", id: it.itemId?.id },
            effectiveValue: 1,
          })),
        );
      },
    );

  it("splits 150 items into 3 requests at chunkSize 50 and returns every item", async () => {
    let posts = 0;
    server.use(echoHandler(() => { posts += 1; }));
    const res = await svc().matchByContextChunked(mkInput(150), { chunkSize: 50 });
    expect(posts).toBe(3);
    expect(res).toHaveLength(150);
    expect(new Set(res.map((r) => r.itemRef?.id)).size).toBe(150);
  });

  it("makes one request per item at chunkSize 1", async () => {
    let posts = 0;
    server.use(echoHandler(() => { posts += 1; }));
    const res = await svc().matchByContextChunked(mkInput(5), { chunkSize: 1 });
    expect(posts).toBe(5);
    expect(res).toHaveLength(5);
  });

  it("returns an empty array without any request when items is empty", async () => {
    let posts = 0;
    server.use(echoHandler(() => { posts += 1; }));
    const res = await svc().matchByContextChunked({ items: [] });
    expect(res).toEqual([]);
    expect(posts).toBe(0);
  });

  it("keeps successful chunks and calls onChunkError once when a chunk 500s", async () => {
    // chunkSize 1 over [p0, BAD, p2] → 3 chunks; the BAD chunk 500s.
    server.use(
      http.post(
        "https://api.emporix.io/price/acme/match-prices-by-context",
        async ({ request }) => {
          const body = (await request.json()) as { items?: { itemId?: { id?: string } }[] };
          const id = body.items?.[0]?.itemId?.id;
          if (id === "BAD") return HttpResponse.json({ code: 500 }, { status: 500 });
          return HttpResponse.json([{ priceId: `pr-${id}`, itemRef: { id }, effectiveValue: 1 }]);
        },
      ),
    );
    const input = {
      items: ["p0", "BAD", "p2"].map((id) => ({
        itemId: { itemType: "PRODUCT", id },
        quantity: { quantity: 1 },
      })),
    };
    const errors: number[] = [];
    const res = await svc().matchByContextChunked(input, {
      chunkSize: 1,
      onChunkError: (_err, idx) => errors.push(idx),
    });
    expect(res.map((r) => r.itemRef?.id).sort()).toEqual(["p0", "p2"]);
    expect(errors).toEqual([1]); // the BAD chunk is index 1
  });

  it("throws on the first chunk failure when throwOnAnyChunkError is set", async () => {
    server.use(
      http.post("https://api.emporix.io/price/acme/match-prices-by-context", async ({ request }) => {
        const body = (await request.json()) as { items?: { itemId?: { id?: string } }[] };
        if (body.items?.[0]?.itemId?.id === "BAD") return HttpResponse.json({ code: 500 }, { status: 500 });
        return HttpResponse.json([]);
      }),
    );
    const input = {
      items: ["p0", "BAD"].map((id) => ({ itemId: { itemType: "PRODUCT", id }, quantity: { quantity: 1 } })),
    };
    await expect(
      svc().matchByContextChunked(input, { chunkSize: 1, throwOnAnyChunkError: true }),
    ).rejects.toBeTruthy();
  });

  it("never runs more than `concurrency` requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    server.use(
      http.post("https://api.emporix.io/price/acme/match-prices-by-context", async ({ request }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        const body = (await request.json()) as { items?: { itemId?: { id?: string } }[] };
        inFlight -= 1;
        return HttpResponse.json(
          (body.items ?? []).map((it) => ({ priceId: `pr-${it.itemId?.id}`, itemRef: { id: it.itemId?.id }, effectiveValue: 1 })),
        );
      }),
    );
    await svc().matchByContextChunked(mkInput(8), { chunkSize: 1, concurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("validates chunkSize and concurrency are >= 1", async () => {
    await expect(svc().matchByContextChunked(mkInput(1), { chunkSize: 0 })).rejects.toThrow(/chunkSize/);
    await expect(svc().matchByContextChunked(mkInput(1), { concurrency: 0 })).rejects.toThrow(/concurrency/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk test -- price`
Expected: FAIL — `svc(...).matchByContextChunked is not a function`.

- [ ] **Step 3: Implement the options interface + method**

In `packages/sdk/src/services/price.ts`, add the options interface just after the existing type aliases near the top (after the `export type PriceMatch = MatchResponse;` line):

```ts
/** Options for {@link PriceService.matchByContextChunked}. */
export interface MatchByContextChunkedOptions {
  /** Items per request. Default 50. Must be >= 1. */
  chunkSize?: number;
  /** Maximum number of requests in flight at once. Default 4. Must be >= 1. */
  concurrency?: number;
  /** Invoked once per failed chunk (default mode only — not when throwing). */
  onChunkError?: (err: unknown, chunkIndex: number) => void;
  /** When true, the first failing chunk rejects the whole call. Default false. */
  throwOnAnyChunkError?: boolean;
}
```

Then add this method inside the `PriceService` class, after the `match` method (before the class's closing `}`):

```ts
  /**
   * Chunked variant of {@link matchByContext} for large `items` arrays. The
   * Emporix backend handles only a limited number of items per request
   * (production limit ~50), so this splits `input.items` into chunks and runs
   * `matchByContext` with bounded concurrency.
   *
   * By default a failing chunk is skipped (its items are absent from the
   * result) and `opts.onChunkError` is called once for it; pass
   * `throwOnAnyChunkError: true` to reject on the first failure instead.
   *
   * **Result order is not guaranteed** — match entries back to your items by
   * `priceId` / `itemRef.id`.
   */
  async matchByContextChunked(
    input: PriceMatchByContextInput,
    opts: MatchByContextChunkedOptions = {},
    auth?: AuthContext,
  ): Promise<PriceMatch[]> {
    const chunkSize = opts.chunkSize ?? 50;
    const concurrency = opts.concurrency ?? 4;
    if (chunkSize < 1) throw new Error("chunkSize must be >= 1");
    if (concurrency < 1) throw new Error("concurrency must be >= 1");

    const items = input.items ?? [];
    if (items.length === 0) return [];

    const chunks: PriceMatchByContextInput[] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push({ ...input, items: items.slice(i, i + chunkSize) });
    }

    const results: PriceMatch[][] = new Array(chunks.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const idx = cursor++;
        const chunk = chunks[idx];
        if (chunk === undefined) return; // past the end
        try {
          results[idx] = await this.matchByContext(chunk, auth);
        } catch (err) {
          if (opts.throwOnAnyChunkError) throw err;
          results[idx] = [];
          opts.onChunkError?.(err, idx);
        }
      }
    };

    const workerCount = Math.min(concurrency, chunks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results.flat();
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk test -- price`
Expected: PASS (existing `PriceService` tests + the 7 new ones).

- [ ] **Step 5: Export the options type from the SDK barrel**

In `packages/sdk/src/index.ts`, add `MatchByContextChunkedOptions` to the price type export:

```ts
export type {
  PriceMatch,
  PriceMatchByContextInput,
  PriceMatchInput,
  MatchByContextChunkedOptions,
} from "./services/price";
```

- [ ] **Step 6: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: passes.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/price.ts packages/sdk/src/index.ts packages/sdk/tests/services/price.test.ts
git commit -m "$(cat <<'EOF'
feat(price): add matchByContextChunked with bounded concurrency

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: React — `useMatchPricesChunked` hook (TDD)

The React package resolves `@viu/emporix-sdk` to its built `dist/`, so build the SDK first.

**Files:**
- Create: `packages/react/src/hooks/use-match-prices-chunked.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Modify: `packages/react/src/index.ts`
- Test: `packages/react/tests/use-match-prices-chunked.test.tsx`

- [ ] **Step 1: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: succeeds.

- [ ] **Step 2: Write the failing test**

Create `packages/react/tests/use-match-prices-chunked.test.tsx` (harness mirrors `tests/use-match-prices.test.tsx`, tenant `viu`):

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMatchPricesChunked } from "../src/hooks/use-match-prices-chunked";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a", token_type: "Bearer", expires_in: 3600, refresh_token: "r", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/price/viu/match-prices-by-context", async ({ request }) => {
    const body = (await request.json()) as { items?: { itemId?: { id?: string } }[] };
    return HttpResponse.json(
      (body.items ?? []).map((it) => ({
        priceId: `pr-${it.itemId?.id}`,
        itemRef: { id: it.itemId?.id },
        effectiveValue: 1,
      })),
    );
  }),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "viu",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

const items = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    itemId: { itemType: "PRODUCT", id: `p${i}` },
    quantity: { quantity: 1 },
  }));

describe("useMatchPricesChunked", () => {
  it("aggregates prices across chunks", async () => {
    const { result } = renderHook(
      () => useMatchPricesChunked({ items: items(5) }, { chunkSize: 2 }),
      { wrapper: wrap() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(5);
  });

  it("is disabled when there are no items", () => {
    const { result } = renderHook(() => useMatchPricesChunked({ items: [] }), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- match-prices-chunked`
Expected: FAIL — cannot resolve `../src/hooks/use-match-prices-chunked`.

- [ ] **Step 4: Implement the hook**

Create `packages/react/src/hooks/use-match-prices-chunked.ts`:

```ts
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type PriceMatch,
  type PriceMatchByContextInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useReadSite } from "./internal/use-read-site";

const PRICES_STALE_TIME = 60_000; // 1 minute — prices change with promotions.

/**
 * Like {@link useMatchPrices} but chunks large `items` arrays via
 * `prices.matchByContextChunked` (default 50 items per request, 4 in flight).
 * Result order is not guaranteed — match by `priceId` / `itemRef.id`.
 */
export function useMatchPricesChunked(
  input: PriceMatchByContextInput,
  options: {
    enabled?: boolean;
    customerToken?: string | null;
    chunkSize?: number;
    concurrency?: number;
  } = {},
): UseQueryResult<PriceMatch[]> {
  const { client } = useEmporix();
  const { siteCode } = useReadSite();
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useQuery({
    queryKey: [
      "emporix",
      "match-prices-chunked",
      {
        tenant: client.tenant,
        input,
        anon: !options.customerToken,
        siteCode,
        chunkSize: options.chunkSize,
        concurrency: options.concurrency,
      },
    ],
    enabled: (options.enabled ?? true) && (input.items?.length ?? 0) > 0,
    queryFn: () =>
      client.prices.matchByContextChunked(
        input,
        {
          ...(options.chunkSize !== undefined ? { chunkSize: options.chunkSize } : {}),
          ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
        },
        ctx,
      ),
    staleTime: PRICES_STALE_TIME,
  });
}
```

- [ ] **Step 5: Export from the hooks barrel**

In `packages/react/src/hooks/index.ts`, add after the `useMatchPrices` export line (`export { useMatchPrices } from "./use-match-prices";`):

```ts
export { useMatchPricesChunked } from "./use-match-prices-chunked";
```

- [ ] **Step 6: Export from the package barrel**

In `packages/react/src/index.ts`, add `useMatchPricesChunked,` to the big `export { … } from "./hooks/index";` list, immediately after `useMatchPrices,`.

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test -- match-prices-chunked`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: passes.

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/hooks/use-match-prices-chunked.ts packages/react/src/hooks/index.ts packages/react/src/index.ts packages/react/tests/use-match-prices-chunked.test.tsx
git commit -m "$(cat <<'EOF'
feat(react): add useMatchPricesChunked hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Docs

**Files:**
- Create: `docs/pricing.md`

- [ ] **Step 1: Write `docs/pricing.md`**

Create `docs/pricing.md`:

```markdown
# Pricing

`client.prices.matchByContext(input, auth?)` resolves prices for `input.items`
against the session context (currency/site/country bound to the token).

## Large carts — chunking

The Emporix `match-prices-by-context` endpoint handles only a limited number of
items per request (in production, > ~50 items per request leads to 4xx errors,
timeouts, or partial responses). Use `matchByContextChunked` so the SDK splits
the request for you — the recommended (and default) `chunkSize` is 50.

```ts
const prices = await client.prices.matchByContextChunked(
  { items },                         // any number of items
  { chunkSize: 50, concurrency: 4 }, // defaults shown
);
```

By default, if a chunk fails the others are still returned and `onChunkError`
is invoked for the failed chunk:

```ts
await client.prices.matchByContextChunked(input, {
  onChunkError: (err, chunkIndex) => report(err, chunkIndex),
});
```

Pass `throwOnAnyChunkError: true` to reject on the first failed chunk instead.

**Result order is not guaranteed** across chunks — match entries back to your
items by `priceId` / `itemRef.id`, never by position.

## React

```tsx
import { useMatchPricesChunked } from "@viu/emporix-sdk-react";

const { data: prices } = useMatchPricesChunked({ items }, { chunkSize: 50 });
```

The existing `useMatchPrices` is unchanged; use it for small carts that fit a
single request.
```

- [ ] **Step 2: Verify the doc exists**

Run: `test -f docs/pricing.md && echo OK`
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add docs/pricing.md
git commit -m "$(cat <<'EOF'
docs(price): document chunked price matching and server limit

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Changeset + config flag

The branch is off `main`, which lacks the changeset-config flag that prevents the peer-dependency force-major. Add it here so both packages bump `minor` (`2.0.0 → 2.1.0`).

**Files:**
- Modify: `.changeset/config.json`
- Create: `.changeset/price-chunking.md`

- [ ] **Step 1: Add the peer-dependent flag to the changeset config**

In `.changeset/config.json`, add the experimental options object after the `privatePackages` line. Resulting tail:

```json
  "ignore": ["@viu/emporix-examples-*"],
  "privatePackages": { "version": false, "tag": false },
  "___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH": {
    "onlyUpdatePeerDependentsWhenOutOfRange": true
  }
}
```

- [ ] **Step 2: Write the changeset**

Create `.changeset/price-chunking.md`:

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add PriceService.matchByContextChunked and the useMatchPricesChunked React hook:
split large match-prices-by-context requests into bounded-concurrency chunks
(default 50 items, 4 in flight) with per-chunk error handling.
```

- [ ] **Step 3: Verify the bump is minor (not major)**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-sdk` and `@viu/emporix-sdk-react` under **minor** (nothing under major). If they appear under major, the Step 1 flag was not applied correctly — fix before committing.

- [ ] **Step 4: Commit**

```bash
git add .changeset/config.json .changeset/price-chunking.md
git commit -m "$(cat <<'EOF'
chore(release): add price-chunking changeset; scope peer-dependent majors

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

- The SDK method unit tests construct `PriceService` directly (no `EmporixClient`),
  so Task 1 needs no client wiring. The React test (Task 2) depends on a freshly
  built SDK `dist/` — build after Task 1.
- The worker pool guarantees at most `concurrency` requests in flight because it
  spawns exactly `min(concurrency, chunkCount)` workers, each awaiting one
  `matchByContext` at a time and pulling the next chunk from a shared cursor.
- `matchByContext` already defaults to anonymous auth and validates the context
  kind, so `matchByContextChunked` just forwards `auth` unchanged.
- Do not stage the pre-existing modified files under `examples/next-app-router/`.
- If another feature branch merges the `.changeset/config.json` flag to `main`
  first, the Task 4 config change becomes a no-op — keep the changeset file.
