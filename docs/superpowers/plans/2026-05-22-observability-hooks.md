# Observability Hooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in typed telemetry channel to `@viu/emporix-sdk-react` (with two additive SDK/storage interface extensions) so storefronts can wire Datadog/Sentry/custom analytics to measure cache effectiveness, auth refresh frequency, mutation activity, and storage writes — and emit their own custom events on the same channel.

**Architecture:** A new `EmporixTelemetryContext` carries an `emit(event)` function down the tree; the provider wires four event sources (React-Query cache, mutation cache, `TokenProvider.onRefresh`, `EmporixStorage.subscribeAll`) into it. Consumers receive events via an optional `onTelemetry` prop. A `useEmporixTelemetry()` hook exposes `{ emit }` for consumer-side custom events. All sources are no-op when `onTelemetry` is not configured.

**Tech Stack:** TypeScript, React 18, `@tanstack/react-query` v5, Vitest + MSW.

**Context for the engineer:**
- Spec: `docs/superpowers/specs/2026-05-22-observability-design.md` — read it first.
- Branch: `feat/observability-hooks` (already created off `main` at `5941a8d`, spec already committed at `17c6588`).
- Two cross-package additive interface extensions: `TokenProvider.onRefresh?` (SDK) and `EmporixStorage.subscribeAll?` (React). Both are `?`-marked so custom implementations continue to work.
- Existing provider lives at `packages/react/src/provider.tsx`. Already wraps children in `EmporixContext.Provider` + `QueryClientProvider` + `EmporixSiteContext.Provider`. Add `EmporixTelemetryContext.Provider` as a fourth nested context.
- React-Query 5 subscription API: `queryClient.getQueryCache().subscribe(event => …)` and `getMutationCache().subscribe(...)`. The `event.type` discriminates lifecycle; `event.action.type` further specifies (`fetch`/`success`/`error`).
- `DefaultTokenProvider` is at `packages/sdk/src/core/auth.ts`. The refresh paths (`fetchAnonymous("login"|"refresh")`, customer-side `customers.login/refresh`) are where `onRefresh` listeners get notified.
- Storage backends live at `packages/react/src/storage/{memory,local-storage,cookie}.ts`. Each gains a `subscribeAll` method and notifies on every `setX(...)`.
- `commitlint` requires the first word of the subject to be a lowercase verb. Use scopes from the allowlist (`repo`, `react`, `sdk`, etc.).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/sdk/src/core/auth.ts` | `TokenProvider` interface + `DefaultTokenProvider` | Modify (add `onRefresh` + `notifyRefresh` calls) |
| `packages/sdk/tests/core/auth.test.ts` | SDK auth tests | Add 2-3 onRefresh tests |
| `packages/react/src/storage/index.ts` | `EmporixStorage` interface | Modify (add optional `subscribeAll`) |
| `packages/react/src/storage/memory.ts` | Memory storage backend | Modify (implement `subscribeAll`) |
| `packages/react/src/storage/local-storage.ts` | localStorage backend | Modify (implement `subscribeAll`) |
| `packages/react/src/storage/cookie.ts` | Cookie backend | Modify (implement `subscribeAll`) |
| `packages/react/tests/storage.test.ts` | Storage tests | Add 3 `subscribeAll` tests |
| `packages/react/src/telemetry.ts` | `EmporixTelemetryEvent` types + context + `useEmporixTelemetry` hook | **CREATE** |
| `packages/react/src/provider.tsx` | EmporixProvider | Modify (add `onTelemetry` prop + 3 source-subscriptions + new context wrap) |
| `packages/react/src/index.ts` | Public re-exports | Modify (add `useEmporixTelemetry` + `EmporixTelemetryEvent` type) |
| `packages/react/tests/telemetry.test.tsx` | Telemetry tests | **CREATE** (~10 tests) |
| `docs/react.md` | Public docs | Modify (Observability subsection) |
| `.changeset/observability.md` | Release notes | **CREATE** (minor on both packages) |

---

## Task 1: Add `TokenProvider.onRefresh` to the SDK

**Files:**
- Modify: `packages/sdk/src/core/auth.ts`
- Test: `packages/sdk/tests/core/auth.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/sdk/tests/core/auth.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("DefaultTokenProvider.onRefresh", () => {
  it("notifies subscribers on anonymous-login refresh with success=true", async () => {
    const provider = new DefaultTokenProvider({
      tenant: "viu",
      host: "https://api.emporix.io",
      credentials: { storefront: { clientId: "sf" } },
      tokenProvider: undefined,
      timeouts: { connectMs: 1000, readMs: 5000 },
      retry: { maxAttempts: 1 },
      cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
      logger: undefined,
    });
    const events: { kind: "anonymous" | "customer"; success: boolean }[] = [];
    const unsubscribe = provider.onRefresh!((e) => events.push(e));

    // Mock fetch to return a successful anonymous login.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "anon-tok",
          token_type: "Bearer",
          expires_in: 3599,
          refresh_token: "rt",
          sessionId: "s",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await provider.getAnonymousToken();
    expect(events).toEqual([{ kind: "anonymous", success: true }]);

    unsubscribe();
    globalThis.fetch = originalFetch;
  });

  it("notifies subscribers with success=false when anonymous login fails", async () => {
    const provider = new DefaultTokenProvider({
      tenant: "viu",
      host: "https://api.emporix.io",
      credentials: { storefront: { clientId: "sf" } },
      tokenProvider: undefined,
      timeouts: { connectMs: 1000, readMs: 5000 },
      retry: { maxAttempts: 1 },
      cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
      logger: undefined,
    });
    const events: { kind: "anonymous" | "customer"; success: boolean }[] = [];
    provider.onRefresh!((e) => events.push(e));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "bad" }), { status: 500 }),
    );

    await expect(provider.getAnonymousToken()).rejects.toThrow();
    expect(events).toEqual([{ kind: "anonymous", success: false }]);

    globalThis.fetch = originalFetch;
  });

  it("unsubscribe stops further notifications", async () => {
    const provider = new DefaultTokenProvider({
      tenant: "viu",
      host: "https://api.emporix.io",
      credentials: { storefront: { clientId: "sf" } },
      tokenProvider: undefined,
      timeouts: { connectMs: 1000, readMs: 5000 },
      retry: { maxAttempts: 1 },
      cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
      logger: undefined,
    });
    const events: unknown[] = [];
    const unsubscribe = provider.onRefresh!((e) => events.push(e));
    unsubscribe();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "anon-tok",
          token_type: "Bearer",
          expires_in: 3599,
          refresh_token: "rt",
          sessionId: "s",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await provider.getAnonymousToken();
    expect(events).toEqual([]);
    globalThis.fetch = originalFetch;
  });
});
```

If the existing test file uses a different `ResolvedConfig` shape or mock setup, adapt the constructor argument (read the existing tests at the top of the file for the canonical pattern).

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-sdk test -- auth.test`
Expected: FAIL — `provider.onRefresh` is `undefined` (the `?` member doesn't exist yet).

- [ ] **Step 3: Add `onRefresh` to the `TokenProvider` interface**

In `packages/sdk/src/core/auth.ts`, find the `TokenProvider` interface and append:

```typescript
export interface TokenProvider {
  // … existing methods …
  /**
   * Subscribe to token-refresh events. Optional — implementations may no-op.
   * Returns an unsubscribe function.
   */
  onRefresh?(
    listener: (event: { kind: "anonymous" | "customer"; success: boolean }) => void,
  ): () => void;
}
```

- [ ] **Step 4: Implement `onRefresh` in `DefaultTokenProvider`**

Inside the `DefaultTokenProvider` class, add a private `Set<listener>` and a `notifyRefresh` helper, and wire the existing refresh paths to call it.

Add at the top of the class (after `private constructor` or as instance field):

```typescript
private readonly refreshListeners = new Set<
  (event: { kind: "anonymous" | "customer"; success: boolean }) => void
>();

onRefresh(
  listener: (event: { kind: "anonymous" | "customer"; success: boolean }) => void,
): () => void {
  this.refreshListeners.add(listener);
  return () => {
    this.refreshListeners.delete(listener);
  };
}

private notifyRefresh(kind: "anonymous" | "customer", success: boolean): void {
  for (const l of this.refreshListeners) {
    try {
      l({ kind, success });
    } catch {
      // Never let a telemetry listener break the auth path.
    }
  }
}
```

Then call `notifyRefresh` in every refresh code path. Find `fetchAnonymous("login" | "refresh")` (around the middle of `auth.ts`) and add the notification:

```typescript
private async fetchAnonymous(mode: "login" | "refresh"): Promise<AnonymousSession> {
  try {
    // … existing fetch logic that returns an AnonymousSession …
    const session = /* … existing computation … */;
    this.notifyRefresh("anonymous", true);
    return session;
  } catch (err) {
    this.notifyRefresh("anonymous", false);
    throw err;
  }
}
```

Wrap the function body in try/catch so failures still notify. If the existing function isn't shaped this way, refactor minimally — the only behavior change is the notification.

For customer refresh notifications, the customer-token flow lives in `packages/sdk/src/services/customer.ts` (the `refresh` method). Adding customer-side notifications is **out of scope** for this task — the SDK doesn't currently route customer refreshes through the TokenProvider. Document it in a comment:

```typescript
// Customer-token refreshes happen via client.customers.refresh() and don't
// route through this TokenProvider — only the anonymous flow notifies.
// React-side useCustomerSession.refresh emits its own telemetry event in a
// follow-up if needed.
```

- [ ] **Step 5: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk test -- auth.test`
Expected: PASS for the 3 new tests + all existing tests in the file.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/auth.ts packages/sdk/tests/core/auth.test.ts
git commit -m "feat(sdk): add TokenProvider.onRefresh subscription"
```

---

## Task 2: Extend `EmporixStorage` with `subscribeAll`

**Files:**
- Modify: `packages/react/src/storage/index.ts`
- Modify: `packages/react/src/storage/memory.ts`
- Modify: `packages/react/src/storage/local-storage.ts`
- Modify: `packages/react/src/storage/cookie.ts`
- Test: `packages/react/tests/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/react/tests/storage.test.ts`:

```typescript
describe("EmporixStorage.subscribeAll", () => {
  it("memory: notifies subscribers for all four key writes", () => {
    const s = createMemoryStorage();
    const events: string[] = [];
    const unsubscribe = s.subscribeAll!((key) => events.push(key));
    s.setCustomerToken("t1");
    s.setCartId("c1");
    s.setSiteCode("X");
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    unsubscribe();
    s.setCartId("c2");
    expect(events).toEqual(["customerToken", "cartId", "siteCode", "anonymousSession"]);
  });

  it("localStorage: notifies subscribers for all four key writes", () => {
    localStorage.clear();
    const s = createLocalStorageStorage();
    const events: string[] = [];
    s.subscribeAll!((key) => events.push(key));
    s.setCustomerToken("t");
    s.setCartId("c");
    s.setSiteCode("Y");
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    expect(events).toEqual(["customerToken", "cartId", "siteCode", "anonymousSession"]);
  });

  it("cookie: notifies subscribers for all four key writes", () => {
    for (const c of document.cookie.split("; ")) {
      const [k] = c.split("=");
      document.cookie = `${k}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
    const s = createCookieStorage({ secure: false, sameSite: "lax" });
    const events: string[] = [];
    s.subscribeAll!((key) => events.push(key));
    s.setCustomerToken("t");
    s.setCartId("c");
    s.setSiteCode("Y");
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    expect(events).toEqual(["customerToken", "cartId", "siteCode", "anonymousSession"]);
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test`
Expected: FAIL — `subscribeAll` doesn't exist on any backend.

- [ ] **Step 3: Add `subscribeAll` to the `EmporixStorage` interface**

In `packages/react/src/storage/index.ts`, append to the interface:

```typescript
export interface EmporixStorage {
  // … existing methods …
  getSiteCode(): string | null;
  setSiteCode(code: string | null): void;
  /**
   * Subscribe to any storage write. The listener receives the key that changed.
   * Returns an unsubscribe function. Optional — backends may no-op.
   */
  subscribeAll?(
    listener: (
      key: "customerToken" | "cartId" | "siteCode" | "anonymousSession",
    ) => void,
  ): () => void;
}
```

- [ ] **Step 4: Implement in `memory.ts`**

Open `packages/react/src/storage/memory.ts`. Add a `Set<listener>` and notify from each `setX` method:

```typescript
import type { EmporixStorage, PersistedAnonymousSession } from "./index";

type AllKey = "customerToken" | "cartId" | "siteCode" | "anonymousSession";

export function createMemoryStorage(opts: { initial?: string } = {}): EmporixStorage {
  let token: string | null = opts.initial ?? null;
  let cartId: string | null = null;
  let anon: PersistedAnonymousSession | null = null;
  let siteCode: string | null = null;
  const listeners = new Set<(t: string | null) => void>();
  const allListeners = new Set<(k: AllKey) => void>();
  const notifyAll = (k: AllKey): void => {
    for (const l of allListeners) {
      try {
        l(k);
      } catch {
        // Swallow handler errors; telemetry must never break writes.
      }
    }
  };
  return {
    getCustomerToken: () => token,
    setCustomerToken: (t) => {
      token = t;
      for (const l of listeners) l(token);
      notifyAll("customerToken");
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCartId: () => cartId,
    setCartId: (id) => {
      cartId = id;
      notifyAll("cartId");
    },
    getAnonymousSession: () => anon,
    setAnonymousSession: (s) => {
      anon = s;
      notifyAll("anonymousSession");
    },
    getSiteCode: () => siteCode,
    setSiteCode: (code) => {
      siteCode = code;
      notifyAll("siteCode");
    },
    subscribeAll: (l) => {
      allListeners.add(l);
      return () => allListeners.delete(l);
    },
  };
}
```

- [ ] **Step 5: Implement in `local-storage.ts`**

Open `packages/react/src/storage/local-storage.ts` and apply the same pattern. Add a `Set<listener>` at module-init scope (inside the factory function), notify from each `setX`. The pattern is identical to `memory.ts` — the only difference is that the underlying writes hit `localStorage.setItem` / `removeItem`. Wrap `notifyAll` in `try/catch` per listener.

Concrete edits inside `createLocalStorageStorage(...)`:

```typescript
const allListeners = new Set<(k: AllKey) => void>();
const notifyAll = (k: AllKey): void => {
  for (const l of allListeners) {
    try {
      l(k);
    } catch {
      /* swallow */
    }
  }
};
```

Append `notifyAll("customerToken")` inside `setCustomerToken`. Append `notifyAll("cartId")` inside `setCartId`. Append `notifyAll("siteCode")` inside `setSiteCode`. Append `notifyAll("anonymousSession")` inside `setAnonymousSession`. Add `subscribeAll: (l) => { allListeners.add(l); return () => allListeners.delete(l); }` to the returned object.

Add the type import (already present in `memory.ts`):

```typescript
type AllKey = "customerToken" | "cartId" | "siteCode" | "anonymousSession";
```

(Or import from a shared file if you prefer — both files define the same union, which is acceptable.)

- [ ] **Step 6: Implement in `cookie.ts`**

Same pattern: add `Set<allListeners>`, `notifyAll`, call from each setter, expose `subscribeAll`.

- [ ] **Step 7: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test`
Expected: PASS for the 3 new tests + all existing storage tests.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/storage/
git add packages/react/tests/storage.test.ts
git commit -m "feat(react): add EmporixStorage.subscribeAll to all 3 backends"
```

---

## Task 3: Add `EmporixTelemetryContext` + `useEmporixTelemetry` hook

**Files:**
- Create: `packages/react/src/telemetry.ts`
- Modify: `packages/react/src/index.ts`

This task introduces the types and the consumer-facing hook. The provider-side wiring lands in Task 4.

- [ ] **Step 1: Create `packages/react/src/telemetry.ts`**

```typescript
import { createContext, useContext } from "react";

/**
 * All telemetry events emitted through the EmporixProvider's `onTelemetry`
 * callback. Discriminated by `type` — exhaustive switch is type-safe.
 *
 * Consumers can emit their own `{ type: "custom" }` events via
 * {@link useEmporixTelemetry}. Namespace `name` with an app-specific
 * prefix (e.g. `"app.checkout-cta-click"`) to avoid collisions with
 * future SDK event types.
 */
export type EmporixTelemetryEvent =
  // Cache lifecycle (React-Query QueryCache)
  | { type: "cache.hit"; queryKey: readonly unknown[]; tenant: string }
  | {
      type: "cache.miss";
      queryKey: readonly unknown[];
      tenant: string;
      durationMs: number;
    }
  | {
      type: "query.refetch";
      queryKey: readonly unknown[];
      tenant: string;
      reason: "invalidate" | "focus" | "stale";
    }
  | {
      type: "query.error";
      queryKey: readonly unknown[];
      tenant: string;
      error: unknown;
    }
  // Mutation lifecycle
  | {
      type: "mutation.success";
      mutationKey?: readonly unknown[];
      tenant: string;
      durationMs: number;
    }
  | {
      type: "mutation.error";
      mutationKey?: readonly unknown[];
      tenant: string;
      error: unknown;
      durationMs: number;
    }
  // Auth refresh (SDK-side)
  | {
      type: "auth.refresh";
      kind: "anonymous" | "customer";
      tenant: string;
      success: boolean;
    }
  // Storage writes
  | {
      type: "storage.write";
      key: "customerToken" | "cartId" | "siteCode" | "anonymousSession";
    }
  // Consumer-emitted
  | { type: "custom"; name: string; props?: Record<string, unknown> };

/** Internal: the React context carrying the emit function down the tree. */
export const EmporixTelemetryContext = createContext<{
  emit: (event: EmporixTelemetryEvent) => void;
} | null>(null);

/**
 * Hook to emit custom telemetry events through the same channel as SDK
 * events. Throws when used outside an {@link EmporixProvider}.
 *
 * When the provider has no `onTelemetry` callback configured, `emit` is a
 * no-op — calling it is safe and incurs no overhead.
 */
export function useEmporixTelemetry(): {
  emit: (event: EmporixTelemetryEvent) => void;
} {
  const ctx = useContext(EmporixTelemetryContext);
  if (!ctx) {
    throw new Error("useEmporixTelemetry must be used within an EmporixProvider");
  }
  return ctx;
}
```

- [ ] **Step 2: Re-export from the package index**

In `packages/react/src/index.ts`, append:

```typescript
export { useEmporixTelemetry } from "./telemetry";
export type { EmporixTelemetryEvent } from "./telemetry";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add packages/react/src/telemetry.ts packages/react/src/index.ts
git commit -m "feat(react): add EmporixTelemetryContext + useEmporixTelemetry hook"
```

---

## Task 4: Wire all four sources into `EmporixProvider`

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/tests/telemetry.test.tsx`

This is the biggest task. It adds the `onTelemetry` prop, the source subscriptions, and the new context wrap.

- [ ] **Step 1: Write the failing tests**

Create `packages/react/tests/telemetry.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { render, renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import {
  useEmporixTelemetry,
  type EmporixTelemetryEvent,
} from "../src/telemetry";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon",
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "rt",
      sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient() {
  return new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: { clientId: "sf" },
    },
    logger: false,
  });
}

function wrap(opts: {
  onTelemetry?: (e: EmporixTelemetryEvent) => void;
} = {}) {
  const client = makeClient();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={client}
      storage={createMemoryStorage()}
      queryClient={queryClient}
      {...(opts.onTelemetry ? { onTelemetry: opts.onTelemetry } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("Telemetry — cache events", () => {
  it("emits cache.miss with positive durationMs on first fetch", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products/p1", () =>
        HttpResponse.json({ id: "p1", name: "Widget" }),
      ),
    );
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    const { result } = renderHook(
      () =>
        useQuery({
          queryKey: ["emporix", "product", "p1"],
          queryFn: () =>
            fetch("https://api.emporix.io/product/acme/products/p1").then((r) =>
              r.json(),
            ),
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const miss = events.find((e) => e.type === "cache.miss");
    expect(miss).toBeDefined();
    expect((miss as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
  });

  it("emits query.error when the queryFn throws", async () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    renderHook(
      () =>
        useQuery({
          queryKey: ["emporix", "boom"],
          queryFn: () => {
            throw new Error("nope");
          },
        }),
      { wrapper },
    );
    await waitFor(() =>
      expect(events.some((e) => e.type === "query.error")).toBe(true),
    );
    const err = events.find((e) => e.type === "query.error");
    expect((err as { error: Error }).error.message).toBe("nope");
  });

  it("filters non-emporix queryKeys (consumer keys are ignored)", async () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    renderHook(
      () =>
        useQuery({
          queryKey: ["app", "user-prefs"],
          queryFn: () => Promise.resolve({ theme: "dark" }),
        }),
      { wrapper },
    );
    // Allow microtasks to flush.
    await new Promise((r) => setTimeout(r, 10));
    expect(events.filter((e) => e.type === "cache.miss")).toEqual([]);
  });
});

describe("Telemetry — mutation events", () => {
  it("emits mutation.success with durationMs", async () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    const { result } = renderHook(
      () =>
        useMutation({
          mutationKey: ["emporix", "test-mutation"],
          mutationFn: async () => "ok",
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync();
    });
    await waitFor(() => {
      const success = events.find((e) => e.type === "mutation.success");
      expect(success).toBeDefined();
    });
  });

  it("emits mutation.error when the mutation rejects", async () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    const { result } = renderHook(
      () =>
        useMutation({
          mutationKey: ["emporix", "bad-mutation"],
          mutationFn: async () => {
            throw new Error("denied");
          },
        }),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync().catch(() => undefined);
    });
    await waitFor(() => {
      const err = events.find((e) => e.type === "mutation.error");
      expect(err).toBeDefined();
    });
  });
});

describe("Telemetry — storage events", () => {
  it("emits storage.write for cartId + siteCode", async () => {
    const storage = createMemoryStorage();
    const events: EmporixTelemetryEvent[] = [];
    const client = makeClient();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <EmporixProvider
        client={client}
        storage={storage}
        queryClient={queryClient}
        onTelemetry={(e) => events.push(e)}
      >
        <div />
      </EmporixProvider>,
    );
    storage.setCartId("c1");
    storage.setSiteCode("X");
    const writes = events.filter((e) => e.type === "storage.write");
    expect(writes.map((e) => (e as { key: string }).key)).toEqual(["cartId", "siteCode"]);
  });
});

describe("Telemetry — custom events via useEmporixTelemetry", () => {
  it("custom emit reaches onTelemetry", () => {
    const events: EmporixTelemetryEvent[] = [];
    const wrapper = wrap({ onTelemetry: (e) => events.push(e) });
    const { result } = renderHook(() => useEmporixTelemetry(), { wrapper });
    act(() => {
      result.current.emit({ type: "custom", name: "app.test" });
    });
    expect(events).toContainEqual({ type: "custom", name: "app.test" });
  });

  it("emit is no-op when no onTelemetry is configured (no throw)", () => {
    const wrapper = wrap();
    const { result } = renderHook(() => useEmporixTelemetry(), { wrapper });
    expect(() => result.current.emit({ type: "custom", name: "x" })).not.toThrow();
  });

  it("useEmporixTelemetry throws when used outside EmporixProvider", () => {
    expect(() => renderHook(() => useEmporixTelemetry())).toThrow(/EmporixProvider/);
  });

  it("handler that throws does not break the provider", () => {
    const wrapper = wrap({
      onTelemetry: () => {
        throw new Error("handler broken");
      },
    });
    // Render + emit a custom event — nothing should bubble up.
    const { result } = renderHook(() => useEmporixTelemetry(), { wrapper });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => result.current.emit({ type: "custom", name: "x" })).not.toThrow();
    errorSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run, expect failure**

Run: `pnpm -F @viu/emporix-sdk-react test -- telemetry.test`
Expected: FAIL — `onTelemetry` prop doesn't exist on `EmporixProvider`; cache/mutation/storage subscriptions are missing.

- [ ] **Step 3: Update `provider.tsx`**

Open `packages/react/src/provider.tsx`. Add imports:

```typescript
import { EmporixTelemetryContext, type EmporixTelemetryEvent } from "./telemetry";
```

Add to `EmporixProviderProps`:

```typescript
export interface EmporixProviderProps {
  // … existing props …
  initialSiteCode?: string;
  /** Receives a typed event stream covering cache, mutations, auth, storage, and consumer-emitted events. */
  onTelemetry?: (event: EmporixTelemetryEvent) => void;
  children: ReactNode;
}
```

Inside `EmporixProvider`, after the existing `useState(() => { client.tokenProvider.attachAnonymousStore?.(...) })` block, add:

```typescript
// Wrap onTelemetry in a stable safeEmit that swallows handler errors.
const safeEmit = useCallback(
  (event: EmporixTelemetryEvent) => {
    if (!onTelemetry) return;
    try {
      onTelemetry(event);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[emporix] telemetry handler threw:", err);
    }
  },
  [onTelemetry],
);

const telemetryValue = useMemo(() => ({ emit: safeEmit }), [safeEmit]);

// Subscribe to all source streams once per provider mount, only when a
// consumer has provided an onTelemetry callback.
useEffect(() => {
  if (!onTelemetry) return;
  const startedAt = new Map<string, number>();

  const unsubQuery = qc.getQueryCache().subscribe((event) => {
    const key = event.query.queryKey;
    if (!Array.isArray(key) || key[0] !== "emporix") return;
    if (event.type === "updated") {
      const action = event.action as { type: string };
      if (action.type === "fetch") {
        const isRefetch = event.query.state.dataUpdateCount > 0;
        if (isRefetch) {
          safeEmit({
            type: "query.refetch",
            queryKey: key,
            tenant: client.tenant,
            reason: "invalidate",
          });
        }
        startedAt.set(event.query.queryHash, Date.now());
      } else if (action.type === "success") {
        const start = startedAt.get(event.query.queryHash);
        startedAt.delete(event.query.queryHash);
        safeEmit({
          type: "cache.miss",
          queryKey: key,
          tenant: client.tenant,
          durationMs: start ? Date.now() - start : 0,
        });
      } else if (action.type === "error") {
        startedAt.delete(event.query.queryHash);
        safeEmit({
          type: "query.error",
          queryKey: key,
          tenant: client.tenant,
          error: event.query.state.error,
        });
      }
    } else if (event.type === "observerResultsUpdated") {
      const s = event.query.state;
      if (s.status === "success" && s.fetchStatus === "idle" && s.dataUpdateCount > 0) {
        safeEmit({ type: "cache.hit", queryKey: key, tenant: client.tenant });
      }
    }
  });

  const unsubMut = qc.getMutationCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const m = event.mutation;
    const dur = Date.now() - (m.state.submittedAt ?? Date.now());
    const mk = m.options.mutationKey;
    if (m.state.status === "success") {
      safeEmit({
        type: "mutation.success",
        ...(mk ? { mutationKey: mk as readonly unknown[] } : {}),
        tenant: client.tenant,
        durationMs: dur,
      });
    } else if (m.state.status === "error") {
      safeEmit({
        type: "mutation.error",
        ...(mk ? { mutationKey: mk as readonly unknown[] } : {}),
        tenant: client.tenant,
        error: m.state.error,
        durationMs: dur,
      });
    }
  });

  const unsubAuth = client.tokenProvider.onRefresh?.((evt) =>
    safeEmit({ type: "auth.refresh", ...evt, tenant: client.tenant }),
  );

  const unsubStorage = value.storage.subscribeAll?.((key) =>
    safeEmit({ type: "storage.write", key }),
  );

  return () => {
    unsubQuery();
    unsubMut();
    unsubAuth?.();
    unsubStorage?.();
  };
}, [qc, onTelemetry, client, value.storage, safeEmit]);
```

Now wrap children in the new context. Find the existing JSX return and update the tree to include `<EmporixTelemetryContext.Provider>` **inside** `EmporixContext.Provider` and **outside** `QueryClientProvider` (so all hooks under the tree, including `useEmporixTelemetry`, can resolve it):

```tsx
return (
  <EmporixContext.Provider value={value}>
    <EmporixTelemetryContext.Provider value={telemetryValue}>
      <QueryClientProvider client={qc}>
        <SiteContextProvider
          client={client}
          storage={value.storage}
          {...(initialSiteCode !== undefined ? { initialSiteCode } : {})}
        >
          {children}
        </SiteContextProvider>
      </QueryClientProvider>
    </EmporixTelemetryContext.Provider>
  </EmporixContext.Provider>
);
```

Add the necessary imports if not already present:

```typescript
import { useCallback, useEffect, useMemo } from "react";
```

(`useState` is already imported; add the rest if missing.)

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- telemetry.test`
Expected: PASS for all 10 telemetry tests.

If a test that uses `useMutation` doesn't fire `mutation.success` because the mutation cache subscription captures observation events differently — adjust by reading `m.state.submittedAt` more defensively or fall back to `Date.now()` for duration calculation (the assertion only checks event presence, not value precision).

- [ ] **Step 5: Run the full React test suite for regressions**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: 138 + 10 = ~148 tests passing. Existing tests don't use `onTelemetry`, so all subscriptions are no-op and no behavior changes.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/telemetry.test.tsx
git commit -m "feat(react): wire telemetry sources (cache, mutations, auth, storage)"
```

---

## Task 5: Documentation + changeset

**Files:**
- Modify: `docs/react.md`
- Create: `.changeset/observability.md`

- [ ] **Step 1: Add an Observability subsection to `docs/react.md`**

Insert after the "Caching & quota" subsection (added in PR #41) and before the "Hooks" heading:

```markdown
### Observability

For production tuning and quota monitoring, pass an `onTelemetry` callback to
the provider:

```tsx
<EmporixProvider
  client={client}
  onTelemetry={(event) => {
    switch (event.type) {
      case "cache.hit":
      case "cache.miss":
        datadog.addAction(event.type, { key: event.queryKey });
        break;
      case "query.error":
      case "mutation.error":
        sentry.captureException(event.error, { tags: { type: event.type } });
        break;
      case "auth.refresh":
        if (!event.success) datadog.addError("auth.refresh failed", event);
        break;
      // … cache.miss / mutation.success / storage.write / custom …
    }
  }}
>
```

The event stream is a typed discriminated union — exhaustive switches are
type-safe. Without `onTelemetry`, the whole telemetry layer is no-op and
incurs no overhead.

To emit your own events on the same channel:

```tsx
function CheckoutCTA() {
  const { emit } = useEmporixTelemetry();
  return (
    <button onClick={() => emit({ type: "custom", name: "app.checkout-cta-click" })}>
      Buy
    </button>
  );
}
```

Namespace your custom-event `name` (e.g. `"app.*"`) to avoid collisions with
future SDK event types.

Event types emitted by the SDK:

| Type | Source | Fields |
|---|---|---|
| `cache.hit` | React-Query | `queryKey`, `tenant` |
| `cache.miss` | React-Query | `queryKey`, `tenant`, `durationMs` |
| `query.refetch` | React-Query | `queryKey`, `tenant`, `reason` |
| `query.error` | React-Query | `queryKey`, `tenant`, `error` |
| `mutation.success` | React-Query | `mutationKey?`, `tenant`, `durationMs` |
| `mutation.error` | React-Query | `mutationKey?`, `tenant`, `error`, `durationMs` |
| `auth.refresh` | SDK TokenProvider | `kind`, `tenant`, `success` |
| `storage.write` | EmporixStorage | `key` |
| `custom` | Consumer | `name`, `props?` |
```

- [ ] **Step 2: Create the changeset**

Create `.changeset/observability.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add opt-in telemetry channel for observability + ops-tuning.

**SDK (additive)**
- `TokenProvider.onRefresh(listener)` — optional subscription to
  token-refresh events. `DefaultTokenProvider` implements it (anonymous
  refresh path).

**React (additive)**
- `<EmporixProvider onTelemetry={fn}>` — receives a typed event stream
  covering cache hit/miss, refetches, errors, mutations, auth refreshes,
  and storage writes.
- `useEmporixTelemetry()` — returns `{ emit }` for consumer-side custom
  events on the same channel.
- `EmporixStorage.subscribeAll(listener)` — optional subscription to all
  storage write events. Implemented in all three built-in adapters
  (memory, localStorage, cookie).

**Event types:**
- `cache.hit`, `cache.miss`, `query.refetch`, `query.error`
- `mutation.success`, `mutation.error`
- `auth.refresh`
- `storage.write`
- `custom`

No breaking changes. The entire telemetry layer is no-op when
`onTelemetry` is not passed. Existing `TokenProvider` / `EmporixStorage`
implementations continue to work without implementing the new optional
methods.
```

- [ ] **Step 3: Commit**

```bash
git add docs/react.md .changeset/observability.md
git commit -m "docs(react): document onTelemetry + useEmporixTelemetry; changeset"
```

---

## Final Verification

- [ ] **Step 1: Full monorepo green**

```bash
pnpm -r build
pnpm -r test
pnpm typecheck
```
Expected:
- `@viu/emporix-sdk`: was 156 → **≥ 159** (+3 onRefresh tests).
- `@viu/emporix-sdk-react`: was 138 → **≥ 151** (+3 storage subscribeAll tests + ~10 telemetry tests).
- All builds + typecheck green.

- [ ] **Step 2: E2E sanity**

```bash
set -a; source e2e/.env.local 2>/dev/null; set +a
pnpm e2e
```
Expected: 6/6 still passing. The telemetry layer is opt-in via prop — the example apps don't set `onTelemetry`, so no behavior change.

- [ ] **Step 3: Sanity grep**

```bash
git grep -nE "EmporixTelemetryEvent|useEmporixTelemetry|onTelemetry|subscribeAll|onRefresh" \
  packages/sdk/src packages/react/src 2>/dev/null
```
Expected: all new symbols are present in the right files.

- [ ] **Step 4: Branch state**

```bash
git log --oneline origin/main..HEAD
```
Expected: 6 commits, in order:
1. Spec (already there: `17c6588`)
2. Plan (this file — after writing-plans commit)
3. SDK: `TokenProvider.onRefresh` + tests
4. React storage: `subscribeAll` + tests
5. React telemetry: types + context + hook
6. React provider: source wiring + telemetry.test.tsx
7. Docs + changeset

(Total may be 7 if the plan commit lands separately.)

---

## Follow-ups (out of scope)

- Pre-built tracker adapters (`@viu/emporix-sdk-react-datadog`, `@viu/emporix-sdk-react-sentry`).
- Cross-tab storage events via `window.addEventListener('storage')` (separate Cross-Tab-Sync feature).
- Customer-side `auth.refresh` event (currently anonymous-only; customer refresh goes through `client.customers.refresh()` and doesn't touch `TokenProvider`).
- OpenTelemetry span integration.
- PII / data-classification helpers for handler-side filtering.
