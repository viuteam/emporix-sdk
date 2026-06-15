# sessionStorage Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-tab `createSessionStorage` adapter to `@viu/emporix-sdk-react`, backed by `sessionStorage`, sharing one internal `fromWebStorage` helper with the existing localStorage adapter, and clean up the public naming (`createLocalStorage` canonical, `createLocalStorageStorage` deprecated alias).

**Architecture:** `localStorage` and `sessionStorage` are both `Storage` instances, so the 8-key get/set/subscribe wiring is extracted once into an internal `fromWebStorage(storage, opts)` helper. `createLocalStorage` and `createSessionStorage` are thin wrappers that do the availability check + memory fallback, then delegate. All changes are in `packages/react`; additive and non-breaking.

**Tech Stack:** TypeScript, Vitest + jsdom, MSW (not needed here), pnpm workspace, changesets.

---

## Background the engineer needs

- The storage layer lives in `packages/react/src/storage/`. The contract is the
  `EmporixStorage` interface in `storage/index.ts` (8 keys: customerToken,
  cartId, anonymousSession, siteCode, language, activeLegalEntityId,
  refreshToken, saasToken + `subscribe`/`subscribeAll`).
- `storage/index.ts` also exports the internal helpers `createListenerSet` and
  `parseAnonymousSession`, plus the `EmporixStorageKey` type — the new helper
  reuses these.
- Today `local-storage.ts` is a ~88-line factory that owns the key constants
  and all the wiring. After Task 1 it becomes a thin wrapper.
- Tests run under jsdom, which provides **both** `localStorage` and
  `sessionStorage` globals. Mirror the existing `tests/storage.test.ts` style.
- Run a single package's tests with:
  `pnpm -F @viu/emporix-sdk-react test` (append `-- <file>` to scope to one file,
  or `-- -t "<name>"` to scope to one test). Repo-wide typecheck: `pnpm typecheck`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/react/src/storage/web-storage.ts` | **new (internal)** — `fromWebStorage(storage, opts)`: the shared 8-key wiring. |
| `packages/react/src/storage/local-storage.ts` | **modify** — thin wrapper delegating to `fromWebStorage`; exports `createLocalStorage` + deprecated `createLocalStorageStorage` alias. |
| `packages/react/src/storage/session-storage.ts` | **new** — thin wrapper for `sessionStorage`; exports `createSessionStorage`. |
| `packages/react/src/storage/index.ts` | **modify** — re-export `createLocalStorage`, `createSessionStorage`. |
| `packages/react/src/index.ts` | **modify** — add `createLocalStorage`, `createSessionStorage` to the public export block. |
| `packages/react/tests/session-storage.test.ts` | **new** — sessionStorage behaviour + isolation + fallback; `createLocalStorage` parity. |
| `docs/react.md`, `packages/react/README.md` | **modify** — document the new adapter + naming. |
| `.changeset/add-session-storage-adapter.md` | **new** — `minor` release entry. |

---

## Task 1: Extract the `fromWebStorage` helper (behaviour-preserving refactor)

**Files:**
- Create: `packages/react/src/storage/web-storage.ts`
- Modify: `packages/react/src/storage/local-storage.ts`
- Regression test (existing): `packages/react/tests/storage.test.ts`

This task is a refactor verified by the **existing** test suite — no new test is
written first; instead we confirm the suite is green before and after.

- [ ] **Step 1: Confirm the existing storage tests pass (baseline green)**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test.ts`
Expected: PASS (all `localStorage storage`, `cookie storage`, `subscribeAll`,
`siteCode`, `language`, `saasToken` describe-blocks green).

- [ ] **Step 2: Create the shared helper**

Create `packages/react/src/storage/web-storage.ts` with exactly:

```ts
import {
  createListenerSet,
  parseAnonymousSession,
  type EmporixStorage,
  type EmporixStorageKey,
} from "./index";

const DEFAULT_TOKEN_KEY = "emporix.customerToken";
const CART_KEY = "emporix.cartId";
const ANON_KEY = "emporix.anonymousSession";
const SITE_KEY = "emporix.siteCode";
const LANGUAGE_KEY = "emporix.language";
const ACTIVE_LE_KEY = "emporix.activeLegalEntityId";
const REFRESH_KEY = "emporix.refreshToken";
const SAAS_KEY = "emporix.saasToken";

/**
 * Internal: build an {@link EmporixStorage} backed by any Web `Storage`
 * instance (`localStorage` or `sessionStorage`). Both share the identical
 * `getItem`/`setItem`/`removeItem` surface, so the 8-key wiring lives here once.
 * Callers own the availability check + memory fallback before delegating.
 */
export function fromWebStorage(
  storage: Storage,
  opts: { key?: string } = {},
): EmporixStorage {
  const tokenKey = opts.key ?? DEFAULT_TOKEN_KEY;
  const tokenListeners = new Set<(t: string | null) => void>();
  const all = createListenerSet<EmporixStorageKey>();
  return {
    getCustomerToken: () => storage.getItem(tokenKey),
    setCustomerToken: (t) => {
      if (t === null) storage.removeItem(tokenKey);
      else storage.setItem(tokenKey, t);
      for (const l of tokenListeners) l(t);
      all.notify("customerToken");
    },
    subscribe: (l) => {
      tokenListeners.add(l);
      return () => tokenListeners.delete(l);
    },
    getCartId: () => storage.getItem(CART_KEY),
    setCartId: (id) => {
      if (id === null) storage.removeItem(CART_KEY);
      else storage.setItem(CART_KEY, id);
      all.notify("cartId");
    },
    getAnonymousSession: () => parseAnonymousSession(storage.getItem(ANON_KEY)),
    setAnonymousSession: (s) => {
      if (s === null) storage.removeItem(ANON_KEY);
      else
        storage.setItem(
          ANON_KEY,
          JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
        );
      all.notify("anonymousSession");
    },
    getSiteCode: () => storage.getItem(SITE_KEY),
    setSiteCode: (code) => {
      if (code === null) storage.removeItem(SITE_KEY);
      else storage.setItem(SITE_KEY, code);
      all.notify("siteCode");
    },
    getLanguage: () => storage.getItem(LANGUAGE_KEY),
    setLanguage: (l) => {
      if (l === null) storage.removeItem(LANGUAGE_KEY);
      else storage.setItem(LANGUAGE_KEY, l);
      all.notify("language");
    },
    getActiveLegalEntityId: () => storage.getItem(ACTIVE_LE_KEY),
    setActiveLegalEntityId: (id) => {
      if (id === null) storage.removeItem(ACTIVE_LE_KEY);
      else storage.setItem(ACTIVE_LE_KEY, id);
      all.notify("activeLegalEntityId");
    },
    getRefreshToken: () => storage.getItem(REFRESH_KEY),
    setRefreshToken: (t) => {
      if (t === null) storage.removeItem(REFRESH_KEY);
      else storage.setItem(REFRESH_KEY, t);
      all.notify("refreshToken");
    },
    getSaasToken: () => storage.getItem(SAAS_KEY),
    setSaasToken: (t) => {
      if (t === null) storage.removeItem(SAAS_KEY);
      else storage.setItem(SAAS_KEY, t);
      all.notify("saasToken");
    },
    subscribeAll: (l) => all.add(l),
  };
}
```

- [ ] **Step 3: Rewrite `local-storage.ts` as a thin wrapper**

Replace the **entire** contents of
`packages/react/src/storage/local-storage.ts` with:

```ts
import type { EmporixStorage } from "./index";
import { createMemoryStorage } from "./memory";
import { fromWebStorage } from "./web-storage";

/**
 * Browser `localStorage`-backed store: persistent and shared across tabs.
 * Falls back to memory on the server (or when localStorage is unavailable).
 */
export function createLocalStorage(opts: { key?: string } = {}): EmporixStorage {
  const available =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== "undefined";
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] localStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  return fromWebStorage((globalThis as unknown as { localStorage: Storage }).localStorage, opts);
}

/** @deprecated Use {@link createLocalStorage}. Kept for backward compatibility. */
export const createLocalStorageStorage = createLocalStorage;
```

- [ ] **Step 4: Run the existing suite + typecheck (still green = refactor is safe)**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test.ts`
Expected: PASS — identical results to Step 1 (the existing tests import
`createLocalStorageStorage`, which is now the alias, and assert real
`localStorage.getItem(...)` values).

Run: `pnpm typecheck`
Expected: PASS (no unused-import or type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/storage/web-storage.ts packages/react/src/storage/local-storage.ts
git commit -m "refactor(react): extract fromWebStorage helper shared by storage adapters"
```

---

## Task 2: Add the `createSessionStorage` adapter (TDD)

**Files:**
- Test: `packages/react/tests/session-storage.test.ts`
- Create: `packages/react/src/storage/session-storage.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/session-storage.test.ts` with:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createSessionStorage } from "../src/storage/session-storage";

describe("sessionStorage storage", () => {
  beforeEach(() => sessionStorage.clear());

  it("persists and clears the token", () => {
    const s = createSessionStorage();
    expect(s.getCustomerToken()).toBeNull();
    s.setCustomerToken("abc");
    expect(sessionStorage.getItem("emporix.customerToken")).toBe("abc");
    expect(createSessionStorage().getCustomerToken()).toBe("abc");
    s.setCustomerToken(null);
    expect(sessionStorage.getItem("emporix.customerToken")).toBeNull();
  });

  it("uses a custom key", () => {
    createSessionStorage({ key: "k" }).setCustomerToken("z");
    expect(sessionStorage.getItem("k")).toBe("z");
  });

  it("round-trips cartId, anonymousSession, siteCode, language, saasToken", () => {
    const s = createSessionStorage();
    s.setCartId("cart-9");
    expect(sessionStorage.getItem("emporix.cartId")).toBe("cart-9");
    s.setAnonymousSession({ refreshToken: "rt", sessionId: "ss" });
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "rt", sessionId: "ss" });
    s.setSiteCode("main");
    expect(s.getSiteCode()).toBe("main");
    s.setLanguage("de");
    expect(s.getLanguage()).toBe("de");
    s.setSaasToken?.("saas-9");
    expect(s.getSaasToken?.()).toBe("saas-9");
  });

  it("getAnonymousSession returns null on malformed JSON", () => {
    sessionStorage.setItem("emporix.anonymousSession", "not-json{");
    expect(createSessionStorage().getAnonymousSession()).toBeNull();
  });

  it("is isolated from localStorage (per-tab privacy)", () => {
    localStorage.clear();
    createSessionStorage().setCustomerToken("only-session");
    expect(sessionStorage.getItem("emporix.customerToken")).toBe("only-session");
    expect(localStorage.getItem("emporix.customerToken")).toBeNull();
  });

  it("notifies subscribe + subscribeAll on writes", () => {
    const s = createSessionStorage();
    const tokens: (string | null)[] = [];
    const keys: string[] = [];
    s.subscribe!((t) => tokens.push(t));
    s.subscribeAll!((k) => keys.push(k));
    s.setCustomerToken("t");
    s.setCartId("c");
    expect(tokens).toEqual(["t"]);
    expect(keys).toEqual(["customerToken", "cartId"]);
  });

  it("falls back to memory + warns once when sessionStorage is unavailable", () => {
    const orig = globalThis.sessionStorage;
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = createSessionStorage();
    s.setCustomerToken("mem");
    expect(s.getCustomerToken()).toBe("mem");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    Object.defineProperty(globalThis, "sessionStorage", { value: orig, configurable: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- session-storage.test.ts`
Expected: FAIL — module `../src/storage/session-storage` does not exist
(resolve error / "createSessionStorage is not a function").

- [ ] **Step 3: Implement the adapter**

Create `packages/react/src/storage/session-storage.ts` with:

```ts
import type { EmporixStorage } from "./index";
import { createMemoryStorage } from "./memory";
import { fromWebStorage } from "./web-storage";

/**
 * Browser `sessionStorage`-backed store: per-tab persistence that survives a
 * reload but is cleared when the tab closes and is not shared across tabs.
 * Falls back to memory on the server (or when sessionStorage is unavailable).
 */
export function createSessionStorage(opts: { key?: string } = {}): EmporixStorage {
  const available =
    typeof globalThis !== "undefined" &&
    typeof (globalThis as { sessionStorage?: Storage }).sessionStorage !== "undefined";
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("[emporix] sessionStorage unavailable; falling back to in-memory storage");
    return createMemoryStorage();
  }
  return fromWebStorage((globalThis as unknown as { sessionStorage: Storage }).sessionStorage, opts);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test -- session-storage.test.ts`
Expected: PASS (all 7 tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/storage/session-storage.ts packages/react/tests/session-storage.test.ts
git commit -m "feat(react): add createSessionStorage per-tab storage adapter"
```

---

## Task 3: Wire up the public exports (TDD)

**Files:**
- Modify: `packages/react/src/storage/index.ts:117-119`
- Modify: `packages/react/src/index.ts:4-8`
- Test: `packages/react/tests/session-storage.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing export test**

Append this describe block to `packages/react/tests/session-storage.test.ts`:

```ts
import {
  createSessionStorage as createSessionStorageFromBarrel,
  createLocalStorage as createLocalStorageFromBarrel,
} from "../src";
import {
  createLocalStorage,
  createLocalStorageStorage,
} from "../src/storage/local-storage";

describe("public exports", () => {
  beforeEach(() => localStorage.clear());

  it("re-exports createSessionStorage from the package barrel", () => {
    expect(createSessionStorageFromBarrel).toBe(createSessionStorage);
  });

  it("re-exports createLocalStorage from the package barrel", () => {
    expect(createLocalStorageFromBarrel).toBe(createLocalStorage);
  });

  it("createLocalStorageStorage is the deprecated alias of createLocalStorage", () => {
    expect(createLocalStorageStorage).toBe(createLocalStorage);
  });

  it("createLocalStorage writes to localStorage", () => {
    createLocalStorage().setCustomerToken("abc");
    expect(localStorage.getItem("emporix.customerToken")).toBe("abc");
  });
});
```

(Place the new `import` lines at the top of the file with the other imports.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- session-storage.test.ts`
Expected: FAIL — `createSessionStorageFromBarrel`/`createLocalStorageFromBarrel`
are `undefined` (not yet exported from `../src`), so the `toBe` assertions fail.

- [ ] **Step 3: Add the storage barrel re-exports**

In `packages/react/src/storage/index.ts`, the last three lines currently are:

```ts
export { createMemoryStorage } from "./memory";
export { createLocalStorageStorage } from "./local-storage";
export { createCookieStorage } from "./cookie";
```

Replace them with:

```ts
export { createMemoryStorage } from "./memory";
export { createLocalStorage, createLocalStorageStorage } from "./local-storage";
export { createSessionStorage } from "./session-storage";
export { createCookieStorage } from "./cookie";
```

- [ ] **Step 4: Add the package-entry re-exports**

In `packages/react/src/index.ts`, the export block currently is:

```ts
export {
  createMemoryStorage,
  createLocalStorageStorage,
  createCookieStorage,
} from "./storage/index";
```

Replace it with:

```ts
export {
  createMemoryStorage,
  createLocalStorage,
  createLocalStorageStorage,
  createSessionStorage,
  createCookieStorage,
} from "./storage/index";
```

- [ ] **Step 5: Run the test + full package suite + typecheck**

Run: `pnpm -F @viu/emporix-sdk-react test -- session-storage.test.ts`
Expected: PASS (all export tests green).

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: PASS (entire React suite, incl. `storage.test.ts`, still green).

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/storage/index.ts packages/react/src/index.ts packages/react/tests/session-storage.test.ts
git commit -m "feat(react): export createSessionStorage and createLocalStorage"
```

---

## Task 4: Docs + changeset

**Files:**
- Modify: `docs/react.md:25-34`
- Modify: `packages/react/README.md:19-31` and `:73-77`
- Create: `.changeset/add-session-storage-adapter.md`

- [ ] **Step 1: Update the storage-adapter table in `docs/react.md`**

Replace the table at `docs/react.md:27-31` (the `| Adapter | Persistence | Notes |`
table) with:

```markdown
| Adapter | Persistence | Notes |
| --- | --- | --- |
| `createMemoryStorage` (default) | none | SSR-safe; lost on reload |
| `createLocalStorage` (was `createLocalStorageStorage`) | `localStorage` | browser only; persistent and shared across tabs; falls back to memory + warns on the server |
| `createSessionStorage` | `sessionStorage` | browser only; per-tab — survives reload, cleared on tab close, not shared across tabs; falls back to memory + warns on the server |
| `createCookieStorage` | cookie | you must set `sameSite`/`secure`; readable by JS unless you manage an httpOnly cookie server-side |
```

(`createLocalStorageStorage` still works as a deprecated alias — the parenthetical
documents the rename without removing the old name.)

- [ ] **Step 2: Update the README provider example + storage section**

In `packages/react/README.md`, change the import on line 21 and the usage on
line 28 to the canonical name:

```tsx
import { EmporixProvider, createLocalStorage } from "@viu/emporix-sdk-react";
```

```tsx
<EmporixProvider client={client} storage={createLocalStorage()}>
```

Then replace the `## Storage adapters` body (lines 75-77) with:

```markdown
`createMemoryStorage` (default, SSR-safe), `createLocalStorage`,
`createSessionStorage` (per-tab: survives reload, cleared on tab close),
`createCookieStorage`. `createLocalStorageStorage` is a deprecated alias of
`createLocalStorage`. Trade-offs and CSRF notes in
[`../../docs/react.md`](../../docs/react.md).
```

- [ ] **Step 3: Create the changeset**

Create `.changeset/add-session-storage-adapter.md` with:

```markdown
---
"@viu/emporix-sdk-react": minor
---

Add `createSessionStorage` — a per-tab `sessionStorage`-backed storage adapter
(survives a page reload, cleared when the tab closes, not shared across tabs).
Adds `createLocalStorage` as the preferred name for `createLocalStorageStorage`,
which is now deprecated but still exported. Internally the `localStorage` and
`sessionStorage` adapters share one `fromWebStorage` helper.
```

- [ ] **Step 4: Verify the changeset + docs build**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-sdk-react` bumped `minor`; no error.

Run: `pnpm -F @viu/emporix-sdk-react test && pnpm typecheck`
Expected: PASS (final green check before commit).

- [ ] **Step 5: Commit**

```bash
git add docs/react.md packages/react/README.md .changeset/add-session-storage-adapter.md
git commit -m "docs(react): document createSessionStorage adapter and add changeset"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- `fromWebStorage` helper → Task 1 ✓
- `local-storage.ts` delegates + `createLocalStorage` + `@deprecated` alias → Task 1 ✓
- `session-storage.ts` + `createSessionStorage` → Task 2 ✓
- `storage/index.ts` re-exports → Task 3 ✓
- `src/index.ts` public exports → Task 3 ✓
- Tests: round-trip, fallback-to-memory, subscribe/subscribeAll, isolation, `createLocalStorage` parity → Tasks 2 & 3 ✓
- `docs/react.md` + `README.md` (per-tab/privacy semantics) → Task 4 ✓
- `.changeset` minor → Task 4 ✓
- Error-handling parity (warn + memory fallback, no write-probe) → Task 1/2 mirror the localStorage code exactly ✓
- Behaviour-preserving refactor proven by existing `storage.test.ts` staying green → Task 1 Steps 1 & 4 ✓

**Type consistency:** `fromWebStorage(storage: Storage, opts: { key?: string })`,
`createLocalStorage(opts)`, `createSessionStorage(opts)`,
`createLocalStorageStorage` (alias) — names used identically across all tasks and
the barrels. ✓

**Placeholder scan:** none. ✓
