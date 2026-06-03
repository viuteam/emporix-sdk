# Opt-in Customer-Token Auto-Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or
> subagent-driven-development) to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, reactive (on-401) auto-refresh for the caller-managed
customer token — a single-flight refresher seam in the SDK core, wired by the
React provider — without changing the default (off) behavior.

**Architecture:** Core gains a `CustomerTokenRefresher` interface + a
single-flight `CustomerRefreshRegistry`; `HttpClient` consults it on a
`customer`-kind 401 and retries once with the returned token. `EmporixClient`
owns one registry shared by all services and exposes
`setCustomerTokenRefresher`. The React `EmporixProvider` opts in via
`autoRefreshCustomerToken` and registers a refresher backed by
`client.customers.refresh` + storage.

**Tech Stack:** TypeScript, Vitest + MSW, `@tanstack/react-query`.

**Spec:** `docs/superpowers/specs/2026-06-03-customer-token-auto-refresh-design.md`
**Branch:** `feat/customer-token-auto-refresh` (already created off `main`).

---

### Task 1: Core — `CustomerTokenRefresher` + `CustomerRefreshRegistry`

**Files:**
- Modify: `packages/sdk/src/core/auth.ts`
- Test: `packages/sdk/tests/core/customer-refresh.test.ts` (new dir `tests/core/`)

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/core/customer-refresh.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CustomerRefreshRegistry } from "../../src/core/auth";

describe("CustomerRefreshRegistry", () => {
  it("is disabled and returns null with no refresher", async () => {
    const reg = new CustomerRefreshRegistry();
    expect(reg.enabled).toBe(false);
    expect(await reg.refresh("old")).toBeNull();
  });

  it("single-flights concurrent refreshes (refresh_token rotates)", async () => {
    const reg = new CustomerRefreshRegistry();
    let calls = 0;
    let release!: (v: string) => void;
    reg.set({
      refresh: () => {
        calls += 1;
        return new Promise<string>((r) => {
          release = r;
        });
      },
    });
    const a = reg.refresh("old");
    const b = reg.refresh("old");
    release("new");
    expect(await a).toBe("new");
    expect(await b).toBe("new");
    expect(calls).toBe(1);
  });

  it("allows a new refresh after the inflight settles", async () => {
    const reg = new CustomerRefreshRegistry();
    let calls = 0;
    reg.set({
      refresh: async () => {
        calls += 1;
        return "t" + calls;
      },
    });
    expect(await reg.refresh("old")).toBe("t1");
    expect(await reg.refresh("old")).toBe("t2");
    expect(calls).toBe(2);
  });

  it("set(null) disables again", async () => {
    const reg = new CustomerRefreshRegistry();
    reg.set({ refresh: async () => "x" });
    reg.set(null);
    expect(reg.enabled).toBe(false);
    expect(await reg.refresh("old")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (not exported)

Run: `pnpm -F @viu/emporix-sdk exec vitest run customer-refresh`
Expected: FAIL — `CustomerRefreshRegistry` is not exported from `core/auth`.

- [ ] **Step 3: Implement in `core/auth.ts`**

Add the interface right after the `AuthContext` type (after line 12):

```ts
/**
 * Supplies a fresh customer token when a `customer`-kind request 401s. The host
 * (e.g. EmporixProvider) implements this; the SDK never refreshes the
 * caller-owned customer token unless a refresher is registered.
 */
export interface CustomerTokenRefresher {
  /**
   * Called on a `customer`-kind 401. Receives the token that just failed;
   * returns a fresh customer token to retry with, or `null` to give up (the
   * 401 then propagates as EmporixAuthError).
   */
  refresh(expiredToken: string): Promise<string | null>;
}
```

Add the registry after `resolveToken` (after line 92):

```ts
/**
 * Late-bindable, single-flight holder for an optional
 * {@link CustomerTokenRefresher}. Single-flight is required because Emporix
 * rotates the refresh token on each refresh — concurrent refreshes would
 * invalidate each other. Off (returns `null`) until a refresher is set.
 */
export class CustomerRefreshRegistry {
  private refresher: CustomerTokenRefresher | null = null;
  private inflight: Promise<string | null> | null = null;

  set(refresher: CustomerTokenRefresher | null): void {
    this.refresher = refresher;
  }

  get enabled(): boolean {
    return this.refresher !== null;
  }

  /** Concurrent callers share one in-flight refresh. */
  refresh(expiredToken: string): Promise<string | null> {
    if (!this.refresher) return Promise.resolve(null);
    if (this.inflight) return this.inflight;
    const p = Promise.resolve(this.refresher.refresh(expiredToken)).finally(() => {
      this.inflight = null;
    });
    this.inflight = p;
    return p;
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm -F @viu/emporix-sdk exec vitest run customer-refresh`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/auth.ts packages/sdk/tests/core/customer-refresh.test.ts
git commit -m "feat(sdk): add CustomerTokenRefresher + single-flight registry"
```

---

### Task 2: Core — wire the registry into `HttpClient` (customer-401 branch)

**Files:**
- Modify: `packages/sdk/src/core/http.ts`
- Test: `packages/sdk/tests/http-customer-refresh.test.ts`

- [ ] **Step 1: Write the failing test** (mirrors `tests/http-retry.test.ts` harness)

Create `packages/sdk/tests/http-customer-refresh.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { HttpClient } from "../src/core/http";
import { CustomerRefreshRegistry } from "../src/core/auth";
import { LevelResolver } from "../src/core/logger";
import { MemoryLogger } from "./helpers/memory-logger";
import { EmporixAuthError } from "../src/core/errors";
import type { TokenProvider } from "../src/core/auth";

const provider = {
  getToken: async () => "svc",
  getAnonymousToken: async () => ({
    accessToken: "anon", refreshToken: "r", sessionId: "s", expiresIn: 3599,
  }),
} as unknown as TokenProvider;

let seenTokens: string[] = [];
const server = setupServer(
  mhttp.get("https://api.emporix.io/cust", ({ request }) => {
    const tok = request.headers.get("authorization");
    seenTokens.push(tok ?? "");
    if (tok === "Bearer OLD") return HttpResponse.json({ e: 1 }, { status: 401 });
    return HttpResponse.json({ ok: true });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenTokens = [];
});
afterAll(() => server.close());

function client(registry?: CustomerRefreshRegistry) {
  const r = new LevelResolver({ level: "silent" });
  return new HttpClient({
    host: "https://api.emporix.io",
    provider,
    logger: new MemoryLogger(r, { service: "http" }),
    retry: { maxAttempts: 3 },
    timeouts: { connectMs: 500, readMs: 500 },
    sleep: () => Promise.resolve(),
    ...(registry ? { customerRefresh: registry } : {}),
  });
}

describe("HttpClient customer-token auto-refresh", () => {
  it("refreshes once on a customer 401 and retries with the new token", async () => {
    const reg = new CustomerRefreshRegistry();
    let calls = 0;
    reg.set({
      refresh: async () => {
        calls += 1;
        return "NEW";
      },
    });
    const r = await client(reg).request<{ ok: boolean }>({
      method: "GET", path: "/cust", auth: { kind: "customer", token: "OLD" },
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(1);
    expect(seenTokens).toEqual(["Bearer OLD", "Bearer NEW"]);
  });

  it("propagates the 401 when the refresher returns null", async () => {
    const reg = new CustomerRefreshRegistry();
    reg.set({ refresh: async () => null });
    await expect(
      client(reg).request({ method: "GET", path: "/cust", auth: { kind: "customer", token: "OLD" } }),
    ).rejects.toBeInstanceOf(EmporixAuthError);
    expect(seenTokens).toEqual(["Bearer OLD"]);
  });

  it("retries at most once (a still-stale refreshed token does not loop)", async () => {
    const reg = new CustomerRefreshRegistry();
    let calls = 0;
    reg.set({
      refresh: async () => {
        calls += 1;
        return "OLD"; // still 401s
      },
    });
    await expect(
      client(reg).request({ method: "GET", path: "/cust", auth: { kind: "customer", token: "OLD" } }),
    ).rejects.toBeInstanceOf(EmporixAuthError);
    expect(calls).toBe(1);
    expect(seenTokens).toEqual(["Bearer OLD", "Bearer OLD"]);
  });

  it("without a registry, a customer 401 throws immediately (default off)", async () => {
    await expect(
      client().request({ method: "GET", path: "/cust", auth: { kind: "customer", token: "OLD" } }),
    ).rejects.toBeInstanceOf(EmporixAuthError);
    expect(seenTokens).toEqual(["Bearer OLD"]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk exec vitest run http-customer-refresh`
Expected: FAIL — `customerRefresh` not a known option; customer 401 throws on the first test.

- [ ] **Step 3: Implement the http.ts changes**

In `packages/sdk/src/core/http.ts`:

(a) Update the import on line 1:

```ts
import {
  type AuthContext,
  type TokenProvider,
  type CustomerRefreshRegistry,
  resolveToken,
} from "./auth";
```

(b) Add the option to `HttpClientOptions` (after the `sleep?` line, ~26):

```ts
  /** Opt-in customer-token refresher registry (off unless a refresher is set). */
  customerRefresh?: CustomerRefreshRegistry;
```

(c) In `request()`, before the `for` loop (after the `let reauthed = false;` line, ~56), add:

```ts
    let customerToken = o.auth.kind === "customer" ? o.auth.token : undefined;
    let customerReauthed = false;
```

(d) Replace the token resolution line (`const token = await resolveToken(...)`, ~59) with an override-aware version:

```ts
      const token = customerToken ?? (await resolveToken(o.auth, this.opts.provider));
```

(e) In the 401 block, after the existing `if (sdkManaged && !reauthed) { … }` branch and before the `throw errorFromResponse(...)` (between ~119 and ~120), insert:

```ts
        if (
          o.auth.kind === "customer" &&
          !customerReauthed &&
          this.opts.customerRefresh?.enabled
        ) {
          customerReauthed = true;
          const fresh = await this.opts.customerRefresh.refresh(customerToken!);
          if (fresh) {
            customerToken = fresh;
            log.warn("customer 401, refreshed once", { authKind: o.auth.kind });
            continue;
          }
        }
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm -F @viu/emporix-sdk exec vitest run http-customer-refresh http-retry`
Expected: PASS — new file (4 tests) **and** the existing `http-retry.test.ts`
"caller-managed 401 throws immediately" case still passes (no registry there).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/http.ts packages/sdk/tests/http-customer-refresh.test.ts
git commit -m "feat(sdk): refresh-and-retry once on customer 401 when opted in"
```

---

### Task 3: Core — `EmporixClient` ownership + `setCustomerTokenRefresher` + exports

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/index.ts`
- Test: `packages/sdk/tests/services/customer-refresh-wiring.test.ts`

- [ ] **Step 1: Write the failing wiring test**

Create `packages/sdk/tests/services/customer-refresh-wiring.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { EmporixClient, auth } from "../../src";

let seenTokens: string[] = [];
const server = setupServer(
  mhttp.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc", token_type: "Bearer", expires_in: 3599 }),
  ),
  mhttp.get("https://api.emporix.io/customer/acme/me", ({ request }) => {
    const tok = request.headers.get("authorization");
    seenTokens.push(tok ?? "");
    if (tok === "Bearer OLD") return HttpResponse.json({ e: 1 }, { status: 401 });
    return HttpResponse.json({ id: "c1" });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenTokens = [];
});
afterAll(() => server.close());

function client() {
  return new EmporixClient({
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  } as never);
}

describe("EmporixClient customer-token refresher wiring", () => {
  it("exposes setCustomerTokenRefresher", () => {
    expect(typeof client().setCustomerTokenRefresher).toBe("function");
  });

  it("a registered refresher drives refresh-and-retry across services", async () => {
    const c = client();
    let calls = 0;
    c.setCustomerTokenRefresher({
      refresh: async () => {
        calls += 1;
        return "NEW";
      },
    });
    const me = (await c.customers.me(auth.customer("OLD"))) as { id?: string };
    expect(me.id).toBe("c1");
    expect(calls).toBe(1);
    expect(seenTokens).toEqual(["Bearer OLD", "Bearer NEW"]);
  });

  it("clearing the refresher restores throw-on-401", async () => {
    const c = client();
    c.setCustomerTokenRefresher({ refresh: async () => "NEW" });
    c.setCustomerTokenRefresher(null);
    await expect(c.customers.me(auth.customer("OLD"))).rejects.toThrow();
    expect(seenTokens).toEqual(["Bearer OLD"]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk exec vitest run customer-refresh-wiring`
Expected: FAIL — `setCustomerTokenRefresher` undefined.

- [ ] **Step 3: Implement in `client.ts`**

(a) Add to the auth import (line 2 area):

```ts
import {
  DefaultTokenProvider,
  CustomerRefreshRegistry,
  type TokenProvider,
  type CustomerTokenRefresher,
} from "./core/auth";
```

(b) Add a private field near `private readonly resolver: LevelResolver;` (~118):

```ts
  private readonly customerRefresh: CustomerRefreshRegistry;
```

(c) In the constructor, before `const mk = …` (~146), create and store the registry:

```ts
    const customerRefresh = new CustomerRefreshRegistry();
    this.customerRefresh = customerRefresh;
```

(d) Add `customerRefresh` to the `HttpClient` options inside `mk` (~150):

```ts
      http: new HttpClient({
        host: cfg.host,
        provider: tokenProvider,
        logger: root.child({ service: "http" }),
        retry: cfg.retry,
        timeouts: cfg.timeouts,
        customerRefresh,
      }),
```

(e) Add the public method (after `getLogLevel`, ~215):

```ts
  /**
   * Registers (or clears with `null`) a customer-token refresher. When set, a
   * `customer`-kind 401 triggers one refresh-and-retry. Off by default — the
   * customer token stays caller-owned. The React `EmporixProvider` wires this
   * automatically via `autoRefreshCustomerToken`.
   */
  setCustomerTokenRefresher(refresher: CustomerTokenRefresher | null): void {
    this.customerRefresh.set(refresher);
  }
```

- [ ] **Step 4: Add the barrel exports in `index.ts`**

Update the `core/auth` exports (~15):

```ts
export { auth, resolveToken, DefaultTokenProvider, CustomerRefreshRegistry } from "./core/auth";
```

And add `CustomerTokenRefresher` to the type export block (~16–22):

```ts
export type {
  AuthKind,
  AuthContext,
  AnonymousSession,
  TokenProvider,
  AnonymousSessionStore,
  CustomerTokenRefresher,
} from "./core/auth";
```

- [ ] **Step 5: Run it — expect PASS + typecheck**

Run: `pnpm -F @viu/emporix-sdk exec vitest run customer-refresh-wiring && pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS (3 tests), typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/customer-refresh-wiring.test.ts
git commit -m "feat(sdk): expose setCustomerTokenRefresher on the client"
```

---

### Task 4: React — `EmporixProvider` opt-in + registration effect

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/tests/auto-refresh-customer.test.tsx`

Build the SDK first so React resolves the new exports:
```bash
pnpm -F @viu/emporix-sdk build
```

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/auto-refresh-customer.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useMyReturns } from "../src/hooks/use-returns";
import type { ReactNode } from "react";

const BASE = "https://api.emporix.io";
let returnCalls: string[] = [];
let refreshHit = 0;

const server = setupServer(
  // anonymous login (the refresh call authorizes with an anonymous token)
  http.get(`${BASE}/customerlogin/auth/anonymous/login`, () =>
    HttpResponse.json({ access_token: "anon", refresh_token: "ar", sessionId: "s", expires_in: 3599 }),
  ),
  // customer refresh endpoint
  http.get(`${BASE}/customer/acme/refreshauthtoken`, ({ request }) => {
    refreshHit += 1;
    const url = new URL(request.url);
    expect(url.searchParams.get("refreshToken")).toBe("RT");
    expect(request.headers.get("authorization")).toBe("Bearer anon");
    return HttpResponse.json({ access_token: "NEW", refresh_token: "RT2", expires_in: 3599 });
  }),
  // protected resource: 401 on OLD, 200 on NEW
  http.get(`${BASE}/return/acme/returns`, ({ request }) => {
    const tok = request.headers.get("authorization");
    returnCalls.push(tok ?? "");
    if (tok === "Bearer OLD") return HttpResponse.json({ e: 1 }, { status: 401 });
    return HttpResponse.json([{ id: "r1" }]);
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  returnCalls = [];
  refreshHit = 0;
});
afterAll(() => server.close());

function wrap(opts: { autoRefresh: boolean; onExpired?: () => void }) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const storage = createMemoryStorage({ initial: "OLD" });
  storage.setRefreshToken("RT");
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={client}
      storage={storage}
      queryClient={queryClient}
      autoRefreshCustomerToken={opts.autoRefresh}
      {...(opts.onExpired ? { onCustomerSessionExpired: opts.onExpired } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("autoRefreshCustomerToken", () => {
  it("refreshes on 401 and the retried query succeeds with the new token", async () => {
    const { result } = renderHook(() => useMyReturns(), { wrapper: wrap({ autoRefresh: true }) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(refreshHit).toBe(1);
    expect(returnCalls).toEqual(["Bearer OLD", "Bearer NEW"]);
    expect(result.current.data).toEqual([{ id: "r1" }]);
  });

  it("calls onCustomerSessionExpired when no refresh token is stored", async () => {
    const onExpired = vi.fn();
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    const storage = createMemoryStorage({ initial: "OLD" }); // no refresh token
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider
        client={client}
        storage={storage}
        queryClient={qc}
        autoRefreshCustomerToken
        onCustomerSessionExpired={onExpired}
      >
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useMyReturns(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(refreshHit).toBe(0);
  });

  it("off by default: a 401 is not auto-refreshed", async () => {
    const { result } = renderHook(() => useMyReturns(), { wrapper: wrap({ autoRefresh: false }) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(refreshHit).toBe(0);
    expect(returnCalls).toEqual(["Bearer OLD"]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run auto-refresh-customer`
Expected: FAIL — `autoRefreshCustomerToken` prop not handled; no refresh happens.

- [ ] **Step 3: Implement the provider changes** in `packages/react/src/provider.tsx`

(a) Add the two props to `EmporixProviderProps` (after `onTelemetry?`, ~74):

```ts
  /**
   * Opt in to reactive customer-token auto-refresh: on a `customer`-kind 401,
   * the SDK refreshes once (via the stored refresh token + anonymous auth) and
   * retries. Default: false (the customer token stays caller-owned).
   */
  autoRefreshCustomerToken?: boolean;
  /**
   * Called when a customer-token refresh is needed but fails (refresh token
   * expired/revoked) or no refresh token is stored. Use to drive logout /
   * redirect to login.
   */
  onCustomerSessionExpired?: () => void;
```

(b) Destructure them in the component signature (with `onTelemetry`, ~80):

```ts
  onTelemetry,
  autoRefreshCustomerToken,
  onCustomerSessionExpired,
  children,
```

(c) Add a registration effect after the telemetry-subscriptions `useEffect`
(after its closing `}, [qc, onTelemetry, client, value.storage, safeEmit]);`, ~220):

```ts
  // Opt-in reactive customer-token auto-refresh. Registered on the client so
  // the core HttpClient can refresh-and-retry a customer 401. Single-flight is
  // handled in the core registry. Off unless `autoRefreshCustomerToken`.
  useEffect(() => {
    if (!autoRefreshCustomerToken) return;
    const storage = value.storage;
    client.setCustomerTokenRefresher({
      refresh: async () => {
        const refreshToken = storage.getRefreshToken();
        if (!refreshToken) {
          safeEmit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
          onCustomerSessionExpired?.();
          return null;
        }
        try {
          const legalEntityId = storage.getActiveLegalEntityId() ?? undefined;
          const s = await client.customers.refresh({
            refreshToken,
            ...(legalEntityId ? { legalEntityId } : {}),
          });
          storage.setCustomerToken(s.customerToken);
          if (s.refreshToken) storage.setRefreshToken(s.refreshToken);
          safeEmit({ type: "auth.refresh", kind: "customer", success: true, tenant: client.tenant });
          return s.customerToken;
        } catch {
          safeEmit({ type: "auth.refresh", kind: "customer", success: false, tenant: client.tenant });
          onCustomerSessionExpired?.();
          return null;
        }
      },
    });
    return () => client.setCustomerTokenRefresher(null);
  }, [autoRefreshCustomerToken, client, value.storage, safeEmit, onCustomerSessionExpired]);
```

> Note: `onCustomerSessionExpired` should be a stable reference (wrap in
> `useCallback` on the consumer side); it's in the dep array so an unstable
> identity re-registers the refresher each render — harmless (idempotent set)
> but wasteful. Documented in `auth.md`.

- [ ] **Step 4: Run it — expect PASS + typecheck**

```bash
pnpm -F @viu/emporix-sdk-react exec vitest run auto-refresh-customer
pnpm -F @viu/emporix-sdk-react typecheck
```
Expected: PASS (3 tests), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/auto-refresh-customer.test.tsx
git commit -m "feat(react): opt-in autoRefreshCustomerToken on the provider"
```

---

### Task 5: Docs + changeset

**Files:**
- Modify: `docs/auth.md`
- Modify: `docs/react.md` (cross-link)
- Create: `.changeset/customer-token-auto-refresh.md`

- [ ] **Step 1: Document in `docs/auth.md`**

Add a "Customer token auto-refresh (opt-in)" section covering: the 30-day TTL +
`/refreshauthtoken` (anonymous-authorized), the core seam
(`setCustomerTokenRefresher`) for non-React consumers, the React
`autoRefreshCustomerToken` + `onCustomerSessionExpired` props, single-flight,
and the limitations (saasToken not restored; `requestRaw` not covered; create
the client per request on the server).

- [ ] **Step 2: Cross-link from `docs/react.md`**

In the auth/session area, add a sentence pointing to the auto-refresh opt-in and
`docs/auth.md`.

- [ ] **Step 3: Write the changeset**

Create `.changeset/customer-token-auto-refresh.md`:

```md
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add opt-in reactive customer-token auto-refresh.

Core: `EmporixClient.setCustomerTokenRefresher(refresher)` registers a
single-flight `CustomerTokenRefresher`; on a `customer`-kind 401 the HTTP layer
refreshes once and retries. Off by default — the customer token stays
caller-owned.

React: `EmporixProvider` gains `autoRefreshCustomerToken` and
`onCustomerSessionExpired`. When enabled, a customer 401 is transparently
refreshed via the stored refresh token (anonymous-authorized
`GET /refreshauthtoken`) and the request is retried; B2B `legalEntityId` is
preserved.
```

- [ ] **Step 4: Commit**

```bash
git add docs/auth.md docs/react.md .changeset/customer-token-auto-refresh.md
git commit -m "docs(auth): document opt-in customer-token auto-refresh"
```

---

### Task 6: Full verification + finish

- [ ] **Step 1: Build, full tests, typecheck**

```bash
pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build
pnpm -r test && pnpm typecheck
```
Expected: all green (incl. the existing `http-retry` 401 case, unchanged).

- [ ] **Step 2: Finish the branch**

Use superpowers:finishing-a-development-branch (note: user pushes manually —
assistant cannot push; user merges PRs externally).

---

## Self-Review

- **Spec coverage:** core interface + registry (Task 1), http customer-401 +
  single-flight + override (Tasks 1–2), client setter + exports (Task 3), React
  opt-in + refresh-via-storage + telemetry + onSessionExpired (Task 4), docs +
  changeset (Task 5). ✓
- **Type consistency:** `CustomerTokenRefresher.refresh(expiredToken): Promise<string | null>`
  used identically in registry, http branch, client setter, and provider. The
  `customerRefresh` option name is identical in `HttpClientOptions`, the test
  harness, and `mk()`. ✓
- **Regression guard:** Task 2 Step 4 re-runs `http-retry.test.ts` to prove the
  default-off behavior (customer 401 throws) is unchanged. ✓
- **Single-flight** is covered by an explicit concurrent test (Task 1). ✓
- **No placeholders:** every code step is complete; the only prose steps are the
  two doc sections (Task 5), which describe required content explicitly. ✓
