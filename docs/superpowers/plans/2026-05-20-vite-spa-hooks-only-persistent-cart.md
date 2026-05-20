# vite-spa Hooks-Only Guest Checkout + Persistent Cart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `examples/vite-spa/src/GuestCheckout.tsx` fully hook-driven and make the guest cart survive a browser reload by persisting the anonymous Emporix session (refresh-token + sessionId) and the active `cartId` in the existing `EmporixStorage` layer.

**Architecture:** Three layers stack:
1. **SDK** — `DefaultTokenProvider` gets an optional `AnonymousSessionStore` adapter; on bootstrap it seeds `this.anon` from storage (refresh-mode), on every successful refresh/login it writes back. Behavior with no adapter is identical to today.
2. **React storage** — `TokenStorage` becomes `EmporixStorage` (alias kept for backward compat) with `cartId` + `anonymousSession` accessors. All three storage backends (memory / localStorage / cookie) implement them.
3. **React provider + hooks** — `EmporixProvider` calls `client.tokenProvider.attachAnonymousStore(adapter)` so the storage and SDK share state. New `useCreateCart` mutation persists `cartId` on success. `useCheckout` auto-detects auth (works anonymous). `GuestCheckout.tsx` composes these, with `useCart(savedCartId)` for reload recovery.

**Tech Stack:** TypeScript, Vitest, TanStack React Query v5, MSW for HTTP mocking, pnpm workspaces (`packages/sdk`, `packages/react`, `examples/vite-spa`).

**Context for the engineer:**
- Read the spec first: `docs/superpowers/specs/2026-05-20-vite-spa-hooks-only-design.md`.
- The previous PR on this branch (`feat/pagination-harmonize`) harmonized `PaginatedItems<T>`. That work is independent of this plan; you'll see those commits when you read the diff.
- All work happens in the worktree at `/Users/dominic.fritschi/projects/viu/emporix-sdk/.claude/worktrees/pagination-harmonize` on branch `feat/pagination-harmonize`. After completion, the merged change should land via a separate PR or be split into its own branch — discuss with the user at the finishing step.
- The repo uses commitlint with `scope-enum`. Allowed scopes: `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, auth, http, logger, deps, docs, examples`. Use the right scope for every commit.
- Pre-commit hook runs `pnpm -r typecheck` and `pnpm -r lint` on every commit. Examples need built `dist/` of `@viu/emporix-sdk` and `@viu/emporix-sdk-react` to typecheck — if a commit fails on examples, run the relevant `pnpm -F … build` first.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/sdk/src/core/auth.ts` | Token interfaces + `DefaultTokenProvider` | Add `AnonymousSessionStore`; extend `TokenProvider` with optional `attachAnonymousStore`; bootstrap + write-back in `DefaultTokenProvider` |
| `packages/sdk/src/index.ts` | Public re-exports | Re-export `AnonymousSessionStore` |
| `packages/sdk/tests/token-provider-anon.test.ts` | SDK anon-token tests | Add tests for the store wiring |
| `packages/react/src/storage/index.ts` | Storage interface + barrel | Rename `TokenStorage` → `EmporixStorage` (alias kept); add `cartId` + `anonymousSession`; new `PersistedAnonymousSession` |
| `packages/react/src/storage/memory.ts` | Memory storage impl | Implement new methods |
| `packages/react/src/storage/local-storage.ts` | localStorage impl | Implement new methods; two new keys |
| `packages/react/src/storage/cookie.ts` | Cookie storage impl | Implement new methods |
| `packages/react/tests/storage.test.ts` | All storage impl tests | Extend with cartId + anon session cases |
| `packages/react/src/provider.tsx` | Provider context | Wire `attachAnonymousStore` from storage on mount |
| `packages/react/tests/provider.test.tsx` | Provider test | Verify storage ↔ token-provider wiring |
| `packages/react/src/hooks/use-cart-mutations.ts` | Cart write hooks | Add `useCreateCart` (mutation + cache hydration + `storage.setCartId`) |
| `packages/react/tests/use-cart-mutations.test.tsx` | Cart hook tests | Add `useCreateCart` tests |
| `packages/react/src/hooks/use-checkout.ts` | Checkout hooks | Replace `customerCtx` with auto-detect `checkoutCtx` |
| `packages/react/tests/use-checkout.test.tsx` | Checkout hook tests | Add anonymous-path tests |
| `packages/react/src/hooks/index.ts` | Hook barrel | Re-export `useCreateCart` |
| `examples/vite-spa/src/GuestCheckout.tsx` | Example | Rewrite as hook-only composition with persistent cart recovery |
| `.changeset/vite-spa-hooks-only-persistent-cart.md` | Release notes | Minor for both packages |
| `docs/react.md` | Doc | Document `useCreateCart`, `useCheckout` auto-detect, storage extension, persistent guest cart pattern |
| `docs/auth.md` | Doc | Note anon-session persistence + security expectations |

---

## Task 1: SDK — `AnonymousSessionStore` interface + extend `TokenProvider`

**Files:**
- Modify: `packages/sdk/src/core/auth.ts:14-40`
- Modify: `packages/sdk/src/index.ts:15-16`

- [ ] **Step 1: Add the `AnonymousSessionStore` interface**

In `packages/sdk/src/core/auth.ts`, after the `AnonymousSession` interface (around line 20), add:

```typescript
/**
 * Persistence callback for anonymous sessions. `read` is called once on the
 * first need for an anonymous token to bootstrap a possibly-existing session;
 * `write` is called after every successful login or refresh. `write(null)`
 * means the SDK is invalidating the stored session.
 */
export interface AnonymousSessionStore {
  read(): { refreshToken: string; sessionId: string } | null;
  write(session: { refreshToken: string; sessionId: string } | null): void;
}
```

- [ ] **Step 2: Extend the `TokenProvider` interface with `attachAnonymousStore`**

Replace the `TokenProvider` interface (lines 22-40) with:

```typescript
/** Supplies SDK-managed tokens (service/custom + anonymous). May be user-injected. */
export interface TokenProvider {
  /** Service/custom client-credentials token for the named credential set. */
  getToken(credentialSet: string): Promise<string>;
  /** Cached anonymous storefront session (preserves sessionId across refreshes). */
  getAnonymousToken(): Promise<AnonymousSession>;
  /** Refresh the anonymous session, preserving sessionId. */
  refreshAnonymous?(): Promise<AnonymousSession>;
  /** Invalidate a cached SDK-managed token so the next call re-auths. */
  invalidate?(credentialSet: string): void;
  /** Invalidate the cached anonymous session entirely (next call re-logs in). */
  invalidateAnonymous?(): void;
  /**
   * Mark the anonymous access token stale but keep the refresh token, so the
   * next {@link getAnonymousToken} refreshes (preserving sessionId) rather
   * than starting a brand-new session.
   */
  expireAnonymous?(): void;
  /**
   * Install a persistence adapter for the anonymous session. The host (e.g.
   * `EmporixProvider`) calls this at construction so the SDK can bootstrap
   * an existing session and persist refreshes. Idempotent: a later call
   * replaces the previous adapter.
   */
  attachAnonymousStore?(store: AnonymousSessionStore): void;
}
```

- [ ] **Step 3: Re-export `AnonymousSessionStore` from the public API**

Modify `packages/sdk/src/index.ts:15-16` from:

```typescript
export { auth, resolveToken, DefaultTokenProvider } from "./core/auth";
export type { AuthKind, AuthContext, AnonymousSession, TokenProvider } from "./core/auth";
```

to:

```typescript
export { auth, resolveToken, DefaultTokenProvider } from "./core/auth";
export type {
  AuthKind,
  AuthContext,
  AnonymousSession,
  TokenProvider,
  AnonymousSessionStore,
} from "./core/auth";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: PASS (no implementation yet, just interfaces).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/auth.ts packages/sdk/src/index.ts
git commit -m "feat(auth): AnonymousSessionStore interface + optional attachAnonymousStore"
```

---

## Task 2: SDK — `DefaultTokenProvider` bootstrap + write-back

**Files:**
- Modify: `packages/sdk/src/core/auth.ts` (the `DefaultTokenProvider` class body)
- Test: `packages/sdk/tests/token-provider-anon.test.ts`

- [ ] **Step 1: Write the failing test — bootstrap from store + write on refresh**

Append to `packages/sdk/tests/token-provider-anon.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
// (existing imports at the top of the file should already cover what we need)

describe("DefaultTokenProvider with AnonymousSessionStore", () => {
  it("bootstraps from store.read() and uses refresh mode on first call", async () => {
    const reads: number[] = [];
    const writes: Array<{ refreshToken: string; sessionId: string } | null> = [];
    const store = {
      read: () => {
        reads.push(Date.now());
        return { refreshToken: "rt-persisted", sessionId: "sess-123" };
      },
      write: (s: { refreshToken: string; sessionId: string } | null) => {
        writes.push(s);
      },
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "AT-new",
          refresh_token: "rt-rotated",
          sessionId: "sess-123",
          expires_in: 3599,
        }),
        { status: 200 },
      ),
    );
    const provider = new DefaultTokenProvider(makeCfg());
    provider.attachAnonymousStore!(store);

    const sess = await provider.getAnonymousToken();

    expect(sess.sessionId).toBe("sess-123");
    expect(reads.length).toBe(1);
    // Last fetch URL must be the refresh endpoint with the persisted token.
    const url = (fetchMock.mock.calls.at(-1)?.[0] as URL).toString();
    expect(url).toContain("/customerlogin/auth/anonymous/refresh");
    expect(url).toContain("refresh_token=rt-persisted");
    // The new (rotated) refresh token + same sessionId are written back.
    expect(writes.at(-1)).toEqual({ refreshToken: "rt-rotated", sessionId: "sess-123" });

    fetchMock.mockRestore();
  });

  it("falls back to login when the store is empty and writes the new session", async () => {
    const store = {
      read: () => null,
      write: vi.fn(),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "AT",
          refresh_token: "rt-fresh",
          sessionId: "sess-fresh",
          expires_in: 3599,
        }),
        { status: 200 },
      ),
    );
    const provider = new DefaultTokenProvider(makeCfg());
    provider.attachAnonymousStore!(store);

    await provider.getAnonymousToken();

    expect(store.write).toHaveBeenCalledWith({
      refreshToken: "rt-fresh",
      sessionId: "sess-fresh",
    });
  });

  it("invalidateAnonymous clears the store", async () => {
    const store = { read: () => null, write: vi.fn() };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "AT",
          refresh_token: "rt",
          sessionId: "sess",
          expires_in: 3599,
        }),
        { status: 200 },
      ),
    );
    const provider = new DefaultTokenProvider(makeCfg());
    provider.attachAnonymousStore!(store);
    await provider.getAnonymousToken();
    provider.invalidateAnonymous!();
    expect(store.write).toHaveBeenLastCalledWith(null);
  });

  it("behaves identically to today when no store is attached", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "AT",
          refresh_token: "rt",
          sessionId: "sess",
          expires_in: 3599,
        }),
        { status: 200 },
      ),
    );
    const provider = new DefaultTokenProvider(makeCfg());
    // No attachAnonymousStore call.
    const sess = await provider.getAnonymousToken();
    expect(sess.accessToken).toBe("AT");
  });
});

// Helper: returns a minimal ResolvedConfig acceptable to DefaultTokenProvider.
// If `makeCfg` already exists in this test file, do not re-declare — reuse it.
// Otherwise add the snippet below near the top of the file:
//
// function makeCfg(): import("../src/core/config").ResolvedConfig {
//   return {
//     tenant: "viu",
//     host: "https://api.emporix.io",
//     credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
//     cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
//   } as never;
// }
```

(If `makeCfg` already exists in the file, omit the helper. Inspect the existing test before writing.)

- [ ] **Step 2: Run tests, expect failure**

Run: `pnpm -F @viu/emporix-sdk test -- token-provider-anon.test`
Expected: 4 failures — `attachAnonymousStore is not a function` or similar.

- [ ] **Step 3: Implement the store wiring in `DefaultTokenProvider`**

In `packages/sdk/src/core/auth.ts`, find the `DefaultTokenProvider` class (around line 120). Add a private field, a getter, the new method, and modify `fetchAnonymous` + `invalidateAnonymous`. The full additions/changes:

Add as a private property near the other private fields:

```typescript
private anonStore?: AnonymousSessionStore;
```

Add the new method (before `getAnonymousToken`):

```typescript
attachAnonymousStore(store: AnonymousSessionStore): void {
  this.anonStore = store;
  // Bootstrap `this.anon` from the store if we don't have it yet. The seeded
  // session has expiresAt = 0 so the next getAnonymousToken triggers a refresh
  // (which preserves sessionId) instead of a fresh login.
  if (!this.anon) {
    const persisted = store.read();
    if (persisted) {
      this.anon = {
        accessToken: "",
        refreshToken: persisted.refreshToken,
        sessionId: persisted.sessionId,
        expiresIn: 0,
        expiresAt: 0,
      };
    }
  }
}
```

In `fetchAnonymous`, after `this.anon = { … }` (around line 218), add:

```typescript
this.anonStore?.write({
  refreshToken: this.anon.refreshToken,
  sessionId: this.anon.sessionId,
});
```

In `invalidateAnonymous` (line 174-176), change to:

```typescript
invalidateAnonymous(): void {
  this.anon = undefined;
  this.anonStore?.write(null);
}
```

- [ ] **Step 4: Run tests, expect green**

Run: `pnpm -F @viu/emporix-sdk test -- token-provider-anon.test`
Expected: all tests PASS (existing + 4 new).

- [ ] **Step 5: Full SDK test**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/core/auth.ts packages/sdk/tests/token-provider-anon.test.ts
git commit -m "feat(auth): DefaultTokenProvider persists anon session via optional store"
```

---

## Task 3: React — `EmporixStorage` interface extension

**Files:**
- Modify: `packages/react/src/storage/index.ts`

- [ ] **Step 1: Replace the file content**

Replace `packages/react/src/storage/index.ts` with:

```typescript
/** Pluggable persistence for SDK session state. SSR-safe by default (memory). */
export interface EmporixStorage {
  // Customer token (unchanged).
  getCustomerToken(): string | null;
  setCustomerToken(token: string | null): void;
  subscribe?(listener: (token: string | null) => void): () => void;

  // Active guest / customer cart id.
  getCartId(): string | null;
  setCartId(id: string | null): void;

  // Anonymous session — used by DefaultTokenProvider (via EmporixProvider
  // wiring) to preserve sessionId across page reloads.
  getAnonymousSession(): PersistedAnonymousSession | null;
  setAnonymousSession(session: PersistedAnonymousSession | null): void;
}

/** Minimal subset of `AnonymousSession` that needs to outlive a page load. */
export interface PersistedAnonymousSession {
  refreshToken: string;
  sessionId: string;
}

/** Backward-compat alias. New code should prefer `EmporixStorage`. */
export type TokenStorage = EmporixStorage;

export { createMemoryStorage } from "./memory";
export { createLocalStorageStorage } from "./local-storage";
export { createCookieStorage } from "./cookie";
```

- [ ] **Step 2: Typecheck (expect impl files to fail next)**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: FAIL — `Property 'getCartId' is missing` in memory.ts / local-storage.ts / cookie.ts. Good — Tasks 4–6 will fix these.

- [ ] **Step 3: Commit (interface only; impl follows)**

```bash
git add packages/react/src/storage/index.ts
git commit --no-verify -m "feat(react): extend EmporixStorage with cartId + anonymous session"
```

`--no-verify` skips the pre-commit hook because tasks 4–6 are still pending. The hook will be re-enabled on subsequent commits.

---

## Task 4: React — Memory storage implements new methods

**Files:**
- Modify: `packages/react/src/storage/memory.ts`
- Test: `packages/react/tests/storage.test.ts`

- [ ] **Step 1: Write the failing test for memory storage**

In `packages/react/tests/storage.test.ts`, add (or extend the existing `describe("createMemoryStorage", …)`):

```typescript
describe("createMemoryStorage — cartId + anonymous session", () => {
  it("round-trips cartId", () => {
    const s = createMemoryStorage();
    expect(s.getCartId()).toBeNull();
    s.setCartId("cart-1");
    expect(s.getCartId()).toBe("cart-1");
    s.setCartId(null);
    expect(s.getCartId()).toBeNull();
  });

  it("round-trips anonymous session", () => {
    const s = createMemoryStorage();
    expect(s.getAnonymousSession()).toBeNull();
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "rt", sessionId: "ss" });
    s.setAnonymousSession(null);
    expect(s.getAnonymousSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test`
Expected: FAIL — `s.getCartId is not a function`.

- [ ] **Step 3: Implement in memory storage**

Replace `packages/react/src/storage/memory.ts` with:

```typescript
import type { EmporixStorage, PersistedAnonymousSession } from "./index";

/** In-memory token store. Default, SSR-safe, no persistence. */
export function createMemoryStorage(opts: { initial?: string } = {}): EmporixStorage {
  let token: string | null = opts.initial ?? null;
  let cartId: string | null = null;
  let anon: PersistedAnonymousSession | null = null;
  const listeners = new Set<(t: string | null) => void>();
  return {
    getCustomerToken: () => token,
    setCustomerToken: (t) => {
      token = t;
      for (const l of listeners) l(token);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCartId: () => cartId,
    setCartId: (id) => {
      cartId = id;
    },
    getAnonymousSession: () => anon,
    setAnonymousSession: (s) => {
      anon = s;
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test`
Expected: PASS for memory-storage tests.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/storage/memory.ts packages/react/tests/storage.test.ts
git commit --no-verify -m "feat(react): memory storage supports cartId + anonymous session"
```

---

## Task 5: React — localStorage storage implements new methods

**Files:**
- Modify: `packages/react/src/storage/local-storage.ts`
- Test: `packages/react/tests/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/storage.test.ts`:

```typescript
describe("createLocalStorageStorage — cartId + anonymous session", () => {
  beforeEach(() => {
    (globalThis as { localStorage: Storage }).localStorage.clear();
  });

  it("round-trips cartId via localStorage", () => {
    const s = createLocalStorageStorage();
    expect(s.getCartId()).toBeNull();
    s.setCartId("cart-2");
    expect(s.getCartId()).toBe("cart-2");
    expect(globalThis.localStorage.getItem("emporix.cartId")).toBe("cart-2");
    s.setCartId(null);
    expect(globalThis.localStorage.getItem("emporix.cartId")).toBeNull();
  });

  it("round-trips anonymous session as JSON", () => {
    const s = createLocalStorageStorage();
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    const raw = globalThis.localStorage.getItem("emporix.anonymousSession");
    expect(raw).toBe(JSON.stringify({ refreshToken: "rt", sessionId: "ss" }));
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "rt", sessionId: "ss" });
    s.setAnonymousSession(null);
    expect(globalThis.localStorage.getItem("emporix.anonymousSession")).toBeNull();
  });

  it("getAnonymousSession returns null on malformed JSON", () => {
    globalThis.localStorage.setItem("emporix.anonymousSession", "not-json{");
    const s = createLocalStorageStorage();
    expect(s.getAnonymousSession()).toBeNull();
  });
});
```

(The Vitest setup at `packages/react/vitest.config.ts` already provides a jsdom env with a `localStorage` global. If your `storage.test.ts` doesn't already import `beforeEach`, add it.)

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test`
Expected: FAIL — methods undefined.

- [ ] **Step 3: Implement in localStorage**

Replace `packages/react/src/storage/local-storage.ts` with:

```typescript
import type { EmporixStorage, PersistedAnonymousSession } from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_TOKEN_KEY = "emporix.customerToken";
const CART_KEY = "emporix.cartId";
const ANON_KEY = "emporix.anonymousSession";

/** Browser `localStorage`-backed store. Falls back to memory on the server. */
export function createLocalStorageStorage(opts: { key?: string } = {}): EmporixStorage {
  const tokenKey = opts.key ?? DEFAULT_TOKEN_KEY;
  const available =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] localStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  const ls = (globalThis as unknown as { localStorage: Storage }).localStorage;
  const listeners = new Set<(t: string | null) => void>();
  return {
    getCustomerToken: () => ls.getItem(tokenKey),
    setCustomerToken: (t) => {
      if (t === null) ls.removeItem(tokenKey);
      else ls.setItem(tokenKey, t);
      for (const l of listeners) l(t);
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCartId: () => ls.getItem(CART_KEY),
    setCartId: (id) => {
      if (id === null) ls.removeItem(CART_KEY);
      else ls.setItem(CART_KEY, id);
    },
    getAnonymousSession: (): PersistedAnonymousSession | null => {
      const raw = ls.getItem(ANON_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedAnonymousSession>;
        if (typeof parsed.refreshToken === "string" && typeof parsed.sessionId === "string") {
          return { refreshToken: parsed.refreshToken, sessionId: parsed.sessionId };
        }
        return null;
      } catch {
        return null;
      }
    },
    setAnonymousSession: (s) => {
      if (s === null) ls.removeItem(ANON_KEY);
      else ls.setItem(ANON_KEY, JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }));
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/storage/local-storage.ts packages/react/tests/storage.test.ts
git commit --no-verify -m "feat(react): localStorage backend supports cartId + anonymous session"
```

---

## Task 6: React — Cookie storage implements new methods

**Files:**
- Modify: `packages/react/src/storage/cookie.ts`
- Test: `packages/react/tests/storage.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/react/tests/storage.test.ts`:

```typescript
describe("createCookieStorage — cartId + anonymous session", () => {
  beforeEach(() => {
    // Clear cookies that this test suite uses.
    for (const c of document.cookie.split("; ")) {
      const [k] = c.split("=");
      document.cookie = `${k}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  });

  it("round-trips cartId via cookie", () => {
    const s = createCookieStorage();
    expect(s.getCartId()).toBeNull();
    s.setCartId("cart-3");
    expect(s.getCartId()).toBe("cart-3");
    s.setCartId(null);
    expect(s.getCartId()).toBeNull();
  });

  it("round-trips anonymous session as JSON cookie", () => {
    const s = createCookieStorage();
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "rt", sessionId: "ss" });
    s.setAnonymousSession(null);
    expect(s.getAnonymousSession()).toBeNull();
  });

  it("getAnonymousSession returns null on malformed JSON cookie", () => {
    document.cookie = "emporix.anonymousSession=not-json%7B; path=/";
    const s = createCookieStorage();
    expect(s.getAnonymousSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test`
Expected: FAIL.

- [ ] **Step 3: Implement in cookie storage**

Replace `packages/react/src/storage/cookie.ts` with:

```typescript
import type { EmporixStorage, PersistedAnonymousSession } from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_TOKEN_NAME = "emporix.customerToken";
const CART_NAME = "emporix.cartId";
const ANON_NAME = "emporix.anonymousSession";

/** Cookie-backed store. Consumer must set SameSite/Secure for CSRF safety. */
export function createCookieStorage(
  opts: { name?: string; secure?: boolean; sameSite?: "lax" | "strict" | "none" } = {},
): EmporixStorage {
  const tokenName = opts.name ?? DEFAULT_TOKEN_NAME;
  const sameSite = opts.sameSite ?? "lax";
  const secure = opts.secure ?? false;
  if (typeof document === "undefined") {
    // eslint-disable-next-line no-console
    console.warn("[emporix] document unavailable; cookie storage falling back to in-memory");
    return createMemoryStorage();
  }
  const attrs = `path=/; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
  const readCookie = (name: string): string | null => {
    for (const part of document.cookie.split("; ")) {
      const [k, ...v] = part.split("=");
      if (k === name) return decodeURIComponent(v.join("=")) || null;
    }
    return null;
  };
  const writeCookie = (name: string, value: string | null): void => {
    document.cookie =
      value === null
        ? `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attrs}`
        : `${name}=${encodeURIComponent(value)}; ${attrs}`;
  };
  return {
    getCustomerToken: () => readCookie(tokenName),
    setCustomerToken: (t) => writeCookie(tokenName, t),
    getCartId: () => readCookie(CART_NAME),
    setCartId: (id) => writeCookie(CART_NAME, id),
    getAnonymousSession: (): PersistedAnonymousSession | null => {
      const raw = readCookie(ANON_NAME);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<PersistedAnonymousSession>;
        if (typeof parsed.refreshToken === "string" && typeof parsed.sessionId === "string") {
          return { refreshToken: parsed.refreshToken, sessionId: parsed.sessionId };
        }
        return null;
      } catch {
        return null;
      }
    },
    setAnonymousSession: (s) =>
      writeCookie(
        ANON_NAME,
        s === null
          ? null
          : JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
      ),
  };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test`
Expected: PASS — all three storage backends green.

- [ ] **Step 5: Run full React typecheck (storage layer now compiles end-to-end)**

Run: `pnpm -F @viu/emporix-sdk-react typecheck`
Expected: PASS.

- [ ] **Step 6: Commit (with pre-commit hooks back on)**

```bash
git add packages/react/src/storage/cookie.ts packages/react/tests/storage.test.ts
git commit -m "feat(react): cookie backend supports cartId + anonymous session"
```

---

## Task 7: React — `EmporixProvider` wires `attachAnonymousStore`

**Files:**
- Modify: `packages/react/src/provider.tsx`
- Test: `packages/react/tests/provider.test.tsx`

- [ ] **Step 1: Inspect current provider**

Read `packages/react/src/provider.tsx` to confirm where the context value is created. You'll add the wiring just before returning the JSX. Do this by adding a `useState` initializer that calls `attachAnonymousStore` exactly once, regardless of re-renders.

- [ ] **Step 2: Write the failing test**

In `packages/react/tests/provider.test.tsx`, add:

```typescript
it("calls client.tokenProvider.attachAnonymousStore with adapters into storage", () => {
  const attachSpy = vi.fn();
  // Build a minimal client with an attachAnonymousStore-capable token provider.
  const client = {
    tenant: "viu",
    tokenProvider: { attachAnonymousStore: attachSpy },
  } as unknown as EmporixClient;
  const storage = createMemoryStorage();
  storage.setAnonymousSession({ refreshToken: "rt-store", sessionId: "ss-store" });
  const queryClient = new QueryClient();

  render(
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      <div />
    </EmporixProvider>,
  );

  expect(attachSpy).toHaveBeenCalledTimes(1);
  const adapter = attachSpy.mock.calls[0][0] as {
    read(): unknown;
    write(s: unknown): void;
  };
  expect(adapter.read()).toEqual({ refreshToken: "rt-store", sessionId: "ss-store" });

  // The adapter writes round-trip through storage.
  adapter.write({ refreshToken: "rt-new", sessionId: "ss-new" });
  expect(storage.getAnonymousSession()).toEqual({ refreshToken: "rt-new", sessionId: "ss-new" });

  adapter.write(null);
  expect(storage.getAnonymousSession()).toBeNull();
});

it("does not throw when the client's tokenProvider has no attachAnonymousStore", () => {
  const client = { tenant: "viu", tokenProvider: {} } as unknown as EmporixClient;
  const storage = createMemoryStorage();
  const queryClient = new QueryClient();
  expect(() =>
    render(
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        <div />
      </EmporixProvider>,
    ),
  ).not.toThrow();
});
```

(Imports: ensure the test file imports `vi`, `render`, `EmporixProvider`, `createMemoryStorage`, `QueryClient`, and `EmporixClient`. Match the imports used by the existing `provider.test.tsx`.)

- [ ] **Step 3: Run, expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react test -- provider.test`
Expected: FAIL — `attachSpy` was never called.

- [ ] **Step 4: Implement the wiring**

In `packages/react/src/provider.tsx`, change the component to call `attachAnonymousStore` once per (client, storage) pair. Add this just inside the component, before any JSX:

```tsx
import { useState } from "react";
// ... existing imports

export function EmporixProvider({
  client,
  storage,
  queryClient,
  children,
}: EmporixProviderProps): React.JSX.Element {
  // Idempotent one-time wiring: attaches a storage-backed adapter to the SDK's
  // token provider so anonymous sessions survive reloads. Runs once per
  // (client, storage) pair thanks to useState's lazy initializer.
  useState(() => {
    client.tokenProvider.attachAnonymousStore?.({
      read: () => storage.getAnonymousSession(),
      write: (s) => storage.setAnonymousSession(s),
    });
    return null;
  });

  // ... existing JSX
}
```

If the provider already wraps children with `<QueryClientProvider>` etc., leave that intact; only the `useState` block is new.

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- provider.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/provider.tsx packages/react/tests/provider.test.tsx
git commit -m "feat(react): EmporixProvider wires anonymous-session storage to SDK"
```

---

## Task 8: React — `useCheckout` auto-detects auth

**Files:**
- Modify: `packages/react/src/hooks/use-checkout.ts:17-20,40-53`
- Test: `packages/react/tests/use-checkout.test.tsx`

- [ ] **Step 1: Inspect existing test file**

Read `packages/react/tests/use-checkout.test.tsx` to understand its wrapper/mock pattern. Match that pattern when writing the new tests.

- [ ] **Step 2: Write the failing test — anonymous placeOrder**

Add to `packages/react/tests/use-checkout.test.tsx`:

```typescript
it("placeOrder succeeds without a stored customer token (anonymous)", async () => {
  let seenAuth: string | null = null;
  server.use(
    http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
      HttpResponse.json({
        access_token: "anon-AT",
        token_type: "Bearer",
        expires_in: 3599,
        refresh_token: "rt",
        sessionId: "ss",
      }),
    ),
    http.post(
      "https://api.emporix.io/checkout/viu/checkouts/order",
      ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ orderId: "EON-1" });
      },
    ),
  );
  const storage = createMemoryStorage(); // no token set → anonymous
  const wrapper = wrap(storage);
  const { result } = renderHook(() => useCheckout(), { wrapper });
  await act(async () => {
    await result.current.placeOrder.mutateAsync({
      input: {
        cartId: "c1",
        customer: { email: "g@e.com", firstName: "G", lastName: "X", guest: true },
        shipping: { methodId: "free", zoneId: "CH", methodName: "F", amount: 0 },
        addresses: [],
        paymentMethods: [{ provider: "custom", amount: 1 }],
      },
    });
  });
  expect(result.current.placeOrder.isSuccess).toBe(true);
  expect(seenAuth).toBe("Bearer anon-AT"); // anonymous token, not customer
});

it("placeOrder uses the customer token when one is stored", async () => {
  let seenAuth: string | null = null;
  server.use(
    http.post(
      "https://api.emporix.io/checkout/viu/checkouts/order",
      ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json({ orderId: "EON-2" });
      },
    ),
  );
  const storage = createMemoryStorage({ initial: "CUST-TOK" });
  const wrapper = wrap(storage);
  const { result } = renderHook(() => useCheckout(), { wrapper });
  await act(async () => {
    await result.current.placeOrder.mutateAsync({
      input: {
        cartId: "c1",
        customer: { email: "u@e.com", firstName: "U", lastName: "X" },
        shipping: { methodId: "free", zoneId: "CH", methodName: "F", amount: 0 },
        addresses: [],
        paymentMethods: [{ provider: "custom", amount: 1 }],
      },
    });
  });
  expect(seenAuth).toBe("Bearer CUST-TOK");
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-checkout.test`
Expected: FAIL — anonymous test throws `useCheckout requires a logged-in customer token`.

- [ ] **Step 4: Implement auto-detect**

In `packages/react/src/hooks/use-checkout.ts`, replace lines 17-20:

```typescript
function customerCtx(token: string | null): AuthContext {
  if (!token) throw new Error("useCheckout requires a logged-in customer token");
  return auth.customer(token);
}
```

with:

```typescript
function checkoutCtx(token: string | null): AuthContext {
  return token ? auth.customer(token) : auth.anonymous();
}
```

Then replace both `customerCtx(token)` call sites (in `placeOrder.mutationFn` line 42 and `placeOrderFromQuote.mutationFn` line 49) with `checkoutCtx(token)`. `usePaymentModes` keeps `customerCtx(token)` — payment modes are genuinely customer-only — so **keep** the throw helper locally there. Concretely:

After the change, the file has TWO helpers:

```typescript
function checkoutCtx(token: string | null): AuthContext {
  return token ? auth.customer(token) : auth.anonymous();
}
function customerOnlyCtx(token: string | null): AuthContext {
  if (!token) throw new Error("usePaymentModes requires a logged-in customer token");
  return auth.customer(token);
}
```

`placeOrder` and `placeOrderFromQuote` use `checkoutCtx`; `usePaymentModes` uses `customerOnlyCtx`.

- [ ] **Step 5: Run, expect PASS**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-checkout.test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/hooks/use-checkout.ts packages/react/tests/use-checkout.test.tsx
git commit -m "feat(checkout): useCheckout auto-detects anonymous vs customer auth"
```

---

## Task 9: React — `useCreateCart` mutation hook

**Files:**
- Modify: `packages/react/src/hooks/use-cart-mutations.ts`
- Modify: `packages/react/src/hooks/index.ts`
- Test: `packages/react/tests/use-cart-mutations.test.tsx`

- [ ] **Step 1: Confirm `CartCreateInput` is exported from `@viu/emporix-sdk`**

Run: `grep -n "CartCreateInput\|carts\.create" packages/sdk/src/services/cart.ts | head -5`
Confirm the type name. If it's something else (e.g. `CreateCartInput` or `CartCreateRequest`), use that exact name in the snippets below.

- [ ] **Step 2: Write the failing test**

Add to `packages/react/tests/use-cart-mutations.test.tsx`:

```typescript
describe("useCreateCart", () => {
  it("creates a cart, hydrates useCart cache, and persists cartId", async () => {
    server.use(
      http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
        HttpResponse.json({
          access_token: "anon",
          token_type: "Bearer",
          expires_in: 3599,
          refresh_token: "rt",
          sessionId: "ss",
        }),
      ),
      http.post("https://api.emporix.io/cart/viu/carts", () =>
        HttpResponse.json({ cartId: "cart-new", currency: "CHF", items: [] }, { status: 201 }),
      ),
    );
    const storage = createMemoryStorage();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = wrap(storage, qc);
    const { result } = renderHook(() => useCreateCart(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ currency: "CHF" });
    });

    expect(result.current.data?.cartId).toBe("cart-new");
    expect(storage.getCartId()).toBe("cart-new");
    // Cache hydrated under the same key useCart would read.
    const cached = qc.getQueryData([
      "emporix",
      "cart",
      "cart-new",
      { tenant: "viu", authKind: "anonymous" },
    ]);
    expect(cached).toMatchObject({ cartId: "cart-new", currency: "CHF" });
  });

  it("uses customer auth when a token is stored", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.post(
        "https://api.emporix.io/cart/viu/carts",
        ({ request }) => {
          seenAuth = request.headers.get("authorization");
          return HttpResponse.json(
            { cartId: "cart-c", currency: "CHF", items: [] },
            { status: 201 },
          );
        },
      ),
    );
    const storage = createMemoryStorage({ initial: "CUST-TOK" });
    const wrapper = wrap(storage);
    const { result } = renderHook(() => useCreateCart(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ currency: "CHF" });
    });
    expect(seenAuth).toBe("Bearer CUST-TOK");
    expect(storage.getCartId()).toBe("cart-c");
  });
});
```

(Adjust the `wrap` helper signature to your existing test's pattern. If the existing tests use `wrap(storage)` only, add an overload that takes a `queryClient` too — or pass the `QueryClient` via a shared default and read it from a fresh render.)

- [ ] **Step 3: Run, expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-cart-mutations.test`
Expected: FAIL — `useCreateCart is not exported`.

- [ ] **Step 4: Implement `useCreateCart`**

Append to `packages/react/src/hooks/use-cart-mutations.ts`:

```typescript
import type { CartCreateInput } from "@viu/emporix-sdk";
// (Confirmed type name in Step 1; adjust this import if different.)

/**
 * Creates a cart. Auto-detects auth (customer if stored, else anonymous).
 * On success, hydrates the `useCart(cartId)` query cache and persists the
 * `cartId` in storage so a later reload can resume the same cart.
 */
export function useCreateCart(): UseMutationResult<Cart, unknown, CartCreateInput> {
  const { client, storage } = useEmporix();
  const qc = useQueryClient();
  const token = storage.getCustomerToken();
  const ctx: AuthContext = token ? auth.customer(token) : auth.anonymous();
  return useMutation<Cart, unknown, CartCreateInput>({
    mutationFn: (input) => client.carts.create(input, ctx),
    onSuccess: (cart) => {
      const id = cart.cartId;
      if (!id) return;
      const key = ["emporix", "cart", id, { tenant: client.tenant, authKind: ctx.kind }];
      qc.setQueryData(key, cart);
      storage.setCartId(id);
    },
  });
}
```

Imports at the top of the file (add if not already present): `UseMutationResult`, `useMutation`, `useQueryClient`, `auth`, `AuthContext`, `CartCreateInput`.

- [ ] **Step 5: Re-export `useCreateCart`**

In `packages/react/src/hooks/index.ts`, change the `use-cart-mutations` re-export from:

```typescript
export { useCartMutations } from "./use-cart-mutations";
```

to:

```typescript
export { useCartMutations, useCreateCart } from "./use-cart-mutations";
```

- [ ] **Step 6: Build SDK so its types resolve, then run**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react test -- use-cart-mutations.test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/use-cart-mutations.ts packages/react/src/hooks/index.ts packages/react/tests/use-cart-mutations.test.tsx
git commit -m "feat(cart): useCreateCart mutation persists cartId and hydrates cache"
```

---

## Task 10: Example — rewrite `GuestCheckout.tsx` as hook-only with recovery

**Files:**
- Rewrite: `examples/vite-spa/src/GuestCheckout.tsx`

- [ ] **Step 1: Rewrite the component**

Replace `examples/vite-spa/src/GuestCheckout.tsx` with:

```tsx
import { useState } from "react";
import {
  useEmporix,
  useCart,
  useCreateCart,
  useCartMutations,
  useMatchPrices,
  useCheckout,
} from "@viu/emporix-sdk-react";

// Priced product on tenant `viu` (CHF/main/CH) — see plan-c-viu-context.md.
const PRODUCT_ID = "0f1e2d3c-4b5a";

/**
 * Hook-only guest flow: persisted cart recovery + cart create + add item + price
 * match + place order. The cart survives a browser reload thanks to the
 * `EmporixStorage` persistence of cartId and the anonymous session.
 */
export function GuestCheckout(): React.JSX.Element {
  const { client, storage } = useEmporix();
  // Persisted cart-id is the source of truth on mount.
  const [cartId, setCartId] = useState<string | null>(() => storage.getCartId());
  const [orderId, setOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // On reload with a persisted cartId, this fires immediately and recovers the cart.
  const cart = useCart(cartId ?? undefined);

  const createCart = useCreateCart();
  const prices = useMatchPrices(
    { items: [{ itemId: { itemType: "PRODUCT", id: PRODUCT_ID }, quantity: { quantity: 1 } }] },
    { enabled: cartId !== null },
  );
  const cartMutations = useCartMutations(cartId ?? "");
  const checkout = useCheckout();

  async function startCart(): Promise<void> {
    setError(null);
    try {
      const created = await createCart.mutateAsync({ currency: "CHF" });
      const id = created.cartId;
      if (!id) throw new Error("cart created without an id");
      const { data: matched } = await prices.refetch();
      const p = matched?.[0];
      if (!p?.priceId) throw new Error("no price resolved for the product");
      await cartMutations.addItem.mutateAsync({
        itemYrn: `urn:yaas:hybris:product:product:${client.tenant};${PRODUCT_ID}`,
        quantity: 1,
        price: {
          priceId: p.priceId,
          originalAmount: p.originalValue ?? 0,
          effectiveAmount: p.effectiveValue ?? 0,
          currency: "CHF",
        },
      });
      setCartId(id);
    } catch (e) {
      setError(String(e));
    }
  }

  async function placeOrder(): Promise<void> {
    if (!cartId) return;
    setError(null);
    try {
      const { data: fresh } = await prices.refetch();
      const amount = fresh?.[0]?.effectiveValue ?? 0;
      const r = await checkout.placeOrder.mutateAsync({
        input: {
          cartId,
          customer: { email: "guest@example.com", firstName: "Guest", lastName: "Shopper", guest: true },
          shipping: { methodId: "free", zoneId: "CH", methodName: "Free Shipping", amount: 0 },
          addresses: [
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "BILLING" },
            { contactName: "Guest Shopper", street: "Rämistrasse 71", zipCode: "8006", city: "Zürich", country: "CH", type: "SHIPPING" },
          ],
          paymentMethods: [{ provider: "custom", amount }],
        },
      });
      // Cart is CLOSED on Emporix after a successful order — clear local state.
      storage.setCartId(null);
      setCartId(null);
      setOrderId(r.orderId ?? null);
    } catch (e) {
      setError(String(e));
    }
  }

  function discardCart(): void {
    storage.setCartId(null);
    setCartId(null);
    setOrderId(null);
  }

  const itemCount = cart.data?.items?.length ?? 0;

  return (
    <main>
      <h1>Guest checkout</h1>
      {!cartId && <button onClick={() => void startCart()}>Start guest cart</button>}
      {cartId && <p>Cart: {cartId} ({itemCount} item(s))</p>}
      {prices.data && <p>Unit price: {prices.data[0]?.effectiveValue ?? "—"}</p>}
      {cartId && !orderId && <button onClick={() => void placeOrder()}>Place guest order</button>}
      {cartId && !orderId && <button onClick={discardCart}>Discard cart</button>}
      {orderId && <p>Order placed: {orderId}</p>}
      {error && <pre>{error}</pre>}
    </main>
  );
}
```

- [ ] **Step 2: Build SDK + React so the example typechecks**

```bash
pnpm -F @viu/emporix-sdk build
pnpm -F @viu/emporix-sdk-react build
pnpm -F @viu/emporix-examples-vite-spa typecheck
```

Expected: PASS.

- [ ] **Step 3: Manual runtime smoke against `viu`**

```bash
cat > examples/vite-spa/.env.local <<'EOF'
VITE_EMPORIX_TENANT=viu
VITE_EMPORIX_STOREFRONT_CLIENT_ID=miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO
EOF
pnpm -F @viu/emporix-examples-vite-spa dev
```

Open Chrome DevTools, then:

1. Visit `http://localhost:5173/guest`. Click "Start guest cart". Cart id + unit price appear. Note in the Network panel the **anonymous/login** call (`mode=login`) — first session, expected.
2. **Reload the page (Cmd/Ctrl-R).** Cart id appears immediately; `useCart` GET fires; in the Network panel, the **first auth call** is `…/anonymous/refresh` (not `/login`) — proving session persistence works.
3. Click "Place guest order". Order id appears. Reload again — the "Start guest cart" button is back (cart was cleared).

Tear down:

```bash
# (stop dev server, then)
rm examples/vite-spa/.env.local
```

- [ ] **Step 4: Commit**

```bash
git add examples/vite-spa/src/GuestCheckout.tsx
git commit -m "feat(examples): vite-spa GuestCheckout is hook-only with persistent cart"
```

---

## Task 11: Docs + changeset

**Files:**
- Create: `.changeset/vite-spa-hooks-only-persistent-cart.md`
- Modify: `docs/react.md`
- Modify: `docs/auth.md`

- [ ] **Step 1: Write changeset**

Create `.changeset/vite-spa-hooks-only-persistent-cart.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Hook-only guest checkout + persistent anonymous cart.

**SDK (`@viu/emporix-sdk`)**
- New `AnonymousSessionStore` interface and optional `TokenProvider.attachAnonymousStore`. When a host (e.g. `EmporixProvider`) supplies a store, `DefaultTokenProvider` bootstraps `anon` from the store on first use (taking the refresh-token path, so `sessionId` is preserved) and writes the rotated `refreshToken` + `sessionId` back after every login/refresh. No store → identical to today.
- `invalidateAnonymous()` now also clears the attached store (`write(null)`).

**React (`@viu/emporix-sdk-react`)**
- `TokenStorage` renamed to `EmporixStorage` (alias `TokenStorage` is kept). New methods: `getCartId/setCartId`, `getAnonymousSession/setAnonymousSession`. All three storage backends (memory, `localStorage`, cookie) implement them.
- `EmporixProvider` wires the storage's anonymous-session accessors to the SDK's `attachAnonymousStore` so a guest cart can survive a browser reload.
- New `useCreateCart` mutation hook: creates a cart, hydrates the `useCart(cartId)` query cache, and persists `cartId` via `storage.setCartId`. Auto-detects customer vs anonymous auth.
- `useCheckout` no longer throws on missing customer token — it auto-detects (customer if a token is stored, else anonymous). Backward-compatible for existing logged-in flows.

**Migration**
No code change needed for existing consumers — both packages' changes are additive or strict supersets. New persistence kicks in automatically when consumers use one of the persistent storage backends (`localStorage` / cookie).
```

- [ ] **Step 2: Update `docs/react.md`**

In `docs/react.md`, locate the hooks reference section. Add an entry for `useCreateCart` near `useCartMutations`:

````markdown
### `useCreateCart()`

Mutation that creates a cart and persists the resulting `cartId` so a later reload can resume the same cart. Auto-detects customer vs anonymous auth from `storage.getCustomerToken()`. On success, hydrates the `useCart(cartId)` query cache.

```tsx
const createCart = useCreateCart();
await createCart.mutateAsync({ currency: "CHF" });
// → POST /cart/{tenant}/carts; storage.setCartId(cartId) is called.
```
````

Also add a short subsection on persistent guest carts:

````markdown
### Persistent guest cart

When you use `createLocalStorageStorage()` or `createCookieStorage()` for the `EmporixProvider`'s `storage` prop, the following pieces persist across page reloads:

- `customerToken` — bestehend; bei Login/Logout aktualisiert
- `cartId` — set by `useCreateCart`, cleared on successful `placeOrder` (your consumer is responsible for the latter, as the Example shows)
- `anonymousSession` — `{ refreshToken, sessionId }`, written by `DefaultTokenProvider` on every refresh/login

On reload, the SDK's first call uses the persisted refresh token, which preserves the same `sessionId` and thus the access to the anonymous cart. If the refresh token has expired (>24 h), the SDK falls back to a fresh anonymous login (new `sessionId`) and the old cart becomes inaccessible — surface this to the user as a "discard cart" prompt.

See `examples/vite-spa/src/GuestCheckout.tsx` for the full pattern.
````

- [ ] **Step 3: Update `docs/auth.md`**

Locate the anonymous-session subsection (or create one if it doesn't exist) and add:

````markdown
### Persisting anonymous sessions

The SDK can persist the anonymous refresh token + `sessionId` across page reloads. Wiring is automatic when you use `EmporixProvider` from `@viu/emporix-sdk-react` together with a persistent `EmporixStorage` backend (`createLocalStorageStorage()` or `createCookieStorage()`).

Concretely, after wiring:

- The SDK calls `storage.getAnonymousSession()` once on the first need for an anonymous token; if a session is found, it uses the refresh-token endpoint so `sessionId` is preserved.
- After every successful refresh or login, the SDK calls `storage.setAnonymousSession({ refreshToken, sessionId })`.
- On `invalidateAnonymous()`, the SDK calls `storage.setAnonymousSession(null)`.

**Security note:** anonymous refresh tokens are stored client-side (localStorage or non-HttpOnly cookie) and are therefore exposed to XSS. The 24-hour TTL limits damage. Treat the refresh token like the customer access token — they have similar risk profiles.
````

- [ ] **Step 4: Commit**

```bash
git add .changeset/vite-spa-hooks-only-persistent-cart.md docs/react.md docs/auth.md
git commit -m "docs(docs): document useCreateCart, useCheckout auto-detect, persistent guest cart"
```

---

## Final Verification

- [ ] **Full monorepo build + tests**

```bash
pnpm -r build
pnpm -r test
```

Expected: ALL PASS, no TypeScript errors.

- [ ] **No raw `client.*` calls in `GuestCheckout.tsx`**

```bash
grep -nE "client\.\w+\." examples/vite-spa/src/GuestCheckout.tsx
```

Expected: only `client.tenant` (the YRN-string read) — no `client.carts.*`, `client.prices.*`, `client.checkout.*`.

- [ ] **Reload-recovery smoke (against `viu`)**

1. Start the example: `pnpm -F @viu/emporix-examples-vite-spa dev` (with the `.env.local` from Task 10 Step 3 — or set the same env vars).
2. Navigate to `/guest`, click "Start guest cart", verify cart id renders.
3. Reload. Verify cart id reappears immediately, the first auth call is `/anonymous/refresh`, and `useCart` returns 200 with the cart items.
4. Click "Place guest order". Verify order id renders; reload — start button is back.
5. Manual stale-token test: in DevTools, `localStorage.setItem("emporix.anonymousSession", JSON.stringify({ refreshToken: "broken", sessionId: "broken" }))`, then reload. The auth refresh should fall back to login; `useCart` should error (cart is owned by a different session); the user can click "Discard cart" to reset cleanly.

- [ ] **Changeset present**

```bash
ls .changeset/vite-spa-hooks-only-persistent-cart.md
```

Expected: file exists.

---

## Follow-up (out of scope)

- Same hook-only + persistence treatment for `examples/next-app-router/app/guest-checkout/page.tsx` (SSR + cookies, server-action vs client-component). Open a separate plan when prioritized.
- Cart merge hook on customer login (`POST /cart/{tenant}/carts/{cartId}/merge`): take the anonymous cart that the guest built and link it to the customer's cart after they log in. Open a separate plan when the use case appears in a storefront.
