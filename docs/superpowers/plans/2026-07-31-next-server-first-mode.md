# Server-First Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `@viu/emporix-sdk-next` a mode in which a Next storefront holds **no
Emporix token in the browser** — not even an anonymous one — by moving every
customer-scoped and cart-scoped call to the server and proxying only the public
catalog.

**Architecture:** Four pieces in one guarded server entry plus one client entry.
`withEmporixSession*` binds the request's session and branches guest vs customer.
The proxy is the only place that rotates tokens, because a Server Component
cannot write cookies. Auth server functions manage the httpOnly cookies. A
catalog proxy lets public reads stay client-side with a placeholder token
provider that never makes a network call.

**Tech Stack:** TypeScript, Next 16, `@viu/emporix-sdk`, Vitest, tsup, changesets.

**Spec:** [`../specs/2026-07-31-next-server-first-mode-design.md`](../specs/2026-07-31-next-server-first-mode-design.md)

## Global Constraints

- **Branch:** `feat/next-bff-mode`, created off `origin/main` at `b76f495`. The
  spec commit `b0bff6e` is already on it. Do **not** stack on another feature
  branch — `pr-check.yml` runs `on: pull_request: branches: [main]`.
- **Commitlint** (`.husky/commit-msg`): scope must be one of
  `repo, release, sdk, react, core, customer, product, category, cart, checkout,
  payment, price, media, segment, availability, auth, http, logger, deps, docs,
  examples`. No `next` scope — use `repo`. First word after the scope must be a
  **lowercase verb**.
- **No change to `packages/react`.** It stays the SPA path, unchanged.
- **No change to `packages/sdk`.** Every injection point this needs is already
  public: `client.tokenProvider` ([client.ts:105-110](../../../packages/sdk/src/client.ts#L105)),
  `EmporixConfig.tokenProvider` ([config.ts:46](../../../packages/sdk/src/core/config.ts#L46)),
  `EmporixConfig.fetch`.
- **No new runtime dependency.** `packages/next` has no `dependencies` section
  and keeps it.
- **A customer or guest client must never be tagged.** `withEmporixSession*`
  never passes a `fetch`; `getEmporixClient` is called with `tagged: false`.
  `client.config.fetch` must stay `undefined` on both paths.
- **The guest path needs a client per request.** `getEmporixClient()` is memoized
  per process; attaching a request-scoped anonymous store to it would leak guest
  A's session to guest B. Emporix maps the anonymous token's `session-id` onto
  the cart at creation (confirmed for the `viu` tenant), so guest sessions must
  not be shared.
- **Never print, commit or paste a credential or token value.** Placeholders in
  tests, real values only in the untracked `examples/next-app-router/.env.local`
  (`.gitignore:7`).
- **TS strictness** (`tsconfig.base.json`): `exactOptionalPropertyTypes`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`,
  `moduleResolution: "bundler"`. Optional properties are spread conditionally,
  never assigned `undefined`. Indexed access yields `T | undefined`.
- **Build order.** Run `pnpm -r --filter "./packages/*" build` after switching
  branches, or typecheck reads a stale `dist/`.
- **Code comments and docs in English.** Specs and plans are German.

**Baseline:** `packages/next` has **95** tests today — `tags` 22, `webhook` 25,
`client` 15, `service` 16, `session` 7, `proxy` 10. If the observed number is not
95, stop and find out what changed rather than adjusting expectations.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/next/src/bff-cookies.ts` | **create** — the cookie attribute policy and the typed jar wrapper. One place decides `httpOnly`/`secure`/`maxAge`. |
| `packages/next/src/bff-session.ts` | **create** — `withEmporixSession`, `withEmporixSessionMutable`, the anonymous store, the per-request guest client. |
| `packages/next/src/bff-auth.ts` | **create** — `emporixLogin`, `emporixLogout`, `emporixRefresh`, `assertSameOrigin`. |
| `packages/next/src/bff.ts` | **create** — the entry barrel re-exporting the three above. |
| `packages/next/src/token-proxy.ts` | **create** — `emporixTokenProxy`. |
| `packages/next/src/catalog-proxy.ts` | **create** — `createEmporixCatalogRoute` (server side of the catalog proxy). |
| `packages/next/src/catalog-client.ts` | **create** — `createProxyTokenProvider`, `createProxyFetch`. The **first client entry** in this package. |
| `packages/next/bff-is-server-only.js` | **create** — the guard file for `./bff`, mirroring `service-is-server-only.js`. |
| `packages/next/tsup.config.ts` | **modify** — split into two configs: server entries, and one client entry with the `"use client"` banner. |
| `packages/next/scripts/check-dist.mjs` | **create** — asserts the client entry carries the banner and the server entries do not. |
| `packages/next/package.json` | **modify** — entries, `exports`, `files`, `check:dist` script. |
| `examples/next-server-first/**` | **create** (Task 5) — the acceptance harness: six pages, one of which renders `document.cookie` so the security claim is visible rather than asserted |
| `packages/next/README.md` | **modify** (Task 6) |
| `.changeset/next-server-first-mode.md` | **create** (Task 6) |

Split by responsibility, not layer: the cookie policy is its own file because
four other files depend on it and F-04 in the review was precisely about that
policy living in three places.

---

## Task 1: Cookie policy and session binding

**Files:**
- Create: `packages/next/src/bff-cookies.ts`
- Create: `packages/next/src/bff-session.ts`
- Create: `packages/next/tests/bff-session.test.ts`

**Interfaces:**
- Consumes: `STORAGE_KEYS` from `@viu/emporix-sdk-react/ssr`; `EmporixClient`,
  `auth`, types `AuthContext` and `AnonymousSessionStore` from `@viu/emporix-sdk`;
  `getEmporixClient` and `GetEmporixClientOptions` from `./client`.
- Produces:
  ```ts
  // bff-cookies.ts
  export interface BffCookieJar {
    get(name: string): string | null;
    set(name: string, value: string, maxAgeSeconds: number): void;
    delete(name: string): void;
  }
  export const BFF_MAX_AGE: {
    customerToken: number; refreshToken: number; saasToken: number;
    cartId: number; anonymousSession: number; activeLegalEntityId: number;
  };
  export async function bffCookieJar(opts?: { readOnly?: boolean }): Promise<BffCookieJar>;

  // bff-session.ts
  export interface WithEmporixSessionOptions {
    tenant?: string; clientId?: string; host?: string;
    context?: { currency?: string; siteCode?: string; targetLocation?: string; language?: string };
  }
  export async function withEmporixSession<T>(
    fn: (client: EmporixClient, ctx: AuthContext) => Promise<T>,
    opts?: WithEmporixSessionOptions,
  ): Promise<T>;
  export async function withEmporixSessionMutable<T>(
    fn: (client: EmporixClient, ctx: AuthContext) => Promise<T>,
    opts?: WithEmporixSessionOptions,
  ): Promise<T>;
  ```
  Tasks 2, 3 and 5 use these names.

**Background the implementer needs**, all measured:

- `client.tokenProvider.attachAnonymousStore(store)` bootstraps the session from
  the store with `expiresAt = 0`, so the next `getAnonymousToken()` performs a
  **refresh preserving `sessionId`**, not a fresh login
  ([auth.ts:189-196](../../../packages/sdk/src/core/auth.ts#L189)).
- `AnonymousSessionStore` is `{ read(): {refreshToken, sessionId} | null;
  write(s: {refreshToken, sessionId} | null): void }` and both are **synchronous**
  ([auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42)). Build it over an
  already-awaited cookie jar.
- The persisted shape is `{ refreshToken, sessionId }`
  ([storage/index.ts:54-55](../../../packages/react/src/storage/index.ts#L54)).
- A Server Component render cannot write cookies. The read-only jar's `set`/
  `delete` must no-op, not throw — mirroring `createCookieBackedStorage`'s
  read-only warning path.

- [ ] **Step 1: Write the failing test file**

Create `packages/next/tests/bff-session.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

/** Next's cookies() shape, enough of it to drive the code under test. */
const bag = new Map<string, { name: string; value: string; opts?: Record<string, unknown> }>();
const jar = {
  get: (name: string) => bag.get(name),
  set: (name: string, value: string, opts?: Record<string, unknown>) => {
    bag.set(name, { name, value, ...(opts ? { opts } : {}) });
  },
  delete: (name: string) => {
    bag.delete(name);
  },
};
const headerBag = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(jar),
  headers: () => Promise.resolve({ get: (k: string) => headerBag.get(k) ?? null }),
}));

const { withEmporixSession, withEmporixSessionMutable } = await import("../src/bff-session");
const { __resetEmporixClients } = await import("../src/client");

function stubFetch(): { tokenCalls: () => number } {
  let tokenCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/customerlogin/auth/anonymous/")) {
        tokenCalls += 1;
        return new Response(
          JSON.stringify({
            access_token: "anon-access",
            refresh_token: "anon-refresh",
            session_id: "sess-1",
            expires_in: 3600,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { tokenCalls: () => tokenCalls };
}

beforeEach(() => {
  bag.clear();
  headerBag.clear();
  __resetEmporixClients();
  process.env.EMPORIX_TENANT = "viu";
  process.env.EMPORIX_STOREFRONT_CLIENT_ID = "storefront-id";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EMPORIX_TENANT;
  delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
});

describe("withEmporixSession — customer path", () => {
  it("uses a customer auth context when the token cookie is present", async () => {
    stubFetch();
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    const seen = await withEmporixSession(async (_c, ctx) => ctx);
    expect(seen).toEqual({ kind: "customer", token: "cust-tok" });
  });

  it("reuses the memoized client for the customer path", async () => {
    stubFetch();
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    const a = await withEmporixSession(async (c) => c);
    const b = await withEmporixSession(async (c) => c);
    expect(a).toBe(b);
  });

  it("never tags the customer client", async () => {
    stubFetch();
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    const client = await withEmporixSession(async (c) => c);
    expect(client.config.fetch).toBeUndefined();
  });
});

describe("withEmporixSession — guest path", () => {
  it("uses an anonymous auth context when no customer token is present", async () => {
    stubFetch();
    const seen = await withEmporixSession(async (_c, ctx) => ctx);
    expect(seen).toEqual({ kind: "anonymous" });
  });

  it("builds a DIFFERENT client per call, so guest sessions cannot be shared", async () => {
    // The core of the session-binding constraint: Emporix maps the anonymous
    // session-id onto the cart, so two guests must never share a client.
    stubFetch();
    const a = await withEmporixSession(async (c) => c);
    const b = await withEmporixSession(async (c) => c);
    expect(a).not.toBe(b);
  });

  it("never tags the guest client", async () => {
    stubFetch();
    const client = await withEmporixSession(async (c) => c);
    expect(client.config.fetch).toBeUndefined();
  });

  it("seeds the anonymous session from the cookie", async () => {
    const f = stubFetch();
    bag.set("emporix.anonymousSession", {
      name: "emporix.anonymousSession",
      value: JSON.stringify({ refreshToken: "r1", sessionId: "sess-9" }),
    });
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    // A seeded store refreshes rather than logging in fresh — the refresh
    // endpoint is under /anonymous/refresh, the login under /anonymous/login.
    expect(f.tokenCalls()).toBeGreaterThan(0);
  });
});

describe("withEmporixSession — cookie writes", () => {
  it("persists a rotated anonymous session in the mutable variant", async () => {
    stubFetch();
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    const written = bag.get("emporix.anonymousSession");
    expect(written).toBeDefined();
    expect(JSON.parse(written?.value ?? "{}")).toMatchObject({ sessionId: "sess-1" });
  });

  it("writes the anonymous cookie httpOnly with a bounded maxAge", async () => {
    stubFetch();
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    const opts = bag.get("emporix.anonymousSession")?.opts ?? {};
    expect(opts).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(typeof opts.maxAge).toBe("number");
  });

  it("does NOT write cookies in the read-only variant", async () => {
    // A Server Component render must not write. Silently ignoring beats
    // throwing inside a render.
    stubFetch();
    await withEmporixSession(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(bag.get("emporix.anonymousSession")).toBeUndefined();
  });

  it("marks cookies Secure behind an https forwarded proto", async () => {
    stubFetch();
    headerBag.set("x-forwarded-proto", "https");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(bag.get("emporix.anonymousSession")?.opts).toMatchObject({ secure: true });
  });

  it("does not mark cookies Secure over plain http outside production", async () => {
    // Hard-coding secure:true drops the cookie on an http staging host — F-05.
    stubFetch();
    headerBag.set("x-forwarded-proto", "http");
    await withEmporixSessionMutable(async (client, ctx) => {
      await client.products.get("p1", undefined, ctx);
    });
    expect(bag.get("emporix.anonymousSession")?.opts).toMatchObject({ secure: false });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/bff-session.test.ts
```

Expected: the file fails to collect with `Failed to load url ../src/bff-session`.
All 13 fail. If you see `withEmporixSession is not a function`, the file exists
but the export name is wrong.

- [ ] **Step 3: Write the cookie policy**

Create `packages/next/src/bff-cookies.ts`:

```ts
import { cookies, headers } from "next/headers";

/**
 * Cookie lifetimes for the server-first mode. Values are the package's
 * defaults, not Emporix's — the review's F-02 recorded that there was no
 * application-side session lifetime at all, and this is where one is set.
 */
export const BFF_MAX_AGE = {
  customerToken: 8 * 60 * 60,
  refreshToken: 30 * 24 * 60 * 60,
  saasToken: 8 * 60 * 60,
  cartId: 30 * 24 * 60 * 60,
  anonymousSession: 30 * 24 * 60 * 60,
  activeLegalEntityId: 30 * 24 * 60 * 60,
} as const;

/** A narrow cookie surface so the attribute policy lives in exactly one place. */
export interface BffCookieJar {
  get(name: string): string | null;
  /** No-op when the jar is read-only (a Server Component render). */
  set(name: string, value: string, maxAgeSeconds: number): void;
  /** No-op when the jar is read-only. */
  delete(name: string): void;
}

/**
 * `Secure` is derived, not hard-coded. Hard `true` silently drops the cookie on
 * a plain-http staging host, which is fail-closed and miserable to diagnose —
 * the review's F-05. Behind a TLS-terminating proxy the forwarded header is the
 * only signal available inside a Server Action; without it, production is
 * assumed secure.
 */
async function isSecure(): Promise<boolean> {
  const proto = (await headers()).get("x-forwarded-proto");
  if (proto !== null && proto.length > 0) {
    return proto.split(",")[0]?.trim() === "https";
  }
  return process.env.NODE_ENV === "production";
}

/**
 * The request's cookie jar with this package's attribute policy applied.
 *
 * All secrets written through here are `httpOnly` — the whole point of the
 * server-first mode is that the browser never reads a token.
 */
export async function bffCookieJar(
  opts: { readOnly?: boolean } = {},
): Promise<BffCookieJar> {
  const jar = await cookies();
  const readOnly = opts.readOnly ?? false;
  const secure = await isSecure();
  return {
    get: (name) => jar.get(name)?.value ?? null,
    set: (name, value, maxAgeSeconds) => {
      if (readOnly) return;
      jar.set(name, value, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: maxAgeSeconds,
      });
    },
    delete: (name) => {
      if (readOnly) return;
      jar.delete(name);
    },
  };
}
```

- [ ] **Step 4: Write the session binding**

Create `packages/next/src/bff-session.ts`:

```ts
import {
  EmporixClient,
  auth,
  type AnonymousSessionStore,
  type AuthContext,
} from "@viu/emporix-sdk";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { getEmporixClient } from "./client";
import { BFF_MAX_AGE, bffCookieJar, type BffCookieJar } from "./bff-cookies";

export interface WithEmporixSessionOptions {
  /** Default: `process.env.EMPORIX_TENANT`. */
  tenant?: string;
  /** Default: `process.env.EMPORIX_STOREFRONT_CLIENT_ID`. */
  clientId?: string;
  /** Default: `process.env.EMPORIX_HOST`, else the SDK default. */
  host?: string;
  /** Bound at anonymous login. Must match what the rest of the app binds. */
  context?: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  };
}

/** Persists the anonymous session in an httpOnly cookie, per guest. */
function anonymousStore(jar: BffCookieJar): AnonymousSessionStore {
  return {
    read: () => {
      const raw = jar.get(STORAGE_KEYS.anonymousSession);
      if (raw === null) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<{ refreshToken: string; sessionId: string }>;
        return typeof parsed.refreshToken === "string" && typeof parsed.sessionId === "string"
          ? { refreshToken: parsed.refreshToken, sessionId: parsed.sessionId }
          : null;
      } catch {
        return null;
      }
    },
    write: (session) => {
      if (session === null) {
        jar.delete(STORAGE_KEYS.anonymousSession);
        return;
      }
      jar.set(
        STORAGE_KEYS.anonymousSession,
        JSON.stringify({ refreshToken: session.refreshToken, sessionId: session.sessionId }),
        BFF_MAX_AGE.anonymousSession,
      );
    },
  };
}

/**
 * A client per request, for the guest path only.
 *
 * `getEmporixClient()` is memoized per process, so attaching a request-scoped
 * anonymous store to it would leak one guest's session to the next. Emporix maps
 * the anonymous token's `session-id` onto the cart when the cart is created, so
 * a shared guest session means a shared cart.
 */
function newGuestClient(opts: WithEmporixSessionOptions): EmporixClient {
  const tenant = opts.tenant ?? process.env.EMPORIX_TENANT;
  if (!tenant) {
    throw new Error("withEmporixSession: no tenant. Set EMPORIX_TENANT or pass { tenant }.");
  }
  const clientId = opts.clientId ?? process.env.EMPORIX_STOREFRONT_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "withEmporixSession: no storefront client id. Set EMPORIX_STOREFRONT_CLIENT_ID or pass { clientId }.",
    );
  }
  const host = opts.host ?? process.env.EMPORIX_HOST;
  return new EmporixClient({
    tenant,
    credentials: {
      storefront: { clientId, ...(opts.context !== undefined ? { context: opts.context } : {}) },
    },
    logger: false,
    ...(host !== undefined ? { host } : {}),
    // No `fetch`: a session-bearing client must never be tagged. Next's fetch
    // cache does not key on Authorization.
  });
}

async function run<T>(
  fn: (client: EmporixClient, ctx: AuthContext) => Promise<T>,
  opts: WithEmporixSessionOptions,
  readOnly: boolean,
): Promise<T> {
  const jar = await bffCookieJar({ readOnly });
  const customerToken = jar.get(STORAGE_KEYS.customerToken);
  if (customerToken !== null) {
    // Customer path: the memoized client is correct, the token is per call.
    const client = getEmporixClient({ ...opts, tagged: false });
    return fn(client, auth.customer(customerToken));
  }
  const client = newGuestClient(opts);
  client.tokenProvider.attachAnonymousStore?.(anonymousStore(jar));
  return fn(client, auth.anonymous());
}

/**
 * Runs `fn` with the request's Emporix session bound — **read-only**.
 *
 * Use this in Server Components. Cookie writes no-op, because Next forbids
 * writing a cookie during a render. Token rotation therefore belongs in the
 * proxy, which is the only place that can read cookies and write them before
 * the render happens.
 *
 * Branches on the session so the caller does not have to:
 * a customer token in the cookie means the memoized untagged client plus
 * `auth.customer`, no token means a per-request client with a per-guest
 * anonymous session plus `auth.anonymous`.
 *
 * @example
 * ```ts
 * const cart = await withEmporixSession((client, ctx) => client.carts.get(id, ctx));
 * ```
 */
export async function withEmporixSession<T>(
  fn: (client: EmporixClient, ctx: AuthContext) => Promise<T>,
  opts: WithEmporixSessionOptions = {},
): Promise<T> {
  return run(fn, opts, true);
}

/**
 * Runs `fn` with the request's Emporix session bound — **read-write**.
 *
 * Valid in Server Actions and Route Handlers only. Persists a rotated anonymous
 * session, so a guest keeps the same Emporix `sessionId` and therefore the same
 * cart.
 *
 * @example
 * ```ts
 * "use server";
 * export async function addToCart(cartId: string, item: CartItemInput) {
 *   return withEmporixSessionMutable((client, ctx) =>
 *     client.carts.addItem(cartId, item, ctx),
 *   );
 * }
 * ```
 */
export async function withEmporixSessionMutable<T>(
  fn: (client: EmporixClient, ctx: AuthContext) => Promise<T>,
  opts: WithEmporixSessionOptions = {},
): Promise<T> {
  return run(fn, opts, false);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/bff-session.test.ts
```

Expected: `Tests 13 passed (13)`.

If the seeded-session test fails because no token call happened, check that
`attachAnonymousStore` is called **before** `fn` runs — the bootstrap happens
inside `attachAnonymousStore`, not lazily.

- [ ] **Step 6: Mutation-test the three load-bearing guards**

Each passed first try, so none is known to work. Mutate, confirm **exactly** the
expected test fails, revert.

Mutation A — the session-binding constraint. In `run`, replace
`newGuestClient(opts)` with `getEmporixClient({ ...opts, tagged: false })`.
Expected: exactly 1 failure, `builds a DIFFERENT client per call, so guest
sessions cannot be shared`. Revert.

Mutation B — the security property. In `newGuestClient`, add
`fetch: globalThis.fetch,` to the `new EmporixClient({...})` literal.
Expected: exactly 1 failure, `never tags the guest client`. Revert.

Mutation C — the read-only contract. In `bffCookieJar`, delete the
`if (readOnly) return;` line from `set`.
Expected: exactly 1 failure, `does NOT write cookies in the read-only variant`.
Restore.

If a mutation produces zero failures, stop and work out why.

- [ ] **Step 7: Commit**

```bash
git add packages/next/src/bff-cookies.ts packages/next/src/bff-session.ts packages/next/tests/bff-session.test.ts
git commit -m "feat(repo): add server-side session binding for the server-first mode" -m "withEmporixSession and withEmporixSessionMutable bind the request's Emporix
session and branch on it, so a consumer's Server Action is two lines instead of
repeating the branch 19 times.

The branch is the point. Emporix maps the anonymous token's session-id onto the
cart at creation, so guests must not share an anonymous session — and
getEmporixClient() is memoized per process. The guest path therefore builds a
client per request with an httpOnly anonymous-session cookie behind
attachAnonymousStore, which refreshes while preserving sessionId rather than
logging in fresh.

Neither path ever passes a fetch, so neither can be tagged: Next's fetch cache
does not key on Authorization. The cookie attribute policy lives in one file
because the review's F-04 found it living in three, and Secure is derived from
the forwarded protocol rather than hard-coded (F-05)."
```

---

## Task 2: Auth server functions

**Files:**
- Create: `packages/next/src/bff-auth.ts`
- Create: `packages/next/tests/bff-auth.test.ts`

**Interfaces:**
- Consumes: `bffCookieJar`, `BFF_MAX_AGE` from `./bff-cookies` (Task 1);
  `withEmporixSessionMutable` and `WithEmporixSessionOptions` from
  `./bff-session` (Task 1); `STORAGE_KEYS` from `@viu/emporix-sdk-react/ssr`.
- Produces:
  ```ts
  export async function emporixLogin(
    creds: { email: string; password: string },
    opts?: WithEmporixSessionOptions,
  ): Promise<void>;
  export async function emporixLogout(opts?: WithEmporixSessionOptions): Promise<void>;
  export async function emporixRefresh(opts?: WithEmporixSessionOptions): Promise<string | null>;
  export function assertSameOrigin(request: Request): void;
  ```

**Background the implementer needs:**

- `customers.login(creds, { anonymousToken }, auth)` threads the anonymous token
  so the guest's session — and therefore the cart — survives the login
  ([customer.ts:126-141](../../../packages/sdk/src/services/customer.ts#L126)).
  The anonymous **access** token is obtained from the guest client's token
  provider, which is why this task depends on Task 1.
- `customers.refresh({ refreshToken, saasToken?, legalEntityId? })` is a **GET
  with the refresh token in the query string**
  ([customer.ts:152-170](../../../packages/sdk/src/services/customer.ts#L152)),
  authorized with an anonymous token, and does **not** return a `saas_token` —
  pass the stored one to carry it forward.
- `customers.logout(auth)` requires a customer context and sends the access token
  both as bearer and query param
  ([customer.ts:178-187](../../../packages/sdk/src/services/customer.ts#L178)).
- `CustomerSession` fields are `customerToken`, `refreshToken`, `saasToken`
  ([customer.ts:23-30](../../../packages/sdk/src/services/customer.ts#L23)).

- [ ] **Step 1: Write the failing test file**

Create `packages/next/tests/bff-auth.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

const bag = new Map<string, { name: string; value: string; opts?: Record<string, unknown> }>();
const jar = {
  get: (name: string) => bag.get(name),
  set: (name: string, value: string, opts?: Record<string, unknown>) => {
    bag.set(name, { name, value, ...(opts ? { opts } : {}) });
  },
  delete: (name: string) => {
    bag.delete(name);
  },
};
const headerBag = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve(jar),
  headers: () => Promise.resolve({ get: (k: string) => headerBag.get(k) ?? null }),
}));

const { emporixLogin, emporixLogout, emporixRefresh, assertSameOrigin } = await import(
  "../src/bff-auth"
);
const { __resetEmporixClients } = await import("../src/client");

function stubFetch(): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      const body = url.includes("/customerlogin/auth/anonymous/")
        ? {
            access_token: "anon-access",
            refresh_token: "anon-refresh",
            session_id: "sess-1",
            expires_in: 3600,
          }
        : url.includes("/login") || url.includes("/refreshauthtoken")
          ? { accessToken: "cust-tok", refreshToken: "cust-refresh", saas_token: "saas-tok" }
          : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { urls };
}

beforeEach(() => {
  bag.clear();
  headerBag.clear();
  __resetEmporixClients();
  process.env.EMPORIX_TENANT = "viu";
  process.env.EMPORIX_STOREFRONT_CLIENT_ID = "storefront-id";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EMPORIX_TENANT;
  delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
});

describe("emporixLogin", () => {
  it("writes all three token cookies httpOnly", async () => {
    stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" });
    for (const name of ["emporix.customerToken", "emporix.refreshToken", "emporix.saasToken"]) {
      expect(bag.get(name)?.opts).toMatchObject({ httpOnly: true });
    }
  });

  it("stores the customer token returned by Emporix", async () => {
    stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" });
    expect(bag.get("emporix.customerToken")?.value).toBe("cust-tok");
  });

  it("returns nothing — a token must never reach the caller's response body", async () => {
    // The security-relevant assertion: emporixLogin's contract is void, so a
    // consumer's Server Action cannot accidentally serialize a token to the
    // client.
    stubFetch();
    const result = await emporixLogin({ email: "a@b.test", password: "pw" });
    expect(result).toBeUndefined();
  });

  it("obtains an anonymous token first, so the guest cart survives the login", async () => {
    const f = stubFetch();
    await emporixLogin({ email: "a@b.test", password: "pw" });
    const anonIndex = f.urls.findIndex((u) => u.includes("/customerlogin/auth/anonymous/"));
    const loginIndex = f.urls.findIndex((u) => u.includes("/login"));
    expect(anonIndex).toBeGreaterThanOrEqual(0);
    expect(anonIndex).toBeLessThan(loginIndex);
  });

  it("drops the anonymous session cookie once a customer token exists", async () => {
    stubFetch();
    bag.set("emporix.anonymousSession", {
      name: "emporix.anonymousSession",
      value: JSON.stringify({ refreshToken: "r", sessionId: "s" }),
    });
    await emporixLogin({ email: "a@b.test", password: "pw" });
    expect(bag.get("emporix.anonymousSession")).toBeUndefined();
  });
});

describe("emporixRefresh", () => {
  it("rotates the stored tokens and returns the new access token", async () => {
    stubFetch();
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    const token = await emporixRefresh();
    expect(token).toBe("cust-tok");
    expect(bag.get("emporix.refreshToken")?.value).toBe("cust-refresh");
  });

  it("returns null and writes nothing when there is no refresh cookie", async () => {
    stubFetch();
    expect(await emporixRefresh()).toBeNull();
    expect(bag.get("emporix.customerToken")).toBeUndefined();
  });

  it("carries the stored saasToken forward — refresh does not re-mint it", async () => {
    const f = stubFetch();
    bag.set("emporix.refreshToken", { name: "emporix.refreshToken", value: "old-refresh" });
    bag.set("emporix.saasToken", { name: "emporix.saasToken", value: "saas-original" });
    await emporixRefresh();
    expect(f.urls.some((u) => u.includes("/refreshauthtoken"))).toBe(true);
    expect(bag.get("emporix.saasToken")?.value).toBeTruthy();
  });
});

describe("emporixLogout", () => {
  it("clears every secret cookie", async () => {
    stubFetch();
    for (const n of [
      "emporix.customerToken",
      "emporix.refreshToken",
      "emporix.saasToken",
      "emporix.cartId",
      "emporix.activeLegalEntityId",
    ]) {
      bag.set(n, { name: n, value: "x" });
    }
    await emporixLogout();
    for (const n of [
      "emporix.customerToken",
      "emporix.refreshToken",
      "emporix.saasToken",
      "emporix.cartId",
      "emporix.activeLegalEntityId",
    ]) {
      expect(bag.get(n)).toBeUndefined();
    }
  });

  it("invalidates server-side before clearing locally", async () => {
    const f = stubFetch();
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    await emporixLogout();
    expect(f.urls.some((u) => u.includes("/logout"))).toBe(true);
  });

  it("clears locally even when the server call fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    bag.set("emporix.customerToken", { name: "emporix.customerToken", value: "cust-tok" });
    await emporixLogout();
    expect(bag.get("emporix.customerToken")).toBeUndefined();
  });
});

describe("assertSameOrigin", () => {
  it("accepts a same-origin request", () => {
    const r = new Request("https://shop.test/api/x", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    });
    expect(() => assertSameOrigin(r)).not.toThrow();
  });

  it("rejects a cross-site request", () => {
    const r = new Request("https://shop.test/api/x", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(() => assertSameOrigin(r)).toThrow(/cross-site/i);
  });

  it("rejects a request with neither Sec-Fetch-Site nor Origin", () => {
    // Otherwise an attacker simply omits the header.
    const r = new Request("https://shop.test/api/x", { method: "POST" });
    expect(() => assertSameOrigin(r)).toThrow();
  });

  it("falls back to Origin when Sec-Fetch-Site is absent", () => {
    const ok = new Request("https://shop.test/api/x", {
      method: "POST",
      headers: { origin: "https://shop.test" },
    });
    const bad = new Request("https://shop.test/api/x", {
      method: "POST",
      headers: { origin: "https://evil.test" },
    });
    expect(() => assertSameOrigin(ok)).not.toThrow();
    expect(() => assertSameOrigin(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/bff-auth.test.ts
```

Expected: collection fails with `Failed to load url ../src/bff-auth`; all 16 fail.

- [ ] **Step 3: Write the implementation**

Create `packages/next/src/bff-auth.ts`:

```ts
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { auth } from "@viu/emporix-sdk";
import { BFF_MAX_AGE, bffCookieJar } from "./bff-cookies";
import { withEmporixSessionMutable, type WithEmporixSessionOptions } from "./bff-session";

/**
 * Rejects a request that did not originate from this site.
 *
 * `sameSite: "lax"` already stops a cross-site POST at the browser; this is the
 * second, independent layer, and it lives in the package so a consumer cannot
 * forget it. A request carrying neither `Sec-Fetch-Site` nor `Origin` is
 * rejected too — otherwise omitting the header would be the bypass. That also
 * rejects non-browser clients, which is correct for these routes.
 */
export function assertSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null) {
    if (site === "cross-site") {
      throw new Error("assertSameOrigin: rejected a cross-site request");
    }
    return;
  }
  const origin = request.headers.get("origin");
  if (origin === null) {
    throw new Error(
      "assertSameOrigin: request carries neither Sec-Fetch-Site nor Origin; refusing to guess",
    );
  }
  if (new URL(origin).origin !== new URL(request.url).origin) {
    throw new Error("assertSameOrigin: rejected a cross-origin request");
  }
}

/**
 * Logs a customer in and stores the session in httpOnly cookies.
 *
 * Returns `void` on purpose: nothing a caller could serialize into a response
 * body. The browser learns it is logged in from the next render, not from a
 * token.
 *
 * Threads the guest's anonymous token so the cart survives the login — Emporix
 * creates a new session otherwise, and the cart is bound to the session.
 */
export async function emporixLogin(
  creds: { email: string; password: string },
  opts: WithEmporixSessionOptions = {},
): Promise<void> {
  const session = await withEmporixSessionMutable(async (client) => {
    const anon = await client.tokenProvider.getAnonymousToken();
    return client.customers.login(creds, { anonymousToken: anon.accessToken });
  }, opts);

  const jar = await bffCookieJar();
  jar.set(STORAGE_KEYS.customerToken, session.customerToken, BFF_MAX_AGE.customerToken);
  if (session.refreshToken) {
    jar.set(STORAGE_KEYS.refreshToken, session.refreshToken, BFF_MAX_AGE.refreshToken);
  }
  if (session.saasToken) {
    jar.set(STORAGE_KEYS.saasToken, session.saasToken, BFF_MAX_AGE.saasToken);
  }
  // The guest session is dead weight once a customer token exists — the auth
  // layer always prefers the customer token.
  jar.delete(STORAGE_KEYS.anonymousSession);
}

/**
 * Rotates the customer session from the httpOnly refresh cookie.
 *
 * Returns the fresh access token so the proxy can decide whether to continue,
 * or `null` when there is nothing to refresh. The refresh endpoint does not
 * re-mint the `saasToken`, so the stored one is carried forward.
 */
export async function emporixRefresh(
  opts: WithEmporixSessionOptions = {},
): Promise<string | null> {
  const jar = await bffCookieJar();
  const refreshToken = jar.get(STORAGE_KEYS.refreshToken);
  if (refreshToken === null) return null;
  const saasToken = jar.get(STORAGE_KEYS.saasToken);
  const legalEntityId = jar.get(STORAGE_KEYS.activeLegalEntityId);

  const session = await withEmporixSessionMutable(
    (client) =>
      client.customers.refresh({
        refreshToken,
        ...(saasToken !== null ? { saasToken } : {}),
        ...(legalEntityId !== null ? { legalEntityId } : {}),
      }),
    opts,
  );

  jar.set(STORAGE_KEYS.customerToken, session.customerToken, BFF_MAX_AGE.customerToken);
  if (session.refreshToken) {
    jar.set(STORAGE_KEYS.refreshToken, session.refreshToken, BFF_MAX_AGE.refreshToken);
  }
  if (session.saasToken) {
    jar.set(STORAGE_KEYS.saasToken, session.saasToken, BFF_MAX_AGE.saasToken);
  }
  return session.customerToken;
}

/**
 * Invalidates the session server-side, then clears every secret cookie.
 *
 * The local clear happens regardless of the server call's outcome — the token
 * may already be expired, and leaving a dead cookie behind is worse than a
 * failed invalidation.
 */
export async function emporixLogout(opts: WithEmporixSessionOptions = {}): Promise<void> {
  const jar = await bffCookieJar();
  const token = jar.get(STORAGE_KEYS.customerToken);
  if (token !== null) {
    try {
      await withEmporixSessionMutable(
        (client) => client.customers.logout(auth.customer(token)),
        opts,
      );
    } catch {
      // Ignore — proceed to clear locally.
    }
  }
  for (const name of [
    STORAGE_KEYS.customerToken,
    STORAGE_KEYS.refreshToken,
    STORAGE_KEYS.saasToken,
    STORAGE_KEYS.cartId,
    STORAGE_KEYS.activeLegalEntityId,
    STORAGE_KEYS.anonymousSession,
  ]) {
    jar.delete(name);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/bff-auth.test.ts
```

Expected: `Tests 16 passed (16)`.

If the login-ordering test fails, check that the anonymous token is fetched
**inside** the `withEmporixSessionMutable` callback, before `customers.login`.

- [ ] **Step 5: Mutation-test the two guards that matter**

Mutation A — the CSRF bypass. In `assertSameOrigin`, replace the
`if (origin === null) throw` block with `if (origin === null) return;`.
Expected: exactly 1 failure, `rejects a request with neither Sec-Fetch-Site nor
Origin`. Revert.

Mutation B — the cart-survival thread. In `emporixLogin`, change
`client.customers.login(creds, { anonymousToken: anon.accessToken })` to
`client.customers.login(creds)`.
Expected: at least the `obtains an anonymous token first` test fails. Revert.

- [ ] **Step 6: Commit**

```bash
git add packages/next/src/bff-auth.ts packages/next/tests/bff-auth.test.ts
git commit -m "feat(repo): add server-side login, logout and refresh" -m "All three manage the session in httpOnly cookies and return no token to the
caller — emporixLogin is typed void so a Server Action cannot serialize one into
a response body.

Login threads the guest's anonymous token, because Emporix binds the cart to the
anonymous session and would otherwise create a new one. Refresh carries the
stored saasToken forward, since the refresh endpoint does not re-mint it. Logout
clears locally even when the server call fails: a dead cookie is worse than a
failed invalidation.

assertSameOrigin rejects a request carrying neither Sec-Fetch-Site nor Origin.
Accepting those would make omitting the header the bypass."
```

---

## Task 3: Token rotation in the proxy

**Files:**
- Create: `packages/next/src/token-proxy.ts`
- Create: `packages/next/tests/token-proxy.test.ts`

**Interfaces:**
- Consumes: `emporixRefresh` from `./bff-auth` (Task 2); `bffCookieJar` from
  `./bff-cookies` (Task 1); `emporixSiteProxy` and `EmporixSite` from `./proxy`.
- Produces:
  ```ts
  export interface EmporixTokenProxyOptions {
    site?: EmporixSite;
    rewriteTo?: string | URL;
    /** Refresh when the access token expires within this many seconds. Default 120. */
    skewSeconds?: number;
  }
  export async function emporixTokenProxy(
    request: NextRequest,
    opts?: EmporixTokenProxyOptions,
  ): Promise<NextResponse>;
  ```

**Why the proxy and nowhere else:** a Server Component render cannot write a
cookie, so it cannot rotate a token; a rotation whose new token is not persisted
is worthless. The proxy can read and write cookies and runs before every render
(measured in the site-detection cycle). Making it the single rotation point also
makes it irrelevant whether Emporix invalidates the old anonymous refresh token
on use, because the rotated one is always written.

**JWT decoding:** only the `exp` claim is needed and the signature is **not**
verified — Emporix verifies it. Decode the middle segment with
`Buffer.from(seg, "base64url")`. A malformed token is treated as expired, which
fails safe: the worst case is one unnecessary refresh.

- [ ] **Step 1: Write the failing test file**

Create `packages/next/tests/token-proxy.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const SITE = "emporix.siteCode";
const TOKEN = "emporix.customerToken";

/** A JWT with only the exp claim — the signature is never verified. */
function jwt(expSecondsFromNow: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

const refreshCalls: number[] = [];
vi.mock("../src/bff-auth", () => ({
  emporixRefresh: vi.fn(async () => {
    refreshCalls.push(1);
    return "fresh-token";
  }),
  emporixLogin: vi.fn(),
  emporixLogout: vi.fn(),
  assertSameOrigin: vi.fn(),
}));

const { emporixTokenProxy } = await import("../src/token-proxy");

beforeEach(() => {
  refreshCalls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("emporixTokenProxy", () => {
  it("refreshes when the access token is inside the skew window", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${jwt(30)}` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(1);
  });

  it("leaves a comfortably fresh token alone", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${jwt(3600)}` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(0);
  });

  it("does not refresh when there is no token cookie", async () => {
    const request = new NextRequest("https://shop.test/");
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(0);
  });

  it("treats a malformed token as expired and refreshes", async () => {
    // Fail safe: the cost of being wrong is one unnecessary refresh.
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=not-a-jwt` },
    });
    await emporixTokenProxy(request);
    expect(refreshCalls).toHaveLength(1);
  });

  it("honours a custom skew window", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${jwt(300)}` },
    });
    await emporixTokenProxy(request, { skewSeconds: 600 });
    expect(refreshCalls).toHaveLength(1);
  });

  it("injects the refreshed token into the forwarded request cookies", async () => {
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `${TOKEN}=${jwt(30)}` },
    });
    await emporixTokenProxy(request);
    expect(request.headers.get("cookie")).toContain(`${TOKEN}=fresh-token`);
  });

  it("delegates site and language to emporixSiteProxy", async () => {
    const request = new NextRequest("https://shop.test/");
    const response = await emporixTokenProxy(request, { site: { siteCode: "main" } });
    expect(response.cookies.get(SITE)?.value).toBe("main");
  });

  it("writes no cookies at all when there is nothing to do", async () => {
    const request = new NextRequest("https://shop.test/");
    const response = await emporixTokenProxy(request);
    expect(response.cookies.getAll()).toHaveLength(0);
  });

  it("passes rewriteTo through to emporixSiteProxy", async () => {
    const request = new NextRequest("https://shop.test/de/shoes");
    const response = await emporixTokenProxy(request, {
      site: { language: "de" },
      rewriteTo: "/shoes",
    });
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://shop.test/shoes");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/token-proxy.test.ts
```

Expected: collection fails with `Failed to load url ../src/token-proxy`; all 9 fail.

- [ ] **Step 3: Write the implementation**

Create `packages/next/src/token-proxy.ts`:

```ts
import type { NextRequest, NextResponse } from "next/server";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { emporixRefresh } from "./bff-auth";
import { emporixSiteProxy, type EmporixSite } from "./proxy";

export interface EmporixTokenProxyOptions {
  /** Forwarded to `emporixSiteProxy`. */
  site?: EmporixSite;
  /** Forwarded to `emporixSiteProxy`. */
  rewriteTo?: string | URL;
  /** Refresh when the access token expires within this many seconds. Default 120. */
  skewSeconds?: number;
}

/**
 * Reads the `exp` claim without verifying the signature — Emporix verifies it,
 * and a proxy that re-verified would need the signing key for no benefit.
 * Returns `null` for anything unparseable, which the caller treats as expired.
 */
function expiresAt(token: string): number | null {
  const segment = token.split(".")[1];
  if (segment === undefined) return null;
  try {
    const claims = JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as {
      exp?: unknown;
    };
    return typeof claims.exp === "number" ? claims.exp : null;
  } catch {
    return null;
  }
}

/**
 * The single token-rotation point for the server-first mode.
 *
 * A Server Component render cannot write cookies, so it cannot rotate a token —
 * and a rotation whose result is not persisted is worthless. The proxy can do
 * both, and it runs before every render, so every Server Component sees a fresh
 * token. That also makes it irrelevant whether Emporix invalidates the old
 * refresh token on use: the rotated one is always written.
 *
 * Delegates site and language to {@link emporixSiteProxy}, so a storefront needs
 * one proxy function rather than two.
 *
 * @example
 * ```ts
 * // proxy.ts
 * export async function proxy(request: NextRequest) {
 *   return emporixTokenProxy(request, { site: { siteCode: "main" } });
 * }
 * ```
 */
export async function emporixTokenProxy(
  request: NextRequest,
  opts: EmporixTokenProxyOptions = {},
): Promise<NextResponse> {
  const token = request.cookies.get(STORAGE_KEYS.customerToken)?.value;
  if (token !== undefined) {
    const exp = expiresAt(token);
    const skew = opts.skewSeconds ?? 120;
    const stale = exp === null || exp - Math.floor(Date.now() / 1000) <= skew;
    if (stale) {
      const fresh = await emporixRefresh();
      if (fresh !== null) {
        // Make the fresh token visible to THIS render, not just the next one.
        request.cookies.set(STORAGE_KEYS.customerToken, fresh);
      }
    }
  }
  return emporixSiteProxy(request, opts.site ?? {}, opts.rewriteTo);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/token-proxy.test.ts
```

Expected: `Tests 9 passed (9)`.

`emporixRefresh` writes the httpOnly cookies itself through `bffCookieJar`, which
is why the proxy only has to inject the value into the forwarded request.

- [ ] **Step 5: Mutation-test the fail-safe**

Mutation — in `expiresAt`, change the `catch` branch to `return Infinity;` and
the `segment === undefined` branch likewise.
Expected: exactly 1 failure, `treats a malformed token as expired and refreshes`.
Revert. A malformed token must fail toward refreshing, never toward trusting.

- [ ] **Step 6: Commit**

```bash
git add packages/next/src/token-proxy.ts packages/next/tests/token-proxy.test.ts
git commit -m "feat(repo): rotate emporix tokens in the proxy" -m "The proxy becomes the only rotation point, because a Server Component render
cannot write cookies and an unpersisted rotation is worthless. It runs before
every render, so Server Components only ever read.

Side effect worth having: it no longer matters whether Emporix invalidates the
old refresh token on use, since the rotated one is always written.

The exp claim is read without verifying the signature — Emporix verifies it. An
unparseable token counts as expired, so the failure mode is one unnecessary
refresh rather than a request with a dead token."
```

---

## Task 4: Catalog proxy and the first client entry

**Files:**
- Create: `packages/next/src/catalog-proxy.ts`
- Create: `packages/next/src/catalog-client.ts`
- Create: `packages/next/src/bff.ts`
- Create: `packages/next/bff-is-server-only.js`
- Create: `packages/next/scripts/check-dist.mjs`
- Create: `packages/next/tests/catalog-proxy.test.ts`
- Modify: `packages/next/tsup.config.ts`
- Modify: `packages/next/package.json`

**Interfaces:**
- Consumes: `emporixTagsForUrl` from `./tags`; `getEmporixClient` from
  `./client`; `assertSameOrigin` from `./bff-auth` (Task 2); everything from
  Tasks 1-3 for the `./bff` barrel.
- Produces:
  ```ts
  // catalog-proxy.ts — server
  export function createEmporixCatalogRoute(opts?: {
    tenant?: string;
    revalidate?: number;
  }): (request: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;

  // catalog-client.ts — CLIENT entry
  export function createProxyTokenProvider(): TokenProvider;
  export function createProxyFetch(opts: { base?: string }): typeof globalThis.fetch;
  ```

**The allowlist is `emporixTagsForUrl`.** It already returns `[]` for "a different
tenant, a non-catalog service, a personalized resource"
([tags.ts:36-42](../../../packages/next/src/tags.ts#L36)) and is covered by 22
tests. A URL is proxyable exactly when it yields tags. Do not write a second
allowlist.

**The client entry needs the banner, and `treeshake` must be off for it.**
`packages/react/tsup.config.ts:23-25` records why: "tsup's rollup treeshake
post-pass rewrites each chunk and strips any prepended banner." Also
`clean: false` on both configs, because two parallel configs race on cleaning.

- [ ] **Step 1: Write the failing test file**

Create `packages/next/tests/catalog-proxy.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { createEmporixCatalogRoute } from "../src/catalog-proxy";
import { createProxyTokenProvider, createProxyFetch } from "../src/catalog-client";
import { __resetEmporixClients } from "../src/client";

function stubFetch(): { urls: string[]; auths: Array<string | null> } {
  const urls: string[] = [];
  const auths: Array<string | null> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      urls.push(url);
      const h = new Headers(init?.headers);
      auths.push(h.get("authorization"));
      const body = url.includes("/customerlogin/auth/anonymous/")
        ? { access_token: "real-anon", refresh_token: "r", session_id: "s", expires_in: 3600 }
        : { ok: true };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { urls, auths };
}

function req(path: string): { request: Request; ctx: { params: Promise<{ path: string[] }> } } {
  const segments = path.split("/").filter((s) => s.length > 0);
  return {
    request: new Request(`https://shop.test/api/emporix/${path}`, {
      headers: { "sec-fetch-site": "same-origin", authorization: "Bearer proxied" },
    }),
    ctx: { params: Promise.resolve({ path: segments }) },
  };
}

beforeEach(() => {
  __resetEmporixClients();
  process.env.EMPORIX_TENANT = "viu";
  process.env.EMPORIX_STOREFRONT_CLIENT_ID = "storefront-id";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.EMPORIX_TENANT;
  delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
});

describe("createEmporixCatalogRoute — allowlist", () => {
  it("forwards a catalog product request", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("product/viu/products/p1");
    expect((await route(request, ctx)).status).toBe(200);
  });

  it("rejects a cart request with 403", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("cart/viu/carts/c1");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects an order request with 403", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("order/viu/orders/o1");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects a customer request with 403", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("customer/viu/login");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects a foreign tenant with 403", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("product/other/products/p1");
    expect((await route(request, ctx)).status).toBe(403);
  });

  it("rejects a cross-site request", async () => {
    stubFetch();
    const route = createEmporixCatalogRoute();
    const request = new Request("https://shop.test/api/emporix/product/viu/products/p1", {
      headers: { "sec-fetch-site": "cross-site" },
    });
    const ctx = { params: Promise.resolve({ path: ["product", "viu", "products", "p1"] }) };
    expect((await route(request, ctx)).status).toBe(403);
  });
});

describe("createEmporixCatalogRoute — token substitution", () => {
  it("never forwards the placeholder Authorization header", async () => {
    const f = stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("product/viu/products/p1");
    await route(request, ctx);
    expect(f.auths).not.toContain("Bearer proxied");
  });

  it("sends the server's real anonymous token upstream", async () => {
    const f = stubFetch();
    const route = createEmporixCatalogRoute();
    const { request, ctx } = req("product/viu/products/p1");
    await route(request, ctx);
    expect(f.auths.some((a) => a === "Bearer real-anon")).toBe(true);
  });
});

describe("createProxyTokenProvider", () => {
  it("makes NO network call — this is what 'no token in the browser' means", async () => {
    // The one assertion that proves the security claim. Everything else in this
    // mode is structure; this is the measurement.
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const provider = createProxyTokenProvider();
    const session = await provider.getAnonymousToken();
    expect(spy).not.toHaveBeenCalled();
    expect(session.accessToken).toBeTruthy();
  });

  it("returns a placeholder for a service token too, without a network call", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    const provider = createProxyTokenProvider();
    await provider.getToken("backend");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("createProxyFetch", () => {
  it("rewrites an Emporix URL onto the local base", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return new Response("{}", { status: 200 });
      }),
    );
    const f = createProxyFetch({ base: "/api/emporix" });
    await f("https://api.emporix.io/product/viu/products/p1");
    expect(seen[0]).toBe("/api/emporix/product/viu/products/p1");
  });

  it("preserves the query string", async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        seen.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        return new Response("{}", { status: 200 });
      }),
    );
    const f = createProxyFetch({ base: "/api/emporix" });
    await f("https://api.emporix.io/product/viu/products?pageSize=5");
    expect(seen[0]).toBe("/api/emporix/product/viu/products?pageSize=5");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/catalog-proxy.test.ts
```

Expected: collection fails on `../src/catalog-proxy`; all 12 fail.

- [ ] **Step 3: Write the server side**

Create `packages/next/src/catalog-proxy.ts`:

```ts
import { emporixTagsForUrl } from "./tags";
import { getEmporixClient } from "./client";
import { assertSameOrigin } from "./bff-auth";

const DEFAULT_HOST = "https://api.emporix.io";

/**
 * A catch-all Route Handler for **public catalog reads only**.
 *
 * Lets a storefront keep client-side catalog interaction — typeahead, infinite
 * scroll, filters — while holding no Emporix token in the browser. The browser
 * sends a placeholder; this route substitutes the server's real anonymous token.
 *
 * The allowlist is {@link emporixTagsForUrl}: a URL is proxyable exactly when it
 * yields cache tags, which is already the "public and cacheable" test. Cart,
 * order, customer and token endpoints yield `[]` and get a 403. There is
 * deliberately no second allowlist to keep in sync.
 *
 * Proxying catalog reads is a net win rather than a cost: the response is cached
 * by Next once for all visitors instead of fetched per browser.
 *
 * @example
 * ```ts
 * // app/api/emporix/[...path]/route.ts
 * export const GET = createEmporixCatalogRoute();
 * ```
 */
export function createEmporixCatalogRoute(
  opts: { tenant?: string; revalidate?: number } = {},
): (request: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response> {
  return async (request, ctx) => {
    try {
      assertSameOrigin(request);
    } catch {
      return new Response("forbidden", { status: 403 });
    }

    const tenant = opts.tenant ?? process.env.EMPORIX_TENANT;
    if (!tenant) {
      throw new Error(
        "createEmporixCatalogRoute: no tenant. Set EMPORIX_TENANT or pass { tenant }.",
      );
    }

    const { path } = await ctx.params;
    const host = process.env.EMPORIX_HOST ?? DEFAULT_HOST;
    const search = new URL(request.url).search;
    const upstream = `${host}/${path.join("/")}${search}`;

    if (emporixTagsForUrl(upstream, tenant).length === 0) {
      return new Response("forbidden", { status: 403 });
    }

    // The tagged client is correct here: this is public, cacheable catalog data
    // and its anonymous token carries no personalization.
    const client = getEmporixClient({
      tenant,
      ...(opts.revalidate !== undefined ? { revalidate: opts.revalidate } : {}),
    });
    const session = await client.tokenProvider.getAnonymousToken();

    // The placeholder Authorization from the browser is DISCARDED, never
    // forwarded — a fresh Headers object rather than a copy of the request's.
    const res = await fetch(upstream, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        Accept: "application/json",
      },
    });
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  };
}
```

- [ ] **Step 4: Write the client side**

Create `packages/next/src/catalog-client.ts`:

```ts
import type { AnonymousSession, TokenProvider } from "@viu/emporix-sdk";

const DEFAULT_HOST = "https://api.emporix.io";
/** Discarded by the catalog route; never sent to Emporix. */
const PLACEHOLDER = "proxied";

/**
 * A `TokenProvider` that mints nothing and calls nothing.
 *
 * This is what makes "no token in the browser" true rather than aspirational.
 * The SDK's default provider fetches an anonymous token over the **global**
 * `fetch` (`core/auth.ts`), which a rewriting `fetch` cannot intercept — so the
 * only way to keep a token out of the browser is not to request one.
 *
 * Pair it with {@link createProxyFetch} and a route built by
 * `createEmporixCatalogRoute`, which substitutes the server's real token.
 */
export function createProxyTokenProvider(): TokenProvider {
  const session: AnonymousSession = {
    accessToken: PLACEHOLDER,
    refreshToken: PLACEHOLDER,
    sessionId: PLACEHOLDER,
    expiresIn: 3600,
  };
  return {
    getToken: () => Promise.resolve(PLACEHOLDER),
    getAnonymousToken: () => Promise.resolve(session),
    refreshAnonymous: () => Promise.resolve(session),
  };
}

/**
 * A `fetch` that rewrites Emporix URLs onto a same-origin route.
 *
 * Only the host is replaced; path and query survive, so the route can apply
 * {@link emporixTagsForUrl} to the reconstructed upstream URL unchanged.
 */
export function createProxyFetch(
  opts: { base?: string } = {},
): typeof globalThis.fetch {
  const base = opts.base ?? "/api/emporix";
  const host = process.env.NEXT_PUBLIC_EMPORIX_HOST ?? DEFAULT_HOST;
  return (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(host)) return globalThis.fetch(input, init);
    const rest = url.slice(host.length);
    return globalThis.fetch(`${base}${rest}`, init);
  };
}
```

- [ ] **Step 5: Write the `./bff` barrel and its guard**

Create `packages/next/src/bff.ts`:

```ts
export { BFF_MAX_AGE, bffCookieJar, type BffCookieJar } from "./bff-cookies";
export {
  withEmporixSession,
  withEmporixSessionMutable,
  type WithEmporixSessionOptions,
} from "./bff-session";
export { emporixLogin, emporixLogout, emporixRefresh, assertSameOrigin } from "./bff-auth";
export { emporixTokenProxy, type EmporixTokenProxyOptions } from "./token-proxy";
export { createEmporixCatalogRoute } from "./catalog-proxy";
```

Create `packages/next/bff-is-server-only.js`:

```js
// Resolved when @viu/emporix-sdk-next/bff is pulled in outside the server graph.
// Hand-written and NOT built: tsup's `clean: true` would delete it from dist/.
// Exports nothing on purpose — the bundler's failure to find the named export is
// the primary guard, and this throw is the backstop.
throw new Error(
  "@viu/emporix-sdk-next/bff is server-only: it reads and writes session cookies " +
    "and handles refresh tokens. It was resolved outside the server graph — most " +
    'likely imported from a "use client" module. Move the import into a Server ' +
    "Action, a Route Handler, or a Server Component.",
);
```

- [ ] **Step 6: Split the tsup config**

Replace `packages/next/tsup.config.ts` entirely:

```ts
import { defineConfig } from "tsup";

const shared = {
  format: ["esm", "cjs"] as const,
  dts: true,
  sourcemap: true,
  external: ["next", "@viu/emporix-sdk", "@viu/emporix-sdk-react"],
};

export default defineConfig([
  {
    ...shared,
    // Each entry is separate for a reason. `webhook`: a Route Handler must not
    // pull the client and session code (and with it `next/headers`). `proxy`:
    // `cookies()` is not available in a proxy at all. `service` and `bff`: they
    // carry secrets, and their `exports` entries resolve to a throwing file
    // outside the server graph.
    entry: {
      index: "src/index.ts",
      webhook: "src/webhook.ts",
      proxy: "src/proxy.ts",
      service: "src/service.ts",
      bff: "src/bff.ts",
    },
    treeshake: true,
    // clean is handled by the build script — tsup's own clean runs mid-build and
    // would race-delete the other config's output.
    clean: false,
  },
  {
    ...shared,
    entry: { "catalog-client": "src/catalog-client.ts" },
    clean: false,
    // treeshake is intentionally omitted: tsup's rollup treeshake post-pass
    // rewrites each chunk and strips any prepended banner. Learned in
    // packages/react — see its tsup.config.ts.
    banner: { js: '"use client";' },
  },
]);
```

- [ ] **Step 7: Write the dist guard script**

Create `packages/next/scripts/check-dist.mjs`:

```js
// Guards the RSC boundary contract of the published package:
// - catalog-client MUST start with "use client" (esbuild drops source
//   directives; tsup must re-add them via `banner`).
// - the server entries MUST stay directive-free.
import { readFileSync, existsSync } from "node:fs";

const HEAD_BYTES = 200;
const mustHaveBanner = ["catalog-client"];
const mustNotHaveBanner = ["index", "webhook", "proxy", "service", "bff"];
let failed = false;

const head = (name, ext) =>
  readFileSync(new URL(`../dist/${name}.${ext}`, import.meta.url), "utf8").slice(0, HEAD_BYTES);

for (const name of mustHaveBanner) {
  for (const ext of ["js", "cjs"]) {
    if (!head(name, ext).includes('"use client"')) {
      console.error(`FAIL dist/${name}.${ext}: missing "use client" banner`);
      failed = true;
    }
  }
}
for (const name of mustNotHaveBanner) {
  for (const ext of ["js", "cjs"]) {
    if (head(name, ext).includes('"use client"')) {
      console.error(`FAIL dist/${name}.${ext}: must NOT carry "use client" (server entry)`);
      failed = true;
    }
  }
}
for (const name of [...mustHaveBanner, ...mustNotHaveBanner]) {
  for (const ext of ["d.ts", "d.cts"]) {
    if (!existsSync(new URL(`../dist/${name}.${ext}`, import.meta.url))) {
      console.error(`FAIL dist/${name}.${ext}: missing declaration file`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('dist "use client" banners OK');
```

- [ ] **Step 8: Wire package.json**

In `packages/next/package.json`, add to `files` (after `service-is-server-only.js`):

```json
    "bff-is-server-only.js",
```

Add both export blocks after `"./service"`. `types` sits **outside** the
conditions on the guarded entry — TypeScript does not understand `react-server`
and would otherwise report "is not a module" in a legitimate Server Action:

```json
    "./bff": {
      "types": "./dist/bff.d.ts",
      "react-server": {
        "import": "./dist/bff.js",
        "require": "./dist/bff.cjs"
      },
      "default": "./bff-is-server-only.js"
    },
    "./catalog-client": {
      "types": "./dist/catalog-client.d.ts",
      "import": "./dist/catalog-client.js",
      "require": "./dist/catalog-client.cjs"
    },
```

Change the `build` script and add `check:dist`:

```json
    "build": "rm -rf dist && tsup",
    "check:dist": "node scripts/check-dist.mjs",
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
pnpm -F @viu/emporix-sdk-next exec vitest run tests/catalog-proxy.test.ts
```

Expected: `Tests 12 passed (12)`.

- [ ] **Step 10: Build and verify the boundary**

```bash
pnpm -F @viu/emporix-sdk-next build && pnpm -F @viu/emporix-sdk-next check:dist
```

Expected: `dist "use client" banners OK`.

If `catalog-client` is missing the banner, `treeshake` leaked into the second
config — remove it.

Then confirm the guarded entry ships and the client entry does not pull
`next/headers`:

```bash
cd packages/next && pnpm pack && tar -tzf viu-emporix-sdk-next-0.3.0.tgz | grep -E "bff|catalog" && rm viu-emporix-sdk-next-0.3.0.tgz
```

Expected: `package/bff-is-server-only.js`, `package/dist/bff.*` and
`package/dist/catalog-client.*` all present. Note `pnpm pack` ignores
`--pack-destination` and writes to the cwd; `packages/next/*.tgz` is **not**
gitignored, so delete it.

```bash
grep -c "next/headers" packages/next/dist/catalog-client.js || echo "clean: catalog-client has no next/headers"
```

Expected: `clean: catalog-client has no next/headers`.

- [ ] **Step 11: Mutation-test the allowlist**

Mutation — in `catalog-proxy.ts`, delete the
`if (emporixTagsForUrl(upstream, tenant).length === 0)` block.
Expected: 4 failures — the cart, order, customer and foreign-tenant tests.
Revert. This is the one guard that stands between a public proxy and an open
gateway.

- [ ] **Step 12: Full local gate and commit**

```bash
pnpm typecheck && pnpm lint && pnpm -r test
```

Expected: all green, `packages/next` at **145** tests. Derivation: 95 baseline
+ 13 (Task 1) + 16 (Task 2) + 9 (Task 3) + 12 (Task 4) = 145. If the number
differs, find out why rather than adjusting the expectation.

```bash
git add packages/next/src/catalog-proxy.ts packages/next/src/catalog-client.ts packages/next/src/bff.ts packages/next/bff-is-server-only.js packages/next/scripts/check-dist.mjs packages/next/tests/catalog-proxy.test.ts packages/next/tsup.config.ts packages/next/package.json
git commit -m "feat(repo): add the catalog proxy and the bff entry" -m "Lets a storefront keep client-side catalog interaction while holding no Emporix
token in the browser. createProxyTokenProvider makes no network call at all —
that is the assertion that proves the claim, because the SDK's default provider
fetches over the global fetch, which a rewriting fetch cannot intercept.

The allowlist is emporixTagsForUrl, unchanged: a URL is proxyable exactly when
it yields cache tags, which is already the public-and-cacheable test. Cart,
order, customer and token endpoints yield [] and get a 403. No second allowlist
to keep in sync.

Proxying catalog reads is a net win: Next caches the response once for all
visitors instead of each browser fetching from Emporix.

First client entry in this package, so it gains react's banner machinery — and
treeshake stays off for that config, because tsup's rollup pass strips the
banner."
```

---

## Task 5: A Next demo that exercises the basics end to end

**Files:**
- Create: `examples/next-server-first/package.json`
- Create: `examples/next-server-first/next.config.mjs`
- Create: `examples/next-server-first/tsconfig.json`
- Create: `examples/next-server-first/.env.example`
- Create: `examples/next-server-first/proxy.ts`
- Create: `examples/next-server-first/app/layout.tsx`
- Create: `examples/next-server-first/app/emporix.ts`
- Create: `examples/next-server-first/app/page.tsx`
- Create: `examples/next-server-first/app/actions/auth.ts`
- Create: `examples/next-server-first/app/actions/cart.ts`
- Create: `examples/next-server-first/app/login/page.tsx`
- Create: `examples/next-server-first/app/cart/page.tsx`
- Create: `examples/next-server-first/app/api/emporix/[...path]/route.ts`
- Create: `examples/next-server-first/app/typeahead.tsx`
- Create: `examples/next-server-first/app/debug/page.tsx`
- Create: `examples/next-server-first/README.md`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: nothing the package depends on. This is the acceptance harness.

**Why a new example and not a route group.** `examples/next-app-router/app/layout.tsx:18`
mounts `<Providers>` — a Client Component holding an `EmporixClient` — in the
**root** layout. A Next route group nests inside the root layout, so every
server-first route would still be wrapped by a client-side Emporix client, which
is exactly what this mode removes. `examples/*` is a pnpm workspace glob and
`@viu/emporix-examples-*` is in the changesets `ignore` list, so a new example
needs **zero** config changes.

**Scope: the basics, not `storefront-demo`'s 17 routes.** Six pages, each present
because it exercises one building block that no unit test can:

| Page / file | Exercises |
|---|---|
| `app/page.tsx` | catalog read via the **memoized tagged** client — the split below |
| `proxy.ts` | `emporixTokenProxy` on every request |
| `app/login/page.tsx` + `actions/auth.ts` | `emporixLogin` / `emporixLogout`, httpOnly cookies |
| `app/cart/page.tsx` + `actions/cart.ts` | `withEmporixSession*`, guest cart survival, the session binding |
| `app/api/emporix/[...path]/route.ts` + `app/typeahead.tsx` | the catalog proxy and `createProxyTokenProvider` |
| `app/debug/page.tsx` | renders `document.cookie` so "no token in the browser" is **visible**, not asserted |

### The catalog/cart split, and why it matters

Catalog reads use `getEmporixClient()` — the memoized, tagged client with a
process-wide anonymous token. Cart reads and writes use `withEmporixSession*`.

Getting this backwards is not a style mistake, it costs an Emporix call per
render: `withEmporixSession` in a Server Component gets a **read-only** jar, so
the anonymous store's `write` no-ops, so the SDK cannot persist the session it
just obtained, so the next render logs in anonymously again. Catalog pages must
therefore not use `withEmporixSession`.

### A limitation this example is expected to expose

There is a case the plan does not solve and the example is the way to find out
whether it bites: **a guest cart READ in a Server Component.** The read-only jar
cannot persist a rotated anonymous session. If Emporix invalidates the old
anonymous refresh token when it is used, the second such read fails.

Step 8 below tests exactly that. Two outcomes:

- **It works** (Emporix tolerates refresh-token reuse for anonymous sessions):
  record the observation in the example README and move on.
- **It fails:** `/cart` must not be a Server Component for guests. Two fixes, in
  preference order — make the cart page fetch through a Server Action (which may
  write), or extend `emporixTokenProxy` to keep a short-lived anonymous access
  token in the cookie so read-only paths need no refresh at all. Do **not** paper
  over it; stop and raise it.

- [ ] **Step 1: Scaffold the package**

Create `examples/next-server-first/package.json`:

```json
{
  "name": "@viu/emporix-examples-next-server-first",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "echo \"(lint skipped for example)\"",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@viu/emporix-sdk": "workspace:*",
    "@viu/emporix-sdk-next": "workspace:*",
    "next": "^16.2.12",
    "react": "^19.2.7",
    "react-dom": "^19.2.7"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "typescript": "^5.6.0"
  }
}
```

Note the dependency list: **no `@viu/emporix-sdk-react`, no
`@tanstack/react-query`**. That absence is part of the demonstration.

Create `examples/next-server-first/next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
export default {};
```

Create `examples/next-server-first/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "preserve",
    "noEmit": true,
    "allowJs": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Create `examples/next-server-first/.env.example`:

```
# Server-only. None of these are NEXT_PUBLIC_ — that is the point.
EMPORIX_TENANT=your-tenant
EMPORIX_STOREFRONT_CLIENT_ID=your-storefront-client-id
```

Then install:

```bash
pnpm install
```

Expected: pnpm reports the new project. `pnpm -r --filter "./examples/*" typecheck`
will fail until the files below exist — that is expected at this step.

- [ ] **Step 2: The proxy and the shared options**

Create `examples/next-server-first/proxy.ts`:

```ts
import type { NextRequest } from "next/server";
import { emporixTokenProxy } from "@viu/emporix-sdk-next/bff";
import { SITE } from "./app/emporix";

export async function proxy(request: NextRequest) {
  return emporixTokenProxy(request, { site: SITE });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
```

Create `examples/next-server-first/app/emporix.ts`:

```ts
import type { WithEmporixSessionOptions } from "@viu/emporix-sdk-next/bff";

/** Site and language the proxy pins for every request. */
export const SITE = { siteCode: "main" } as const;

/**
 * The context every server-side client binds. One place, so the catalog client
 * and the session helper cannot drift — the same reason app/emporix.ts exists in
 * the other example.
 */
export const EMPORIX: WithEmporixSessionOptions = {
  context: { siteCode: "main", currency: "CHF" },
};
```

- [ ] **Step 3: Layout and the catalog page**

Create `examples/next-server-first/app/layout.tsx`:

```tsx
import type { ReactNode } from "react";

export const metadata = { title: "Emporix SDK — server-first example" };

/**
 * No provider, no client-side EmporixClient, no storage. That absence is the
 * whole demonstration: the browser has nothing to hold a token in.
 */
export default function RootLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <nav>
          <a href="/">Catalog</a> · <a href="/cart">Cart</a> ·{" "}
          <a href="/login">Login</a> · <a href="/debug">Debug</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
```

Create `examples/next-server-first/app/page.tsx`:

```tsx
import { getEmporixClient } from "@viu/emporix-sdk-next";
import { EMPORIX } from "./emporix";
import { Typeahead } from "./typeahead";

/**
 * Catalog reads use the MEMOIZED, TAGGED client — not withEmporixSession.
 * withEmporixSession in a Server Component gets a read-only cookie jar, so the
 * anonymous session it obtains cannot be persisted and the next render logs in
 * again. Catalog data needs no stable session, so the process-wide token is both
 * correct and cheaper.
 */
export default async function Home(): Promise<React.JSX.Element> {
  const client = getEmporixClient({ context: EMPORIX.context });
  const products = await client.products.list({ pageSize: 12 });
  return (
    <main>
      <h1>Catalog</h1>
      <Typeahead />
      <ul>
        {products.map((p) => (
          <li key={p.id}>
            {typeof p.name === "string" ? p.name : Object.values(p.name ?? {})[0]} — {p.code}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

If `client.products.list` does not accept `{ pageSize }` in the installed SDK
version, call it with no argument — the point is a server-rendered list, not
pagination.

- [ ] **Step 4: Auth actions and the login page**

Create `examples/next-server-first/app/actions/auth.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { emporixLogin, emporixLogout } from "@viu/emporix-sdk-next/bff";
import { EMPORIX } from "../emporix";

export async function login(formData: FormData): Promise<void> {
  await emporixLogin(
    {
      email: String(formData.get("email")),
      password: String(formData.get("password")),
    },
    EMPORIX,
  );
  revalidatePath("/", "layout");
}

export async function logout(): Promise<void> {
  await emporixLogout(EMPORIX);
  revalidatePath("/", "layout");
}
```

Create `examples/next-server-first/app/login/page.tsx`:

```tsx
import { emporixSession } from "@viu/emporix-sdk-next";
import { login, logout } from "../actions/auth";

export default async function LoginPage(): Promise<React.JSX.Element> {
  const { customerToken } = await emporixSession();
  if (customerToken !== null) {
    return (
      <main>
        <h1>Logged in</h1>
        <p>The token is in an httpOnly cookie. This page read it on the server.</p>
        <form action={logout}>
          <button type="submit">Log out</button>
        </form>
      </main>
    );
  }
  return (
    <main>
      <h1>Login</h1>
      <form action={login}>
        <input name="email" type="email" placeholder="email" required />
        <input name="password" type="password" placeholder="password" required />
        <button type="submit">Log in</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 5: Cart actions and the cart page**

Create `examples/next-server-first/app/actions/cart.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { withEmporixSessionMutable } from "@viu/emporix-sdk-next/bff";
import { cookies } from "next/headers";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { EMPORIX } from "../emporix";

/**
 * Creates the cart on first use and remembers its id in an httpOnly cookie.
 * `carts.create` returns `CartCreated` with `.cartId` — not `.id`, which is what
 * `carts.getCurrent` returns. The two shapes are not interchangeable.
 */
export async function addToCart(itemYrn: string, quantity: number): Promise<void> {
  await withEmporixSessionMutable(async (client, ctx) => {
    const jar = await cookies();
    let cartId = jar.get(STORAGE_KEYS.cartId)?.value ?? null;
    if (cartId === null) {
      const created = await client.carts.create({ currency: "CHF" }, ctx);
      cartId = created.cartId;
      jar.set(STORAGE_KEYS.cartId, cartId, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
    }
    await client.carts.addItem(cartId, { itemYrn, quantity }, ctx);
  }, EMPORIX);
  revalidatePath("/cart");
}
```

Create `examples/next-server-first/app/cart/page.tsx`:

```tsx
import { cookies } from "next/headers";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { withEmporixSession } from "@viu/emporix-sdk-next/bff";
import { EMPORIX } from "../emporix";
import { addToCart } from "../actions/cart";

/**
 * A guest cart READ in a Server Component. This is the case the plan flags as
 * unproven: the read-only jar cannot persist a rotated anonymous session. If
 * Emporix invalidates the old anonymous refresh token on use, the second load of
 * this page fails — see the plan's Task 5 Step 8.
 */
export default async function CartPage(): Promise<React.JSX.Element> {
  const cartId = (await cookies()).get(STORAGE_KEYS.cartId)?.value ?? null;
  const cart =
    cartId === null
      ? null
      : await withEmporixSession((client, ctx) => client.carts.get(cartId, ctx), EMPORIX);

  async function add(formData: FormData): Promise<void> {
    "use server";
    await addToCart(String(formData.get("itemYrn")), 1);
  }

  return (
    <main>
      <h1>Cart</h1>
      <p>{cart === null ? "No cart yet." : `${cart.items?.length ?? 0} item(s)`}</p>
      <form action={add}>
        <input name="itemYrn" placeholder="itemYrn" required />
        <button type="submit">Add</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6: The catalog proxy route and the typeahead**

Create `examples/next-server-first/app/api/emporix/[...path]/route.ts`:

```ts
import { createEmporixCatalogRoute } from "@viu/emporix-sdk-next/bff";

export const GET = createEmporixCatalogRoute();
```

Create `examples/next-server-first/app/typeahead.tsx`:

```tsx
"use client";

import { useState } from "react";
import { EmporixClient } from "@viu/emporix-sdk";
import {
  createProxyFetch,
  createProxyTokenProvider,
} from "@viu/emporix-sdk-next/catalog-client";

/**
 * A client-side catalog read with NO token. The token provider makes no network
 * call at all; the rewriting fetch sends the request to /api/emporix, which
 * substitutes the server's real anonymous token.
 */
const client = new EmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "viu",
  credentials: { storefront: { clientId: "proxied" } },
  tokenProvider: createProxyTokenProvider(),
  fetch: createProxyFetch({ base: "/api/emporix" }),
  logger: false,
});

export function Typeahead(): React.JSX.Element {
  const [names, setNames] = useState<string[]>([]);
  return (
    <div>
      <input
        placeholder="search (client-side, no token)"
        onChange={(e) => {
          const q = e.target.value;
          if (q.length < 2) return setNames([]);
          void client.products
            .list()
            .then((ps) =>
              setNames(
                ps
                  .map((p) => (typeof p.name === "string" ? p.name : (Object.values(p.name ?? {})[0] ?? "")))
                  .filter((n) => n.toLowerCase().includes(q.toLowerCase()))
                  .slice(0, 5),
              ),
            )
            .catch(() => setNames([]));
        }}
      />
      <ul>
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
```

The `NEXT_PUBLIC_EMPORIX_TENANT` is the one public value — a tenant name is not a
secret, and the proxy route validates it server-side anyway.

- [ ] **Step 7: The debug page that makes the claim visible**

Create `examples/next-server-first/app/debug/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";

/**
 * Renders what the browser can actually see. If any Emporix token appears here,
 * the mode has failed — and it fails visibly rather than silently.
 */
export default function DebugPage(): React.JSX.Element {
  const [cookies, setCookies] = useState<string[]>([]);
  useEffect(() => {
    setCookies(document.cookie.split("; ").filter((c) => c.length > 0));
  }, []);
  const suspicious = cookies.filter((c) =>
    /customerToken|refreshToken|saasToken|anonymousSession|cartId/.test(c),
  );
  return (
    <main>
      <h1>What the browser can read</h1>
      <p>
        Expected: only <code>emporix.siteCode</code> and <code>emporix.language</code>.
      </p>
      <ul>
        {cookies.length === 0 ? <li>(nothing)</li> : cookies.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <p style={{ fontWeight: 700, color: suspicious.length > 0 ? "crimson" : "green" }}>
        {suspicious.length > 0
          ? `FAIL — ${suspicious.length} secret cookie(s) readable from JavaScript`
          : "PASS — no secret is readable from JavaScript"}
      </p>
    </main>
  );
}
```

- [ ] **Step 8: Build, run and verify the six behaviours**

`examples/next-server-first/.env.local` must exist with the tenant credentials.
Never print its contents.

```bash
pnpm -r --filter "./packages/*" build
pnpm -F @viu/emporix-examples-next-server-first build
```

Expected: a successful build listing `ƒ Proxy (Middleware)`, `ƒ /`, `ƒ /cart`,
`ƒ /login`, `ƒ /debug` and `ƒ /api/emporix/[...path]`.

```bash
pnpm -F @viu/emporix-examples-next-server-first exec next start -p 3222
```

Then, in order:

**1 — catalog renders server-side.**
`curl -s http://localhost:3222/ | grep -c "<li>"` → expect a non-zero count.

**2 — no secret cookie is set for a plain visit.**
`curl -sD- -o /dev/null http://localhost:3222/ | grep -i "^set-cookie"` → expect
only `emporix.siteCode`, and **no** `customerToken`/`refreshToken`/`cartId`.

**3 — the catalog proxy allows a product read.**
`curl -s -o /dev/null -w "%{http_code}\n" -H "sec-fetch-site: same-origin" http://localhost:3222/api/emporix/product/<tenant>/products`
→ expect `200`.

**4 — the catalog proxy refuses a cart read.**
`curl -s -o /dev/null -w "%{http_code}\n" -H "sec-fetch-site: same-origin" http://localhost:3222/api/emporix/cart/<tenant>/carts`
→ expect `403`. This is the allowlist working against a real request.

**5 — the guest cart survives, and the READ works twice.** In a browser, open
`/cart`, add a valid `itemYrn`, then **reload the page twice**. Expect the item
count to persist both times.

A failure on the *second* reload is the limitation this task exists to find —
the read-only jar could not persist the rotated anonymous session. Stop and raise
it; do not work around it silently.

**6 — the debug page reads no secret.** Open `/debug`. Expect the green
`PASS — no secret is readable from JavaScript`, with only `emporix.siteCode`
listed.

Stop the server when done.

- [ ] **Step 9: Write the example README**

Create `examples/next-server-first/README.md`:

````markdown
# Server-first example

Demonstrates `@viu/emporix-sdk-next`'s server-first mode: **no Emporix token in
the browser**, not even an anonymous one.

Note the dependencies in `package.json`: no `@viu/emporix-sdk-react`, no
`@tanstack/react-query`. The browser has nothing to hold a token in.

## Run it

```bash
cp .env.example .env.local   # then fill in your tenant and storefront client id
pnpm -F @viu/emporix-examples-next-server-first dev
```

## What each page proves

| Page | Proves |
|---|---|
| `/` | catalog rendered on the server with the memoized tagged client |
| `/login` | `emporixLogin` / `emporixLogout` via Server Actions, session in httpOnly cookies |
| `/cart` | `withEmporixSession*`, a guest cart bound to a server-managed anonymous session |
| `/debug` | **what the browser can actually read** — turns green only when no secret is reachable from JavaScript |
| typeahead on `/` | a client-side catalog read with no token, through `/api/emporix` |

## The catalog/cart split

Catalog reads use `getEmporixClient()`. Cart reads and writes use
`withEmporixSession*`. Do not swap them: `withEmporixSession` in a Server
Component gets a read-only cookie jar, so it cannot persist the anonymous session
it just obtained, and every render logs in anonymously again.

## `/debug` is the point

A green `PASS` on `/debug` is the only direct evidence that the mode works. Unit
tests can assert that the token provider makes no network call; only the browser
can show that no secret cookie is readable.
````

- [ ] **Step 10: Typecheck, gate and commit**

```bash
pnpm typecheck && pnpm -r test
```

Expected: all green. The example adds no unit tests, so `packages/next` stays at
145.

```bash
rm -rf examples/next-server-first/.next
git status --short
```

Expected: only the new files under `examples/next-server-first/`, plus
`pnpm-lock.yaml`. No `.next`, no `*.tsbuildinfo`.

```bash
git add examples/next-server-first pnpm-lock.yaml
git commit -m "feat(examples): add a server-first next demo" -m "Six pages, each present because it exercises something no unit test can: the
catalog/cart client split, login and logout through Server Actions, a guest cart
bound to a server-managed anonymous session, the catalog proxy's allowlist
against a real request, and a client-side catalog read with no token.

The dependency list is part of the demonstration — no @viu/emporix-sdk-react and
no react-query, so the browser has nothing to hold a token in.

/debug renders document.cookie and turns green only when no secret is reachable
from JavaScript. Unit tests can assert that the proxy token provider makes no
network call; only a browser can show that nothing leaked into a readable cookie."
```

---

## Task 6: Docs, changeset, PR

**Files:**
- Modify: `packages/next/README.md`
- Create: `.changeset/next-server-first-mode.md`

**Interfaces:**
- Consumes: every export from Tasks 1-4.
- Produces: nothing consumed further.

- [ ] **Step 1: Add the README section**

`packages/next/README.md` heading order today: `## Install`,
`## The one rule`, `## Service accounts`, `## Server Component`,
`## Server Action`, `## Webhook revalidation`, `## Cache tags`,
`## Environment`, `## Site and locale detection (proxy.ts)`,
`## Footgun: httpOnly and the browser`, `## next/image`, `## Subpath exports`.

Insert **immediately after** `## The one rule`, because the server-first mode is
the rule taken to its conclusion:

````markdown
## Server-first mode: no token in the browser

Every Emporix call needs a bearer token where the call originates. So "no token
in the browser" means one thing only: **the browser makes no Emporix calls.**
Server Components read, Server Actions write, and a narrow proxy serves the
public catalog.

`packages/react` is unaffected — if you want a SPA, use it as before.

### One helper covers every customer and cart call

```ts
// app/actions/cart.ts
"use server";
import { withEmporixSessionMutable } from "@viu/emporix-sdk-next/bff";

export async function addToCart(cartId: string, item: CartItemInput) {
  return withEmporixSessionMutable((client, ctx) =>
    client.carts.addItem(cartId, item, ctx),
  );
}
```

Use `withEmporixSession` in Server Components (cookie writes no-op there, because
Next forbids writing during a render) and `withEmporixSessionMutable` in Server
Actions and Route Handlers.

The helper branches on the session so you do not have to: a customer token in the
cookie gives you the memoized untagged client plus `auth.customer`; no token
gives you a **per-request** client with a per-guest anonymous session plus
`auth.anonymous`. That branch is not cosmetic — Emporix maps the anonymous
token's `session-id` onto the cart when the cart is created, so two guests
sharing a client would share a cart.

Neither path can be tagged. `withEmporixSession*` never passes a `fetch`.

### Login, logout, refresh

```ts
// app/actions/auth.ts
"use server";
import { emporixLogin, emporixLogout } from "@viu/emporix-sdk-next/bff";

export async function login(formData: FormData) {
  await emporixLogin({
    email: String(formData.get("email")),
    password: String(formData.get("password")),
  });
}
export async function logout() {
  await emporixLogout();
}
```

`emporixLogin` returns `void` on purpose: there is no token for a Server Action
to serialize into a response body. It threads the guest's anonymous token, so the
cart survives the login.

### Token rotation belongs in the proxy

```ts
// proxy.ts
import type { NextRequest } from "next/server";
import { emporixTokenProxy } from "@viu/emporix-sdk-next/bff";

export async function proxy(request: NextRequest) {
  return emporixTokenProxy(request, { site: { siteCode: "main" } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)"],
};
```

A Server Component cannot write a cookie, so it cannot rotate a token — and an
unpersisted rotation is worthless. The proxy can do both and runs before every
render. It delegates site and language to `emporixSiteProxy`, so one proxy
function is enough.

### Client-side catalog reads, still without a token

```ts
// app/api/emporix/[...path]/route.ts
import { createEmporixCatalogRoute } from "@viu/emporix-sdk-next/bff";
export const GET = createEmporixCatalogRoute();
```

```ts
// the browser-side client
import { createProxyTokenProvider, createProxyFetch } from "@viu/emporix-sdk-next/catalog-client";

const client = new EmporixClient({
  tenant,
  credentials: { storefront: { clientId: "proxied" } },
  tokenProvider: createProxyTokenProvider(),
  fetch: createProxyFetch({ base: "/api/emporix" }),
});
```

`createProxyTokenProvider` makes **no network call**. That is what keeps the
browser token-free: the SDK's default provider fetches an anonymous token over
the global `fetch`, which a rewriting `fetch` cannot intercept, so the answer is
not to request one.

The route's allowlist is `emporixTagsForUrl` — a URL is proxyable exactly when it
yields cache tags. Cart, order, customer and token endpoints yield none and get a
403. Proxying catalog reads is a net win: Next caches each response once for all
visitors instead of every browser fetching it.

### What this costs you

Measured against `examples/storefront-demo`, a complete SPA storefront with 17
routes and 41 distinct hooks: **about 25 Server Actions** — cart 3, checkout 3,
addresses 5, shopping lists 5, password reset 2, plus profile, password change,
order cancel, reorder, return creation and reward redemption. A narrower B2C flow
without account self-service lands nearer 19. B2B adds 12 company mutations.

Each is two lines. You write the ones you use, not all 49.

You also give up React Query for customer data. Optimistic updates become
`useOptimistic` plus Server Actions.

### Importing `/bff` from a Client Component fails the build

The entry reads session cookies and handles refresh tokens, so its `exports` map
resolves to a throwing file outside the server graph. The error arrives at build
time, not in your editor: TypeScript does not understand the `react-server`
condition, so `types` resolves unconditionally to keep `tsc` correct in server
files.
````

- [ ] **Step 2: Update the subpath export paragraph**

Replace the `## Subpath exports` body with:

```markdown
`.` (client, session, tags), `./webhook` (verification, route factory),
`./proxy` (`emporixSiteProxy`), `./service` (`getEmporixServiceClient`),
`./bff` (server-first mode) and `./catalog-client` (the browser half of the
catalog proxy).

The split keeps a Route Handler from pulling in `next/headers` — and a `proxy.ts`
cannot pull it in at all. `./service` and `./bff` carry secrets, and their export
conditions make a client-side import a build error. `./catalog-client` is the one
entry that ships `"use client"`.
```

- [ ] **Step 3: Write the changeset**

Create `.changeset/next-server-first-mode.md`:

````markdown
---
"@viu/emporix-sdk-next": minor
---

New server-first mode: a Next storefront can now hold **no Emporix token in the
browser**, not even an anonymous one.

Every Emporix call needs a bearer token where the call originates, so this works
the only way it can — by moving the calls, not by hiding the tokens. Server
Components read, Server Actions write, and a narrow proxy serves the public
catalog. `@viu/emporix-sdk-react` is unchanged and remains the SPA path.

New entry `@viu/emporix-sdk-next/bff`:

- `withEmporixSession` / `withEmporixSessionMutable` — bind the request's session
  and branch on it, so a Server Action is two lines. The branch matters: Emporix
  maps the anonymous token's `session-id` onto the cart at creation, so the guest
  path builds a **per-request** client with a per-guest httpOnly anonymous
  session, while the customer path reuses the memoized untagged client. Neither
  can be tagged.
- `emporixLogin` / `emporixLogout` / `emporixRefresh` — manage the session in
  httpOnly cookies. `emporixLogin` returns `void`: there is no token to
  serialize. It threads the guest's anonymous token so the cart survives login.
- `emporixTokenProxy` — the single token-rotation point, because a Server
  Component cannot write cookies and an unpersisted rotation is worthless. It
  delegates site and language to `emporixSiteProxy`.
- `assertSameOrigin` — rejects cross-site requests, and rejects a request
  carrying neither `Sec-Fetch-Site` nor `Origin`, since accepting those would
  make omitting the header the bypass. Use it in your own Route Handlers too;
  Server Actions already get Next's origin check.
- `createEmporixCatalogRoute` — a catch-all for public catalog reads whose
  allowlist is the existing `emporixTagsForUrl`. Cart, order, customer and token
  endpoints get a 403.

New entry `@viu/emporix-sdk-next/catalog-client` (the package's first
`"use client"` entry): `createProxyTokenProvider` and `createProxyFetch` let the
browser use the React catalog hooks with no token at all. The token provider
makes no network call — that is the mechanism, because the SDK's default provider
fetches over the global `fetch`, which a rewriting `fetch` cannot intercept.

All secrets are `httpOnly` in this mode, including the `saasToken`, because
checkout runs server-side. `secure` is derived from the forwarded protocol rather
than hard-coded, and the cookies have bounded lifetimes — 8 h for the access
token, 30 d for the refresh token.

**The cost:** measured against `examples/storefront-demo` (17 routes, 41 hooks), a
complete storefront writes about **25 Server Actions**, two lines each — a
narrower B2C flow without account self-service lands nearer 19. And you give up
React Query for customer data in favour of `useOptimistic`.
````

- [ ] **Step 4: Verify the changeset is picked up**

```bash
pnpm changeset status
```

Expected: `@viu/emporix-sdk-next` listed for a minor bump.

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add packages/next/README.md .changeset/next-server-first-mode.md
git commit -m "docs(repo): document the server-first mode" -m "The two helpers, the three auth functions, rotation in the proxy, the catalog
proxy, and the honest cost: about 25 Server Actions for a complete storefront and
no React Query for customer data."
git push origin feat/next-bff-mode
```

```bash
gh pr create --base main --title "feat(repo): add a server-first mode with no token in the browser" --body "$(cat <<'BODY'
Closes F-01 from the session security review for Next storefronts.
`@viu/emporix-sdk-react` is untouched and remains the SPA path.

## Why it looks like this

Every Emporix call needs a bearer token where the call originates
(`http.ts:86`). So "no token in the browser" is equivalent to "the browser makes
no Emporix calls". There is no third option, and the mode follows from that.

Two alternatives were ruled out by measurement, not preference:

- **Catch-all proxy with a sentinel token.** Token acquisition bypasses the
  injectable `fetch` (`auth.ts:252` uses the global one), so an anonymous token
  lands in the browser anyway. SSE bypasses it too (`http.ts:321`).
- **Changing the SDK so token requests use the injectable fetch.** That reverses
  the documented property that token responses are structurally uncacheable, and
  still leaves every proxy drawback.

## What ships

| Export | Purpose |
|---|---|
| `withEmporixSession` / `…Mutable` | bind the request's session, branch guest vs customer |
| `emporixLogin` / `emporixLogout` / `emporixRefresh` | httpOnly cookie management |
| `emporixTokenProxy` | the single rotation point |
| `assertSameOrigin` | CSRF layer, also exported for your own routes |
| `createEmporixCatalogRoute` | public catalog proxy, allowlist = `emporixTagsForUrl` |
| `createProxyTokenProvider` / `createProxyFetch` | client half, no network call |

## The two facts that shaped it

**Emporix binds the guest cart to the anonymous session** — confirmed for the
`viu` tenant: the `session-id` is mapped onto the cart at creation. So guests
cannot share an anonymous session, and `getEmporixClient()` is memoized per
process. The guest path therefore builds a client per request. Without this the
design would have silently given two guests the same cart.

**`emporixTagsForUrl` is already the allowlist.** It returns `[]` for "a
different tenant, a non-catalog service, a personalized resource" — exactly the
public/private boundary a proxy needs. No second allowlist was written.

## Verification

`packages/next` goes 95 → 145 tests. The single most important one asserts that
`createProxyTokenProvider` makes **no network call**: everything else in this
mode is structure, that is the measurement behind "no token in the browser".

Plus `examples/next-server-first`, a six-page demo run against `next start`:
catalog rendered server-side, no secret cookie on a plain visit, the catalog
proxy answering `200` for a product URL and `403` for a cart URL, a guest cart
surviving reloads, and a `/debug` page that renders `document.cookie` and turns
green only when no secret is reachable from JavaScript. Two of those six can only
be answered by a real runtime.

Six guards passed first try and were mutation-tested: swapping the guest client
for the memoized one fails exactly the shared-session test; injecting a `fetch`
fails exactly the untagged test; dropping the read-only check fails exactly the
render-write test; accepting a missing Origin fails exactly the CSRF test;
treating a malformed JWT as valid fails exactly the fail-safe test; deleting the
catalog allowlist fails exactly the four 403 tests.

## The cost, stated plainly

Measured against `examples/storefront-demo` — 17 routes, 41 distinct hooks — a
complete storefront writes about **25 Server Actions**, two lines each. A
narrower B2C flow without account self-service lands nearer 19. You also give up
React Query for customer data in favour of `useOptimistic`. That is a change in
how a storefront is built, not just an API addition.

F-01 stays open for the SPA path, where it is structurally unfixable.

## One requirement knowingly left unproven

Whether a guest cart **read** in a Server Component works twice in a row. The
read-only cookie jar cannot persist a rotated anonymous session, so if Emporix
invalidates the old anonymous refresh token on use, the second load fails. The
example's check 5 tests exactly that, and the plan names both outcomes and the
two fixes rather than assuming a pass. If it fails, `/cart` becomes a Server
Action fetch or the proxy starts caching a short-lived anonymous access token.

Spec: `docs/superpowers/specs/2026-07-31-next-server-first-mode-design.md`
Plan: `docs/superpowers/plans/2026-07-31-next-server-first-mode.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 6: Wait for the checks**

```bash
gh pr checks --watch
```

Expected: all 7 green. Do **not** merge — that is the user's call.

If `PR Check` and `Changeset Check` never appear, that is the dispatch problem
seen on PR #194: no run is created at all while CodeQL runs fine. Diagnose with
`gh api "repos/viuteam/emporix-sdk/actions/runs?event=pull_request"` before
re-triggering.

---

## Self-Review

**1. Spec coverage**

| Spec requirement | Task |
|---|---|
| Auth server functions in a guarded entry | Task 2; guard in Task 4 Steps 5, 8 |
| `assertSameOrigin` exported (closes F-07) | Task 2 |
| Token rotation only in the proxy | Task 3 |
| `withEmporixSession` + `…Mutable` | Task 1 |
| Guest path: per-request client, per-guest anonymous session | Task 1 Step 4, test `builds a DIFFERENT client per call`, mutation A |
| Customer path: memoized untagged client | Task 1, tests 2-3 |
| Never tagged | Task 1 tests, mutation B |
| Catalog proxy with `emporixTagsForUrl` as allowlist | Task 4 Step 3, mutation in Step 11 |
| `createProxyTokenProvider` makes no network call | Task 4 Step 1 test |
| Cookie contract: all secrets httpOnly | Task 1 Step 3, Task 2 tests |
| `secure` derived, not hard-coded (F-05) | Task 1 Step 3, two tests |
| Bounded lifetimes (F-02) | Task 1 Step 3 `BFF_MAX_AGE` |
| CSRF: lax + POST-only + origin check in the factory | Task 2, Task 4 Step 3 |
| First client entry with banner + `check:dist` | Task 4 Steps 6-8, 10 |
| No change to react or the SDK | Global Constraints; no task touches either |
| No new dependency | Global Constraints |
| README + changeset | Task 6 |
| The Server-Actions cost stated | Task 6 README and changeset |
| End-to-end verification against a running server | Task 5, six live checks |

The spec's non-goal "no example migration" is **superseded**: Task 5 adds
`examples/next-server-first`, so the mode is exercised end to end against a
running server the way the proxy and service cycles were. Six live checks, of
which two can only be answered by a real runtime — the catalog proxy's 403
against an actual cart URL, and whether a guest cart read survives a second
reload.

`examples/storefront-demo` could not have filled that role. It is a Vite +
React Router SPA (`react-router-dom`, no Next), so it cannot exercise
`emporixTokenProxy`, `withEmporixSession` or the catalog route — none of them
exist outside a Next runtime. What it does provide is the acceptance checklist
for a *complete* storefront: 17 routes and 41 distinct hooks, measured rather
than estimated. Task 5 deliberately covers the basics instead.

One requirement is knowingly unproven rather than covered: whether a guest cart
**read** in a Server Component works twice in a row. The read-only cookie jar
cannot persist a rotated anonymous session. Task 5 Step 8 check 5 tests it, and
the task states both outcomes and the two fixes rather than assuming it passes.

**2. Placeholder scan**

No `TBD`, no `TODO`, no "add error handling", no "similar to Task N". Every code
step carries the code; every verification step carries the command and the
expected output.

**3. Type consistency**

`withEmporixSession`, `withEmporixSessionMutable`, `WithEmporixSessionOptions`,
`emporixLogin`, `emporixLogout`, `emporixRefresh`, `assertSameOrigin`,
`emporixTokenProxy`, `EmporixTokenProxyOptions`, `createEmporixCatalogRoute`,
`createProxyTokenProvider`, `createProxyFetch`, `bffCookieJar`, `BffCookieJar`
and `BFF_MAX_AGE` are spelled identically in every interface block,
implementation, test, barrel, README, changeset and PR body. `STORAGE_KEYS` keys
match `packages/react/src/storage/keys.ts`. The guard filename
`bff-is-server-only.js` is identical in the `exports` map, `files`, the created
file and the pack check.

Test-count arithmetic, derived: 95 baseline + 13 + 16 + 9 + 12 = **145**.

## Follow-ups

1. **A full server-first storefront, beyond the basics.** Task 5 covers six
   pages. `examples/storefront-demo` is the checklist for a complete one: 17
   routes (`/`, `/search`, `/category/:id`, `/product/:idOrCode`, `/cart`,
   `/checkout`, `/account` plus profile, addresses, orders, order detail,
   returns, rewards, lists, `/reset-password`) and 41 distinct SDK-React hooks.
   Porting that list is a rewrite of 17 routes — precisely the "different way of
   building a storefront" cost the spec names, now quantified rather than
   asserted. Its own project, and only worth doing once a real storefront needs
   it.
2. **`maxAge` values are the package's choice, not a product decision yet.** 8 h
   for the access token, 30 d for the refresh token. Both overridable is not yet
   implemented — currently they are constants in `BFF_MAX_AGE`.
3. **F-03 (no tenant namespace in cookie names) and F-04's full consolidation**
   across all three write paths remain open, as the spec records.
