# Server-Side Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The session values move into a store the consumer provides; what stays
in the cookie is an opaque `sid`. That is what makes revoking a **single**
session possible.

**Architecture:** The store is an *implementation* of `SessionCookieJar`, not a
second code path. `sessionCookieJar()` hydrates the record once (async), returns
a synchronous jar on top of it, and the four callers flush once. Above the jar
nothing changes.

**Tech Stack:** `node:crypto` for the `sid`, `redis` (node-redis) **only** in the
example, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-server-side-sessions-design.md`

## Global Constraints

- **Branch:** `feat/session-store`, already branched off `main` (contains the
  merged PR #197). The spec is already on it.
- **Push:** `git push origin feat/session-store` over SSH. The gh token is
  rejected for Git operations over HTTPS.
- **Commitlint:** scope out of `repo, release, sdk, react, core, customer, product,
  category, cart, checkout, payment, price, media, segment, availability, auth,
  http, logger, deps, docs, examples`. No `next` scope — take `repo`. The first
  word after the scope is a **lowercase verb**.
- **The package keeps zero runtime dependencies.** It defines the interface, not
  an implementation. `redis` goes into `examples/next-server-first`.
- **No signature becomes async that is not already.**
  `AnonymousSessionStore` is synchronous and is called in the middle of the token refresh
  ([core/auth.ts:42-45](../../../packages/sdk/src/core/auth.ts#L42)).
- **The cookie mode stays untouched.** Without `store`, everything has to behave
  the way it does today, encryption and the `__Host-` prefix included. A test
  holds that down.
- **`exactOptionalPropertyTypes` is on.** An optional field either gets a value
  or does not exist.
- **Swiss Standard German in prose, no sharp S.** Code and comments in
  English. *(Superseded 2026-08-05: everything committed is English — see `CLAUDE.md`. Kept as the record of the constraint that applied when this plan was written.)*
- **Redis runs in Podman on 6379**, verified with `+PONG`.

---

### Task S1: Interface, `sid` and the store jar

**Files:**
- Create: `packages/next/src/session-store.ts`
- Modify: `packages/next/src/session-cookies.ts:83-105`
- Test: `packages/next/tests/session-store.test.ts` (new)

**Interfaces:**
- Consumes: `cookieName`, `readCookie` from `./cookie-name`.
- Produces:
  - `EmporixSessionStore` — `read`/`write`/`destroy`
  - `SESSION_SID` = `"emporix.sid"`
  - `SESSION_GUEST_MAX` = `7 * 24 * 60 * 60`
  - `hydrateStoreJar(store, secure, readOnly)` →
    `Promise<{ jar: SessionCookieJar; flush: () => Promise<void> }>`

- [ ] **Step 1: Write the test file**

Create `packages/next/tests/session-store.test.ts`:

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

const { sessionCookieJar } = await import("../src/session-cookies");
const { SESSION_SID } = await import("../src/session-store");
import type { EmporixSessionStore } from "../src/session-store";

/** A Map-backed store. Deliberately not exported from the package — a consumer
 *  who needs one for their own tests can write these fifteen lines. */
function fakeStore(): EmporixSessionStore & {
  records: Map<string, { record: Record<string, string>; ttl: number }>;
  reads: number;
} {
  const records = new Map<string, { record: Record<string, string>; ttl: number }>();
  const self = {
    records,
    reads: 0,
    read: async (id: string) => {
      self.reads += 1;
      return records.get(id)?.record ?? null;
    },
    write: async (id: string, record: Record<string, string>, ttl: number) => {
      records.set(id, { record: { ...record }, ttl });
    },
    destroy: async (id: string) => {
      records.delete(id);
    },
  };
  return self;
}

beforeEach(() => {
  bag.clear();
  headerBag.clear();
  headerBag.set("x-forwarded-proto", "https");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cookie mode is untouched", () => {
  it("writes values into cookies when no store is configured", async () => {
    const j = await sessionCookieJar();
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(bag.get("__Host-emporix.customerToken")?.value).toBe("tok-1");
    expect(bag.get("__Host-emporix.sid")).toBeUndefined();
  });
});

describe("store mode", () => {
  it("puts only the sid in a cookie, never the token", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    const sid = bag.get(`__Host-${SESSION_SID}`);
    expect(sid).toBeDefined();
    expect(bag.get("__Host-emporix.customerToken")).toBeUndefined();
    for (const c of bag.values()) expect(c.value).not.toContain("tok-1");
  });

  it("marks the sid httpOnly", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(bag.get(`__Host-${SESSION_SID}`)?.opts).toMatchObject({ httpOnly: true });
  });

  it("reads a value back on a second request with the same sid", async () => {
    const store = fakeStore();
    const first = await sessionCookieJar({ store });
    first.set("emporix.customerToken", "tok-1", 3600);
    await first.flush();

    const second = await sessionCookieJar({ store });
    expect(second.get("emporix.customerToken")).toBe("tok-1");
  });

  it("treats an unknown sid as an empty session, not an error", async () => {
    const store = fakeStore();
    bag.set(`__Host-${SESSION_SID}`, { name: `__Host-${SESSION_SID}`, value: "never-existed" });
    const j = await sessionCookieJar({ store });
    expect(j.get("emporix.customerToken")).toBeNull();
  });

  it("survives a store whose read throws", async () => {
    // A Redis outage must degrade to «logged out», not to a 500 on every page.
    const store = fakeStore();
    store.read = async () => {
      throw new Error("connection refused");
    };
    bag.set(`__Host-${SESSION_SID}`, { name: `__Host-${SESSION_SID}`, value: "some-id" });
    const j = await sessionCookieJar({ store });
    expect(j.get("emporix.customerToken")).toBeNull();
  });

  it("keeps siteCode a cookie even in store mode", async () => {
    // The site proxy writes it browser-readable on purpose.
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    j.set("emporix.siteCode", "main", 3600);
    await j.flush();
    expect(bag.get("__Host-emporix.siteCode")?.value).toBe("main");
    expect(store.records.size).toBe(0);
  });

  it("does not write in the read-only variant", async () => {
    // Next forbids a cookie write during render, but nothing stops a store
    // write — the mistake would be invisible and would move real state.
    const store = fakeStore();
    const j = await sessionCookieJar({ store, readOnly: true });
    j.set("emporix.customerToken", "tok-1", 3600);
    await j.flush();
    expect(store.records.size).toBe(0);
  });

  it("deletes a value from the record", async () => {
    const store = fakeStore();
    const first = await sessionCookieJar({ store });
    first.set("emporix.customerToken", "tok-1", 3600);
    await first.flush();

    const second = await sessionCookieJar({ store });
    second.delete("emporix.customerToken");
    await second.flush();

    const third = await sessionCookieJar({ store });
    expect(third.get("emporix.customerToken")).toBeNull();
  });

  it("does not touch the store when nothing changed", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    await j.flush();
    expect(store.records.size).toBe(0);
  });
});

describe("lifetimes", () => {
  it("gives a guest session the sliding guest window", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    j.set("emporix.anonymousSession", '{"refreshToken":"r","sessionId":"s"}', 3600);
    await j.flush();
    const [entry] = [...store.records.values()];
    expect(entry?.ttl).toBe(7 * 24 * 60 * 60);
  });

  it("gives a customer session the time left until the ceiling", async () => {
    const store = fakeStore();
    const j = await sessionCookieJar({ store });
    const tenDaysAgo = Math.floor(Date.now() / 1000) - 10 * 24 * 60 * 60;
    j.set("emporix.customerToken", "tok-1", 3600);
    j.set("emporix.sessionStartedAt", String(tenDaysAgo), 3600);
    await j.flush();
    const [entry] = [...store.records.values()];
    // 90 days minus the 10 already spent, give or take a second of test runtime.
    expect(entry?.ttl).toBeGreaterThan(79 * 24 * 60 * 60);
    expect(entry?.ttl).toBeLessThanOrEqual(80 * 24 * 60 * 60);
  });
});
```

- [ ] **Step 2: Test run — must fail**

```bash
pnpm -F @viu/emporix-sdk-next test -- session-store
```

Expectation: the import of `../src/session-store` fails. Note the test count
**before** this task.

- [ ] **Step 3: Write the store module**

Create `packages/next/src/session-store.ts`:

```ts
import { randomBytes } from "node:crypto";
import { STORAGE_KEYS } from "@viu/emporix-sdk-react/ssr";
import { SESSION_ABSOLUTE_MAX, SESSION_STARTED_AT } from "./session-cookies";

/**
 * A place to keep session values so the browser never holds them.
 *
 * The package ships no implementation on purpose — that is what keeps it at zero
 * runtime dependencies. `examples/next-server-first` has a Redis one to copy.
 *
 * Three methods, because a fourth would be something to get wrong. `write`
 * REPLACES the record rather than merging: a merge needs conflict rules for two
 * concurrent requests, and last-writer-wins is the right semantics for session
 * state anyway.
 */
export interface EmporixSessionStore {
  /** The record, or `null` when the id is unknown or expired. */
  read(id: string): Promise<Record<string, string> | null>;
  /** Replaces the record and sets its expiry. */
  write(id: string, record: Record<string, string>, ttlSeconds: number): Promise<void>;
  /** Removes the record. Must not throw when the id is unknown. */
  destroy(id: string): Promise<void>;
}

/** The only session cookie in store mode. */
export const SESSION_SID = "emporix.sid";

/**
 * How long a guest session lives, sliding.
 *
 * An anonymous session guards no account, so there is no reason for a hard
 * ceiling. What bounds the guest experience is Emporix's refresh token, not
 * this: the anonymous access token is valid for one hour and is renewed from
 * the refresh token.
 *
 * Seven rather than the thirty days the cookie mode uses, because in store mode
 * every visitor costs a key. With bot traffic that is a real operational line
 * item and this is the cheapest lever against it.
 */
export const SESSION_GUEST_MAX = 7 * 24 * 60 * 60;

/** Values that stay cookies even in store mode: the site proxy writes them
 *  browser-readable on purpose, and moving them would break a client-side
 *  language switch. */
const PUBLIC_KEYS: readonly string[] = [STORAGE_KEYS.siteCode, STORAGE_KEYS.language];

export function isPublicSessionKey(name: string): boolean {
  return PUBLIC_KEYS.includes(name);
}

/** 32 random bytes. Not encrypted: sealing a random id buys nothing, because it
 *  already means nothing without the store. */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The remaining lifetime for a record, in seconds.
 *
 * The TTL is time-remaining rather than a fixed window, so the key dies exactly
 * when the session does and a sliding TTL cannot outlive a non-sliding ceiling.
 */
export function recordTtl(record: Record<string, string>): number {
  const hasCustomer = record[STORAGE_KEYS.customerToken] !== undefined;
  if (!hasCustomer) return SESSION_GUEST_MAX;
  const startedAt = Number(record[SESSION_STARTED_AT]);
  if (!Number.isFinite(startedAt)) return SESSION_ABSOLUTE_MAX;
  const spent = Math.floor(Date.now() / 1000) - startedAt;
  return Math.max(1, SESSION_ABSOLUTE_MAX - spent);
}
```

`Number(undefined)` is `NaN`, which is why `Number.isFinite` is enough here — unlike
with `jar.get()`, which returns `null`, where `Number(null)` yields **0**. That
difference has already caused a bug once during the hardening work.

- [ ] **Step 4: Extend the jar with the store**

In `packages/next/src/session-cookies.ts`, add `flush` to `SessionCookieJar`
and rework `sessionCookieJar`.

First the interface:

```ts
export interface SessionCookieJar {
  get(name: string): string | null;
  /** No-op when the jar is read-only (a Server Component render). */
  set(name: string, value: string, maxAgeSeconds: number): void;
  /** No-op when the jar is read-only. */
  delete(name: string): void;
  /**
   * Persists a store-backed session. A no-op in cookie mode, where `set` has
   * already written through.
   *
   * Must be awaited by every mutating entry point. The read-only variant never
   * needs it, which halves the places that could forget.
   */
  flush(): Promise<void>;
  /** Drops the whole session, store record included. */
  destroy(): Promise<void>;
}
```

Then the function:

```ts
export async function sessionCookieJar(
  opts: { readOnly?: boolean; store?: EmporixSessionStore } = {},
): Promise<SessionCookieJar> {
  const jar = await cookies();
  const readOnly = opts.readOnly ?? false;
  const secure = await isSecure();
  const store = opts.store;

  const cookieGet = (name: string): string | null =>
    readCookie(name, (wire) => jar.get(wire)?.value);
  const cookieSet = (name: string, value: string, maxAgeSeconds: number): void => {
    jar.set(cookieName(name, secure), sealCookie(name, value), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: maxAgeSeconds,
    });
  };

  if (store === undefined) {
    return {
      get: cookieGet,
      set: (name, value, maxAgeSeconds) => {
        if (readOnly) return;
        cookieSet(name, value, maxAgeSeconds);
      },
      delete: (name) => {
        if (readOnly) return;
        jar.delete(cookieName(name, secure));
      },
      flush: async () => {},
      destroy: async () => {},
    };
  }

  // Store mode: hydrate once, mutate in memory, flush once. This is what lets a
  // synchronous jar sit on top of an async store — and AnonymousSessionStore
  // (sdk core/auth.ts:42) leaves no choice, it is declared synchronous.
  const sid = cookieGet(SESSION_SID);
  let record: Record<string, string> = {};
  if (sid !== null) {
    try {
      record = (await store.read(sid)) ?? {};
    } catch {
      // A store outage degrades to «logged out», not to a 500 on every page.
      record = {};
    }
  }
  let dirty = false;

  return {
    get: (name) => (isPublicSessionKey(name) ? cookieGet(name) : (record[name] ?? null)),
    set: (name, value, maxAgeSeconds) => {
      if (readOnly) return;
      if (isPublicSessionKey(name)) {
        cookieSet(name, value, maxAgeSeconds);
        return;
      }
      record[name] = value;
      dirty = true;
    },
    delete: (name) => {
      if (readOnly) return;
      if (isPublicSessionKey(name)) {
        jar.delete(cookieName(name, secure));
        return;
      }
      if (record[name] !== undefined) {
        delete record[name];
        dirty = true;
      }
    },
    flush: async () => {
      if (readOnly || !dirty) return;
      const id = sid ?? newSessionId();
      const ttl = recordTtl(record);
      await store.write(id, record, ttl);
      cookieSet(SESSION_SID, id, ttl);
      dirty = false;
    },
    destroy: async () => {
      if (readOnly) return;
      if (sid !== null) await store.destroy(sid);
      jar.delete(cookieName(SESSION_SID, secure));
      record = {};
      dirty = false;
    },
  };
}
```

Add the imports at the top:

```ts
import {
  isPublicSessionKey,
  newSessionId,
  recordTtl,
  SESSION_SID,
  type EmporixSessionStore,
} from "./session-store";
```

**Watch out for a cycle:** `session-store.ts` imports `SESSION_ABSOLUTE_MAX` and
`SESSION_STARTED_AT` from `session-cookies.ts`, and `session-cookies.ts`
imports functions back. Those are pure constants in one direction and
functions in the other, ESM resolves that — but if the build does
complain, the two constants move into `session-store.ts` and
`session-cookies.ts` re-exports them. Do **not** resolve it with a third file
before the cycle actually gets in the way.

- [ ] **Step 5: Test run — must pass**

```bash
pnpm -F @viu/emporix-sdk-next test -- session-store
```

Expectation: 12 tests green. The other suites do not run yet, because `flush`
is new in the interface — that is Step 6.

- [ ] **Step 6: Make the four callers flush**

`pnpm -F @viu/emporix-sdk-next typecheck` now shows where `flush` is missing. In
`session-auth.ts`:

- `emporixLogin`: after `jar.delete(STORAGE_KEYS.anonymousSession);` an
  `await jar.flush();`
- `emporixRefresh`: after `persistSession(jar, session);` an
  `await jar.flush();` — **and** in the ceiling branch after `clearSession(jar)` an
  `await jar.destroy();`
- `emporixLogout`: after `clearSession(jar);` an `await jar.destroy();`

In `session-client.ts`, `run()`: the mutable variant has to flush after `fn`.
That needs a small rearrangement, because `run` today does `return fn(...)` directly:

```ts
  const result = await fn(client, auth.anonymous());
  if (!readOnly) await jar.flush();
  return result;
```

— at **both** return sites, the customer branch and the guest branch.

- [ ] **Step 7: Full suite and typecheck**

```bash
pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck
```

Expectation: everything green. If existing tests break because they build a jar
themselves and `flush` is missing: adjust the test, do not make the interface
optional — an optional `flush` is exactly the spot somebody forgets.

- [ ] **Step 8: Mutation testing**

Three mutations, one at a time, each one reverted afterwards:

1. In `flush`, remove the `if (readOnly …) return;` → «does not write in the
   read-only variant» **must** go red. That is the most valuable test in the
   task: Next prevents cookie writes during render, but not a store write.
2. Make `isPublicSessionKey` always return `false` → «keeps siteCode a
   cookie even in store mode» **must** go red.
3. In `recordTtl`, replace the time-remaining calculation with `SESSION_ABSOLUTE_MAX` →
   «gives a customer session the time left until the ceiling» **must** go
   red.

- [ ] **Step 9: Commit**

```bash
git add packages/next/src packages/next/tests && git commit -m "feat(repo): add a session store adapter behind the cookie jar"
```

---

### Task S2: The three readers and the entry

**Files:**
- Modify: `packages/next/src/session-client.ts:11-25` (options)
- Modify: `packages/next/src/token-proxy.ts:50-80`
- Modify: `packages/next/src/server-session.ts:51-97`
- Modify: `packages/next/src/session.ts` (export)
- Test: `packages/next/tests/session-store.test.ts` (extend)

**Interfaces:**
- Consumes: everything from S1.
- Produces:
  - `store?: EmporixSessionStore` in `WithEmporixSessionOptions`
  - `store?` in `EmporixTokenProxyOptions` and in the options of
    `emporixSession` / `emporixSessionMutable`
  - `EmporixSessionStore` and `SESSION_SID` from `@viu/emporix-sdk-next/session`

- [ ] **Step 1: The option in `WithEmporixSessionOptions`**

```ts
  /**
   * Keeps session values server-side instead of in cookies. Without it the
   * values live in cookies, which still works — see the README.
   */
  store?: EmporixSessionStore;
```

And pass it through in `run()`:

```ts
  const jar = await sessionCookieJar({
    readOnly,
    ...(opts.store !== undefined ? { store: opts.store } : {}),
  });
```

The `...(x !== undefined ? …)` is needed because of `exactOptionalPropertyTypes`, not
a question of style.

- [ ] **Step 2: `emporixTokenProxy`**

The proxy reads `request.cookies` directly today. In store mode all that sits
there is a `sid`, so it needs the store. It cannot use `sessionCookieJar()`,
because `cookies()` does not exist inside a proxy — it reads the `sid`
itself and then goes to the store.

`EmporixTokenProxyOptions` gets `store?: EmporixSessionStore`, and the block
from `const read = …` onwards becomes:

```ts
  const read = (wire: string): string | undefined => request.cookies.get(wire)?.value;
  let token: string | null;
  let expiryRaw: string | null;
  if (opts.store !== undefined) {
    const sid = readCookie(SESSION_SID, read);
    const record = sid === null ? null : await opts.store.read(sid).catch(() => null);
    token = record?.[STORAGE_KEYS.customerToken] ?? null;
    expiryRaw = record?.[SESSION_EXPIRES_AT] ?? null;
  } else {
    token = readCookie(STORAGE_KEYS.customerToken, read);
    expiryRaw = readCookie(SESSION_EXPIRES_AT, read);
  }
```

And in the `stale` branch: the cookie write of the fresh token falls away in
store mode, because `emporixRefresh` has already written into the store and the
render that follows reads from there:

```ts
      const fresh = await emporixRefresh(refreshOpts);
      if (fresh !== null && opts.store === undefined) {
        // Cookie mode only: make the fresh token visible to THIS render. In
        // store mode emporixRefresh already wrote the record, and the render
        // reads the record — there is nothing to inject.
        request.cookies.set(tokenCookie, sealCookie(STORAGE_KEYS.customerToken, fresh));
      }
```

`emporixRefresh` needs the store as well, otherwise the proxy refreshes against
cookies:

```ts
  const refreshOpts: WithEmporixSessionOptions =
    opts.store !== undefined ? { store: opts.store } : {};
```

- [ ] **Step 3: `emporixSession` and `emporixSessionMutable`**

Both build a `ServerCookieJar` shim on top of `cookies()`. In store mode the
shim has to go through the session jar.

`emporixSession` gets an optional parameter:

```ts
export async function emporixSession(
  opts: { store?: EmporixSessionStore } = {},
): Promise<EmporixServerSession> {
  const sessionJar = await sessionCookieJar({
    readOnly: true,
    ...(opts.store !== undefined ? { store: opts.store } : {}),
  });
  const io: ServerCookieJar = { get: (name) => sessionJar.get(name) };
  return build(createServerStorage(io));
}
```

That is a simplification at the same time: the separate `readCookie` wiring
falls away, because the jar already does it.

`emporixSessionMutable` likewise, plus `store` in its options object and an
`await sessionJar.flush()` **after** the build — the ordering is tricky
here, because `createServerStorage` writes synchronously. So the shim collects in
the jar, and the caller gets the session back before the flush happened. Hence:

```ts
  // The storage writes synchronously into the jar; the flush has to happen
  // after the caller is done with it. Returning a `flush` on the session is the
  // honest shape — a silent write-behind would be a lie about when state lands.
  return { ...build(createServerStorage(io)), flush: () => sessionJar.flush() };
```

`EmporixServerSession` gets `flush: () => Promise<void>` for that. In the
read-only variant it is a no-op, so that both have the same shape.

- [ ] **Step 4: Export it from the entry**

In `packages/next/src/session.ts`:

```ts
export {
  SESSION_GUEST_MAX,
  SESSION_SID,
  type EmporixSessionStore,
} from "./session-store";
```

- [ ] **Step 5: Tests for the three readers**

Append to `session-store.test.ts` — `emporixSession` and `withEmporixSession`
against the fake store, plus the proxy:

```ts
describe("all three readers see the store", () => {
  it("emporixSession reads the session out of the store", async () => {
    const store = fakeStore();
    const seed = await sessionCookieJar({ store });
    seed.set("emporix.customerToken", "tok-1", 3600);
    seed.set("emporix.cartId", "cart-1", 3600);
    await seed.flush();

    const { emporixSession } = await import("../src/server-session");
    const session = await emporixSession({ store });
    expect(session.customerToken).toBe("tok-1");
    expect(session.cartId).toBe("cart-1");
  });

  it("withEmporixSession resolves a customer context from the store", async () => {
    const store = fakeStore();
    const seed = await sessionCookieJar({ store });
    seed.set("emporix.customerToken", "tok-1", 3600);
    await seed.flush();

    process.env.EMPORIX_TENANT = "viu";
    process.env.EMPORIX_STOREFRONT_CLIENT_ID = "sf";
    const { withEmporixSession } = await import("../src/session-client");
    const ctx = await withEmporixSession(async (_c, c) => c, { store });
    expect(ctx).toEqual({ kind: "customer", token: "tok-1" });
    delete process.env.EMPORIX_TENANT;
    delete process.env.EMPORIX_STOREFRONT_CLIENT_ID;
  });
});
```

For the proxy, add a test in `token-proxy.test.ts` that shows that with a
`store` it does **not** read from the cookie:

```ts
  it("reads the token from the store when one is configured", async () => {
    const records = new Map([["sid-1", { [TOKEN]: OPAQUE, [EXPIRES]: expiresIn(30) }]]);
    const store = {
      read: async (id: string) => records.get(id) ?? null,
      write: async () => {},
      destroy: async () => {},
    };
    const request = new NextRequest("https://shop.test/", {
      headers: { cookie: `__Host-emporix.sid=sid-1` },
    });
    await emporixTokenProxy(request, { store });
    // The expiry in the record is inside the skew window, so it refreshed —
    // which proves it read the record, since the cookie holds no token at all.
    expect(refreshCalls).toHaveLength(1);
  });
```

- [ ] **Step 6: Full suite, typecheck, lint**

```bash
pnpm -F @viu/emporix-sdk-next test && pnpm -F @viu/emporix-sdk-next typecheck && pnpm -F @viu/emporix-sdk-next lint
```

- [ ] **Step 7: Mutation testing**

In `emporixTokenProxy`, remove the store branch so that it always reads from
cookies → «reads the token from the store when one is configured» **must** go
red. Without this mutation the test proves nothing, because a
`refreshCalls` counter stays at zero for a missing token too — it could be
green for the wrong reason.

- [ ] **Step 8: Commit**

```bash
git add packages/next/src packages/next/tests && git commit -m "feat(repo): thread the session store through all three readers"
```

---

### Task S3: Redis adapter in the example and live verification

**Files:**
- Create: `examples/next-server-first/app/session-store.ts`
- Modify: `examples/next-server-first/app/emporix.ts`
- Modify: `examples/next-server-first/proxy.ts`
- Modify: `examples/next-server-first/app/cart/page.tsx`, `app/checkout/page.tsx`,
  `app/actions/cart.ts`, `app/actions/checkout.ts`, `app/login/page.tsx`,
  `app/debug/page.tsx` — everywhere `EMPORIX` or `emporixSession` is used
- Modify: `examples/next-server-first/package.json` (`redis`)

**Interfaces:**
- Consumes: `EmporixSessionStore` from `@viu/emporix-sdk-next/session`.
- Produces: `sessionStore(): EmporixSessionStore | undefined`.

- [ ] **Step 1: `redis` as a dependency**

```bash
pnpm -F @viu/emporix-examples-next-server-first add redis
```

The package itself gets **nothing** — the zero-dependency promise holds.

- [ ] **Step 2: Write the adapter**

Create `examples/next-server-first/app/session-store.ts`:

```ts
import { createClient, type RedisClientType } from "redis";
import type { EmporixSessionStore } from "@viu/emporix-sdk-next/session";

const PREFIX = "emporix:session:";

let client: RedisClientType | undefined;

/**
 * Memoized like getEmporixClient. A module-level connection would leak one
 * socket per HMR reload in dev.
 */
function connection(url: string): RedisClientType {
  if (client === undefined) {
    client = createClient({ url });
    // Without this a transient error becomes an unhandled rejection that takes
    // the whole server down.
    client.on("error", (e) => console.error("[redis]", e));
  }
  return client;
}

async function ready(url: string): Promise<RedisClientType> {
  const c = connection(url);
  if (!c.isOpen) await c.connect();
  return c;
}

/**
 * A Redis-backed session store, or `undefined` when no URL is configured.
 *
 * Returning `undefined` rather than throwing is what keeps both modes
 * reachable: drop the variable and the example runs on cookies, no code change.
 */
export function sessionStore(): EmporixSessionStore | undefined {
  const url = process.env.EMPORIX_SESSION_REDIS_URL;
  if (url === undefined || url.length === 0) return undefined;
  return {
    read: async (id) => {
      const raw = await (await ready(url)).get(PREFIX + id);
      return raw === null ? null : (JSON.parse(raw) as Record<string, string>);
    },
    write: async (id, record, ttlSeconds) => {
      await (await ready(url)).set(PREFIX + id, JSON.stringify(record), { EX: ttlSeconds });
    },
    destroy: async (id) => {
      await (await ready(url)).del(PREFIX + id);
    },
  };
}
```

- [ ] **Step 3: Wire it up in `app/emporix.ts`**

```ts
import { sessionStore } from "./session-store";

const STORE = sessionStore();

export const EMPORIX: WithEmporixSessionOptions = {
  context: CONTEXT,
  ...(STORE !== undefined ? { store: STORE } : {}),
};

/** Exported separately for the proxy and for emporixSession, which take their
 *  own options rather than the full WithEmporixSessionOptions. */
export const SESSION_STORE = STORE;
```

- [ ] **Step 4: The proxy and the direct `emporixSession` calls**

`examples/next-server-first/proxy.ts`:

```ts
return emporixTokenProxy(request, {
  site: { siteCode: "main" },
  ...(SESSION_STORE !== undefined ? { store: SESSION_STORE } : {}),
});
```

There is exactly **one** `emporixSession()` call in the example, measured:
`app/login/page.tsx:5`. It gets the store passed in:

```ts
const { customerToken } = await emporixSession(
  SESSION_STORE !== undefined ? { store: SESSION_STORE } : {},
);
```

Before the rework, recount whether it is still one:

```bash
grep -rn "emporixSession(" examples/next-server-first/app
```

- [ ] **Step 5: Typecheck and build**

```bash
pnpm -F @viu/emporix-sdk-next build && pnpm -F @viu/emporix-examples-next-server-first typecheck && pnpm -F @viu/emporix-examples-next-server-first build
```

- [ ] **Step 6: Live — the cookie mode has to run unchanged**

Start without `EMPORIX_SESSION_REDIS_URL`. Fill the cart, `/cart` shows it,
`/debug` green. **That is the regression evidence** that the cookie mode
survived the work.

- [ ] **Step 7: Live — store mode against Redis**

Redis runs in Podman on 6379. Restart the server with
`EMPORIX_SESSION_REDIS_URL=redis://127.0.0.1:6379`.

1. `/cart` says **«No cart yet»** — the cookie session does not count in store mode.
2. Fill the cart, `/cart` shows it.
3. In the browser **only** `__Host-emporix.sid` and `emporix.siteCode` are set.
4. Exactly **one** key in the store:
   ```bash
   node -e "const {createClient}=require('redis');(async()=>{const c=createClient({url:'redis://127.0.0.1:6379'});await c.connect();console.log(await c.keys('emporix:session:*'));await c.quit();})()"
   ```
5. TTL at ~604800 seconds (7 days) for the guest.
6. Delete the key → `/cart` says «No cart yet» again. **That is the revocation
   of a single session, live** — the capability this whole piece of work
   exists for.
7. `/debug` stays green.

Point 6 is the real evidence. Points 1 and 3 show that nothing
secret is left in the browser.

- [ ] **Step 8: Live — logged in**

Needs the password and therefore the user's own hand. Afterwards check:

1. The key's TTL is at ~90 days instead of 7.
2. The record contains `emporix.saasToken`, the browser does not — which at the
   same time makes the open point about the `saasToken` size moot.

- [ ] **Step 9: Commit**

```bash
git add examples/next-server-first && git commit -m "feat(examples): add a redis session store to the next demo"
```

---

### Task S4: Docs, changeset and PR

**Files:**
- Modify: `packages/next/README.md`
- Modify: `examples/next-server-first/README.md`
- Modify: `docs/superpowers/specs/2026-08-03-session-cookie-hardening-design.md`
  (close the two open points)
- Create: `.changeset/next-session-store.md`

- [ ] **Step 1: Changeset**

Create `.changeset/next-session-store.md`:

```markdown
---
"@viu/emporix-sdk-next": minor
---

Session values can now live in a store you provide instead of in cookies. Pass
`store` and the browser keeps one opaque `emporix.sid`; everything else moves
server-side.

```ts
const store: EmporixSessionStore = {
  read: async (id) => …,
  write: async (id, record, ttlSeconds) => …,
  destroy: async (id) => …,
};
```

Three methods, and the package ships no implementation — that is what keeps it
at zero runtime dependencies. `examples/next-server-first` has a Redis one to
copy.

**What this buys that encrypted cookies cannot:** deleting a single session.
`emporixLogout` now destroys the record, and an operator with the id can too.

It also removes three problems rather than mitigating them: the 4 KB per-cookie
limit no longer applies to the `saasToken`, its JWT payload never reaches the
browser, and `cartId` / `activeLegalEntityId` — the values the app itself trusts
— are not in the browser to tamper with.

Lifetimes are time-remaining, so a key dies exactly when its session does:
`SESSION_ABSOLUTE_MAX` minus time spent for a customer, a sliding
`SESSION_GUEST_MAX` (7 days) for a guest. Guests get a shorter window because in
store mode every visitor costs a key.

**`EMPORIX_COOKIE_SECRET` is not applied in store mode.** Sealing a random id
buys nothing. The cookie mode keeps encryption unchanged.

**No admin API.** The store makes revocation possible; it is not shipped as a
feature. Revoking every session of one customer needs a `customerId → sid[]`
index, which your store can build from the record.
```

- [ ] **Step 2: README section in the package**

After «Session cookie hardening», a section «Server-side sessions» with: the
interface, the wiring via `store`, the table of what stays in the cookie, the
lifetimes, the sentence about `EMPORIX_COOKIE_SECRET`, and the honest paragraph
about revocation without an admin API.

Explicitly on top of that: **all three readers need the option** —
`withEmporixSession*`, `emporixTokenProxy` and `emporixSession`. Anyone who
forgets it somewhere silently gets the cookie mode there, and that is exactly the
mistake the cookie hardening has already produced once.

- [ ] **Step 3: Close the two open points of the hardening spec**

In `2026-08-03-session-cookie-hardening-design.md`, mark the open points about the
`saasToken` size and the JWT content as **moot in store mode**,
with a reference to the new spec. In cookie mode they stay open.

- [ ] **Step 4: Full suite**

```bash
pnpm -r --filter "./packages/*" build && pnpm -r test && pnpm typecheck && pnpm lint
```

Note the test count.

- [ ] **Step 5: Commit, push, PR**

```bash
git add .changeset packages/next/README.md examples/next-server-first/README.md docs && git commit -m "docs(repo): document the server-side session store"
git push origin feat/session-store
```

PR against `main`. Into the description: the three measures, what the store can do
that encryption cannot, the closed open points, the measured
test count, and the live evidence for single-session revocation.

**Do not merge.**

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Hydrate / mutate in memory / flush | S1 Step 4 |
| Four flush sites, read-only never flushes | S1 Step 6, Test 9 |
| Adapter with three methods, `write` replaces | S1 Step 3 |
| `store` in `WithEmporixSessionOptions` | S2 Step 1 |
| `emporixTokenProxy` and `emporixSession` get it | S2 Steps 2-3 |
| `emporix.sid`, 32 bytes, httpOnly, `__Host-` | S1 Step 3-4, Tests 2-3 |
| `siteCode`/`language` stay cookies | S1 Step 3, Test 8 |
| `EMPORIX_COOKIE_SECRET` not on the `sid` | S1 Step 3 (`newSessionId` without a seal), S4 Steps 1-2 |
| TTL = time remaining, guest 7 days sliding | S1 Step 3 (`recordTtl`), Tests 11-12 |
| No index, no store in the package, no merge | Non-goals, S4 Step 1 |
| Redis adapter in the example, `undefined` without a URL | S3 Steps 2-3 |
| Live checks incl. single-session revocation | S3 Steps 6-8 |

**Beyond the spec, with a reason:** the spec does not name `flush` and `destroy`
as part of the `SessionCookieJar` interface. The plan does, because otherwise there
is no place where the store write happens — and `EmporixServerSession` gets
a `flush` as well, because `createServerStorage` writes synchronously and the
caller has to decide when the state lands. A silent write-behind
would be a lie about when the write happened.

**Type consistency:** `EmporixSessionStore`, `SESSION_SID`, `SESSION_GUEST_MAX`,
`newSessionId`, `recordTtl`, `isPublicSessionKey` come into being in S1 Step 3
and are consumed in S1 Step 4, S2 and S3 with exactly these signatures.
`flush` and `destroy` come out of S1 Step 4 and are called in S1 Step 6 and
S2 Step 3.

**Three assumptions the plan marks as a check point instead of asserting:**

1. The import cycle between `session-store.ts` and `session-cookies.ts` (S1
   Step 4) — with the instruction on what to do if the build complains,
   and explicitly what **not** to do.
2. Whether existing tests break because they build a jar themselves (S1 Step 7) —
   with the instruction to adjust the test and not to make `flush` optional.
3. The number of `emporixSession()` calls in the example is **one**, measured
   (`app/login/page.tsx:5`) — with a recount command in case that changes
   before implementation.
