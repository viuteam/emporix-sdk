# Service Account Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@viu/emporix-sdk-next/service` with `getEmporixServiceClient`, so a
Next server can hold a named Emporix service account with `clientId` + `secret`,
reuse its cached token, and be unable to leak the secret into the browser bundle.

**Architecture:** One memoized factory over `EmporixClient` with
`credentials.custom`, in its own build entry whose `exports` map resolves to a
throwing file outside the server graph. No tagging fetch, ever. No cookies.

**Tech Stack:** TypeScript, Next 16, `@viu/emporix-sdk`, Vitest, tsup, changesets.

**Spec:** [`../specs/2026-07-31-next-service-account-design.md`](../specs/2026-07-31-next-service-account-design.md)

## Global Constraints

- **Branch:** `feat/next-service-account`, already created off `origin/main` and
  merged up to `abf779c` (which includes #193). The two spec commits `16acc8d`
  and `0da7148` are already on it. Do **not** stack on another feature branch —
  `pr-check.yml` runs `on: pull_request: branches: [main]`, so a PR based on a
  feature branch never gets its `quality` checks.
- **Commitlint** (`.husky/commit-msg`): scope must be one of
  `repo, release, sdk, react, core, customer, product, category, cart, checkout,
  payment, price, media, segment, availability, auth, http, logger, deps, docs,
  examples`. There is **no** `next` scope — use `repo`. First word after the
  scope must be a **lowercase verb**.
- **No new runtime dependency.** `packages/next` has no `dependencies` section
  and keeps it. In particular: do **not** add `server-only`.
- **The service client must never receive a `fetch`.** Omitting it is the
  security property, not a default. Next's fetch cache does not key on
  `Authorization`, so a tagged privileged GET would be served to other visitors.
  There is no `tagged` option to add.
- **No `context` option.** `context` belongs to `StorefrontCredentials`, not
  `ServiceCredentials` — a service client has nowhere to put it.
- **Never print, commit or paste a credential value.** No real service-account
  credentials are needed anywhere in this plan; the guard verification checks
  module resolution and the build, not a successful Emporix call. Placeholders
  only. The tenant's own credentials stay in the untracked
  `examples/next-app-router/.env.local` (`.gitignore:7`).
- **TS strictness** (`tsconfig.base.json`): `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `moduleResolution: "bundler"`. Optional properties are spread conditionally
  (`...(x !== undefined ? { x } : {})`), never assigned `undefined`. Indexed
  access yields `T | undefined` and must be narrowed.
- **Build order.** `packages/next` resolves `@viu/emporix-sdk` through its
  `dist/`. Run `pnpm -r --filter "./packages/*" build` after pulling or
  switching branches, or typecheck reads a stale `dist/`.
- **Code comments and docs in English.** Specs and plans are German, shipped
  source and README are English.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/next/src/service.ts` | **create** — `getEmporixServiceClient`, the memo map, the validation, `__resetEmporixServiceClients` |
| `packages/next/tests/service.test.ts` | **create** — fourteen tests (Task 1) plus two guard tests (Task 2) |
| `packages/next/tsup.config.ts` | **modify** — fourth build entry |
| `packages/next/package.json` | **modify** — `"./service"` export (Task 1, plain), then the conditional form plus the `files` entry (Task 2) |
| `packages/next/service-is-server-only.js` | **create** (Task 2) — hand-written, four lines, throws |
| `packages/next/README.md` | **modify** (Task 3) — a section after «The one rule» |
| `.changeset/next-service-account.md` | **create** (Task 3) |

`service.ts` stays one file. It is one function plus its guards.

**Baseline for test counting:** `packages/next` has **79** tests today —
`tags` 22, `webhook` 25, `client` 15, `session` 7, `proxy` 10. Task 1 takes it to
93, Task 2 to 95. Measured, not estimated: if the observed starting number is not
79, stop and find out what changed rather than adjusting the expectation.

---

## Task 1: `getEmporixServiceClient` with fourteen tests

**Files:**
- Create: `packages/next/src/service.ts`
- Create: `packages/next/tests/service.test.ts`
- Modify: `packages/next/tsup.config.ts` (the `entry` object)
- Modify: `packages/next/package.json` (the `exports` map, after `"./proxy"`)

**Interfaces:**
- Consumes: `EmporixClient` (value) and `ServiceCredentials` (type) from
  `@viu/emporix-sdk`. `ServiceCredentials` is exported from the SDK root
  (`packages/sdk/src/index.ts:8`) and is `{ clientId: string; secret: string;
  scope?: string }` — use it directly rather than declaring a twin type.
- Produces:
  ```ts
  export interface GetEmporixServiceClientOptions {
    credentials: Record<string, ServiceCredentials>;
    tenant?: string;
    host?: string;
  }
  export function getEmporixServiceClient(
    opts: GetEmporixServiceClientOptions,
  ): EmporixClient;
  export function __resetEmporixServiceClients(): void;
  ```
  Task 2 wraps this entry in the export condition. Task 3 documents these names.

**Background an implementer needs.** All of it measured in the SDK source:

- `credentials.custom?: Record<string, ServiceCredentials>` is the named
  service-account slot (`packages/sdk/src/core/config.ts`).
- `auth.service(name)` picks a set; `auth.service()` with no argument means
  `"backend"` (`core/auth.ts:95`, `:109`).
- The token cache is per set on the **client instance**
  (`core/auth.ts:282-286`), with `expiresAt = obtainedAt + (expires_in −
  expirationBufferSeconds) * 1000` and a default buffer of 60 s. A single-flight
  lock per set sits in front of it (`core/auth.ts:235-239`).
- An unknown set throws `Unknown credential set "x"` before the cache path
  (`core/auth.ts:219`, `:231`).
- **Token requests deliberately use the global `fetch`**, never the injected one
  (comment on `EmporixConfig.fetch`). Stubbing `globalThis.fetch` is therefore
  the correct seam for every token test — and since this client injects no
  `fetch` at all, the same stub also catches API requests.
- `client.config` is public: `readonly config: ResolvedConfig`
  (`packages/sdk/src/client.ts:117`).
- `client.products.get(productId, _opts?, auth?)` is a plain GET
  (`packages/sdk/src/services/product.ts:93-102`) — the cheapest call for
  driving a token fetch in a test.

- [ ] **Step 1: Write the failing test file**

Create `packages/next/tests/service.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { auth } from "@viu/emporix-sdk";
import { getEmporixServiceClient, __resetEmporixServiceClients } from "../src/service";

const CREDS = {
  productWriter: { clientId: "writer-id", secret: "writer-secret", scope: "product.product_create" },
};

/**
 * Stubs the global fetch and records every call. Token requests and API requests
 * both land here: token requests use the global fetch by design, and a service
 * client injects no fetch of its own.
 */
function stubFetch(tokenBody: Record<string, unknown> = { access_token: "tok", expires_in: 3600 }) {
  const calls: Array<{ url: string; body: string }> = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, body: typeof init?.body === "string" ? init.body : String(init?.body ?? "") });
    const payload = url.includes("/oauth/token") ? tokenBody : {};
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return {
    calls,
    tokenCalls: (): Array<{ url: string; body: string }> =>
      calls.filter((c) => c.url.includes("/oauth/token")),
  };
}

beforeEach(() => {
  __resetEmporixServiceClients();
  process.env.EMPORIX_TENANT = "viu";
  delete process.env.EMPORIX_HOST;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EMPORIX_TENANT;
});

describe("getEmporixServiceClient — instance and config", () => {
  it("returns the same instance for identical options", () => {
    const a = getEmporixServiceClient({ credentials: CREDS });
    const b = getEmporixServiceClient({ credentials: CREDS });
    expect(a).toBe(b);
  });

  it("returns a different instance for different options", () => {
    const a = getEmporixServiceClient({ credentials: CREDS });
    const b = getEmporixServiceClient({ credentials: CREDS, tenant: "other" });
    expect(a).not.toBe(b);
  });

  it("never installs a fetch — a service client must not be tagged", () => {
    // Next's fetch cache does not key on Authorization. A tagged privileged GET
    // would be served to other visitors.
    const client = getEmporixServiceClient({ credentials: CREDS });
    expect(client.config.fetch).toBeUndefined();
  });

  it("passes the named credential sets through to the SDK", () => {
    const client = getEmporixServiceClient({ credentials: CREDS });
    expect(client.config.credentials.custom?.productWriter?.clientId).toBe("writer-id");
    expect(client.config.credentials.storefront).toBeUndefined();
    expect(client.config.credentials.backend).toBeUndefined();
  });

  it("uses a host override for the token request, not just the config", async () => {
    const f = stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS, host: "https://custom.test" });
    await client.products.get("p1", undefined, auth.service("productWriter"));
    expect(f.tokenCalls()[0]?.url).toBe("https://custom.test/oauth/token");
  });
});

describe("getEmporixServiceClient — token behaviour", () => {
  it("sends the configured scope in the client_credentials body", async () => {
    const f = stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS });
    await client.products.get("p1", undefined, auth.service("productWriter"));
    const body = f.tokenCalls()[0]?.body ?? "";
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("client_id=writer-id");
    expect(body).toContain("scope=product.product_create");
  });

  it("reuses the cached token across sequential calls", async () => {
    const f = stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS });
    await client.products.get("p1", undefined, auth.service("productWriter"));
    await client.products.get("p2", undefined, auth.service("productWriter"));
    expect(f.tokenCalls()).toHaveLength(1);
  });

  it("fetches one token for ten concurrent calls", async () => {
    // Single-flight lock, core/auth.ts:235-239. Distinct from the sequential
    // case: a broken lock still passes that one.
    const f = stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS });
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.products.get(`p${i}`, undefined, auth.service("productWriter")),
      ),
    );
    expect(f.tokenCalls()).toHaveLength(1);
  });

  it("re-fetches once the cached token has expired", async () => {
    // expires_in 1 minus the 60s default buffer puts expiresAt in the past, so
    // this needs no fake timers. Guards against a cache that never expires,
    // which the sequential test would also pass.
    const f = stubFetch({ access_token: "tok", expires_in: 1 });
    const client = getEmporixServiceClient({ credentials: CREDS });
    await client.products.get("p1", undefined, auth.service("productWriter"));
    await client.products.get("p2", undefined, auth.service("productWriter"));
    expect(f.tokenCalls()).toHaveLength(2);
  });

  it("keys the token cache per credential set", async () => {
    const f = stubFetch();
    const client = getEmporixServiceClient({
      credentials: {
        writer: { clientId: "writer-id", secret: "s1" },
        reader: { clientId: "reader-id", secret: "s2" },
      },
    });
    await client.products.get("p1", undefined, auth.service("writer"));
    await client.products.get("p2", undefined, auth.service("reader"));
    const bodies = f.tokenCalls().map((c) => c.body);
    expect(bodies).toHaveLength(2);
    expect(bodies.some((b) => b.includes("client_id=writer-id"))).toBe(true);
    expect(bodies.some((b) => b.includes("client_id=reader-id"))).toBe(true);
  });

  it("rejects an unknown credential set", async () => {
    stubFetch();
    const client = getEmporixServiceClient({ credentials: CREDS });
    await expect(
      client.products.get("p1", undefined, auth.service("nope")),
    ).rejects.toThrow(/Unknown credential set "nope"/);
  });
});

describe("getEmporixServiceClient — validation", () => {
  it("throws and names EMPORIX_TENANT when no tenant is resolvable", () => {
    delete process.env.EMPORIX_TENANT;
    expect(() => getEmporixServiceClient({ credentials: CREDS })).toThrow(/EMPORIX_TENANT/);
  });

  it("throws when credentials is empty", () => {
    expect(() => getEmporixServiceClient({ credentials: {} })).toThrow(
      /at least one named credential set/,
    );
  });

  it("throws and names the set when clientId or secret is empty", () => {
    // An unset env var yields "" — which reaches Emporix as a 401 that looks
    // like a permissions problem. Fail locally, once per process, instead.
    expect(() =>
      getEmporixServiceClient({ credentials: { writer: { clientId: "id", secret: "" } } }),
    ).toThrow(/"writer"/);
    expect(() =>
      getEmporixServiceClient({ credentials: { writer: { clientId: "", secret: "s" } } }),
    ).toThrow(/"writer"/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/service.test.ts
```

Expected: the file fails to collect with `Failed to load url ../src/service`.
All fourteen fail because the module does not exist. If you instead see
`getEmporixServiceClient is not a function`, the file exists but the export name
is wrong.

- [ ] **Step 3: Write the implementation**

Create `packages/next/src/service.ts`:

```ts
import { EmporixClient, type ServiceCredentials } from "@viu/emporix-sdk";

export interface GetEmporixServiceClientOptions {
  /**
   * Named client-credentials sets. The key is the name you pass to
   * `auth.service(name)`.
   */
  credentials: Record<string, ServiceCredentials>;
  /** Default: `process.env.EMPORIX_TENANT`. */
  tenant?: string;
  /** Default: `process.env.EMPORIX_HOST`, else the SDK default. */
  host?: string;
}

const clients = new Map<string, EmporixClient>();

/**
 * A memoized `EmporixClient` holding one or more Emporix service accounts.
 *
 * **Server-only.** This module carries a client secret. Its `exports` entry
 * resolves to a throwing file outside the server graph, so importing it from a
 * `"use client"` module fails the build rather than shipping the secret to the
 * browser. Use it from a Route Handler, a Server Action or a Server Component.
 *
 * Call it at **module scope**, never inside a handler body. The SDK's token
 * cache lives on the client instance: a per-request client fetches a fresh
 * token per request and the cache does nothing. That memoization is the reason
 * this function exists.
 *
 * Token handling is entirely the SDK's: one cached token per credential set,
 * reused until `expires_in` minus a 60s buffer, behind a single-flight lock so
 * concurrent calls share one token request.
 *
 * There is deliberately **no `tagged` option**. A service client never receives
 * a `fetch`, because Next's fetch cache does not key on the `Authorization`
 * header — a cached privileged GET would be served to other visitors. An option
 * that can be set to `true` is an option someone eventually sets to `true`.
 *
 * There is deliberately **no `context` option**. `context` belongs to
 * `StorefrontCredentials` and is bound at anonymous login; a service client has
 * no storefront credentials and nowhere to put it.
 *
 * @example
 * ```ts
 * // lib/emporix-service.ts
 * export const service = getEmporixServiceClient({
 *   credentials: {
 *     productWriter: {
 *       clientId: process.env.EMPORIX_PRODUCT_WRITER_ID!,
 *       secret: process.env.EMPORIX_PRODUCT_WRITER_SECRET!,
 *       scope: "product.product_create",
 *     },
 *   },
 * });
 *
 * // app/api/products/route.ts
 * await service.products.create(input, {}, auth.service("productWriter"));
 * ```
 */
export function getEmporixServiceClient(
  opts: GetEmporixServiceClientOptions,
): EmporixClient {
  const tenant = opts.tenant ?? process.env.EMPORIX_TENANT;
  if (!tenant) {
    throw new Error(
      "getEmporixServiceClient: no tenant. Set EMPORIX_TENANT or pass { tenant }.",
    );
  }

  const names = Object.keys(opts.credentials);
  if (names.length === 0) {
    throw new Error(
      "getEmporixServiceClient: credentials is empty. Pass at least one named credential set.",
    );
  }
  for (const name of names) {
    const set = opts.credentials[name];
    if (!set?.clientId || !set.secret) {
      throw new Error(
        `getEmporixServiceClient: credential set "${name}" is missing clientId or secret. ` +
          "An unset environment variable yields an empty string, which Emporix rejects " +
          "as a 401 that looks like a permissions problem.",
      );
    }
  }

  const host = opts.host ?? process.env.EMPORIX_HOST;
  // The secrets are part of the key. They are already held in
  // ResolvedConfig.credentials for the life of the process, so this adds no
  // exposure — and a key without them could silently return a client carrying
  // the wrong secret for a set of the same name.
  const key = JSON.stringify({ tenant, host: host ?? "", credentials: opts.credentials });
  const cached = clients.get(key);
  if (cached) return cached;

  const client = new EmporixClient({
    tenant,
    credentials: { custom: opts.credentials },
    logger: false,
    ...(host !== undefined ? { host } : {}),
    // No `fetch`. See the note above — omitting it is the security property.
  });
  clients.set(key, client);
  return client;
}

/** Test-only: clears the memoization map so each test starts clean. */
export function __resetEmporixServiceClients(): void {
  clients.clear();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/service.test.ts
```

Expected: `Tests 14 passed (14)`.

If the token tests fail with a network error, the stub is not catching API
requests — check that `getEmporixServiceClient` really passes no `fetch`, since
that is what makes the client fall back to the global one.

- [ ] **Step 5: Mutation-test the three guards that matter**

Each of these passed first try, so none is known to work. Mutate, confirm
**exactly** the expected test fails, revert.

Mutation A — the security property. In `service.ts`, add
`fetch: globalThis.fetch,` to the `new EmporixClient({...})` literal.
Expected: exactly 1 failure, `never installs a fetch — a service client must not
be tagged`. Revert.

Mutation B — the validation that turns a 401 into a local error. Delete the
`for (const name of names)` loop.
Expected: exactly 1 failure, `throws and names the set when clientId or secret is
empty`. Restore.

Mutation C — the memoization, which is the whole point of the function. Replace
`const cached = clients.get(key); if (cached) return cached;` with nothing.
Expected: at least the `returns the same instance for identical options` test
fails. Note which others move — the token-caching tests should **not** break,
because each test creates its client once; if they do break, a test is
accidentally relying on cross-call memoization. Restore.

If a mutation produces zero failures, stop and work out why before continuing.

- [ ] **Step 6: Add the build entry**

In `packages/next/tsup.config.ts`, the `entry` line currently reads:

```ts
  entry: { index: "src/index.ts", webhook: "src/webhook.ts", proxy: "src/proxy.ts" },
```

Replace it and extend the comment above it so the block reads:

```ts
  // `webhook` is its own entry so a Route Handler does not pull the client and
  // session code (and with it `next/headers`). `proxy` likewise: `cookies()`
  // from `next/headers` is not available in a proxy at all. `service` is
  // separate for a different reason — it carries a client secret and its
  // `exports` entry resolves to a throwing file outside the server graph.
  entry: {
    index: "src/index.ts",
    webhook: "src/webhook.ts",
    proxy: "src/proxy.ts",
    service: "src/service.ts",
  },
```

- [ ] **Step 7: Add the subpath export (plain form for now)**

In `packages/next/package.json`, insert a `"./service"` block after `"./proxy"`:

```json
    "./proxy": {
      "types": "./dist/proxy.d.ts",
      "import": "./dist/proxy.js",
      "require": "./dist/proxy.cjs"
    },
    "./service": {
      "types": "./dist/service.d.ts",
      "import": "./dist/service.js",
      "require": "./dist/service.cjs"
    },
    "./package.json": "./package.json"
```

Task 2 replaces this with the conditional form. Keeping it plain here means
every intermediate state of the branch is valid.

- [ ] **Step 8: Build and confirm the artefacts**

Run:

```bash
pnpm -F @viu/emporix-sdk-next build
```

Then:

```bash
ls packages/next/dist/service.js packages/next/dist/service.cjs packages/next/dist/service.d.ts packages/next/dist/service.d.cts
```

Expected: all four listed. Then confirm the entry pulled in neither
`next/headers` nor the tagging fetch:

```bash
grep -c "next/headers\|emporixTagsForUrl" packages/next/dist/service.js || echo "clean: service entry has no next/headers and no tag mapping"
```

Expected: `clean: service entry has no next/headers and no tag mapping`. A
non-zero count means `src/service.ts` imported something from `src/index.ts`,
`src/session.ts` or `src/client.ts`.

- [ ] **Step 9: Full local gate**

Run:

```bash
pnpm typecheck && pnpm lint && pnpm -r test
```

Expected: all green, `packages/next` at **93** tests (79 + 14).

- [ ] **Step 10: Commit**

```bash
git add packages/next/src/service.ts packages/next/tests/service.test.ts packages/next/tsup.config.ts packages/next/package.json
git commit -m "feat(repo): add getEmporixServiceClient for named service accounts" -m "A Next server can now hold one or more Emporix service accounts with clientId
and secret and reuse the SDK's cached token: one client instance per process, so
the per-set cache, the 60s expiry buffer and the single-flight lock all apply.
A per-request client would defeat all three, which is why this function exists.

No tagged option, deliberately: the client never receives a fetch, because
Next's fetch cache does not key on Authorization and a cached privileged GET
would reach other visitors. No context option either — context belongs to
StorefrontCredentials and a service client has nowhere to put it.

Validates the credential sets up front. An unset environment variable yields an
empty secret that Emporix rejects as a 401 looking like a permissions problem;
failing locally once per process is cheaper to diagnose."
```

---

## Task 2: The bundler guard

**Files:**
- Create: `packages/next/service-is-server-only.js`
- Modify: `packages/next/package.json` (the `"./service"` block from Task 1, and
  the `files` array)
- Modify: `packages/next/tests/service.test.ts` (append one describe block)

**Interfaces:**
- Consumes: the `"./service"` export block and the built `dist/service.*` from
  Task 1.
- Produces: no new runtime API. The guard is a resolution behaviour plus a
  throwing module.

**Why the file lives at the package root and not in `dist/`:**
`packages/next/tsup.config.ts` has `clean: true`, so a hand-placed file in
`dist/` would be deleted by the next build. It therefore needs its own entry in
the `files` array, or it is missing from the published tarball and the `default`
condition resolves to nothing.

**Why this works** — measured against a real `next build` with Turbopack, the
default in Next 16. The mechanism is `client-only@0.0.1`'s, mirrored:

| Context | Resolves via | Result |
|---|---|---|
| Route Handler (`app/*/route.ts`) | `react-server` | import succeeds |
| Server Action (`"use server"`, imported by a Client Component) | `react-server` | import succeeds |
| Client Component (`"use client"`) | `default` | **build fails**, layers `[app-client]` and `[app-ssr]` |

Note for anyone re-deriving this: Next's **webpack** config applies
`reactServerConditionNames` to the RSC, `middleware` and `instrument` layers
only — not to `apiNode`. Reading that config suggests Route Handlers would break.
They do not. The webpack config is the wrong source for Next 16.

- [ ] **Step 1: Write the failing guard tests**

Append to `packages/next/tests/service.test.ts`:

```ts
describe("the server-only guard", () => {
  it("throws when the guard file is loaded, naming the way out", async () => {
    // The second belt. The first is the resolution failure, which no unit test
    // can exercise — see this task's verification steps.
    //
    // Both patterns deliberately avoid the words "server-only": a missing file
    // produces "Failed to load url ../service-is-server-only.js", which matches
    // that and would make the assertion vacuous. Verified — the naive
    // /server-only/ version passed before the file existed.
    //
    // The @ts-expect-error lines are required: the guard is untyped JS on
    // purpose, so `tsc --noEmit` reports TS7016 without them. Vitest does not
    // typecheck, so this only shows up in `pnpm typecheck`.
    // @ts-expect-error — untyped guard module
    await expect(import("../service-is-server-only.js")).rejects.toThrow(
      /carries a client secret/,
    );
    // @ts-expect-error — untyped guard module
    await expect(import("../service-is-server-only.js")).rejects.toThrow(
      /use client/,
    );
  });

  it("wires the export condition and ships the guard file", async () => {
    // Catches the failure that is otherwise only visible on publish: without
    // the files entry the guard is absent from the tarball and the `default`
    // condition resolves to nothing.
    const pkg = (await import("../package.json")) as unknown as {
      default: {
        exports: Record<string, unknown>;
        files: string[];
      };
    };
    const service = pkg.default.exports["./service"] as Record<string, unknown>;
    expect(service).toBeDefined();
    // `types` sits OUTSIDE the conditions — see Step 4 for why.
    expect(service["types"]).toBe("./dist/service.d.ts");
    expect(service["react-server"]).toMatchObject({
      import: "./dist/service.js",
      require: "./dist/service.cjs",
    });
    expect(service["default"]).toBe("./service-is-server-only.js");
    expect(pkg.default.files).toContain("service-is-server-only.js");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/service.test.ts
```

Expected: 2 failures. The first cannot resolve
`../service-is-server-only.js`; the second reports the `./service` block still
in its plain Task 1 shape (`service["react-server"]` is `undefined`).

- [ ] **Step 3: Write the guard file**

Create `packages/next/service-is-server-only.js`:

```js
// Resolved when @viu/emporix-sdk-next/service is pulled in outside the server
// graph. Hand-written and NOT built: tsup's `clean: true` would delete it from
// dist/. Exports nothing on purpose — the bundler's failure to find the named
// export is the primary guard, and this throw is the backstop for any bundler
// that includes the file anyway.
throw new Error(
  "@viu/emporix-sdk-next/service is server-only: it carries a client secret. " +
    "It was resolved outside the server graph — most likely imported from a " +
    '"use client" module. Move the import into a Route Handler, a Server Action, ' +
    "or a Server Component.",
);
```

- [ ] **Step 4: Switch the export to the conditional form**

In `packages/next/package.json`, replace the `"./service"` block from Task 1
with:

```json
    "./service": {
      "types": "./dist/service.d.ts",
      "react-server": {
        "import": "./dist/service.js",
        "require": "./dist/service.cjs"
      },
      "default": "./service-is-server-only.js"
    },
```

Two things about this shape, both learned the hard way:

**Condition order matters.** `react-server` must come before `default`, because
resolution takes the first match.

**`types` sits OUTSIDE the conditions, and it must.** TypeScript does not
understand `react-server`. Put `types` inside that block and TS falls through to
`default`, finds the guard file, and fails with
`Type error: File '.../service-is-server-only.js' is not a module` — **even in a
legitimate Route Handler**. Hoisting `types` keeps `tsc` and the editor pointed
at the real declarations while the bundler still gets the guard.

The cost of hoisting: a `"use client"` import no longer shows a type error in the
editor. It fails the build instead, which is where the guard actually lives. That
is the right trade — TS never prevented bundling anyway.

- [ ] **Step 5: Add the guard file to `files`**

In the same file, the `files` array currently reads:

```json
  "files": [
    "dist",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
```

Add the guard:

```json
  "files": [
    "dist",
    "service-is-server-only.js",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/service.test.ts
```

Expected: `Tests 16 passed (16)`.

If the guard-file test fails with «does not provide an export named», the file
was written with `export` statements — it must have none.

- [ ] **Step 7: Confirm the guard file is actually packed**

`files` entries are easy to get subtly wrong. Verify against a real tarball
rather than trusting the array.

Note: `pnpm pack --pack-destination <dir>` is **ignored** — the tarball lands in
the current working directory regardless. Do not chase a missing file in the
destination you asked for.

```bash
cd packages/next && pnpm pack && tar -tzf viu-emporix-sdk-next-0.2.0.tgz | grep -i service
```

Expected: `package/service-is-server-only.js` appears alongside
`package/dist/service.js`, `package/dist/service.cjs`,
`package/dist/service.d.ts` and `package/dist/service.d.cts`.

Then remove the tarball — it is untracked and must not reach the commit:

```bash
rm packages/next/viu-emporix-sdk-next-0.2.0.tgz
```

- [ ] **Step 8: Verify the guard against a real build — the client half**

This is the step that turns the security property from asserted into shown. No
unit test can do it.

Create two temporary files, both deleted in Step 10 and never committed:

`examples/next-app-router/app/spike-leak/leak.tsx`

```tsx
// TEMPORARY — guard verification, deleted after checking. Do not commit.
"use client";

import { getEmporixServiceClient } from "@viu/emporix-sdk-next/service";

export function Leak(): React.JSX.Element {
  return <p>{typeof getEmporixServiceClient}</p>;
}
```

`examples/next-app-router/app/spike-leak/page.tsx`

```tsx
// TEMPORARY — guard verification, deleted after checking. Do not commit.
import { Leak } from "./leak";

export default function SpikeLeakPage(): React.JSX.Element {
  return <Leak />;
}
```

Then build:

```bash
rm -rf examples/next-app-router/.next && pnpm -F @viu/emporix-examples-next-app-router build
```

Expected: the build **FAILS**, with the error naming
`service-is-server-only.js` and the layers `[app-client]` and `[app-ssr]`.

A build that succeeds here means the guard is not working — stop and fix it
before continuing. Check the condition order in the `exports` block.

**Re-run this step after any change to the `exports` block.** Hoisting `types`
out of the conditions in Step 4 changes resolution, and the earlier measurement
no longer applies. It was re-verified and the guard still fires in both layers —
but that is a fact about this exact shape, not about the mechanism in general.

- [ ] **Step 9: Verify the guard against a real build — the server half**

Delete the leak files and prove the legitimate path still works:

```bash
rm -rf examples/next-app-router/app/spike-leak
```

Create `examples/next-app-router/app/spike-service/route.ts` — temporary, deleted
in Step 10, never committed. Placeholder credentials only; no real service
account is needed, because this checks resolution rather than a successful
Emporix call:

```ts
// TEMPORARY — guard verification, deleted after checking. Do not commit.
import { getEmporixServiceClient } from "@viu/emporix-sdk-next/service";

export function GET(): Response {
  const client = getEmporixServiceClient({
    tenant: "viu",
    credentials: { spike: { clientId: "placeholder", secret: "placeholder" } },
  });
  return Response.json({ resolved: true, tagged: client.config.fetch !== undefined });
}
```

Build and run:

```bash
rm -rf examples/next-app-router/.next && pnpm -F @viu/emporix-examples-next-app-router build
```

Expected: the build **succeeds** and lists `ƒ /spike-service`.

Then:

```bash
pnpm -F @viu/emporix-examples-next-app-router exec next start -p 3123
```

and in another shell:

```bash
curl -s http://localhost:3123/spike-service
```

Expected: `{"resolved":true,"tagged":false}`. `tagged: false` is the security
property confirmed through the real build path, not just in a unit test.

Stop the server.

- [ ] **Step 10: Delete the temporary files and prove the tree is clean**

`.next/` must go too. It is gitignored, so `git status` will not mention it, but
Next generates `.next/types/validator.ts` with an import per route — after
deleting the route that file still references it and `tsc --noEmit` fails with
`TS2307`. The pre-commit hook catches it, which is a confusing place to find out.

```bash
rm -rf examples/next-app-router/app/spike-service
rm -rf examples/next-app-router/.next
git status --short
```

Expected: only `packages/next/package.json`,
`packages/next/service-is-server-only.js` and
`packages/next/tests/service.test.ts`. No `examples/` entry, no `dist/`, no
`*.tsbuildinfo`, and no `.tgz` — `packages/next/*.tgz` is **not** gitignored, so
a forgotten `pnpm pack` artefact would be staged.

Then:

```bash
pnpm -F @viu/emporix-examples-next-app-router typecheck
```

Expected: no output, exit 0.

- [ ] **Step 11: Full local gate**

```bash
pnpm typecheck && pnpm lint && pnpm -r test
```

Expected: all green, `packages/next` at **95** tests (93 + 2).

- [ ] **Step 12: Commit**

```bash
git add packages/next/package.json packages/next/service-is-server-only.js packages/next/tests/service.test.ts
git commit -m "feat(repo): guard the service entry against client bundling" -m "The ./service exports entry now resolves to a throwing file outside the server
graph, so importing it from a \"use client\" module fails the BUILD rather than
writing the client secret into the browser bundle. Verified both ways against a
real Turbopack build: the client import fails in the app-client and app-ssr
layers, a Route Handler resolves and reports config.fetch as undefined.

The mechanism is client-only@0.0.1's, mirrored in our own exports map — no
server-only dependency, so the package keeps its empty dependency set.

The guard file sits at the package root rather than in dist/, because tsup's
clean:true would delete it, and it needs its own files entry or it is absent
from the tarball and the default condition resolves to nothing. A pnpm pack
check covers that, since it is otherwise only visible on publish."
```

---

## Task 3: README, changeset, PR

**Files:**
- Modify: `packages/next/README.md`
- Create: `.changeset/next-service-account.md`

**Interfaces:**
- Consumes: `getEmporixServiceClient` and `GetEmporixServiceClientOptions` from
  Task 1, the guard from Task 2.
- Produces: nothing consumed further.

- [ ] **Step 1: Add the README section**

`packages/next/README.md` has this heading order: `## Install`,
`## The one rule`, `## Server Component`, `## Server Action`,
`## Webhook revalidation`, `## Cache tags`, `## Environment`,
`## Site and locale detection (proxy.ts)`,
`## Footgun: httpOnly and the browser`, `## next/image`, `## Subpath exports`.

Insert this **immediately after** the `## The one rule` section, because it is
the same rule one notch sharper:

````markdown
## Service accounts (`@viu/emporix-sdk-next/service`)

For server-side writes with a dedicated Emporix service account — create a
product, set a price — with `clientId`, `secret` and only the scopes that
account was granted.

```ts
// lib/emporix-service.ts — module scope, NOT inside a handler body
import { getEmporixServiceClient } from "@viu/emporix-sdk-next/service";

export const service = getEmporixServiceClient({
  credentials: {
    productWriter: {
      clientId: process.env.EMPORIX_PRODUCT_WRITER_ID!,
      secret: process.env.EMPORIX_PRODUCT_WRITER_SECRET!,
      scope: "product.product_create",
    },
  },
});
```

```ts
// app/api/products/route.ts
import { auth } from "@viu/emporix-sdk";
import { service } from "@/lib/emporix-service";

export async function POST(request: Request) {
  const created = await service.products.create(
    await request.json(),
    {},
    auth.service("productWriter"),
  );
  return Response.json(created);
}
```

The key in `credentials` is the name you pass to `auth.service(name)`. Works from
Route Handlers, Server Actions and Server Components.

### Importing this from a Client Component fails the build

That is the point. The entry carries a secret, so its `exports` map resolves to a
throwing file outside the server graph. A `"use client"` module that imports it
produces a build error naming `service-is-server-only.js` — the secret cannot
reach a browser bundle, rather than being documented as something you should
avoid.

### Token caching is the SDK's, and it needs module scope

One cached token per credential set, reused until `expires_in` minus a 60-second
buffer, behind a single-flight lock so concurrent calls share one token request.

All of that lives on the **client instance**. Call `getEmporixServiceClient`
inside a handler body and you build a new client per request, fetch a token per
request, and the cache does nothing. That memoization is why this function exists
instead of `new EmporixClient`.

### There is no `tagged` option

A service client never receives a `fetch`. Next's fetch cache does not key on the
`Authorization` header, so a cached privileged GET would be served to other
visitors. This is not a default you can change — the option does not exist.

There is no `context` option either: `context` belongs to
`StorefrontCredentials` and is bound at anonymous login, and a service client has
no storefront credentials.

### An empty secret fails locally

`getEmporixServiceClient` rejects a credential set with an empty `clientId` or
`secret` and names the set. An unset environment variable yields `""`, which
Emporix answers with a 401 that reads like a permissions problem — this turns it
into one clear error, once per process.
````

- [ ] **Step 2: Update the subpath export paragraph**

`## Subpath exports` currently reads:

```markdown
`.` (client, session, tags), `./webhook` (verification, route factory) and
`./proxy` (`emporixSiteProxy`). The split keeps a Route Handler from pulling in
`next/headers` — and a `proxy.ts` cannot pull it in at all, because `cookies()`
does not exist in a proxy context.
```

Replace with:

```markdown
`.` (client, session, tags), `./webhook` (verification, route factory),
`./proxy` (`emporixSiteProxy`) and `./service` (`getEmporixServiceClient`). The
split keeps a Route Handler from pulling in `next/headers` — and a `proxy.ts`
cannot pull it in at all, because `cookies()` does not exist in a proxy context.
`./service` is split for a different reason: it carries a secret, and its export
condition makes a client-side import a build error.
```

- [ ] **Step 3: Write the changeset**

Create `.changeset/next-service-account.md`:

````markdown
---
"@viu/emporix-sdk-next": minor
---

New entry `@viu/emporix-sdk-next/service` with `getEmporixServiceClient`, for
server-side writes with a dedicated Emporix service account.

```ts
export const service = getEmporixServiceClient({
  credentials: {
    productWriter: { clientId: "…", secret: "…", scope: "product.product_create" },
  },
});
await service.products.create(input, {}, auth.service("productWriter"));
```

Returns a plain `EmporixClient`, memoized per option set, so the SDK's token
handling applies: one cached token per credential set, reused until `expires_in`
minus a 60-second buffer, behind a single-flight lock. All of that lives on the
client instance, so the memoization is the feature — a client built inside a
handler body fetches a token per request.

**Importing this entry from a `"use client"` module fails the build.** The entry
carries a secret, so its `exports` map resolves to a throwing file outside the
server graph. Verified against a real Turbopack build: the client import fails in
the `app-client` and `app-ssr` layers, while Route Handlers, Server Actions and
Server Components resolve normally. No `server-only` dependency was added — the
package still has none.

**No `tagged` option, deliberately.** A service client never receives a `fetch`,
because Next's fetch cache does not key on `Authorization` and a cached
privileged GET would be served to other visitors. No `context` option either:
`context` belongs to `StorefrontCredentials`, and a service client has none.

A credential set with an empty `clientId` or `secret` is rejected up front with
the set name. An unset environment variable yields `""`, which Emporix answers
with a 401 that reads like a permissions problem.
````

- [ ] **Step 4: Verify the changeset is picked up**

```bash
pnpm changeset status
```

Expected: `@viu/emporix-sdk-next` listed for a minor bump. Whether
`@viu/emporix-sdk-react` and `@viu/emporix-sdk` also appear depends on whether
the pending release PR has merged — both are fine. `linked` does not force an
empty bump; a package appears only if a changeset names it.

- [ ] **Step 5: Commit**

```bash
git add packages/next/README.md .changeset/next-service-account.md
git commit -m "docs(repo): document the service account entry" -m "The module-scope requirement, why there is no tagged and no context option,
what happens when a Client Component imports the entry, and the built-in cache
numbers."
```

- [ ] **Step 6: Push and open the PR**

Push over SSH — the `gh` CLI token (`gho_…`) is rejected for git operations with
`Password authentication is not supported for Git operations`:

```bash
git push origin feat/next-service-account
```

```bash
gh pr create --base main --title "feat(repo): add a server-only service account entry to the next package" --body "$(cat <<'BODY'
New entry `@viu/emporix-sdk-next/service` with one function, plus a bundler guard
that makes a client-side import a build error.

## What

`getEmporixServiceClient({ credentials, tenant?, host? })` returns a memoized
`EmporixClient` holding named service accounts. `auth.service(name)` picks one.

The memoization is the feature. The SDK's token cache — one token per credential
set, reused until `expires_in` minus a 60s buffer, behind a single-flight lock —
lives on the client instance. A client built inside a handler body fetches a
token per request and the cache does nothing.

## The secret cannot reach the browser

The entry's `exports` map resolves to a throwing file outside the server graph,
mirroring `client-only@0.0.1`'s mechanism. **No `server-only` dependency** — the
package still has an empty dependency set.

Verified both ways against a real Turbopack build, not reasoned about:

| Context | Result |
|---|---|
| `"use client"` import | **build fails**, layers `app-client` and `app-ssr`, error names `service-is-server-only.js` |
| Route Handler | resolves, and reports `config.fetch` as `undefined` |
| Server Action | resolves |

Worth recording for anyone re-deriving this: Next's **webpack** config applies
`reactServerConditionNames` to the RSC, `middleware` and `instrument` layers
only, not `apiNode`. Reading it suggests Route Handlers would break under the
guard. They do not — Next 16 defaults to Turbopack, and the webpack config is the
wrong source.

## Two options that deliberately do not exist

**`tagged`.** A service client never receives a `fetch`. Next's fetch cache does
not key on `Authorization`, so a cached privileged GET would be served to other
visitors. An option that can be set to `true` is one someone eventually sets to
`true`.

**`context`.** It belongs to `StorefrontCredentials` and is bound at anonymous
login. A service client has no storefront credentials and nowhere to put it.

## Verification

Sixteen unit tests, `packages/next` 79 → 95. Covered beyond the happy path:
single-flight under ten concurrent calls, cache expiry (a cache that never
expires passes the sequential test too), per-set keying, host override reaching
the token URL, and the guard file's own throw via a dynamic import.

Three guards passed first try and were mutation-tested: injecting a `fetch`
fails exactly the untagged test, deleting the credential validation fails exactly
that test, removing the memo lookup fails the identity test.

A `pnpm pack` check confirms `service-is-server-only.js` is in the tarball —
without its `files` entry the `default` condition resolves to nothing, and that
is only visible on publish.

What no unit test covers, stated plainly: the bundler condition itself. Test 16
asserts the shape of the `exports` map and test 15 the file's behaviour, but
whether Turbopack picks `default` in a client module is shown only by the build
steps above.

## Credential handling

No real service-account credentials were used. The guard verification checks
module resolution and the build, not a successful Emporix call, so placeholders
suffice. Nothing was printed, committed or pasted.

Spec: `docs/superpowers/specs/2026-07-31-next-service-account-design.md`
Plan: `docs/superpowers/plans/2026-07-31-next-service-account.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 7: Wait for the checks and report**

```bash
gh pr checks --watch
```

Expected: all 7 green — `quality (node 20)`, `quality (node 22)`,
`quality (node 24)`, `Analyze (actions)`,
`Analyze (javascript-typescript)`, `CodeQL`, `changeset`.

Do **not** merge. Merging is the user's call.

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| `getEmporixServiceClient({ credentials, tenant?, host? })` | Task 1 Step 3 |
| Uses the SDK's `ServiceCredentials`, no twin type | Task 1 Step 3 |
| Returns a plain `EmporixClient`, generic | Task 1 Step 3, changeset |
| Memoized at module scope, key includes secrets | Task 1 Step 3, tests 1–2, mutation C |
| No `fetch`, structurally untagged | Task 1 test 3, mutation A, Task 2 Step 9 (`tagged: false` through the real build) |
| No `tagged` option | absent by construction; README + changeset say why |
| No `context` option | absent by construction; README + changeset say why |
| `tenant`/`host` default from env | Task 1 Step 3, tests 5 and 12 |
| Validation: empty credentials, empty clientId/secret | Task 1 Step 3, tests 13–14, mutation B |
| Token caching, single-flight, expiry, per-set | Task 1 tests 7–10 |
| Unknown set throws | Task 1 test 11 |
| `exports` condition with `react-server` before `default` | Task 2 Steps 4 and 6, test 16 |
| Guard file at the package root, in `files` | Task 2 Steps 3, 5, 7, test 16 |
| Guard file throws with a message naming the way out | Task 2 Step 3, test 15 |
| No `server-only` dependency | Global Constraints; nothing adds one |
| Own tsup entry | Task 1 Step 6, plus the `next/headers` grep in Step 8 |
| Build-level guard verification, both directions | Task 2 Steps 8 and 9 |
| No committed example change | Task 2 Step 10 |
| README section after «The one rule» | Task 3 Steps 1–2 |
| Credentials never printed or committed | Global Constraints; Task 2 Step 9 uses placeholders |
| Sixteen tests | Task 1 (14) + Task 2 (2) |

No gaps.

**2. Placeholder scan**

No `TBD`, no `TODO`, no "add error handling", no "similar to Task N". Every code
step carries the code; every verification step carries the command and the
expected output.

**3. Type consistency**

`getEmporixServiceClient`, `GetEmporixServiceClientOptions` and
`__resetEmporixServiceClients` are spelled identically in Task 1's interface
block, the implementation, the test file, the README, the changeset and the PR
body. `ServiceCredentials` is the SDK's own type
(`packages/sdk/src/index.ts:8`), not a redeclaration. `client.config.fetch` and
`client.config.credentials.custom` match `ResolvedConfig` in
`packages/sdk/src/core/config.ts`. The guard filename
`service-is-server-only.js` is identical in the `exports` map, the `files` array,
the created file, test 15's import, test 16's assertion and the pack check.

Test-count arithmetic, derived rather than estimated: `tags` 22 + `webhook` 25 +
`client` 15 + `session` 7 + `proxy` 10 = **79** today. Task 1 adds 14 → **93**.
Task 2 adds 2 → **95**. If the observed baseline is not 79, stop and find out
what changed instead of adjusting the expectation.
