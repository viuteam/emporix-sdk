# Pagination Response Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let SDK facades read response headers, then use that to surface Emporix's cursor
pagination and absolute match counts through the existing `PaginatedItems` contract.

**Architecture:** `HttpClient.request` is split so its retry/reauth loop can also hand back
the response `Headers`; one internal `requestPage` helper owns the whole paginated shape
(the `X-Total-Count` opt-in, the cursor headers, and a three-tier `hasNextPage`); the
facades then move onto that helper instead of each reading headers themselves.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Vitest + MSW, pnpm
workspaces, changesets.

**Spec:** [`../specs/2026-08-10-pagination-response-headers-design.md`](../specs/2026-08-10-pagination-response-headers-design.md)

## Global Constraints

- **Everything written into the repo is English** — comments, JSDoc, changesets, commit
  messages, PR bodies, test names. No exceptions (`CLAUDE.md`).
- **Commitlint:** scope must be one of `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth, http,
  logger, deps, docs, examples`. The first word after the scope must be a **lowercase
  verb** (`feat(sdk): add …`, never `feat(sdk): Add …`).
- **`exactOptionalPropertyTypes: true`** repo-wide (`tsconfig.base.json:9`). `{ x: undefined }`
  is **not** assignable to `{ x?: T }` — optional fields must be spread conditionally.
- **Changeset required** for any PR touching `packages/*/src/**`. `pnpm changeset`.
- **Verification before any completion claim:** `pnpm -r test` and `pnpm typecheck` must
  both be run and pass. Report the actual output.
- **Never merge a PR.** Open it and hand it over.
- Branch naming: `feat/<short-name>`. This plan's branches are given per PR below.

## Reference: the three tiers of `hasNextPage`

Every task below assumes this ordering. It is the core semantic of the whole plan:

1. `X-Next-Cursor` present → `true`. Exact — the server sends it only when a next page exists.
2. else `totalCount` known → `pageNumber * pageSize < totalCount`. Exact.
3. else `items.length === pageSize`. The pre-existing guess, unchanged.

Tier 1 is **one-directional**. An absent cursor header does not mean "no next page": only
two endpoints in the entire API emit the header, so its absence carries no information and
must fall through to tiers 2 and 3.

---

# PR A — core header access

**Branch:** `feat/pagination-response-headers` (already created, holds the spec commit)

## Task A1: `requestWithMeta` on `HttpClient`

**Files:**
- Modify: `packages/sdk/src/core/http.ts:12-29` (`RequestOptions.query`), `:95-232` (the `request` method)
- Modify: `packages/sdk/src/index.ts:41-42` (export the new type)
- Test: `packages/sdk/tests/http-headers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `HttpResult<T> = { data: T; headers: Headers }` exported from
  `src/core/http.ts` and re-exported from `src/index.ts`;
  `HttpClient.requestWithMeta<T>(o: RequestOptions): Promise<HttpResult<T>>`;
  `RequestOptions.query` widened to `Record<string, string | number | boolean | undefined>`.
  `HttpClient.request<T>(o: RequestOptions): Promise<T>` keeps its exact signature.

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/tests/http-headers.test.ts`, inside a new `describe` at the end of
the file:

```ts
describe("HttpClient.requestWithMeta", () => {
  it("returns the response headers alongside the parsed body", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/paged", () =>
        HttpResponse.json([{ id: "a" }], {
          headers: { "X-Total-Count": "42", "X-Next-Cursor": "cur-1" },
        }),
      ),
    );

    const r = await client().requestWithMeta<{ id: string }[]>({
      method: "GET",
      path: "/paged",
      auth: { kind: "service" },
    });

    expect(r.data).toEqual([{ id: "a" }]);
    expect(r.headers.get("X-Total-Count")).toBe("42");
    expect(r.headers.get("X-Next-Cursor")).toBe("cur-1");
  });

  it("leaves request() returning the body alone", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/plain", () =>
        HttpResponse.json({ ok: true }, { headers: { "X-Total-Count": "7" } }),
      ),
    );

    const body = await client().request<{ ok: boolean }>({
      method: "GET",
      path: "/plain",
      auth: { kind: "service" },
    });

    expect(body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F @viu/emporix-sdk test -- tests/http-headers.test.ts
```

Expected: FAIL — `client(...).requestWithMeta is not a function`.

- [ ] **Step 3: Widen `RequestOptions.query` to accept booleans**

`packages/sdk/src/core/http.ts:15` currently reads:

```ts
  query?: Record<string, string | number | undefined>;
```

Change it to:

```ts
  query?: Record<string, string | number | boolean | undefined>;
```

This is needed by Task B1: `ListInstancesQuery` gains a `boolean` member (`totalCount`),
which forces its index signature to admit `boolean`, and the facade spreads that object
straight into `query`. Widening a parameter type is not a breaking change, and both loops
that consume `query` already do `String(v)`, so booleans serialise correctly today —
`category.searchByQuery` currently calls `String(params.showRoots)` by hand to work around
exactly this.

- [ ] **Step 4: Split `request` into `send` + two public entry points**

In `packages/sdk/src/core/http.ts`, add the result type next to `RequestOptions`
(around line 29, after the `RequestOptions` interface):

```ts
/**
 * A successful response: the parsed body plus its headers.
 *
 * `Headers` rather than the whole `Response` on purpose — by the time this
 * returns, the body has been consumed, and a `Response` whose body cannot be
 * read again is a trap in a caller's hands.
 */
export interface HttpResult<T> {
  data: T;
  headers: Headers;
}
```

Then rename the existing `async request<T = unknown>(o: RequestOptions): Promise<T> {`
(line 95) to:

```ts
  private async send<T>(o: RequestOptions): Promise<HttpResult<T>> {
```

Leave the entire method body untouched **except** its success branch, which currently reads:

```ts
      if (res.ok) {
        log.debug("http ok", { status: res.status });
        return parsed as T;
      }
```

and becomes:

```ts
      if (res.ok) {
        log.debug("http ok", { status: res.status });
        return { data: parsed as T, headers: res.headers };
      }
```

Directly above `send`, add the two public methods:

```ts
  /**
   * Issues a request and returns the parsed body. Retries 5xx/429 on idempotent
   * methods and re-auths once on a 401 — see {@link send}.
   */
  async request<T = unknown>(o: RequestOptions): Promise<T> {
    return (await this.send<T>(o)).data;
  }

  /**
   * Like {@link request}, but also hands back the response headers.
   *
   * Emporix puts pagination metadata there — `X-Total-Count` and, on the schema
   * service's custom instances, `X-Next-Cursor` / `X-Prev-Cursor`. Facades
   * should reach for `core/paged.ts`'s `requestPage` rather than calling this
   * directly; it exists for metadata that does not fit the paginated shape.
   */
  async requestWithMeta<T = unknown>(o: RequestOptions): Promise<HttpResult<T>> {
    return this.send<T>(o);
  }
```

- [ ] **Step 5: Export the type**

In `packages/sdk/src/index.ts`, line 42 currently reads:

```ts
export type { RequestOptions, HttpClientOptions } from "./core/http";
```

Change it to:

```ts
export type { RequestOptions, HttpClientOptions, HttpResult } from "./core/http";
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk test -- tests/http-headers.test.ts tests/http-retry.test.ts tests/http-basic.test.ts tests/http-customer-refresh.test.ts
```

Expected: PASS. The retry and customer-refresh suites are the proof that moving the loop
into `send` changed no behaviour — they exercise the 5xx retry, the 401 re-auth and the
customer refresh paths.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/core/http.ts packages/sdk/src/index.ts packages/sdk/tests/http-headers.test.ts
git commit -m "feat(http): add requestWithMeta for response-header access

Emporix puts pagination metadata in response headers and request() threw it
away. The retry/reauth loop moves into a private send() that returns the
headers alongside the body; request() delegates and keeps its signature."
```

## Task A2: the `requestPage` helper

**Files:**
- Modify: `packages/sdk/src/core/context.ts:18-23` (`PaginatedItems`)
- Create: `packages/sdk/src/core/paged.ts`
- Test: `packages/sdk/tests/core/paged.test.ts`

**Interfaces:**
- Consumes: `HttpResult<T>`, `HttpClient.requestWithMeta` from Task A1.
- Produces: `PaginatedItems<T>` with three new optional fields (`totalCount?: number`,
  `nextCursor?: string`, `prevCursor?: string`);
  `PageParams = { pageNumber: number; pageSize: number; totalCount?: boolean }`;
  `requestPage<T>(http: HttpClient, o: RequestOptions, page: PageParams): Promise<PaginatedItems<T>>`,
  exported from `src/core/paged.ts` and **not** from `src/index.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/core/paged.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../../src/core/http";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { requestPage } from "../../src/core/paged";
import type { TokenProvider } from "../../src/core/auth";

const provider: TokenProvider = {
  getToken: async () => "SVC",
  getAnonymousToken: async () => ({
    accessToken: "ANON", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
};

let sentTotalCount: string | null = null;
const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  sentTotalCount = null;
});
afterAll(() => server.close());

function client(): HttpClient {
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "paged" }),
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
}

/** Answers /items with `count` rows and whatever response headers are given. */
function serveItems(count: number, headers: Record<string, string> = {}): void {
  server.use(
    mhttp.get("https://api.emporix.io/items", ({ request }) => {
      sentTotalCount = request.headers.get("X-Total-Count");
      return HttpResponse.json(
        Array.from({ length: count }, (_, i) => ({ id: `i${i}` })),
        { headers },
      );
    }),
  );
}

const GET = { method: "GET", path: "/items", auth: { kind: "service" } } as const;

describe("requestPage", () => {
  it("guesses hasNextPage from the page size when no headers come back", async () => {
    serveItems(10);
    const page = await requestPage<{ id: string }>(client(), { ...GET }, {
      pageNumber: 1,
      pageSize: 10,
    });
    expect(page.hasNextPage).toBe(true);
    expect(page.totalCount).toBeUndefined();
    expect(page.items).toHaveLength(10);
  });

  it("does not ask for totals unless totalCount is set", async () => {
    serveItems(3);
    await requestPage<{ id: string }>(client(), { ...GET }, { pageNumber: 1, pageSize: 10 });
    expect(sentTotalCount).toBeNull();
  });

  it("sends X-Total-Count: true and derives hasNextPage from the total", async () => {
    serveItems(10, { "X-Total-Count": "25" });
    const page = await requestPage<{ id: string }>(client(), { ...GET }, {
      pageNumber: 1,
      pageSize: 10,
      totalCount: true,
    });
    expect(sentTotalCount).toBe("true");
    expect(page.totalCount).toBe(25);
    expect(page.hasNextPage).toBe(true);
  });

  it("reports the last page exactly when the total is known", async () => {
    serveItems(5, { "X-Total-Count": "25" });
    const page = await requestPage<{ id: string }>(client(), { ...GET }, {
      pageNumber: 3,
      pageSize: 10,
      totalCount: true,
    });
    // 3 * 10 = 30 >= 25, so there is nothing after this page — and the guess
    // would have said the same only by accident (5 !== 10).
    expect(page.hasNextPage).toBe(false);
  });

  it("trusts X-Next-Cursor over both other tiers, even on a short page", async () => {
    serveItems(2, { "X-Next-Cursor": "cur-2", "X-Prev-Cursor": "cur-0" });
    const page = await requestPage<{ id: string }>(client(), { ...GET }, {
      pageNumber: 1,
      pageSize: 10,
    });
    expect(page.hasNextPage).toBe(true);
    expect(page.nextCursor).toBe("cur-2");
    expect(page.prevCursor).toBe("cur-0");
  });

  it("treats an absent cursor header as no information, not as the last page", async () => {
    // A full page with no cursor header at all: every non-schema endpoint. The
    // guess must still apply.
    serveItems(10);
    const page = await requestPage<{ id: string }>(client(), { ...GET }, {
      pageNumber: 1,
      pageSize: 10,
    });
    expect(page.nextCursor).toBeUndefined();
    expect(page.hasNextPage).toBe(true);
  });

  it("ignores a non-numeric X-Total-Count instead of poisoning hasNextPage", async () => {
    serveItems(10, { "X-Total-Count": "lots" });
    const page = await requestPage<{ id: string }>(client(), { ...GET }, {
      pageNumber: 1,
      pageSize: 10,
      totalCount: true,
    });
    expect(page.totalCount).toBeUndefined();
    expect(page.hasNextPage).toBe(true);
  });

  it("returns an empty page rather than throwing on an empty body", async () => {
    server.use(mhttp.get("https://api.emporix.io/items", () => new HttpResponse(null, { status: 204 })));
    const page = await requestPage<{ id: string }>(client(), { ...GET }, {
      pageNumber: 1,
      pageSize: 10,
    });
    expect(page.items).toEqual([]);
    expect(page.hasNextPage).toBe(false);
  });

  it("keeps the caller's own request headers", async () => {
    let lang: string | null = null;
    server.use(
      mhttp.get("https://api.emporix.io/items", ({ request }) => {
        lang = request.headers.get("Accept-Language");
        sentTotalCount = request.headers.get("X-Total-Count");
        return HttpResponse.json([]);
      }),
    );
    await requestPage<{ id: string }>(
      client(),
      { ...GET, headers: { "Accept-Language": "de" } },
      { pageNumber: 1, pageSize: 10, totalCount: true },
    );
    expect(lang).toBe("de");
    expect(sentTotalCount).toBe("true");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F @viu/emporix-sdk test -- tests/core/paged.test.ts
```

Expected: FAIL — cannot resolve `../../src/core/paged`.

- [ ] **Step 3: Extend the `PaginatedItems` contract**

In `packages/sdk/src/core/context.ts`, replace lines 18–23:

```ts
export interface PaginatedItems<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  hasNextPage: boolean;
}
```

with:

```ts
export interface PaginatedItems<T> {
  items: T[];
  pageNumber: number;
  pageSize: number;
  hasNextPage: boolean;
  /**
   * Absolute number of matches, when the caller asked for it and the endpoint
   * answered. Opt-in per call (`totalCount: true`), because Emporix computes it
   * with a second query — see `core/paged.ts`.
   *
   * Always `undefined` in cursor mode: the server ignores the request header
   * and omits the response header there.
   */
  totalCount?: number;
  /**
   * Opaque cursor for the next page, on the endpoints that offer one (today:
   * the schema service's custom instances). Pass it back as the `next` query
   * parameter. Absence means "this endpoint said nothing", NOT "last page".
   */
  nextCursor?: string;
  /** Opaque cursor for the previous page. Same caveat as {@link nextCursor}. */
  prevCursor?: string;
}
```

- [ ] **Step 4: Write `requestPage`**

Create `packages/sdk/src/core/paged.ts`:

```ts
import type { PaginatedItems } from "./context";
import type { HttpClient, RequestOptions } from "./http";

/** Pagination inputs for {@link requestPage}. */
export interface PageParams {
  /** 1-based, as Emporix counts. */
  pageNumber: number;
  pageSize: number;
  /**
   * Ask Emporix for the absolute match count via the `X-Total-Count: true`
   * request header.
   *
   * Off by default and opt-in per call, not a client-wide setting: the count
   * costs the server a second query, and defaulting it on would put that cost
   * on every list every storefront issues.
   */
  totalCount?: boolean;
}

/**
 * Reads a non-negative integer header, or `undefined` when it is missing or is
 * not one. A malformed value must not reach the `hasNextPage` arithmetic —
 * `Number("lots")` is `NaN`, and every comparison against `NaN` is `false`,
 * which would silently report "last page" on every page.
 */
function intHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/**
 * Issues one page of a list endpoint and assembles {@link PaginatedItems} from
 * the body plus Emporix's pagination response headers.
 *
 * Cursors travel in opposite directions: the caller sends one as the `next` or
 * `prev` **query parameter** (so it belongs in `o.query`), and the server
 * returns the following one as the `X-Next-Cursor` **response header**. This
 * helper only ever reads them.
 */
export async function requestPage<T>(
  http: HttpClient,
  o: RequestOptions,
  page: PageParams,
): Promise<PaginatedItems<T>> {
  const { data, headers } = await http.requestWithMeta<T[]>(
    page.totalCount === true
      ? { ...o, headers: { ...(o.headers ?? {}), "X-Total-Count": "true" } }
      : o,
  );

  // A 204 or empty body parses to `undefined`. Facades used to index straight
  // into the result and would throw; an empty page is the honest answer.
  const items = data ?? [];
  const totalCount = intHeader(headers, "X-Total-Count");
  const nextCursor = headers.get("X-Next-Cursor") ?? undefined;
  const prevCursor = headers.get("X-Prev-Cursor") ?? undefined;

  // Three tiers, most precise first. Tier 1 is ONE-DIRECTIONAL on purpose: only
  // two endpoints in the whole API emit a cursor header, so its absence says
  // nothing at all and has to fall through to the other two.
  const hasNextPage =
    nextCursor !== undefined
      ? true
      : totalCount !== undefined
        ? page.pageNumber * page.pageSize < totalCount
        : items.length === page.pageSize;

  // Spread conditionally — `exactOptionalPropertyTypes` rejects an explicit
  // `undefined` for an optional property.
  return {
    items,
    pageNumber: page.pageNumber,
    pageSize: page.pageSize,
    hasNextPage,
    ...(totalCount === undefined ? {} : { totalCount }),
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(prevCursor === undefined ? {} : { prevCursor }),
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk test -- tests/core/paged.test.ts
pnpm typecheck
```

Expected: both PASS. If `typecheck` complains about `exactOptionalPropertyTypes` anywhere,
the conditional spreads are the fix — never `x: undefined`.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/paged.ts packages/sdk/src/core/context.ts packages/sdk/tests/core/paged.test.ts
git commit -m "feat(core): add requestPage and the paginated header contract

PaginatedItems gains optional totalCount, nextCursor and prevCursor, and one
helper owns reading them. hasNextPage is now exact when a cursor or a total is
available and falls back to the old page-size guess otherwise."
```

## Task A3: docs, changeset, PR A

**Files:**
- Modify: `docs/pagination.md:72-76` (the "Why not absolute totals?" section)
- Create: the `.changeset/*.md` file that `pnpm changeset` generates (it picks the name)

**Interfaces:**
- Consumes: everything from A1 and A2.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite the stale docs section**

`docs/pagination.md` currently ends with a section that PR A makes false:

> ## Why not absolute totals?
>
> Emporix returns `X-Total-Count` headers on some endpoints, but the SDK does not
> currently expose response headers to facades. …

Replace that whole section (from the `## Why not absolute totals?` heading to the end of
the file) with:

```markdown
## Absolute totals and cursors

`PaginatedItems` carries three optional fields beyond the four above:

| field | when it is set |
|---|---|
| `totalCount` | the caller passed `totalCount: true` **and** the endpoint answered with `X-Total-Count` |
| `nextCursor` / `prevCursor` | the endpoint offers cursor pagination (today: the schema service's custom instances) |

`hasNextPage` uses whichever is most precise: a `nextCursor` means there is a next page,
a known `totalCount` gives `pageNumber * pageSize < totalCount`, and otherwise it stays
the `items.length === pageSize` guess. An **absent** cursor header means "this endpoint
does not offer cursors", not "last page".

Totals are opt-in per call rather than always on: Emporix computes the count with a second
query, so defaulting it on would put that cost on every list a storefront issues.

No facade surfaces `totalCount` yet — that arrives with the facade migration. The import
service remains the exception that needs none of this: it reports `totalElements` and
`totalPages` **in the response body**, so `ImportPage` derives `hasNextPage` from the
totals without touching a header. See [import.md](./import.md#pagination).
```

- [ ] **Step 2: Author the changeset**

```bash
pnpm changeset
```

Choose `@viu/emporix-sdk` and **minor** — `HttpClient` and `PaginatedItems` are both
exported from the package root, so this adds public API surface. Write the summary as:

```
feat(sdk): expose response headers to facades

`HttpClient.requestWithMeta` returns the parsed body together with the response
`Headers`, and `PaginatedItems` gains optional `totalCount`, `nextCursor` and
`prevCursor`. Nothing surfaces them yet; this is the groundwork that lets the
facades read Emporix's `X-Total-Count` and cursor headers at all.
```

- [ ] **Step 3: Run the full verification**

```bash
pnpm -r test
pnpm typecheck
```

Expected: both PASS. Paste the real tail of each into the PR body — no summarising a run
you did not read.

- [ ] **Step 4: Commit and push**

```bash
git add docs/pagination.md .changeset
git commit -m "docs(sdk): document totals and cursors on PaginatedItems"
git push origin feat/pagination-response-headers
```

Push over SSH. The `gho_` token works for `gh` API calls but is rejected for git itself.

- [ ] **Step 5: Open PR A**

Write the PR body to a scratchpad file first (`gh pr create --body` mangles multi-line
markdown), then:

```bash
gh pr create --base main --title "feat(sdk): expose response headers to facades" --body-file /tmp/pr-a-body.md
```

The body must state: what was unreachable before (the cursor value from #250, and
`X-Total-Count`), that `request` is behaviourally unchanged and which existing suites prove
it (`http-retry`, `http-customer-refresh`, `http-basic`), the three `hasNextPage` tiers with
the one-directional caveat spelled out, and that no facade surfaces any of it yet.

Do **not** merge. Hand the PR over.

---

# PR B — schema cursors and the iterator

**Branch:** `feat/schema-cursor-pagination`, cut from PR A's branch (stacked). Rebase onto
`main` once PR A merges.

## Task B1: typed cursor parameters and `listInstances` on `requestPage`

**Files:**
- Modify: `packages/sdk/src/services/schema-types.ts:94-98` (`ListInstancesQuery`)
- Modify: `packages/sdk/src/services/schema.ts:274-288` (`listInstances`)
- Test: `packages/sdk/tests/services/schema.test.ts`

**Interfaces:**
- Consumes: `requestPage`, `PageParams` from Task A2.
- Produces: `ListInstancesQuery` with declared `next?: string`, `prev?: string`,
  `totalCount?: boolean`; `listInstances` returning a `PaginatedItems` that carries
  `nextCursor` / `prevCursor` when the server sends them.

- [ ] **Step 1: Write the failing test**

Add to the `describe("SchemaService — custom instances (group D)")` block in
`packages/sdk/tests/services/schema.test.ts`:

```ts
  it("forwards next as a query parameter and returns the cursors from the headers", async () => {
    let sentNext: string | null = null;
    server.use(
      http.get(INSTANCES, ({ request }) => {
        sentNext = new URL(request.url).searchParams.get("next");
        return HttpResponse.json(
          [{ id: "i2", name: { en: "n" }, type: "shoe", owner: { type: "SERVICE", userId: "u" }, mixins: { size: 43 }, metadata: { version: 1 } }],
          { headers: { "X-Next-Cursor": "cur-3", "X-Prev-Cursor": "cur-1" } },
        );
      }),
    );

    const page = await svc().listInstances<{ size: number }>("shoe", { next: "cur-2" });

    expect(sentNext).toBe("cur-2");
    expect(page.nextCursor).toBe("cur-3");
    expect(page.prevCursor).toBe("cur-1");
    // One item on a pageSize-60 request: the old guess would have said false.
    expect(page.hasNextPage).toBe(true);
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F @viu/emporix-sdk test -- tests/services/schema.test.ts
```

Expected: FAIL — `page.nextCursor` is `undefined`, and TypeScript rejects `{ next: "cur-2" }`
only once the index signature is narrowed, so the failure is at runtime on the assertion.

- [ ] **Step 3: Declare the cursor parameters**

In `packages/sdk/src/services/schema-types.ts`, replace lines 94–98:

```ts
export interface ListInstancesQuery {
  pageNumber?: number;
  pageSize?: number;
  [key: string]: string | number | undefined;
}
```

with:

```ts
export interface ListInstancesQuery {
  pageNumber?: number;
  pageSize?: number;
  /**
   * Opaque cursor from a previous page's `nextCursor`. Sending it switches the
   * server to cursor pagination: `pageNumber` is ignored and no total is
   * returned. Cannot be combined with {@link prev} — the server answers 400.
   */
  next?: string;
  /** Opaque cursor from a previous page's `prevCursor`. See {@link next}. */
  prev?: string;
  /** Ask for `X-Total-Count`. Ignored by the server in cursor mode. */
  totalCount?: boolean;
  [key: string]: string | number | boolean | undefined;
}
```

- [ ] **Step 4: Move `listInstances` onto `requestPage`**

In `packages/sdk/src/services/schema.ts`, add the import next to the existing core imports
at the top of the file:

```ts
import { requestPage } from "../core/paged";
```

Then replace the body of `listInstances` (lines 279–287) so the method reads:

```ts
  async listInstances<T = Record<string, unknown>>(
    type: string,
    query: ListInstancesQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<CustomInstance<T>>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    // `totalCount` is an SDK-side flag, not an Emporix query parameter — it
    // becomes a request header in requestPage. Sending it in the query too
    // would be a stray `?totalCount=true` on every call.
    const { totalCount, ...rest } = query;
    return requestPage<CustomInstance<T>>(
      this.ctx.http,
      {
        method: "GET",
        path: this.instancesBase(type),
        auth,
        query: { ...rest, pageNumber, pageSize },
      },
      { pageNumber, pageSize, ...(totalCount === undefined ? {} : { totalCount }) },
    );
  }
```

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk test -- tests/services/schema.test.ts
```

Expected: PASS, including the pre-existing `listInstances GETs a paginated envelope for the
type` and `encodeURIComponent-escapes the type segment in the path` cases.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/schema-types.ts packages/sdk/src/services/schema.ts packages/sdk/tests/services/schema.test.ts
git commit -m "feat(sdk): type the schema cursor parameters and read the cursors back

next and prev already slipped through ListInstancesQuery's index signature but
were invisible at the call site and useless, because the cursor value they need
only exists in a response header."
```

## Task B2: `searchInstances` forwards its query

**Files:**
- Modify: `packages/sdk/src/services/schema.ts:468-480` (`searchInstances`)
- Modify: `packages/sdk/src/services/schema-types.ts` (add `SearchInstancesQuery`)
- Test: `packages/sdk/tests/services/schema.test.ts`

**Interfaces:**
- Consumes: `requestPage` from A2; the `ListInstancesQuery` shape from B1.
- Produces: `SearchInstancesQuery` (same fields as `ListInstancesQuery` plus `sort?: string`);
  `searchInstances(type, body, query?, auth?)` — note the **new third parameter**, with
  `auth` moving to fourth.

- [ ] **Step 1: Write the failing test**

Add to the same `describe` block in `packages/sdk/tests/services/schema.test.ts`:

```ts
  it("searchInstances forwards pagination and cursor parameters to the query string", async () => {
    let params = new URLSearchParams();
    server.use(
      http.post(`${INSTANCES}/search`, ({ request }) => {
        params = new URL(request.url).searchParams;
        return HttpResponse.json(
          [{ id: "i1", name: { en: "n" }, type: "shoe", owner: { type: "SERVICE", userId: "u" }, mixins: { size: 42 }, metadata: { version: 1 } }],
          { headers: { "X-Next-Cursor": "cur-9" } },
        );
      }),
    );

    const page = await svc().searchInstances(
      "shoe",
      { size: { $gt: 40 } },
      { pageNumber: 2, pageSize: 5, sort: "_id:ASC", next: "cur-8" },
    );

    expect(params.get("pageNumber")).toBe("2");
    expect(params.get("pageSize")).toBe("5");
    expect(params.get("sort")).toBe("_id:ASC");
    expect(params.get("next")).toBe("cur-8");
    expect(page.nextCursor).toBe("cur-9");
    // Used to be hard-coded false regardless of what the server said.
    expect(page.hasNextPage).toBe(true);
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

```bash
pnpm -F @viu/emporix-sdk test -- tests/services/schema.test.ts
```

Expected: FAIL — `searchInstances` takes no third argument, so every `params.get(...)`
assertion is `null`.

- [ ] **Step 3: Add the query type**

In `packages/sdk/src/services/schema-types.ts`, directly after `InstanceSearchBody`
(line 107), add:

```ts
/** Pagination, sorting and cursor options for {@link SchemaService.searchInstances}. */
export interface SearchInstancesQuery {
  pageNumber?: number;
  pageSize?: number;
  /** e.g. `"_id:ASC"`. The server appends `_id:ASC` as a tie-breaker if absent. */
  sort?: string;
  /** See {@link ListInstancesQuery.next}. */
  next?: string;
  /** See {@link ListInstancesQuery.prev}. */
  prev?: string;
  /** Ask for `X-Total-Count`. Ignored by the server in cursor mode. */
  totalCount?: boolean;
}
```

Add `SearchInstancesQuery` to both the `import { … } from "./schema-types"` list and the
`export type { … } from "./schema-types"` list in `packages/sdk/src/services/schema.ts`
(lines 13–27 and 29–54 respectively), keeping them alphabetically where the neighbours are.

- [ ] **Step 4: Rewrite `searchInstances`**

Replace the whole method (`packages/sdk/src/services/schema.ts:468-480`) with:

```ts
  async searchInstances<T = Record<string, unknown>>(
    type: string,
    body: InstanceSearchBody,
    query: SearchInstancesQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<CustomInstance<T>>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const { totalCount, ...rest } = query;
    return requestPage<CustomInstance<T>>(
      this.ctx.http,
      {
        method: "POST",
        path: `${this.instancesBase(type)}/search`,
        auth,
        body,
        query: { ...rest, pageNumber, pageSize },
      },
      { pageNumber, pageSize, ...(totalCount === undefined ? {} : { totalCount }) },
    );
  }
```

The `auth` parameter moved from third to fourth. Update the existing
`searchInstances POSTs the filter to /instances/search and wraps the result` test if it
passes an `auth` positionally — check it, and check `tests/services/schema-wiring.test.ts`
and `tests/services/facade-coverage.test.ts` for other call sites.

- [ ] **Step 5: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk test
pnpm typecheck
```

Expected: PASS. The full SDK suite, not just the schema file — the signature change is the
kind that breaks a caller three files away.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/schema.ts packages/sdk/src/services/schema-types.ts packages/sdk/tests/services/schema.test.ts
git commit -m "fix(sdk): let searchInstances page, sort and take cursors

It forwarded no query parameters at all and returned a hard-coded
hasNextPage: false, although the spec allows pageNumber, pageSize, sort, next
and prev on that endpoint."
```

## Task B3: the cursor iterator

**Files:**
- Modify: `packages/sdk/src/services/schema.ts` (add `listAllInstances` after `listInstances`)
- Test: `packages/sdk/tests/services/schema.test.ts`

**Interfaces:**
- Consumes: `listInstances` from B1.
- Produces: `listAllInstances<T>(type: string, query?: ListInstancesQuery, auth?: AuthContext): AsyncIterable<CustomInstance<T>>`.
  Any `next`, `prev` or `pageNumber` the caller passes is overwritten by the iterator.

- [ ] **Step 1: Write the failing test**

Add to the same `describe` block:

```ts
  it("listAllInstances follows the cursor across pages", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(INSTANCES, ({ request }) => {
        const next = new URL(request.url).searchParams.get("next");
        seen.push(next);
        const row = (id: string) => ({
          id, name: { en: "n" }, type: "shoe",
          owner: { type: "SERVICE", userId: "u" },
          mixins: { size: 42 }, metadata: { version: 1 },
        });
        if (next === null) return HttpResponse.json([row("a")], { headers: { "X-Next-Cursor": "c1" } });
        if (next === "c1") return HttpResponse.json([row("b")], { headers: { "X-Next-Cursor": "c2" } });
        return HttpResponse.json([row("c")]);
      }),
    );

    const ids: string[] = [];
    for await (const inst of svc().listAllInstances<{ size: number }>("shoe")) ids.push(inst.id);

    expect(ids).toEqual(["a", "b", "c"]);
    expect(seen).toEqual([null, "c1", "c2"]);
  });

  it("listAllInstances falls back to page numbers when the server sends no cursor", async () => {
    const pages: (string | null)[] = [];
    server.use(
      http.get(INSTANCES, ({ request }) => {
        const p = new URL(request.url).searchParams.get("pageNumber");
        pages.push(p);
        const row = (id: string) => ({
          id, name: { en: "n" }, type: "shoe",
          owner: { type: "SERVICE", userId: "u" },
          mixins: { size: 42 }, metadata: { version: 1 },
        });
        // pageSize 2, so a full page means "keep going" under the guess.
        if (p === "1") return HttpResponse.json([row("a"), row("b")]);
        return HttpResponse.json([row("c")]);
      }),
    );

    const ids: string[] = [];
    for await (const inst of svc().listAllInstances<{ size: number }>("shoe", { pageSize: 2 })) {
      ids.push(inst.id);
    }

    expect(ids).toEqual(["a", "b", "c"]);
    expect(pages).toEqual(["1", "2"]);
  });
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
pnpm -F @viu/emporix-sdk test -- tests/services/schema.test.ts
```

Expected: FAIL — `svc(...).listAllInstances is not a function`.

- [ ] **Step 3: Implement the iterator**

In `packages/sdk/src/services/schema.ts`, immediately after `listInstances`, add:

```ts
  /**
   * Async-iterates every instance of a type.
   *
   * Not built on `iterateAll`: that helper drives pagination by page number, and
   * the server ignores `pageNumber` the moment a cursor is in play. This follows
   * `nextCursor` while the server offers one and falls back to `pageNumber + 1`
   * when it does not — so it is correct whether or not the tenant's deployment
   * emits cursor headers on a request that carries no cursor.
   */
  async *listAllInstances<T = Record<string, unknown>>(
    type: string,
    // Takes the full query type rather than an `Omit<…>`: `ListInstancesQuery`
    // has an index signature, so `Omit` would not actually forbid `next` — it
    // would only look like it did. The overrides below win regardless.
    query: ListInstancesQuery = {},
    auth: AuthContext = SERVICE,
  ): AsyncIterable<CustomInstance<T>> {
    let cursor: string | undefined;
    let pageNumber = 1;
    for (;;) {
      const page = await this.listInstances<T>(
        type,
        { ...query, pageNumber, ...(cursor === undefined ? {} : { next: cursor }) },
        auth,
      );
      for (const item of page.items) yield item;
      if (!page.hasNextPage) return;
      cursor = page.nextCursor;
      // Only advances while there is no cursor. Once cursor mode takes over the
      // server ignores pageNumber anyway, so leaving it pinned keeps the two
      // modes from interfering.
      if (cursor === undefined) pageNumber += 1;
    }
  }
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk test -- tests/services/schema.test.ts
```

Expected: PASS, both new cases.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/schema.ts packages/sdk/tests/services/schema.test.ts
git commit -m "feat(sdk): add listAllInstances, a cursor-following iterator"
```

## Task B4: docs, changeset, PR B

**Files:**
- Modify: `docs/pagination.md` (the "Available paginated surfaces" table)
- Create: the `.changeset/*.md` file that `pnpm changeset` generates (it picks the name)

**Interfaces:**
- Consumes: B1–B3.
- Produces: nothing.

- [ ] **Step 1: Add the schema surfaces to the docs table**

In `docs/pagination.md`, in the `## Available paginated surfaces` table, add these rows:

```markdown
| `client.schema.listInstances` / `searchInstances` | `PaginatedItems<CustomInstance<T>>` |
| `client.schema.listAllInstances` | `AsyncIterable<CustomInstance<T>>` |
```

Then, under the "Absolute totals and cursors" section written in Task A3, append:

````markdown
### Following a cursor by hand

```ts
let page = await client.schema.listInstances("shoe", { pageSize: 50 });
while (page.nextCursor !== undefined) {
  page = await client.schema.listInstances("shoe", { pageSize: 50, next: page.nextCursor });
}
```

`client.schema.listAllInstances("shoe")` does exactly this and yields the items, falling
back to page numbers on a tenant whose deployment does not send the cursor headers.
````

- [ ] **Step 2: Author the changeset**

```bash
pnpm changeset
```

`@viu/emporix-sdk`, **minor**. Summary:

```
feat(sdk): support cursor pagination on schema custom instances

listInstances and searchInstances now declare `next` / `prev`, return the
cursors the server sends back, and searchInstances finally forwards
pageNumber, pageSize and sort — it forwarded none of them and always claimed
hasNextPage: false. New listAllInstances iterates a whole type by cursor.

Note: searchInstances gained a third `query` parameter, so a positional `auth`
argument moves to fourth.
```

- [ ] **Step 3: Run the full verification**

```bash
pnpm -r test
pnpm typecheck
```

- [ ] **Step 4: Commit, push, open PR B**

```bash
git add docs/pagination.md .changeset
git commit -m "docs(sdk): document schema cursor pagination"
git push origin feat/schema-cursor-pagination
gh pr create --base main --title "feat(sdk): support cursor pagination on schema custom instances" --body-file /tmp/pr-b-body.md
```

The body must call out the `searchInstances` signature change explicitly — it is the one
thing in this PR that can break a caller — and note that PR A must merge first.

Do **not** merge.

---

# PR C — totals across the facades

**Branch:** `feat/pagination-totals`, cut from PR A's branch. Independent of PR B.

## Task C1: migrate the storefront-facing facades

**Files:**
- Modify: `packages/sdk/src/services/product.ts:122`, `:149`, `:182`
- Modify: `packages/sdk/src/services/category.ts:82`, `:103`, `:199`, `:368`
- Modify: `packages/sdk/src/services/availability.ts:114`
- Test: `packages/sdk/tests/services/product.test.ts`, `category.test.ts`, `availability.test.ts`

**Interfaces:**
- Consumes: `requestPage`, `PageParams` from A2.
- Produces: `totalCount?: boolean` accepted by `products.list`, `products.search`,
  `products.searchByName`, `categories.list`, `categories.search`, `categories.productsIn`,
  `categories.searchByQuery`, `availability.listForSite`.

These are the facades the React hooks sit on, which is why they are their own task: a
reviewer can accept or reject the storefront blast radius separately from the backend one.

- [ ] **Step 1: Write the failing test**

Add to `packages/sdk/tests/services/product.test.ts`:

```ts
  it("asks for X-Total-Count only on request and reports the exact total", async () => {
    let asked: string | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        asked = request.headers.get("X-Total-Count");
        return HttpResponse.json([{ id: "p1" }], { headers: { "X-Total-Count": "137" } });
      }),
    );

    const plain = await svc().list({ pageNumber: 1, pageSize: 50 });
    expect(asked).toBeNull();
    expect(plain.totalCount).toBeUndefined();

    const withTotals = await svc().list({ pageNumber: 1, pageSize: 50, totalCount: true });
    expect(asked).toBe("true");
    expect(withTotals.totalCount).toBe(137);
    expect(withTotals.hasNextPage).toBe(true);
  });
```

`svc()` is the service factory `product.test.ts` already defines at line 36, and
`https://api.emporix.io/product/acme/products` is the URL its other handlers use — the
snippet drops in as written.

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm -F @viu/emporix-sdk test -- tests/services/product.test.ts
```

Expected: FAIL — TypeScript rejects `totalCount` on the params type.

- [ ] **Step 3: Apply the migration to each method**

Add `import { requestPage } from "../core/paged";` to each of the three service files.

The transformation is the same everywhere. `products.list` goes from:

```ts
  async list(
    params: { pageNumber?: number; pageSize?: number } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    const items = await this.ctx.http.request<Product[]>({
      method: "GET",
      path: `/product/${this.ctx.tenant}/products`,
      query: { pageNumber, pageSize },
      auth,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }
```

to:

```ts
  async list(
    params: { pageNumber?: number; pageSize?: number; totalCount?: boolean } = {},
    auth: AuthContext = ANON,
  ): Promise<PaginatedItems<Product>> {
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 50;
    return requestPage<Product>(
      this.ctx.http,
      {
        method: "GET",
        path: `/product/${this.ctx.tenant}/products`,
        query: { pageNumber, pageSize },
        auth,
      },
      { pageNumber, pageSize, ...(params.totalCount === undefined ? {} : { totalCount: params.totalCount }) },
    );
  }
```

Three rules that apply to every one of them:

1. **The `pageSize` default never changes.** Copy the existing `?? N` verbatim — they
   differ per service and a silent change moves every consumer's page boundaries.
2. **`totalCount` must not leak into the query string.** It is an SDK-side flag that
   becomes a request header. Where the facade spreads the caller's object into `query`
   (`{ ...query, pageNumber, pageSize }` — `schema`, `media`, `fee`, `quote`), destructure
   it out first: `const { totalCount, ...rest } = query;`. Where the facade builds the query
   field by field (`product`, `category`, `availability`, `orders`, `indexing`), nothing
   leaks and no destructuring is needed.
3. **Spread the flag conditionally** into `PageParams` — `exactOptionalPropertyTypes`
   rejects `{ totalCount: undefined }`.

Apply it to each of these, using each one's own path, query and default:

| file:line | method | `pageSize` default | query built by |
|---|---|---|---|
| `product.ts:122` | `list` | 50 | field by field |
| `product.ts:149` | `search` | 50 | field by field |
| `category.ts:82` | `list` | 50 | field by field |
| `category.ts:103` | `search` | 50 | field by field |
| `category.ts:199` | `productsIn` | 50 | field by field |
| `category.ts:368` | `searchByQuery` | 50 | field by field |
| `availability.ts:114` | `listForSite` | 50 | field by field |

`products.searchByName` (`product.ts:182`) makes **no request of its own** — it delegates to
`products.search`. It needs only two edits: add `totalCount?: boolean` to its `params` type
so the flag can be forwarded, and leave its early-return empty page (for a blank search
term) exactly as it is — an empty page has no total to report.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk test -- tests/services/product.test.ts tests/services/category.test.ts tests/services/availability.test.ts tests/services/product-admin.test.ts tests/services/category-admin.test.ts
pnpm typecheck
```

Expected: PASS. The `-admin` suites are included because they share the same service
classes.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/product.ts packages/sdk/src/services/category.ts packages/sdk/src/services/availability.ts packages/sdk/tests/services
git commit -m "feat(product): opt into absolute totals on the storefront list facades

product, category and availability move onto requestPage, so a caller can ask
for X-Total-Count and get an exact hasNextPage instead of the page-size guess."
```

## Task C2: migrate the backend facades

**Files:**
- Modify: `packages/sdk/src/services/media.ts:111`, `:380`
- Modify: `packages/sdk/src/services/orders.ts:136`, `:216`, `:300`
- Modify: `packages/sdk/src/services/quote.ts:53`, `:144`
- Modify: `packages/sdk/src/services/fee.ts:65`
- Modify: `packages/sdk/src/services/indexing.ts:121`
- Modify: `packages/sdk/src/services/schema.ts:102`, `:497`
- Test: the matching `packages/sdk/tests/services/*.test.ts`

**Interfaces:**
- Consumes: `requestPage`, `PageParams` from A2; the three migration rules from Task C1.
- Produces: `totalCount?: boolean` accepted by `media.list`, `media.listForProduct`,
  `orders.listMine`, `salesOrders.listForLegalEntity`, `salesOrders.list`, `quotes.list`,
  `quoteReasons.list`, `fees.list`, `indexing.listReindexJobs`, `schema.listSchemas`,
  `schema.references.list`.

- [ ] **Step 1: Write the failing test**

Add to `packages/sdk/tests/services/media.test.ts`. `svc()` is that file's own service
factory (line 19) and `https://api.emporix.io/media/acme/assets` is the URL its other
handlers use, so this drops in as written:

```ts
  it("asks for X-Total-Count only on request and reports the exact total", async () => {
    let asked: string | null = null;
    server.use(
      http.get("https://api.emporix.io/media/acme/assets", ({ request }) => {
        asked = request.headers.get("X-Total-Count");
        return HttpResponse.json([{ id: "a1" }], { headers: { "X-Total-Count": "3" } });
      }),
    );

    const plain = await svc().list({ pageSize: 60 });
    expect(asked).toBeNull();
    expect(plain.totalCount).toBeUndefined();

    const withTotals = await svc().list({ pageSize: 60, totalCount: true });
    expect(asked).toBe("true");
    expect(withTotals.totalCount).toBe(3);
    // 1 * 60 >= 3, so this is the last page — the guess would have agreed here
    // only because the page is short.
    expect(withTotals.hasNextPage).toBe(false);
  });
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
pnpm -F @viu/emporix-sdk test -- tests/services/media.test.ts
```

Expected: FAIL — TypeScript rejects `totalCount` on `ListAssetsQuery`.

- [ ] **Step 3: Apply the same migration**

Same three rules as Task C1, applied to:

| file:line | method | `pageSize` default | query built by |
|---|---|---|---|
| `media.ts:111` | `list` | 60 | spread — destructure `totalCount` out |
| `orders.ts:136` | `listMine` | 50 | field by field |
| `orders.ts:216` | `listForLegalEntity` | 50 | field by field |
| `orders.ts:300` | `list` (sales orders) | 50 | field by field |
| `quote.ts:53` | `list` | 60 | field by field |
| `quote.ts:144` | `list` (reasons) | 60 | field by field |
| `fee.ts:65` | `list` | 60 | spread — destructure `totalCount` out |
| `indexing.ts:121` | `listReindexJobs` | 50 | field by field |
| `schema.ts:102` | `listSchemas` | 60 | field by field (`const q: Record<string, string \| number>`) |
| `schema.ts:497` | `references.list` | 60 | field by field |

Where the query object is typed `Record<string, string | number>` (quote, orders,
indexing), leave that type alone — `totalCount` never enters it.

`media.listForProduct` (`media.ts:380`) delegates to `media.list` and makes no request of
its own. It takes no options object today; leave its signature alone rather than inventing
one — a caller who wants totals calls `media.list({ "refIds.id": id, totalCount: true })`.
Say so in its JSDoc.

`segments.listMyProducts` and `segments.listMyCategories` are **deliberately not migrated**.
They page over the assignments list and hydrate the hits through a second call, so an
`X-Total-Count` there would count assignments, not the products or categories the caller
sees. Add a comment above each saying exactly that, so the next person does not "finish the
job".

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
pnpm -F @viu/emporix-sdk test
pnpm typecheck
```

Expected: PASS across the whole SDK package.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services packages/sdk/tests/services
git commit -m "feat(media): opt into absolute totals on the backend list facades

media, orders, quotes, fees, indexing and schema move onto requestPage. The two
segment facades stay on the guess on purpose — their count would describe the
assignments list, not the items the caller gets back."
```

## Task C3: verify the React query key

**Files:**
- Read: `packages/react/src/hooks/internal/query-keys.ts:14-23`
- Read: `packages/react/src/hooks/internal/use-emporix-query.ts:63`
- Test: `packages/react/tests/query-keys.test.ts`

**Interfaces:**
- Consumes: the `totalCount?: boolean` parameters from C1.
- Produces: either a passing verification, or a fix — this task's deliverable is evidence,
  not a guess.

The claim to verify: `emporixKey(resource, args, meta)` folds the call arguments into the
query key, so `useProducts({ pageSize: 50, totalCount: true })` gets its own cache entry and
cannot be served a cached page that lacks `totalCount`.

- [ ] **Step 1: Read how the key is built**

```bash
cat packages/react/src/hooks/internal/query-keys.ts
```

`emporixKey` is declared as:

```ts
export function emporixKey<TArgs extends readonly unknown[]>(
  resource: string,
  args: TArgs,
  context: { tenant: string; authKind: string; siteCode?: string | null; language?: string | null },
): readonly ["emporix", string, ...TArgs, Record<string, unknown>]
```

`args` is a **tuple spread wholesale into the key**, so a params object containing
`totalCount` should land in it untouched. What still has to be checked is the hook side:
whether the hook passes its params object into `args` intact, or picks fields out of it
first. If it picks, `totalCount` is dropped and the claim is **false** — that is the failure
mode this task exists to catch.

- [ ] **Step 2: Write the test that proves it either way**

Add to `packages/react/tests/query-keys.test.ts`. Note `args` is an **array**:

```ts
it("gives a totals request its own cache key", () => {
  const ctx = { tenant: "acme", authKind: "anonymous" };
  const withoutTotals = emporixKey("products", [{ pageNumber: 1, pageSize: 50 }], ctx);
  const withTotals = emporixKey("products", [{ pageNumber: 1, pageSize: 50, totalCount: true }], ctx);
  expect(withTotals).not.toEqual(withoutTotals);
});
```

Copy the exact `ctx` shape from the neighbouring tests in that file if they build it
differently.

- [ ] **Step 3: Run it**

```bash
pnpm -F @viu/emporix-sdk-react test
```

If it PASSES, the claim held: record that in the PR body and move on. If it FAILS,
`totalCount` must be threaded into the key explicitly — do that, and say so in the PR body
rather than quietly fixing it.

- [ ] **Step 4: Commit**

```bash
git add packages/react
git commit -m "test(react): prove a totals request gets its own query key"
```

## Task C4: docs, changeset, PR C

**Files:**
- Modify: `docs/pagination.md`
- Create: the `.changeset/*.md` file that `pnpm changeset` generates (it picks the name)

**Interfaces:**
- Consumes: C1–C3.
- Produces: nothing.

- [ ] **Step 1: Document the "X of Y" usage**

In `docs/pagination.md`, under the "Absolute totals and cursors" section from Task A3,
replace the sentence `No facade surfaces `totalCount` yet — that arrives with the facade
migration.` with:

````markdown
### "X of Y" counters

```ts
const page = await client.products.list({ pageNumber: 2, pageSize: 50, totalCount: true });
`Showing ${(page.pageNumber - 1) * page.pageSize + page.items.length} of ${page.totalCount}`;
```

`totalCount: true` is accepted by every list facade except `client.segments.listMyProducts`
and `listMyCategories`. Those two page over the segment's **assignments** and hydrate the
hits through a second call, so a total there would count assignments rather than the items
returned — they keep the `items.length === pageSize` guess on purpose.
````

- [ ] **Step 2: Author the changeset**

```bash
pnpm changeset
```

`@viu/emporix-sdk`, **minor**. Summary:

```
feat(sdk): opt into absolute match counts on the list facades

Pass `totalCount: true` to any list facade to get `X-Total-Count` back as
`page.totalCount`, and an exact `hasNextPage` instead of the page-size guess.
Off by default: Emporix computes the count with a second query.

The two segment facades keep the guess — their count would describe the
assignments list rather than the items returned.
```

- [ ] **Step 3: Run the full verification**

```bash
pnpm -r test
pnpm typecheck
```

- [ ] **Step 4: Commit, push, open PR C**

```bash
git add docs/pagination.md .changeset
git commit -m "docs(sdk): document the totalCount opt-in"
git push origin feat/pagination-totals
gh pr create --base main --title "feat(sdk): opt into absolute match counts on the list facades" --body-file /tmp/pr-c-body.md
```

The body must list: which facades gained the flag, the two that deliberately did not and
why, the result of the React query-key verification from C3 (the actual result, not the
hoped-for one), and that PR A must merge first.

Do **not** merge.

---

## Deliberately not in this plan

- **No local guard that `next` and `prev` are mutually exclusive.** The server answers 400
  and the SDK surfaces it as `EmporixBadRequestError`. A second copy of the rule in the
  client is a second place to maintain it.
- **`requestPage` is not exported from `index.ts`.** No consumer outside the SDK needs it,
  and an internal helper can change shape without a major bump.
- **Cursors stay on the two schema endpoints.** No other vendored spec offers them.
- **Totals are never on by default.** That would add a count query to every list call in
  every storefront.
- **`segments.listMyProducts` / `listMyCategories` keep the guess.** Their total would be
  the wrong number in the way that is hardest to notice.
