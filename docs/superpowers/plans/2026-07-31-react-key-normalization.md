# React Query-Key Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the last two hand-keyed read hooks onto `emporixKey`, and let a server-side prefetch reproduce a customer-gated hook's key.

**Architecture:** `prefetchEmporix` gains a `mode` mirroring `useEmporixQuery`'s, which fixes `prefetchOrder` for `auth.raw` callers. The availability hooks move to `useEmporixQuery` with an always-supplied `authOverride`, so their key shape normalizes without their auth semantics changing. Three unrelated repo-hygiene commits ride along.

**Tech Stack:** TypeScript 5.6 (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`), React 19, `@tanstack/react-query` v5, Vitest 2 + MSW 2, Changesets.

**Spec:** [`../specs/2026-07-31-react-key-normalization-design.md`](../specs/2026-07-31-react-key-normalization-design.md)

## Global Constraints

- **Only the availability change invalidates consumer caches.** The `prefetchOrder` fix does not: with `auth.customer(token)` the key is already identical today, and only `auth.raw(jwt)` differs — a path that is broken rather than merely different. The changeset must say exactly this, not warn about both.
- **`authOverride` is ALWAYS supplied on the availability hooks.** Omitting it when `customerToken` is absent lets `read-auth` fall back to the *stored* token, so a logged-in shopper would start receiving personalized availability where the hook reads anonymously today. That is a behaviour change and is out of scope.
- **`siteCode` goes into positional `args`, not into the `site: "full"` meta slot.** That slot carries the ambient site from `useReadSite()`; an explicit argument does not belong there.
- **These two files must pass BYTE-IDENTICAL:** `packages/react/tests/use-availability.test.tsx` and `packages/react/tests/use-availabilities.test.tsx`. Verified 2026-07-31: zero matches for `anon:` anywhere in `packages/react/tests/`, so no test locks the old key shape and these two are a genuine behaviour-neutrality net. **If either needs editing, stop and report** — something beyond the key changed. This is also why the new auth assertion goes in a NEW file: `wrap()` in `use-availability.test.tsx` returns only the wrapper, not the `QueryClient`, and changing it would edit the existing tests' call sites.
- **`tsconfig.base.json` strictness:** `exactOptionalPropertyTypes: true` (use `...(v !== undefined ? { v } : {})`), `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`.
- **eslint per package** forbids `no-console`, `@typescript-eslint/no-explicit-any` and default exports.
- **Commitlint scopes:** `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. First word after the scope must be a lowercase verb. Use `react` for the hook/ssr work, `availability` for the availability hooks if you prefer, `repo` for hygiene.
- **Release mechanics:** one changeset, minor on `@viu/emporix-sdk-react` (2.25.0 → 2.26.0). `.changeset/config.json` links sdk with react, so `@viu/emporix-sdk` also goes to 2.26.0 with only dependency updates in its changelog. Expected, not a defect — the last release did the same.
- **Branch:** `fix/react-key-normalization`, which already carries the spec commit.
- **Gates per task:** `pnpm -F @viu/emporix-sdk-react test`, `typecheck`, `lint`. Before the final commit: `pnpm -r test && pnpm typecheck && pnpm lint && pnpm -F @viu/emporix-sdk-react check:dist`.

---

## File Structure

| File | Change | Task |
|---|---|---|
| `packages/react/src/ssr.ts` | `PrefetchEmporixOpts.mode`, honoured in the key; `prefetchOrder` passes `mode: "customer"` | 1 |
| `packages/react/tests/ssr.test.tsx` | new case: `prefetchOrder` with `auth.raw` | 1 |
| `packages/react/tests/prefetch-parity.test.tsx` | `Row.mode`; `useOrder` row uses it with a raw context | 1 |
| `packages/react/src/hooks/use-availability.ts` | onto `useEmporixQuery` | 2 |
| `packages/react/src/hooks/use-availabilities.ts` | onto `useEmporixQuery` | 2 |
| `packages/react/tests/use-availability-auth.test.tsx` | **new** — a stored token must not change `authKind` | 2 |
| `packages/react/tests/prefetch-parity.test.tsx` | two new rows (10 → 12) | 2 |
| `docs/react.md` | remove the "cannot be prefetched" pitfall; table 10 → 12 rows; `useOrder` gains `mode` | 3 |
| `.changeset/react-key-normalization.md` | **new**, minor | 3 |
| `.gitignore` | `.claude/settings.local.json`, `examples/next-app-router/tsconfig.tsbuildinfo` | 4 |
| `packages/next/CHANGELOG.md` | two lines on the 0.1.0 bootstrap | 4 |

---

## Task 1: `prefetchEmporix` gains `mode`

**Files:**
- Modify: `packages/react/src/ssr.ts` (`PrefetchEmporixOpts`, the key construction, `prefetchOrder`)
- Test: `packages/react/tests/ssr.test.tsx`, `packages/react/tests/prefetch-parity.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  // added to PrefetchEmporixOpts
  mode?: "read-auth" | "customer";
  ```
  Consumed by Task 2's parity rows (which omit it, defaulting to `"read-auth"`) and Task 3's docs table.

- [ ] **Step 1: Write the failing test in `tests/ssr.test.tsx`**

Append inside the existing `describe("prefetchOrder", …)` block. The file already has an MSW server and a `prefetchOrder` test, so reuse its handler style:

```tsx
  it("keys authKind as customer even for auth.raw, matching useOrder", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-3", () =>
        HttpResponse.json({
          id: "o-3", orderNumber: "ORD-3", status: "CREATED",
          currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [],
        }),
      ),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const qc = new QueryClient();

    // An externally-issued token: `kind` is "raw", but useOrder is customer-gated
    // and keys "customer". Before the fix this wrote authKind: "raw".
    await prefetchOrder(qc, client, "o-3", auth.raw("external-jwt"));

    const cached = qc.getQueryData([
      "emporix",
      "orders",
      "o-3",
      { tenant: "acme", authKind: "customer", language: null },
    ]);
    expect((cached as { orderNumber?: string } | undefined)?.orderNumber).toBe("ORD-3");
  });
```

If `auth` is not already imported in that file, it is — the existing tests use `auth.customer("cust")`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/ssr.test.tsx`
Expected: FAIL — the entry was written under `authKind: "raw"`, so `getQueryData` returns `undefined`.

- [ ] **Step 3: Add `mode` to `ssr.ts`**

In `PrefetchEmporixOpts`, after the `site` field:

```ts
  /**
   * Mirrors `useEmporixQuery`'s mode. `"customer"` keys `authKind: "customer"`
   * regardless of the context kind, matching a customer-gated hook — which keys
   * `"customer"` / `"anonymous"` rather than `ctx.kind`, so an `auth.raw` token
   * would otherwise produce a key nothing reads. Default `"read-auth"`, which
   * keys `auth.kind`.
   */
  mode?: "read-auth" | "customer";
```

In `prefetchEmporix`, replace the `authKind` line:

```ts
  const ctx = opts.auth ?? auth.anonymous();
  const authKind = opts.mode === "customer" ? "customer" : ctx.kind;
  await qc.prefetchQuery({
    queryKey: emporixKey(opts.resource, opts.args, {
      tenant: opts.client.tenant,
      authKind,
      ...siteMeta(opts.site, opts.siteCode ?? null, opts.language ?? null),
    }),
    queryFn: () => opts.queryFn(ctx),
  });
```

Note `queryFn` still receives the real `ctx` — only the key is normalized. A `raw`
token must still be the token actually sent.

- [ ] **Step 4: Make `prefetchOrder` use it**

Add `mode: "customer",` to the `prefetchEmporix` call inside `prefetchOrder`, next to `site: "language"`.

- [ ] **Step 5: Run the SSR tests**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/ssr.test.tsx`
Expected: PASS, 5 tests (4 before plus 1 new). The existing four must pass unedited — one of them asserts the literal key for `auth.customer("cust")`, which `mode: "customer"` leaves unchanged.

- [ ] **Step 6: Extend the parity test to exercise `mode`**

In `packages/react/tests/prefetch-parity.test.tsx`, add to the `Row` interface:

```ts
  /** Passed through to prefetchEmporix; customer-gated hooks need "customer". */
  mode?: "read-auth" | "customer";
```

Change the `useOrder` row to use it, and give it a raw context so the row itself is the regression test:

```ts
  {
    name: "useOrder",
    render: () => useOrder("o1"),
    resource: "orders",
    args: ["o1"],
    site: "language",
    customer: true,
    mode: "customer",
  },
```

and in the test body, thread `mode` through and make the customer context raw for
rows that declare `mode: "customer"`:

```ts
    const ctx: AuthContext = row.mode === "customer"
      ? auth.raw("external-jwt")   // kind "raw" — mode must normalize it
      : row.customer
        ? auth.customer("cust")
        : auth.anonymous();
    const serverQc = new QueryClient();
    await prefetchEmporix(serverQc, {
      client,
      resource: row.resource,
      args: row.args,
      site: row.site,
      auth: ctx,
      ...(row.mode !== undefined ? { mode: row.mode } : {}),
      queryFn: () => Promise.resolve(null),
    });
```

The conditional spread is required by `exactOptionalPropertyTypes`.

Give `useMyOrders` the same treatment — it is customer-gated too
(`use-my-orders.ts:34`: `mode: "customer"`), verified, so its row gets
`mode: "customer"` as well. Both customer-gated rows then run through a raw
context, which makes each of them a regression test for the fix.

- [ ] **Step 7: Run the parity test**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/prefetch-parity.test.tsx`
Expected: PASS, 10 tests. If the `useMyOrders` row fails, apply the note in Step 6 and rerun.

- [ ] **Step 8: Gates and commit**

Run: `pnpm -F @viu/emporix-sdk-react test && pnpm -F @viu/emporix-sdk-react typecheck && pnpm -F @viu/emporix-sdk-react lint`

```bash
git add packages/react/src/ssr.ts packages/react/tests/ssr.test.tsx \
        packages/react/tests/prefetch-parity.test.tsx
git commit -m "fix(react): key prefetchEmporix authKind by mode, not context kind

useOrder is customer-gated and keys authKind \"customer\"; prefetchOrder keyed
authCtx.kind, so auth.raw(jwt) wrote \"raw\" and the hook never found the entry.

mode: \"customer\" normalizes the key while queryFn still receives the real
context — a raw token must still be the token actually sent. No cache
invalidation: with auth.customer the key is unchanged.

The parity test's useOrder row now passes a raw context, so it is the regression
test rather than a second assertion of the working path."
```

---

## Task 2: Availability hooks onto `emporixKey`

**Files:**
- Modify: `packages/react/src/hooks/use-availability.ts` (45 lines), `packages/react/src/hooks/use-availabilities.ts` (47 lines)
- Create: `packages/react/tests/use-availability-auth.test.tsx`
- Modify: `packages/react/tests/prefetch-parity.test.tsx` (two new rows)
- **Must not touch:** `packages/react/tests/use-availability.test.tsx`, `packages/react/tests/use-availabilities.test.tsx`

**Interfaces:**
- Consumes: `useEmporixQuery` from `./internal/use-emporix-query` (`{ mode, site, resource, args, authOverride, enabled, queryFn, staleTime }`).
- Produces the new key shapes, consumed by Task 3's docs table:
  ```
  ["emporix", "availability",   productId,  siteCode, defaultAvailableOnNotFound, { tenant, authKind }]
  ["emporix", "availabilities", productIds, siteCode, defaultAvailableOnNotFound, { tenant, authKind }]
  ```

- [ ] **Step 1: Record the green baseline of the two untouchable files**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-availability.test.tsx tests/use-availabilities.test.tsx`
Expected: PASS, 4 tests (2 per file). This is the number that must still hold at the end, with both files unmodified.

- [ ] **Step 2: Write the failing auth test in a NEW file**

Create `packages/react/tests/use-availability-auth.test.tsx`. It needs its own
harness because `wrap()` in the existing file does not expose the `QueryClient`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useAvailability } from "../src/hooks/use-availability";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "a", token_type: "Bearer", expires_in: 3600,
      refresh_token: "r", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/availability/viu/availability/p1/main", () =>
    HttpResponse.json({ id: "main:p1", productId: "p1", site: "main", available: true }),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** Unlike the sibling file's harness, this one exposes the QueryClient. */
function harness(storedToken: string | null) {
  const client = new EmporixClient({
    tenant: "viu",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const storage = createMemoryStorage(storedToken ? { initial: storedToken } : {});
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    wrapper: ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        {children}
      </EmporixProvider>
    ),
  };
}

const keyOf = (qc: QueryClient): readonly unknown[] =>
  qc.getQueryCache().getAll().find((q) => q.queryKey[1] === "availability")!.queryKey;

describe("useAvailability — key shape", () => {
  it("keys through emporixKey with authKind, not a boolean anon flag", async () => {
    const { wrapper, queryClient } = harness(null);

    const { result } = renderHook(() => useAvailability("p1", "main"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(keyOf(queryClient)).toEqual([
      "emporix",
      "availability",
      "p1",
      "main",
      false,
      { tenant: "viu", authKind: "anonymous" },
    ]);
  });

  it("keys authKind customer when a customerToken option is passed", async () => {
    const { wrapper, queryClient } = harness(null);

    renderHook(() => useAvailability("p1", "main", { customerToken: "cust", enabled: false }), {
      wrapper,
    });

    expect(keyOf(queryClient)).toEqual([
      "emporix",
      "availability",
      "p1",
      "main",
      false,
      { tenant: "viu", authKind: "customer" },
    ]);
  });

  it("a STORED customer token does not change the auth — semantics are unchanged", async () => {
    // This is the regression guard for the whole change: switching to
    // useEmporixQuery without always passing authOverride would make this
    // resolve to "customer" and start serving personalized availability.
    const { wrapper, queryClient } = harness("stored-cust");

    renderHook(() => useAvailability("p1", "main", { enabled: false }), { wrapper });

    expect(keyOf(queryClient)).toEqual([
      "emporix",
      "availability",
      "p1",
      "main",
      false,
      { tenant: "viu", authKind: "anonymous" },
    ]);
  });

  it("defaultAvailableOnNotFound is part of the key", async () => {
    const { wrapper, queryClient } = harness(null);

    renderHook(
      () => useAvailability("p1", "main", { defaultAvailableOnNotFound: true, enabled: false }),
      { wrapper },
    );

    expect(keyOf(queryClient)[4]).toBe(true);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-availability-auth.test.tsx`
Expected: FAIL — the hook still writes the old single-meta-object key, so the array comparison mismatches on every case.

- [ ] **Step 4: Rewrite `use-availability.ts`**

```ts
import { type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext, type Availability } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

const AVAILABILITY_STALE_TIME = 30_000; // 30s — stock changes, but not per render.

export interface UseAvailabilityOptions {
  enabled?: boolean;
  customerToken?: string | null;
  defaultAvailableOnNotFound?: boolean;
}

/**
 * Reads availability for one product on one site via `availability.get`.
 * Defaults to the anonymous token; pass `customerToken` for a customer context.
 *
 * `siteCode` is an explicit argument rather than the ambient site, so it lives in
 * the key's positional args and `site` is `"none"`. `authOverride` is always
 * supplied — without it, `read-auth` would fall back to the *stored* token and a
 * logged-in shopper would start receiving personalized availability.
 */
export function useAvailability(
  productId: string,
  siteCode: string,
  options: UseAvailabilityOptions = {},
): UseQueryResult<Availability> {
  const { client } = useEmporix();
  const defaultAvailableOnNotFound = options.defaultAvailableOnNotFound ?? false;
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useEmporixQuery({
    mode: "read-auth",
    site: "none",
    resource: "availability",
    args: [productId, siteCode, defaultAvailableOnNotFound],
    authOverride: ctx,
    enabled: (options.enabled ?? true) && Boolean(productId) && Boolean(siteCode),
    queryFn: (resolved) =>
      client.availability.get(productId, siteCode, resolved, { defaultAvailableOnNotFound }),
    staleTime: AVAILABILITY_STALE_TIME,
  });
}
```

- [ ] **Step 5: Rewrite `use-availabilities.ts`**

```ts
import { type UseQueryResult } from "@tanstack/react-query";
import { auth, type AuthContext, type Availability } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

const AVAILABILITY_STALE_TIME = 30_000; // 30s — stock changes, but not per render.

export interface UseAvailabilitiesOptions {
  enabled?: boolean;
  customerToken?: string | null;
  defaultAvailableOnNotFound?: boolean;
}

/**
 * Reads availability for many products on one site via `availability.getMany`
 * (a single batch request). Returns records in input order; missing products
 * are `{ available: false }` (or `{ available: true }` with
 * `defaultAvailableOnNotFound`).
 *
 * Keying follows `useAvailability`: `siteCode` is an explicit argument so it goes
 * in the positional args with `site: "none"`, and `authOverride` is always
 * supplied so a stored token never silently personalizes the read.
 */
export function useAvailabilities(
  productIds: string[],
  siteCode: string,
  options: UseAvailabilitiesOptions = {},
): UseQueryResult<Availability[]> {
  const { client } = useEmporix();
  const defaultAvailableOnNotFound = options.defaultAvailableOnNotFound ?? false;
  const ctx: AuthContext = options.customerToken
    ? auth.customer(options.customerToken)
    : auth.anonymous();
  return useEmporixQuery({
    mode: "read-auth",
    site: "none",
    resource: "availabilities",
    args: [productIds, siteCode, defaultAvailableOnNotFound],
    authOverride: ctx,
    enabled: (options.enabled ?? true) && productIds.length > 0 && Boolean(siteCode),
    queryFn: (resolved) =>
      client.availability.getMany(productIds, siteCode, resolved, { defaultAvailableOnNotFound }),
    staleTime: AVAILABILITY_STALE_TIME,
  });
}
```

- [ ] **Step 6: Run the new test, then the two untouchable files**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-availability-auth.test.tsx`
Expected: PASS, 4 tests.

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-availability.test.tsx tests/use-availabilities.test.tsx`
Expected: PASS, 4 tests, **both files unmodified**.

Run: `git status --short packages/react/tests/use-availability.test.tsx packages/react/tests/use-availabilities.test.tsx`
Expected: no output. If either shows as modified, revert it and fix the source instead.

- [ ] **Step 7: Add the two parity rows**

In `packages/react/tests/prefetch-parity.test.tsx`, add to `ROWS`:

```ts
  {
    name: "useAvailability",
    render: () => useAvailability("p1", "main"),
    resource: "availability",
    args: ["p1", "main", false],
    site: "none",
  },
  {
    name: "useAvailabilities",
    render: () => useAvailabilities(["p1", "p2"], "main"),
    resource: "availabilities",
    args: [["p1", "p2"], "main", false],
    site: "none",
  },
```

and import them:

```ts
import { useAvailability } from "../src/hooks/use-availability";
import { useAvailabilities } from "../src/hooks/use-availabilities";
```

The suite's catch-all MSW handler hangs every resource request, so these rows
compare keys without needing availability fixtures — same as the other ten.

- [ ] **Step 8: Run the parity test**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/prefetch-parity.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 9: Gates and commit**

Run: `pnpm -F @viu/emporix-sdk-react test && pnpm -F @viu/emporix-sdk-react typecheck && pnpm -F @viu/emporix-sdk-react lint`

```bash
git add packages/react/src/hooks/use-availability.ts \
        packages/react/src/hooks/use-availabilities.ts \
        packages/react/tests/use-availability-auth.test.tsx \
        packages/react/tests/prefetch-parity.test.tsx
git commit -m "fix(availability): key the availability hooks through emporixKey

They were the last two read hooks building keys by hand, with a boolean anon
flag instead of authKind and every discriminator crammed into one meta object.
That also made them the only read hooks prefetchEmporix could not express.

siteCode is an explicit argument, not the ambient site, so it goes in the
positional args with site: \"none\". authOverride is ALWAYS supplied: without it
read-auth would fall back to the stored token and a logged-in shopper would
start receiving personalized availability. A test guards exactly that.

Cache-invalidating: existing availability entries are orphaned.

tests/use-availability.test.tsx and use-availabilities.test.tsx pass unedited."
```

---

## Task 3: Docs and changeset

**Files:**
- Modify: `docs/react.md` (the descriptor table, the pitfalls list)
- Create: `.changeset/react-key-normalization.md`

**Interfaces:**
- Consumes: the key shapes from Tasks 1 and 2.

- [ ] **Step 1: Add the two rows and `mode` to the descriptor table**

In `docs/react.md`, the table currently ends with the `useSites` row. Add above it:

```markdown
| `useAvailability` | `availability` | `[productId, siteCode, defaultAvailableOnNotFound]` | `none` |
| `useAvailabilities` | `availabilities` | `[productIds, siteCode, defaultAvailableOnNotFound]` | `none` |
```

Then add a note under the table, next to the existing `useOrder` / `useMyOrders` note:

```markdown
`useOrder` and `useMyOrders` are customer-gated: they key `authKind: "customer"`
rather than the context kind, so a prefetch must pass `mode: "customer"`.
Otherwise an `auth.raw(jwt)` context writes `authKind: "raw"` and the hook never
finds the entry. `prefetchOrder` does this for you.
```

- [ ] **Step 2: Remove the obsolete pitfall**

In `docs/react.md`, delete this bullet (around line 740) entirely:

```markdown
- **`useAvailability` / `useAvailabilities` cannot be prefetched** — their keys
  predate `emporixKey` and use a different shape (a boolean `anon` instead of
  `authKind`, and no positional args). Call `client.availability.*` directly on
  the server and pass the result down as a prop.
```

And replace the `prefetchOrder` / `auth.raw` pitfall — it is now fixed, so it
becomes a statement of how it works rather than a warning:

```markdown
- **Customer-gated hooks need `mode: "customer"`** — `useOrder` and `useMyOrders`
  key `authKind: "customer"` regardless of the context kind. A prefetch that
  keys `ctx.kind` would write `"raw"` for an `auth.raw(jwt)` context and produce
  a silent cache miss. `prefetchEmporix` accepts `mode` for this;
  `prefetchOrder` sets it already.
```

- [ ] **Step 3: Verify the table matches the parity test**

Run: `grep -c '^| `use' docs/react.md`
Expected: `12`.

Run: `grep -c 'name: "use' packages/react/tests/prefetch-parity.test.tsx`
Expected: `12`. The two counts must agree.

- [ ] **Step 4: Write the changeset**

`.changeset/react-key-normalization.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

Query-key normalization for the last two hand-keyed read hooks.

**`useAvailability` / `useAvailabilities` — cache-invalidating.** Both now build
their key through `emporixKey` like every other read hook:

```
before: ["emporix", "availability", { tenant, productId, siteCode, anon, defaultAvailableOnNotFound }]
after:  ["emporix", "availability", productId, siteCode, defaultAvailableOnNotFound, { tenant, authKind }]
```

Existing cached availability entries are orphaned and refetch once. Auth
behaviour is unchanged: the hooks still read anonymously unless you pass
`customerToken`, and a token in storage does not change that. They are now
prefetchable via `prefetchEmporix` — see the descriptor table in `docs/react.md`.

**`prefetchEmporix` gains `mode` — not cache-invalidating.** `"customer"` keys
`authKind: "customer"` regardless of the context kind, matching customer-gated
hooks like `useOrder`. `prefetchOrder` now sets it, which fixes prefetching with
an `auth.raw(jwt)` context — that previously keyed `"raw"` and the hook never
found the entry. With `auth.customer(token)` the key is unchanged, so nothing is
orphaned by this half.
```

- [ ] **Step 5: Full repo gates**

Run: `pnpm -r test && pnpm typecheck && pnpm lint && pnpm -F @viu/emporix-sdk-react check:dist`
Expected: all clean. React goes from 343 to **350** tests, derived: +1 in
`ssr.test.tsx`, +4 in the new `use-availability-auth.test.tsx`, +2 parity rows,
nothing removed → 343 + 7 = 350. Any other number means a test was lost — find
out which one before continuing.

- [ ] **Step 6: Commit**

```bash
git add docs/react.md .changeset/react-key-normalization.md
git commit -m "docs(react): document the normalized availability keys and prefetch mode

The descriptor table grows to 12 rows because the availability hooks are now
prefetchable, and the pitfall saying they are not is removed. The prefetchOrder
auth.raw warning becomes a statement of how mode works, since it is fixed.

The changeset separates the two halves: availability orphans cached entries,
the prefetch fix orphans nothing."
```

---

## Task 4: Repo hygiene — three separate commits

No package effect, so no changeset. Kept as three commits so a reviewer can reject one without the others.

**Files:**
- Modify: `.gitignore`
- Remove from tracking: `examples/next-app-router/tsconfig.tsbuildinfo`
- Modify: `packages/next/CHANGELOG.md`

- [ ] **Step 1: Ignore the local Claude settings**

Append to `.gitignore`, under the existing env block:

```
# Claude Code: settings.json is shared, settings.local.json is personal
.claude/settings.local.json
```

Run: `git check-ignore -v .claude/settings.local.json`
Expected: a line naming `.gitignore` and the pattern. Then `git status --short` should no longer show `?? .claude/`.

```bash
git add .gitignore
git commit -m "chore(repo): ignore the personal claude settings file

Claude Code's convention is that .claude/settings.json is shared and
settings.local.json is personal. The entry was missing, which is why pnpm
publish refused on an unclean tree during the emporix-sdk-next bootstrap."
```

- [ ] **Step 2: Untrack the TypeScript build artifact**

```bash
git rm --cached examples/next-app-router/tsconfig.tsbuildinfo
```

Append to `.gitignore`:

```
# TypeScript incremental build artifacts
*.tsbuildinfo
```

The glob rather than the one path: any package adding `incremental: true` would otherwise reintroduce the same problem.

Run: `git status --short | grep tsbuildinfo`
Expected: only the staged deletion, no untracked entry.

```bash
git add .gitignore
git commit -m "chore(repo): untrack tsconfig.tsbuildinfo

A TypeScript incremental-build artifact that showed as modified in every status
check. Ignored by glob so any package enabling incremental builds later does not
reintroduce it."
```

- [ ] **Step 3: Record the 0.1.0 bootstrap in the next package's changelog**

`packages/next/CHANGELOG.md` currently opens with a `## 0.2.0` section labelled as
the initial release, with no mention of 0.1.0 — which reads as a mistake. Add
below that section:

```markdown
## 0.1.0

Bootstrap publish, done by hand and therefore without npm provenance.

npm trusted publishing is configured per package and cannot be set up for a
package that does not exist yet, so the first version had to be published
manually to create the package. `0.2.0` above is the first release from the
pipeline, with provenance. There is no functional difference between the two.
```

```bash
git add packages/next/CHANGELOG.md
git commit -m "docs(release): record the 0.1.0 bootstrap publish

0.2.0 is labelled the initial release with no 0.1.0 entry above it, which reads
as an error. It was a manual publish to create the package, because npm trusted
publishing is configured per package and needs the package to exist first."
```

- [ ] **Step 4: Final gates, push, open the PR**

Run: `pnpm -r test && pnpm typecheck && pnpm lint`
Expected: clean.

```bash
git push origin fix/react-key-normalization
```

The PR body must state: the availability change orphans cached entries and the
`prefetchOrder` fix does not; that the availability hooks' auth semantics are
deliberately unchanged and a test guards it; that
`tests/use-availability.test.tsx` and `tests/use-availabilities.test.tsx` pass
unedited as the behaviour-neutrality proof; the react 343 → 349 test count; and
that the linked changesets group will also bump `@viu/emporix-sdk` to 2.26.0 with
only dependency updates in its changelog.

---

## Follow-ups not in scope

1. Middleware for site/locale detection in `@viu/emporix-sdk-next`. In Next 16
   that is `proxy.ts` exporting `proxy`, Node runtime only.
2. `docs/nextjs.md` with the `images.remotePatterns` entry for `next/image`.
3. Share the eight storage-key literals between `storage/cookie-core.ts` and
   `storage/web-storage.ts`.
4. `@viu/emporix-mixins` has no `publishConfig.provenance` and therefore publishes
   without provenance, unlike the other three. One line if it is not deliberate.
