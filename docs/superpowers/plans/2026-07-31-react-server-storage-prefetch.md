# React Server Storage + Generic Prefetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@viu/emporix-sdk-react` usable from a server runtime — an `EmporixStorage` backed by an injected cookie jar, and one generic `prefetchEmporix` that covers every `emporixKey`-shaped read query instead of the three hand-written helpers.

**Architecture:** Two additive exports on the existing `./ssr` entry, plus one behaviour-neutral refactor. The cookie-name↔accessor mapping is extracted out of `storage/cookie.ts` into a shared core that both the browser backend (`document.cookie`) and the new server backend (injected jar) delegate to. Query-key parity is made *structural* by moving the site-meta computation out of `useEmporixQuery` into `query-keys.ts`, so the hook and the prefetch helper compute the trailing meta object with the same function.

**Tech Stack:** TypeScript 5.6+, React 18/19, `@tanstack/react-query` v5, Vitest 2 + `@testing-library/react` + MSW 2, tsup 8 (two-config build), Changesets.

**Spec:** [`../specs/2026-07-31-react-server-storage-prefetch-design.md`](../specs/2026-07-31-react-server-storage-prefetch-design.md)

## Global Constraints

- **Package scope:** all source changes are inside `packages/react`. Do not touch `packages/sdk` or `packages/mixins`.
- **No new dependencies.** No `next` import anywhere in `packages/**/src`. The server storage receives a cookie jar; it never imports one.
- **`EmporixStorage` stays synchronous.** Every accessor keeps the shape `(): string | null` / `(v): void`. Do not make anything `async`.
- **`createServerStorage`, `ServerCookieJar`, `serverAuth`, `prefetchEmporix`, `PrefetchEmporixOpts` and `SiteFields` are exported from `./ssr` ONLY.** Never from `./index`, `./provider`, `./hooks` or `./storage` — those four entries carry a `"use client"` banner (`packages/react/tsup.config.ts`), and exporting a server helper there would turn every importing Server Component into a Client Component.
- **Non-breaking.** `prefetchProduct`, `prefetchCart`, `prefetchOrder` keep byte-identical signatures. Release is a **minor** on `@viu/emporix-sdk-react`.
- **The eight cookie-name literals must exist in exactly one place** after Task 1: `emporix.customerToken`, `emporix.cartId`, `emporix.anonymousSession`, `emporix.siteCode`, `emporix.language`, `emporix.activeLegalEntityId`, `emporix.refreshToken`, `emporix.saasToken`.
- **Two existing test files are the safety net and must pass UNCHANGED:** `packages/react/tests/storage.test.ts` (proves the `cookie.ts` extraction is behaviour-neutral) and `packages/react/tests/use-emporix-query.test.tsx` + `packages/react/tests/ssr.test.tsx` (prove the key refactor is behaviour-neutral). **If any of them needs editing, stop and report — the refactor was not neutral.**
- **Commitlint:** allowed scopes are `repo, release, sdk, react, core, customer, product, category, cart, checkout, payment, price, media, segment, availability, auth, http, logger, deps, docs, examples`. The first word after the scope must be a **lowercase verb**. `feat(react): add createServerStorage` ✓ — `feat(react): Add …` ✗.
- **Branch:** `feat/react-server-storage-prefetch` (already exists, already carries the spec commit).
- **Gates before the final commit:** `pnpm -F @viu/emporix-sdk-react test`, `pnpm typecheck`, `pnpm -F @viu/emporix-sdk-react lint`, and `pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-sdk-react check:dist`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/react/src/storage/cookie-core.ts` (create) | the eight cookie names + the name↔accessor mapping, backend-agnostic | 1 |
| `packages/react/src/storage/cookie.ts` (modify) | `document.cookie` backend: guard, attributes, listener set — delegates the mapping | 1 |
| `packages/react/src/storage/server.ts` (create) | injected-jar backend + read-only warning + `serverAuth` | 2 |
| `packages/react/src/hooks/internal/query-keys.ts` (modify) | owns `SiteFields` and `siteMeta` alongside `emporixKey` | 3 |
| `packages/react/src/hooks/internal/use-emporix-query.ts` (modify) | consumes `siteMeta` instead of inlining it | 3 |
| `packages/react/src/ssr.ts` (modify) | `prefetchEmporix` + the three wrappers + server-storage re-exports | 2, 4 |
| `packages/react/tests/server-storage.test.ts` (create) | jar delegation, read-only warning, `serverAuth` | 2 |
| `packages/react/tests/query-keys.test.ts` (create) | `siteMeta` unit behaviour | 3 |
| `packages/react/tests/prefetch-emporix.test.tsx` (create) | generic prefetch produces a hydration cache hit | 4 |
| `packages/react/tests/prefetch-parity.test.tsx` (create) | the 10 documented descriptors match the hooks' real keys | 5 |
| `docs/react.md` (modify) | descriptor table + three pitfalls | 6 |
| `packages/react/README.md` (modify) | `./ssr` surface | 6 |
| `.changeset/react-server-storage-prefetch.md` (create) | minor | 6 |

Tests live flat in `packages/react/tests/` — the existing 81 test files use no subdirectories. Each test file wires its own `EmporixProvider`; there is no shared harness, so do not create one.

---

## Task 1: Extract the cookie mapping into `cookie-core.ts`

Pure refactor. No new public API. Success is defined by `tests/storage.test.ts` passing without edits.

**Files:**
- Create: `packages/react/src/storage/cookie-core.ts`
- Modify: `packages/react/src/storage/cookie.ts` (currently 100 lines — replace entirely)
- Test: `packages/react/tests/storage.test.ts` (existing, **must not be edited**)

**Interfaces:**
- Consumes: `EmporixStorage`, `EmporixStorageKey`, `PersistedAnonymousSession`, `createListenerSet`, `parseAnonymousSession` from `./index`; `createMemoryStorage` from `./memory`.
- Produces:
  ```ts
  export const COOKIE_NAMES: {
    readonly customerToken: "emporix.customerToken";
    readonly cartId: "emporix.cartId";
    readonly anonymousSession: "emporix.anonymousSession";
    readonly siteCode: "emporix.siteCode";
    readonly language: "emporix.language";
    readonly activeLegalEntityId: "emporix.activeLegalEntityId";
    readonly refreshToken: "emporix.refreshToken";
    readonly saasToken: "emporix.saasToken";
  };
  export interface CookieIo {
    get(name: string): string | null;
    set?(name: string, value: string | null): void;
  }
  export function createCookieBackedStorage(
    io: CookieIo,
    opts?: { tokenName?: string; notify?: (key: EmporixStorageKey) => void },
  ): EmporixStorage;
  ```

- [ ] **Step 1: Read the two files you are about to change**

Read `packages/react/src/storage/cookie.ts` (100 lines) and `packages/react/src/storage/index.ts` (120 lines) in full. You need the exact `EmporixStorage` member list — there are 16 accessors plus three optional members (`subscribe`, `getSaasToken`/`setSaasToken`, `subscribeAll`) — and the exact current cookie names.

- [ ] **Step 2: Run the existing storage tests to record the green baseline**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test.ts`
Expected: PASS. Note the number of passing tests — the same number must pass at the end of this task.

- [ ] **Step 3: Create `cookie-core.ts`**

```ts
import {
  parseAnonymousSession,
  type EmporixStorage,
  type EmporixStorageKey,
} from "./index";

/**
 * The eight persisted session keys, as cookie names. Single source of truth —
 * both the browser backend (`./cookie`) and the server backend (`./server`)
 * read and write through these.
 */
export const COOKIE_NAMES = {
  customerToken: "emporix.customerToken",
  cartId: "emporix.cartId",
  anonymousSession: "emporix.anonymousSession",
  siteCode: "emporix.siteCode",
  language: "emporix.language",
  activeLegalEntityId: "emporix.activeLegalEntityId",
  refreshToken: "emporix.refreshToken",
  saasToken: "emporix.saasToken",
} as const;

/** Backend-agnostic cookie accessor. `set` absent ⇒ the storage is read-only. */
export interface CookieIo {
  get(name: string): string | null;
  /** `null` deletes the cookie. */
  set?(name: string, value: string | null): void;
}

/**
 * Builds an {@link EmporixStorage} over a cookie accessor. Contains the whole
 * name-to-accessor mapping so no backend repeats it.
 *
 * `opts.notify` is a callback rather than a flag so this module stays free of
 * listener-set lifetime: the browser backend owns a `createListenerSet`, passes
 * its `notify` here, and attaches `subscribeAll` to the result itself. This
 * function never sets `subscribeAll` — the server backend therefore has none,
 * which is correct: a server render has no lifetime to observe.
 */
export function createCookieBackedStorage(
  io: CookieIo,
  opts: { tokenName?: string; notify?: (key: EmporixStorageKey) => void } = {},
): EmporixStorage {
  const tokenName = opts.tokenName ?? COOKIE_NAMES.customerToken;
  const notify = opts.notify;

  // Read-only mode: warn once per key so a genuine bug surfaces, but a render
  // loop cannot flood the log.
  const warned = new Set<EmporixStorageKey>();
  const write = (name: string, value: string | null, key: EmporixStorageKey): void => {
    if (io.set === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[emporix] storage is read-only; ignoring write to "${key}". ` +
            "Provide a `set` accessor to enable writes (e.g. from a Server Action).",
        );
      }
      return;
    }
    io.set(name, value);
    notify?.(key);
  };

  return {
    getCustomerToken: () => io.get(tokenName),
    setCustomerToken: (t) => write(tokenName, t, "customerToken"),

    getCartId: () => io.get(COOKIE_NAMES.cartId),
    setCartId: (id) => write(COOKIE_NAMES.cartId, id, "cartId"),

    getAnonymousSession: () => parseAnonymousSession(io.get(COOKIE_NAMES.anonymousSession)),
    setAnonymousSession: (s) =>
      write(
        COOKIE_NAMES.anonymousSession,
        s === null ? null : JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
        "anonymousSession",
      ),

    getSiteCode: () => io.get(COOKIE_NAMES.siteCode),
    setSiteCode: (code) => write(COOKIE_NAMES.siteCode, code, "siteCode"),

    getLanguage: () => io.get(COOKIE_NAMES.language),
    setLanguage: (l) => write(COOKIE_NAMES.language, l, "language"),

    getActiveLegalEntityId: () => io.get(COOKIE_NAMES.activeLegalEntityId),
    setActiveLegalEntityId: (id) =>
      write(COOKIE_NAMES.activeLegalEntityId, id, "activeLegalEntityId"),

    getRefreshToken: () => io.get(COOKIE_NAMES.refreshToken),
    setRefreshToken: (t) => write(COOKIE_NAMES.refreshToken, t, "refreshToken"),

    getSaasToken: () => io.get(COOKIE_NAMES.saasToken),
    setSaasToken: (t) => write(COOKIE_NAMES.saasToken, t, "saasToken"),
  };
}
```

Note: `subscribeAll` is **not** set here. The browser backend adds it (Step 4) because it owns the listener set.

- [ ] **Step 4: Rewrite `cookie.ts` to delegate**

Replace the whole file:

```ts
import { createListenerSet, type EmporixStorage, type EmporixStorageKey } from "./index";
import { createMemoryStorage } from "./memory";
import { createCookieBackedStorage } from "./cookie-core";

/**
 * Cookie-backed store. `Secure` defaults to on for https origins; override
 * with `secure: false` only for non-https dev setups. Consumer must still pick
 * an appropriate `sameSite` for CSRF safety.
 */
export function createCookieStorage(
  opts: { name?: string; secure?: boolean; sameSite?: "lax" | "strict" | "none" } = {},
): EmporixStorage {
  const sameSite = opts.sameSite ?? "lax";
  // Default: Secure on https origins. Tokens must not ride plain-http
  // cookies in production; localhost/http dev keeps working without opts.
  const secure =
    opts.secure ?? (typeof location !== "undefined" && location.protocol === "https:");
  if (typeof document === "undefined") {
    // eslint-disable-next-line no-console
    console.warn("[emporix] document unavailable; cookie storage falling back to in-memory");
    return createMemoryStorage();
  }
  const attrs = `path=/; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
  const all = createListenerSet<EmporixStorageKey>();
  const storage = createCookieBackedStorage(
    {
      get: (name) => {
        for (const part of document.cookie.split("; ")) {
          const [k, ...v] = part.split("=");
          if (k === name) return decodeURIComponent(v.join("=")) || null;
        }
        return null;
      },
      set: (name, value) => {
        document.cookie =
          value === null
            ? `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attrs}`
            : `${name}=${encodeURIComponent(value)}; ${attrs}`;
      },
    },
    {
      ...(opts.name !== undefined ? { tokenName: opts.name } : {}),
      notify: (key) => all.notify(key),
    },
  );
  return { ...storage, subscribeAll: (l) => all.add(l) };
}
```

- [ ] **Step 5: Run the existing storage tests — they must pass unedited**

Run: `pnpm -F @viu/emporix-sdk-react test -- storage.test.ts`
Expected: PASS, same count as Step 2. These tests cover cookie attributes, the `Secure` protocol sniffing, `cartId` round-trip, anonymous-session JSON round-trip, malformed-JSON handling, and `subscribeAll` notification — collectively the proof that the extraction changed no behaviour.

**If any test fails, do not edit the test.** Fix `cookie-core.ts` / `cookie.ts` until it passes.

- [ ] **Step 6: Verify the cookie names now live in exactly one place**

Run: `grep -rn 'emporix\.customerToken\|emporix\.cartId\|emporix\.anonymousSession\|emporix\.siteCode\|emporix\.language\|emporix\.activeLegalEntityId\|emporix\.refreshToken\|emporix\.saasToken' packages/react/src`
Expected: every hit is inside `packages/react/src/storage/cookie-core.ts`. Hits in `local-storage.ts` / `session-storage.ts` / `web-storage.ts` are acceptable and out of scope — those backends use the same names as *storage* keys, not cookie names. Record which files still hold literals; the answer belongs in the commit message.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm -F @viu/emporix-sdk-react typecheck && pnpm -F @viu/emporix-sdk-react lint`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/storage/cookie-core.ts packages/react/src/storage/cookie.ts
git commit -m "refactor(react): extract cookie name mapping into cookie-core

Behaviour-neutral: tests/storage.test.ts passes unedited. Prepares a second
backend (injected cookie jar) without duplicating the eight-name mapping."
```

---

## Task 2: `createServerStorage` and `serverAuth`

**Files:**
- Create: `packages/react/src/storage/server.ts`
- Modify: `packages/react/src/ssr.ts` (add re-exports at the top; leave the existing prefetch functions untouched in this task)
- Test: `packages/react/tests/server-storage.test.ts` (create)

**Interfaces:**
- Consumes: `createCookieBackedStorage`, `CookieIo` from `./cookie-core` (Task 1); `EmporixStorage` from `./index`; `auth`, `AuthContext` from `@viu/emporix-sdk`.
- Produces:
  ```ts
  export interface ServerCookieJar {
    get(name: string): string | null;
    set?(name: string, value: string | null): void;
  }
  export function createServerStorage(jar: ServerCookieJar): EmporixStorage;
  export function serverAuth(storage: EmporixStorage): AuthContext;
  ```
  All three are re-exported from `./ssr` and consumed by Task 5's parity test and Task 6's docs.

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/server-storage.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { auth } from "@viu/emporix-sdk";
import { createServerStorage, serverAuth } from "../src/storage/server";

/** A minimal in-object cookie jar, standing in for `await cookies()`. */
function jar(initial: Record<string, string> = {}) {
  const bag = new Map(Object.entries(initial));
  return {
    bag,
    get: (name: string) => bag.get(name) ?? null,
    set: (name: string, value: string | null) => {
      if (value === null) bag.delete(name);
      else bag.set(name, value);
    },
  };
}

afterEach(() => vi.restoreAllMocks());

describe("createServerStorage", () => {
  it("reads all eight keys through the injected jar", () => {
    const j = jar({
      "emporix.customerToken": "cust",
      "emporix.cartId": "cart-1",
      "emporix.siteCode": "main",
      "emporix.language": "de",
      "emporix.activeLegalEntityId": "le-1",
      "emporix.refreshToken": "rt",
      "emporix.saasToken": "saas",
      "emporix.anonymousSession": JSON.stringify({ refreshToken: "art", sessionId: "sid" }),
    });
    const s = createServerStorage(j);

    expect(s.getCustomerToken()).toBe("cust");
    expect(s.getCartId()).toBe("cart-1");
    expect(s.getSiteCode()).toBe("main");
    expect(s.getLanguage()).toBe("de");
    expect(s.getActiveLegalEntityId()).toBe("le-1");
    expect(s.getRefreshToken()).toBe("rt");
    expect(s.getSaasToken?.()).toBe("saas");
    expect(s.getAnonymousSession()).toEqual({ refreshToken: "art", sessionId: "sid" });
  });

  it("returns null for absent keys and for a malformed anonymous session", () => {
    const s = createServerStorage(jar({ "emporix.anonymousSession": "not-json" }));
    expect(s.getCustomerToken()).toBeNull();
    expect(s.getCartId()).toBeNull();
    expect(s.getAnonymousSession()).toBeNull();
  });

  it("writes through the jar when a set accessor is supplied", () => {
    const j = jar();
    const s = createServerStorage(j);

    s.setCustomerToken("t1");
    s.setCartId("c1");
    s.setAnonymousSession({ refreshToken: "r", sessionId: "s" });
    expect(j.bag.get("emporix.customerToken")).toBe("t1");
    expect(j.bag.get("emporix.cartId")).toBe("c1");
    expect(JSON.parse(j.bag.get("emporix.anonymousSession") as string)).toEqual({
      refreshToken: "r",
      sessionId: "s",
    });

    s.setCustomerToken(null);
    expect(j.bag.has("emporix.customerToken")).toBe(false);
  });

  it("read-only when set is omitted: no throw, warns once per key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const j = jar({ "emporix.customerToken": "cust" });
    const s = createServerStorage({ get: j.get });

    expect(() => s.setCustomerToken("new")).not.toThrow();
    s.setCustomerToken("again");
    s.setCartId("c1");

    // Reads still work.
    expect(s.getCustomerToken()).toBe("cust");
    // Two distinct keys warned about, and customerToken only once.
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("customerToken"))).toHaveLength(1);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("cartId"))).toHaveLength(1);
  });

  it("omits subscribe and subscribeAll — a server render has no lifetime to observe", () => {
    const s = createServerStorage(jar());
    expect(s.subscribe).toBeUndefined();
    expect(s.subscribeAll).toBeUndefined();
  });
});

describe("serverAuth", () => {
  it("resolves a customer context when a token is stored", () => {
    const s = createServerStorage(jar({ "emporix.customerToken": "cust" }));
    expect(serverAuth(s)).toEqual(auth.customer("cust"));
  });

  it("resolves an anonymous context when no token is stored", () => {
    const s = createServerStorage(jar());
    expect(serverAuth(s)).toEqual(auth.anonymous());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- server-storage.test.ts`
Expected: FAIL — `Failed to resolve import "../src/storage/server"`.

- [ ] **Step 3: Write `server.ts`**

```ts
import { auth, type AuthContext } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./index";
import { createCookieBackedStorage } from "./cookie-core";

/**
 * A synchronous cookie accessor supplied by the caller. Deliberately
 * synchronous: {@link EmporixStorage} is synchronous throughout, so any
 * `await` (e.g. Next's `await cookies()`) belongs to the caller.
 *
 * Omit `set` for a read-only storage. Next.js forbids cookie writes during a
 * Server Component render — only Server Actions and Route Handlers may write.
 */
export interface ServerCookieJar {
  get(name: string): string | null;
  /** `null` deletes the cookie. */
  set?(name: string, value: string | null): void;
}

/**
 * An {@link EmporixStorage} reading (and optionally writing) through a
 * caller-supplied cookie jar — for RSC, Server Actions, Route Handlers, or any
 * other server runtime.
 *
 * `subscribe` / `subscribeAll` are absent: a server render has no lifetime over
 * which to observe changes.
 *
 * ```ts
 * // Next.js Server Component (read-only)
 * const jar = await cookies();
 * const storage = createServerStorage({ get: (n) => jar.get(n)?.value ?? null });
 *
 * // Next.js Server Action (read-write)
 * const jar = await cookies();
 * const storage = createServerStorage({
 *   get: (n) => jar.get(n)?.value ?? null,
 *   set: (n, v) =>
 *     v === null
 *       ? jar.delete(n)
 *       : jar.set(n, v, { httpOnly: true, sameSite: "lax", secure: true, path: "/" }),
 * });
 * ```
 */
export function createServerStorage(jar: ServerCookieJar): EmporixStorage {
  return createCookieBackedStorage(
    jar.set !== undefined ? { get: jar.get, set: jar.set } : { get: jar.get },
  );
}

/**
 * Resolves the {@link AuthContext} a server-side read should use, mirroring
 * exactly what `useEmporixQuery` resolves on the client: the customer context
 * when a token is stored, anonymous otherwise.
 *
 * Use this rather than hand-rolling it — `authKind` is part of every query key,
 * so a mismatch here produces a silent cache miss (a second fetch after
 * hydration, no error).
 */
export function serverAuth(storage: EmporixStorage): AuthContext {
  const token = storage.getCustomerToken();
  return token !== null ? auth.customer(token) : auth.anonymous();
}
```

Note the explicit `jar.set !== undefined` branch: the repo runs with `exactOptionalPropertyTypes`-style strictness in places, and passing `{ get, set: undefined }` is not the same as omitting `set`. Keep the branch.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test -- server-storage.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Re-export from the `./ssr` entry**

Add to the **top** of `packages/react/src/ssr.ts`, after the existing imports:

```ts
export {
  createServerStorage,
  serverAuth,
  type ServerCookieJar,
} from "./storage/server";
```

Do **not** add these to `src/index.ts`, `src/storage/index.ts`, `src/provider.tsx` or `src/hooks/index.ts`.

- [ ] **Step 6: Prove the RSC boundary still holds**

Run: `pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-sdk-react check:dist`
Expected: `dist "use client" banners OK`. This confirms `dist/ssr.js` and `dist/ssr.cjs` still carry no `"use client"` directive after gaining a storage import — the whole point of putting the export here rather than in `./storage`.

- [ ] **Step 7: Confirm no `next` import leaked in**

Run: `grep -rn 'next/' packages/react/src packages/sdk/src packages/mixins/src`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/storage/server.ts packages/react/src/ssr.ts packages/react/tests/server-storage.test.ts
git commit -m "feat(react): add createServerStorage and serverAuth to the ssr entry

An EmporixStorage over a caller-supplied cookie jar, read-only unless a set
accessor is given (Next forbids cookie writes during a Server Component
render). serverAuth mirrors useEmporixQuery's auth resolution so server-side
prefetch keys match the client's."
```

---

## Task 3: Move `SiteFields` and `siteMeta` into `query-keys.ts`

Behaviour-neutral. This is what makes key parity structural rather than tested.

**Files:**
- Modify: `packages/react/src/hooks/internal/query-keys.ts` (currently 35 lines)
- Modify: `packages/react/src/hooks/internal/use-emporix-query.ts` (currently 80 lines — remove the local `SiteFields` type at line ~10 and the inline site-meta ternary at lines ~63–68)
- Test: `packages/react/tests/query-keys.test.ts` (create); `packages/react/tests/use-emporix-query.test.tsx` (existing, **must not be edited**)

**Interfaces:**
- Produces:
  ```ts
  export type SiteFields = "full" | "language" | "none";
  export function siteMeta(
    site: SiteFields,
    siteCode: string | null,
    language: string | null,
  ): { siteCode?: string | null; language?: string | null };
  ```
  `SiteFields` is re-exported as a type from `./ssr` in Task 4 and used by `PrefetchEmporixOpts`.

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/query-keys.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emporixKey, siteMeta } from "../src/hooks/internal/query-keys";

describe("siteMeta", () => {
  it("'full' carries both siteCode and language", () => {
    expect(siteMeta("full", "main", "de")).toEqual({ siteCode: "main", language: "de" });
  });

  it("'full' preserves nulls rather than dropping the fields", () => {
    expect(siteMeta("full", null, null)).toEqual({ siteCode: null, language: null });
  });

  it("'language' carries only language", () => {
    const meta = siteMeta("language", "main", "de");
    expect(meta).toEqual({ language: "de" });
    expect("siteCode" in meta).toBe(false);
  });

  it("'none' carries neither", () => {
    expect(siteMeta("none", "main", "de")).toEqual({});
  });
});

describe("emporixKey with siteMeta", () => {
  it("produces the shape the hooks assert (read-auth + full site)", () => {
    expect(
      emporixKey("product", ["p1"], {
        tenant: "acme",
        authKind: "anonymous",
        ...siteMeta("full", null, null),
      }),
    ).toEqual([
      "emporix",
      "product",
      "p1",
      { tenant: "acme", authKind: "anonymous", siteCode: null, language: null },
    ]);
  });

  it("drops site fields entirely for 'none'", () => {
    expect(
      emporixKey("sites", [], { tenant: "acme", authKind: "anonymous", ...siteMeta("none", "main", "de") }),
    ).toEqual(["emporix", "sites", { tenant: "acme", authKind: "anonymous" }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- query-keys.test.ts`
Expected: FAIL — `siteMeta` is not exported from `query-keys`.

- [ ] **Step 3: Add `SiteFields` and `siteMeta` to `query-keys.ts`**

Append to `packages/react/src/hooks/internal/query-keys.ts`:

```ts
/** Which site discriminators go into the query key's meta object. */
export type SiteFields = "full" | "language" | "none";

/**
 * Builds the site portion of a query key's meta object. Shared by
 * `useEmporixQuery` (client) and `prefetchEmporix` (server) so the two cannot
 * disagree about which discriminators a resource carries — key parity is
 * structural, not tested.
 *
 * Note `null` is preserved rather than dropped: an unbound site is a distinct
 * cache identity from a bound one, and `emporixKey` only omits a field when it
 * is `undefined`.
 */
export function siteMeta(
  site: SiteFields,
  siteCode: string | null,
  language: string | null,
): { siteCode?: string | null; language?: string | null } {
  return site === "full"
    ? { siteCode, language }
    : site === "language"
      ? { language }
      : {};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test -- query-keys.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Make `use-emporix-query.ts` consume it**

Two edits in `packages/react/src/hooks/internal/use-emporix-query.ts`:

1. Delete the local type alias (around line 10):
```ts
/** Which site discriminators go into the query key's meta object. */
type SiteFields = "full" | "language" | "none";
```
and change the import from `./query-keys` to bring in both symbols:
```ts
import { emporixKey, siteMeta, type SiteFields } from "./query-keys";
```

2. Replace the inline ternary (around lines 63–68):
```ts
  const siteMeta =
    cfg.site === "full"
      ? { siteCode, language }
      : cfg.site === "language"
        ? { language }
        : {};
```
with:
```ts
  const meta = siteMeta(cfg.site, siteCode, language);
```
and update the single use below it from `...siteMeta` to `...meta`.

The local `const` must be renamed — leaving it as `siteMeta` would shadow the imported function.

- [ ] **Step 6: Run the existing hook tests — they must pass unedited**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-emporix-query.test.tsx`
Expected: PASS, 4 tests. These assert the exact key arrays for `site: "full"`, `"language"` and `"none"` — the proof that the extraction changed nothing.

**If any fails, do not edit the test.** Fix `siteMeta`.

- [ ] **Step 7: Run the whole react suite**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: PASS. Every read hook routes through `useEmporixQuery`, so a regression here would be broad and loud.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/hooks/internal/query-keys.ts packages/react/src/hooks/internal/use-emporix-query.ts packages/react/tests/query-keys.test.ts
git commit -m "refactor(react): move siteMeta into query-keys for shared key building

useEmporixQuery and the upcoming prefetchEmporix now compute the site portion
of a query key with the same function, so client and server keys cannot drift.
Behaviour-neutral: use-emporix-query.test.tsx passes unedited."
```

---

## Task 4: `prefetchEmporix`, with the three helpers as wrappers

**Files:**
- Modify: `packages/react/src/ssr.ts`
- Test: `packages/react/tests/prefetch-emporix.test.tsx` (create); `packages/react/tests/ssr.test.tsx` (existing, **must not be edited**)

**Interfaces:**
- Consumes: `emporixKey`, `siteMeta`, `SiteFields` from `./hooks/internal/query-keys` (Task 3).
- Produces:
  ```ts
  export interface PrefetchEmporixOpts<T, TArgs extends readonly unknown[]> {
    client: EmporixClient;
    resource: string;
    args: TArgs;
    site: SiteFields;
    auth?: AuthContext;
    siteCode?: string | null;
    language?: string | null;
    queryFn: (ctx: AuthContext) => Promise<T>;
  }
  export function prefetchEmporix<T, TArgs extends readonly unknown[]>(
    qc: QueryClient,
    opts: PrefetchEmporixOpts<T, TArgs>,
  ): Promise<void>;
  export type { SiteFields };
  ```
  Task 5's parity test calls `prefetchEmporix`; Task 6 documents it.

- [ ] **Step 1: Write the failing test**

Create `packages/react/tests/prefetch-emporix.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EmporixClient, auth } from "@viu/emporix-sdk";
import { prefetchEmporix } from "../src/ssr";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useSites } from "../src/hooks/use-sites";

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
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
}

describe("prefetchEmporix", () => {
  it("defaults to an anonymous context and null site fields", async () => {
    const qc = new QueryClient();
    const client = makeClient();
    await prefetchEmporix(qc, {
      client,
      resource: "thing",
      args: ["t1"],
      site: "full",
      queryFn: () => Promise.resolve({ id: "t1" }),
    });
    expect(
      qc.getQueryData([
        "emporix",
        "thing",
        "t1",
        { tenant: "acme", authKind: "anonymous", siteCode: null, language: null },
      ]),
    ).toEqual({ id: "t1" });
  });

  it("keys authKind from the supplied auth context", async () => {
    const qc = new QueryClient();
    await prefetchEmporix(qc, {
      client: makeClient(),
      resource: "mine",
      args: [],
      site: "none",
      auth: auth.customer("cust"),
      queryFn: () => Promise.resolve(["x"]),
    });
    expect(qc.getQueryData(["emporix", "mine", { tenant: "acme", authKind: "customer" }])).toEqual([
      "x",
    ]);
  });

  it("'language' site carries only language; 'none' carries neither", async () => {
    const qc = new QueryClient();
    const client = makeClient();
    await prefetchEmporix(qc, {
      client,
      resource: "ling",
      args: [1],
      site: "language",
      language: "de",
      queryFn: () => Promise.resolve(1),
    });
    expect(
      qc.getQueryData(["emporix", "ling", 1, { tenant: "acme", authKind: "anonymous", language: "de" }]),
    ).toBe(1);

    await prefetchEmporix(qc, {
      client,
      resource: "bare",
      args: [],
      site: "none",
      siteCode: "main",
      language: "de",
      queryFn: () => Promise.resolve(2),
    });
    expect(qc.getQueryData(["emporix", "bare", { tenant: "acme", authKind: "anonymous" }])).toBe(2);
  });

  it("passes the resolved context to queryFn", async () => {
    let seen = "";
    await prefetchEmporix(new QueryClient(), {
      client: makeClient(),
      resource: "ctx",
      args: [],
      site: "none",
      auth: auth.customer("cust"),
      queryFn: (ctx) => {
        seen = ctx.kind;
        return Promise.resolve(null);
      },
    });
    expect(seen).toBe("customer");
  });

  it("produces a real hydration cache hit for a hook that bypasses useEmporixQuery", async () => {
    let hits = 0;
    server.use(
      http.get("https://api.emporix.io/site/acme/sites", () => {
        hits += 1;
        return HttpResponse.json([{ code: "main", name: "Main", default: true, active: true }]);
      }),
    );
    const client = makeClient();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });

    await prefetchEmporix(qc, {
      client,
      resource: "sites",
      args: [],
      site: "none",
      queryFn: (ctx) => client.sites.list(ctx),
    });
    expect(hits).toBe(1);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={qc}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useSites(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(hits).toBe(1); // no refetch — the key matched
  });
});
```

Both details are verified, not guessed: `useSites` (`hooks/use-sites.ts:15-16`) calls `client.sites.list(ctx)` and keys `emporixKey("sites", [], { tenant, authKind })` — no site fields, so `site: "none"`. The endpoint is `GET /site/{tenant}/sites` (`packages/sdk/src/services/site.ts:39`), which is why the MSW handler above uses `https://api.emporix.io/site/acme/sites`.

`useSites` is deliberately the subject of the last test: it bypasses `useEmporixQuery` and calls `emporixKey` directly, so it proves `prefetchEmporix` covers the hand-built-key hooks too, not just the declarative ones.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- prefetch-emporix.test.tsx`
Expected: FAIL — `prefetchEmporix` is not exported from `../src/ssr`.

- [ ] **Step 3: Add `prefetchEmporix` to `ssr.ts`**

Change the import line in `packages/react/src/ssr.ts` from
```ts
import { emporixKey } from "./hooks/internal/query-keys";
```
to
```ts
import { emporixKey, siteMeta, type SiteFields } from "./hooks/internal/query-keys";
```

Add after the `PrefetchSiteOpts` interface:

```ts
export type { SiteFields };

/**
 * Everything needed to reproduce a read hook's query key on the server.
 *
 * `resource`, `args` and `site` must match the hook's own descriptor — see the
 * table in `docs/react.md`. A mismatch is a silent cache miss: no error, just a
 * second fetch after hydration.
 */
export interface PrefetchEmporixOpts<T, TArgs extends readonly unknown[]> {
  client: EmporixClient;
  /** The hook's `resource` literal, e.g. `"product"`. */
  resource: string;
  /** The hook's `args` tuple, e.g. `[productId]`. */
  args: TArgs;
  /** Which site discriminators the hook puts in its key. */
  site: SiteFields;
  /** Defaults to `auth.anonymous()`. Use `serverAuth(storage)` to mirror the client. */
  auth?: AuthContext;
  /** Must match what the client provider binds; `null` (the default) = unbound. */
  siteCode?: string | null;
  language?: string | null;
  queryFn: (ctx: AuthContext) => Promise<T>;
}

/**
 * Server-side prefetch for any read hook whose key is built with `emporixKey`.
 * Writes the same cache entry the hook reads, so client hydration is a cache
 * hit. Create the `EmporixClient` once per server, never per request.
 *
 * `useAvailability` / `useAvailabilities` are NOT supported — their keys predate
 * `emporixKey` and use a different shape. See `docs/react.md`.
 */
export async function prefetchEmporix<T, TArgs extends readonly unknown[]>(
  qc: QueryClient,
  opts: PrefetchEmporixOpts<T, TArgs>,
): Promise<void> {
  const ctx = opts.auth ?? auth.anonymous();
  await qc.prefetchQuery({
    queryKey: emporixKey(opts.resource, opts.args, {
      tenant: opts.client.tenant,
      authKind: ctx.kind,
      ...siteMeta(opts.site, opts.siteCode ?? null, opts.language ?? null),
    }),
    queryFn: () => opts.queryFn(ctx),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react test -- prefetch-emporix.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 5: Rewrite the three existing helpers as wrappers**

Replace the bodies of `prefetchProduct`, `prefetchCart` and `prefetchOrder` in `packages/react/src/ssr.ts`. **Keep every signature, parameter name, default and JSDoc block exactly as it is** — only the body changes.

```ts
// prefetchProduct body:
  await prefetchEmporix(qc, {
    client,
    resource: "product",
    args: [productId],
    site: "full",
    auth: authCtx,
    siteCode: opts.siteCode ?? null,
    language: opts.language ?? null,
    queryFn: (ctx) => client.products.get(productId, undefined, ctx),
  });

// prefetchCart body:
  await prefetchEmporix(qc, {
    client,
    resource: "cart",
    args: [cartId, opts.activeCompanyId ?? null],
    site: "full",
    auth: authCtx,
    siteCode: opts.siteCode ?? null,
    language: opts.language ?? null,
    queryFn: (ctx) => client.carts.get(cartId, ctx),
  });

// prefetchOrder body:
  await prefetchEmporix(qc, {
    client,
    resource: "orders",
    args: [orderId],
    site: "language",
    auth: authCtx,
    language: opts.language ?? null,
    queryFn: (ctx) =>
      client.orders.get(orderId, ctx, opts.saasToken ? { saasToken: opts.saasToken } : {}),
  });
```

`prefetchOrder` passes no `siteCode` — `site: "language"` drops it anyway, and omitting it documents the intent.

- [ ] **Step 6: Run the existing SSR tests — they must pass unedited**

Run: `pnpm -F @viu/emporix-sdk-react test -- ssr.test.tsx`
Expected: PASS, 4 tests. One of them asserts the literal key array `["emporix", "orders", "o-1", { tenant: "acme", authKind: "customer", language: null }]` and another asserts zero client refetch after `prefetchProduct` — together the proof that the wrappers produce byte-identical keys.

**If either fails, do not edit the test.** The wrapper mapping is wrong; re-read the hook descriptor.

- [ ] **Step 7: Full gates**

Run: `pnpm -F @viu/emporix-sdk-react test && pnpm -F @viu/emporix-sdk-react typecheck && pnpm -F @viu/emporix-sdk-react lint && pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-sdk-react check:dist`
Expected: all clean, `dist "use client" banners OK`.

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/ssr.ts packages/react/tests/prefetch-emporix.test.tsx
git commit -m "feat(react): add prefetchEmporix covering every emporixKey read query

One generic server-side prefetch replaces the need for a helper per resource;
prefetchProduct/Cart/Order become wrappers with unchanged signatures, proven
by ssr.test.tsx passing unedited."
```

---

## Task 5: Parity test for the 10 documented descriptors

This is the guard that lets Task 6's table be trusted. Each descriptor below was read off the hook source, not inferred.

**Files:**
- Test: `packages/react/tests/prefetch-parity.test.tsx` (create)

**Interfaces:**
- Consumes: `prefetchEmporix` from `../src/ssr` (Task 4); the ten hooks from `../src/hooks/*`.
- Produces: nothing consumed by later tasks. Task 6's table must list exactly the rows this test covers.

**The ten descriptors (verified against source on 2026-07-31):**

| Hook | Source | `resource` | `args` | `site` | `mode` |
|---|---|---|---|---|---|
| `useProduct` | `use-products.ts:19` | `product` | `[productId]` | `full` | read-auth |
| `useProducts` | `use-products.ts:33` | `products` | `[params]` | `full` | read-auth |
| `useProductByCode` | `use-products.ts:66` | `product-by-code` | `[code]` | `full` | read-auth |
| `useCategory` | `use-categories.ts:28` | `category` | `[categoryId]` | `full` | read-auth |
| `useCategories` | `use-categories.ts:58` | `categories` | `[params]` | `full` | read-auth |
| `useProductsInCategory` | `use-categories.ts:148` | `products-in-category` | `[categoryId, params]` | `full` | read-auth |
| `useCart` | `use-cart.ts:38` | `cart` | `[cartId, activeCompanyId ?? null]` | `full` | read-auth |
| `useOrder` | `use-order.ts:17` | `orders` | `[orderId]` | `language` | customer |
| `useMyOrders` | `use-my-orders.ts:34` | `orders` | `["mine", legalEntityId ?? null, status ?? null, pageNumber ?? 1, pageSize ?? null, qString]` | `full` | customer |
| `useSites` | `use-sites.ts:15` | `sites` | `[]` | `none` | read-auth |

Two traps to respect:
- `useOrder` and `useMyOrders` share `resource: "orders"` but differ in `site`. They do not collide because `useMyOrders` prefixes its args with the literal `"mine"`.
- The two `mode: "customer"` hooks key `authKind` as `"customer"` when a token is stored. The test must store a token for those two and pass `auth.customer(...)` to `prefetchEmporix`.

- [ ] **Step 1: Read every hook in the table to confirm its descriptor**

Read `use-products.ts`, `use-categories.ts`, `use-cart.ts`, `use-order.ts`, `use-my-orders.ts` and `use-sites.ts` in `packages/react/src/hooks/`. Confirm each `resource` / `args` / `site` / `mode` against the table above. **If any row differs from the source, the source wins** — correct the table here, in the test, and in Task 6's docs table, and note the correction in the commit message.

- [ ] **Step 2: Write the failing test**

Create `packages/react/tests/prefetch-parity.test.tsx`:

```tsx
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EmporixClient, auth, type AuthContext } from "@viu/emporix-sdk";
import { prefetchEmporix, type SiteFields } from "../src/ssr";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useProduct, useProducts, useProductByCode } from "../src/hooks/use-products";
import { useCategory, useCategories, useProductsInCategory } from "../src/hooks/use-categories";
import { useCart } from "../src/hooks/use-cart";
import { useOrder } from "../src/hooks/use-order";
import { useMyOrders } from "../src/hooks/use-my-orders";
import { useSites } from "../src/hooks/use-sites";

// All queries are disabled/never-resolving in this suite: we compare KEYS, not
// data. The anonymous-login handler is still needed because the provider's
// token bootstrap runs on mount.
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
  http.all("https://api.emporix.io/*", () => new Promise(() => {})), // hang: keys only
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

/** One table row: the hook, and the descriptor a server would hand prefetchEmporix. */
interface Row {
  name: string;
  render: () => unknown;
  resource: string;
  args: readonly unknown[];
  site: SiteFields;
  /** Customer-gated hooks need a stored token and a customer context. */
  customer?: boolean;
}

const PARAMS = { pageSize: 24 } as const;

const ROWS: Row[] = [
  { name: "useProduct", render: () => useProduct("p1"), resource: "product", args: ["p1"], site: "full" },
  { name: "useProducts", render: () => useProducts(PARAMS), resource: "products", args: [PARAMS], site: "full" },
  { name: "useProductByCode", render: () => useProductByCode("slug"), resource: "product-by-code", args: ["slug"], site: "full" },
  { name: "useCategory", render: () => useCategory("c1"), resource: "category", args: ["c1"], site: "full" },
  { name: "useCategories", render: () => useCategories(PARAMS), resource: "categories", args: [PARAMS], site: "full" },
  { name: "useProductsInCategory", render: () => useProductsInCategory("c1", PARAMS), resource: "products-in-category", args: ["c1", PARAMS], site: "full" },
  { name: "useCart", render: () => useCart("cart1"), resource: "cart", args: ["cart1", null], site: "full" },
  { name: "useOrder", render: () => useOrder("o1"), resource: "orders", args: ["o1"], site: "language", customer: true },
  { name: "useMyOrders", render: () => useMyOrders(), resource: "orders", args: ["mine", null, null, 1, null, null], site: "full", customer: true },
  { name: "useSites", render: () => useSites(), resource: "sites", args: [], site: "none" },
];

function makeClient(): EmporixClient {
  return new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
}

describe.each(ROWS)("prefetch parity: $name", (row) => {
  it("the documented descriptor reproduces the hook's key exactly", async () => {
    const client = makeClient();
    const storage = createMemoryStorage(row.customer ? { initial: "cust" } : {});
    const hookQc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={hookQc}>
        {children}
      </EmporixProvider>
    );

    renderHook(() => row.render(), { wrapper });
    await waitFor(() =>
      expect(hookQc.getQueryCache().getAll().some((q) => q.queryKey[1] === row.resource)).toBe(true),
    );
    const hookKeys = hookQc
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[1] === row.resource)
      .map((q) => q.queryKey);

    const ctx: AuthContext = row.customer ? auth.customer("cust") : auth.anonymous();
    const serverQc = new QueryClient();
    await prefetchEmporix(serverQc, {
      client,
      resource: row.resource,
      args: row.args,
      site: row.site,
      auth: ctx,
      queryFn: () => Promise.resolve(null),
    });
    const serverKey = serverQc.getQueryCache().getAll()[0]!.queryKey;

    // The hook's cache may hold sibling entries under the same resource
    // (useOrder vs useMyOrders both use "orders"); the descriptor must match
    // exactly one of them.
    expect(hookKeys).toContainEqual(serverKey);
  });
});
```

Note the `describe.each` + `$name` interpolation: each row reports as its own test, so a failure names the drifted hook directly.

- [ ] **Step 3: Run it and expect real failures**

Run: `pnpm -F @viu/emporix-sdk-react test -- prefetch-parity.test.tsx`
Expected: some rows FAIL on the first attempt. This is normal and is the point of the exercise — likely causes, in order of likelihood:

1. **A hook needs more setup than `render` provides** (e.g. `useCart` resolving a cart id from storage rather than the argument). Read the hook, adjust the `render` thunk or seed `storage` — never loosen the assertion.
2. **`useMyOrders` args differ** — `activeCompany?.id` comes from the B2B context; with no active company it is `null`, which the row already assumes. If `qString` or a default differs, correct the row from the source.
3. **A hook is `enabled: false` and never enters the cache**, so `waitFor` times out. Give the hook an argument that enables it.

For each failure, fix the **row**, not the assertion. If a row cannot be made to match because the hook's key genuinely cannot be reproduced by `prefetchEmporix`, remove that row and record it in Task 6's docs as an exclusion alongside `useAvailability` — and say so in the commit message.

- [ ] **Step 4: Run until all rows pass**

Run: `pnpm -F @viu/emporix-sdk-react test -- prefetch-parity.test.tsx`
Expected: PASS, 10 tests (or fewer, if Step 3 forced a documented removal).

- [ ] **Step 5: Run the whole suite**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/react/tests/prefetch-parity.test.tsx
git commit -m "test(react): assert documented prefetch descriptors match hook keys

Ten hooks: renders each, reads its real query key, and compares against the
descriptor a server would pass to prefetchEmporix. The docs table can no
longer drift silently."
```

---

## Task 6: Docs and changeset

**Files:**
- Modify: `docs/react.md` (the *SSR / RSC* section, currently lines ~629–655)
- Modify: `packages/react/README.md` (the *Errors & SSR* section, line ~95; and *Subpath exports*, line ~110)
- Create: `.changeset/react-server-storage-prefetch.md`

**Interfaces:**
- Consumes: everything from Tasks 2, 4 and 5. The docs table must list exactly the rows the parity test covers.
- Produces: nothing.

- [ ] **Step 1: Replace the *SSR / RSC* section of `docs/react.md`**

Keep the existing "Two patterns" list and the "Critical rule" line. Add the following after them, and fold the existing *Common pitfalls* bullets into the new pitfalls list rather than duplicating them:

````markdown
### Server-side session

`createServerStorage` builds an `EmporixStorage` over a cookie jar you supply.
It is synchronous by design — any `await` (Next's `cookies()`) belongs to you:

```ts
import { cookies } from "next/headers";
import { createServerStorage, serverAuth } from "@viu/emporix-sdk-react/ssr";

// Server Component — read-only. Next forbids cookie writes during render.
const jar = await cookies();
const storage = createServerStorage({ get: (n) => jar.get(n)?.value ?? null });
const ctx = serverAuth(storage); // customer if a token is stored, else anonymous
```

```ts
// Server Action / Route Handler — read-write.
const jar = await cookies();
const storage = createServerStorage({
  get: (n) => jar.get(n)?.value ?? null,
  set: (n, v) =>
    v === null
      ? jar.delete(n)
      : jar.set(n, v, { httpOnly: true, sameSite: "lax", secure: true, path: "/" }),
});
```

Omitting `set` makes every setter a no-op that warns once per key. There is no
`next` import in the package — the same jar shape works for Remix, SvelteKit,
Nitro or a plain Express handler.

Use `serverAuth(storage)` rather than resolving the context by hand: `authKind`
is part of every query key, so a mismatch is a silent cache miss.

### Prefetching any read hook

`prefetchEmporix` writes the same cache entry a hook reads. It needs the hook's
three key ingredients — `resource`, `args` and `site`:

```ts
await prefetchEmporix(qc, {
  client: sdk,
  resource: "products-in-category",
  args: [categoryId, { pageSize: 24 }],
  site: "full",
  auth: ctx,
  siteCode: storage.getSiteCode(),
  queryFn: (c) => sdk.categories.listProducts(categoryId, { pageSize: 24 }, c),
});
```

| Hook | `resource` | `args` | `site` |
| --- | --- | --- | --- |
| `useProduct` | `product` | `[productId]` | `full` |
| `useProducts` | `products` | `[params]` | `full` |
| `useProductByCode` | `product-by-code` | `[code]` | `full` |
| `useCategory` | `category` | `[categoryId]` | `full` |
| `useCategories` | `categories` | `[params]` | `full` |
| `useProductsInCategory` | `products-in-category` | `[categoryId, params]` | `full` |
| `useCart` | `cart` | `[cartId, activeCompanyId ?? null]` | `full` |
| `useOrder` | `orders` | `[orderId]` | `language` |
| `useMyOrders` | `orders` | `["mine", legalEntityId, status, pageNumber, pageSize, q]` | `full` |
| `useSites` | `sites` | `[]` | `none` |

`useOrder` and `useMyOrders` share `resource: "orders"` with different `site`
values; they don't collide because `useMyOrders` prefixes its args with `"mine"`.

These rows are asserted against the real hook keys in
`packages/react/tests/prefetch-parity.test.tsx` — that file is the reference for
the ~33 further read queries not tabulated here. `prefetchProduct`,
`prefetchCart` and `prefetchOrder` remain as convenience wrappers.

### Pitfalls

- **Per-request client** — recreating `EmporixClient` per request defeats token
  caching and leaks state. One per server. `createServerStorage` is the
  opposite: it is per request, because the cookie jar is.
- **`httpOnly` breaks the client side** — if a Server Action writes
  `emporix.customerToken` with `httpOnly: true`, the browser-side
  `createCookieStorage` cannot read it and the provider mounts unauthenticated.
  That is the security win, and the footgun. The supported pattern is the
  existing one: the server reads the cookie and passes `initialCustomerToken`,
  which seeds `createMemoryStorage`.
- **Token hydration** — the server reads the cookie and passes
  `initialCustomerToken`; the client provider seeds storage from it so the first
  render is authenticated (no flash of logged-out UI).
- **Cart-merge timing** — log the customer in *before* merging the anonymous
  cart; merge requires the customer token and the preserved `sessionId` (see
  [`auth.md`](./auth.md)).
- **`useAvailability` / `useAvailabilities` cannot be prefetched** — their keys
  predate `emporixKey` and use a different shape (`anon: boolean` instead of
  `authKind`, no positional args). Call `client.availability.*` directly on the
  server and pass the result down as a prop.
- **`prefetchOrder` with `auth.raw(...)`** — `useOrder` is customer-gated and
  keys `authKind: "customer"`, while `prefetchOrder` keys `authCtx.kind`. With
  `auth.customer(token)` they agree; with `auth.raw(jwt)` they don't, and you
  get a silent refetch. Use `auth.customer(...)` for order prefetch.
````

- [ ] **Step 2: Update `packages/react/README.md`**

Replace the *Errors & SSR* section body:

```markdown
`<EmporixErrorBoundary>` and `useEmporixErrorHandler` for error coordination.
For servers (RSC, Server Actions, Remix/SvelteKit loaders): `createServerStorage`
+ `serverAuth` resolve the session from an injected cookie jar, and
`prefetchEmporix` prefills the cache for any read hook (`prefetchProduct` /
`prefetchCart` / `prefetchOrder` are convenience wrappers). All from
`@viu/emporix-sdk-react/ssr`, which carries no `"use client"` directive. See
[`../../docs/react.md`](../../docs/react.md).
```

Leave the *Subpath exports* line (`.`, `./provider`, `./hooks`, `./storage`, `./ssr`) unchanged — no new subpath was added.

- [ ] **Step 3: Create the changeset**

`.changeset/react-server-storage-prefetch.md`:

```markdown
---
"@viu/emporix-sdk-react": minor
---

Server-runtime support on the `./ssr` entry.

- `createServerStorage(jar)` — an `EmporixStorage` over a caller-supplied cookie
  jar, for RSC / Server Actions / Route Handlers / loaders. Synchronous, so
  `await cookies()` stays with the caller. Read-only unless a `set` accessor is
  given (Next forbids cookie writes during a Server Component render); writes
  then no-op and warn once per key.
- `serverAuth(storage)` — resolves the same `AuthContext` the client hooks
  resolve (customer if a token is stored, else anonymous). `authKind` is part of
  every query key, so this prevents silent cache misses.
- `prefetchEmporix(qc, opts)` — server-side prefetch for any read hook whose key
  is built with `emporixKey`, replacing the need for a helper per resource.
  `prefetchProduct` / `prefetchCart` / `prefetchOrder` keep their signatures and
  are now wrappers.

No new dependency and no `next` import — the jar shape works for any server
framework. `useAvailability` / `useAvailabilities` are not prefetchable; their
keys predate `emporixKey`. See `docs/react.md`.
```

- [ ] **Step 4: Verify the docs table matches the parity test**

Run: `grep -c '^| `use' docs/react.md`
Then compare against the number of rows in `ROWS` in `packages/react/tests/prefetch-parity.test.tsx`. The two counts must agree. If Task 5 Step 3 removed a row, remove it here too.

- [ ] **Step 5: Full repo gates**

Run: `pnpm -r test && pnpm typecheck && pnpm lint`
Expected: all clean. `pnpm typecheck` covers the examples too, which typecheck against the built `dist/` — if it fails on an example, run `pnpm -F @viu/emporix-sdk-react build` first.

- [ ] **Step 6: Commit**

```bash
git add docs/react.md packages/react/README.md .changeset/react-server-storage-prefetch.md
git commit -m "docs(react): document server storage, generic prefetch and the descriptor table

Adds the ten verified prefetch descriptors, the httpOnly/per-request-client
pitfalls, and the two documented exclusions (availability hooks, prefetchOrder
with auth.raw)."
```

- [ ] **Step 7: Push and open the PR**

```bash
git push origin feat/react-server-storage-prefetch
```

PR body must state: additive minor; the three existing prefetch signatures are unchanged; `tests/storage.test.ts`, `tests/use-emporix-query.test.tsx` and `tests/ssr.test.tsx` all pass unedited as the behaviour-neutrality proof; and the two follow-ups (key normalization for the availability hooks + the `prefetchOrder` `authKind` mismatch; the `examples/next-app-router` migration).

---

## Follow-ups (explicitly NOT in this plan)

1. **One key-normalization PR** — fix the `prefetchOrder` / `useOrder` `authKind` mismatch and move `useAvailability` / `useAvailabilities` onto `emporixKey`. Both change cache keys and therefore invalidate consumer caches, which is why they are separate and need their own changeset note.
2. **`examples/next-app-router` migration** — consume `createServerStorage`, drop the duplicated cookie-name literal in `app/actions.ts`, and consolidate the two module-scope `EmporixClient` instances into one.
3. **`@viu/emporix-sdk-next` decision** — worth a package at two or more Next storefronts, otherwise a `docs/nextjs.md`. Needs the Emporix webhook signature scheme checked first (`docs/webhook.md` documents `secretKey` as write-only but not the header scheme).
