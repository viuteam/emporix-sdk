# Web Storage Server Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `createLocalStorage()` and `createSessionStorage()` use Web Storage only where a `document` exists, so a Node 26 server never shares one store across requests.

**Architecture:** One internal helper in `packages/sdk/src/core/browser-storage.ts` returns the named Web Storage only when `globalThis.document` is defined; both factories read their store through it and keep their existing memory fallback. React, Angular and Next get the fix through their dependency on `@viu/emporix-sdk`.

**Tech Stack:** TypeScript (`lib: ["ES2022"]`, no DOM), Vitest (`environment: "node"` in `packages/sdk`), changesets, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-23-web-storage-server-guard-design.md`

## Global Constraints

- `packages/sdk` compiles without the DOM lib: reach globals through the existing narrowed `browser` (`BrowserGlobals`), never through ambient DOM types.
- Read `document` **before** touching `localStorage`: on Node 26 reading `localStorage` itself emits an `ExperimentalWarning`.
- The fallback warnings stay byte for byte: `[emporix] localStorage unavailable; falling back to in-memory storage` and `[emporix] sessionStorage unavailable; falling back to in-memory storage`.
- Browser behaviour does not change.
- Release: `patch` for `@viu/emporix-sdk` only. Branch `fix/web-storage-server-guard` (spec already committed as `92fb2591`).
- Everything committed is English; commit subjects follow commitlint (`fix(sdk): <lowercase verb> …`, body lines ≤ 100 chars, no `#N` in body lines).

## Review Focus

1. **Edge runtime or worker** (no `document`, no Web Storage): memory plus the existing warning, no throw. Test in Task 1.
2. **`document` present but the storage missing** (a WebView with storage off, a partial shim): memory plus the warning. Test in Task 1.
3. **A server that shims a global `document`** (older Angular SSR setups that copy domino onto `globalThis`): the check passes, and on Node 26 the shared store is used again. Accepted limitation: the factory's JSDoc says so. The browser-path test in Task 1 pins that a `document` means Web Storage.
4. **The real Node 26 globals**, not stubs: covered by the live check in Task 2.

---

### Task 1: Guard Web Storage behind `document`

**Files:**
- Create: `packages/sdk/tests/core/browser-storage.test.ts`
- Modify: `packages/sdk/src/core/browser-storage.ts:215-245` (`createLocalStorage`, `createSessionStorage`, plus the new helper above them)

**Interfaces:**
- Consumes: `fromWebStorage(storage: WebStorageLike, opts?: { key?: string }): EmporixStorage`, `createMemoryStorage(): EmporixStorage`, `STORAGE_KEYS.customerToken === "emporix.customerToken"` (all existing, same file / `core/storage`).
- Produces: unchanged public signatures `createLocalStorage(opts?: { key?: string }): EmporixStorage` and `createSessionStorage(opts?: { key?: string }): EmporixStorage`. New internal, non-exported helper `documentStorage(name: "localStorage" | "sessionStorage"): WebStorageLike | undefined`.

- [ ] **Step 1: Write the failing tests** in `packages/sdk/tests/core/browser-storage.test.ts`.

Import `createLocalStorage`, `createSessionStorage` from `../../src/core/browser-storage`. Setup:
- a `fakeStorage()` helper returning `{ getItem, setItem, removeItem }` as `vi.fn()`s over a `Map`;
- `beforeEach`: spy `console.warn` (`mockImplementation(() => {})`);
- `afterEach`: `vi.unstubAllGlobals()`, `vi.restoreAllMocks()`, and restore any descriptor you replaced with `Object.defineProperty` (save it with `Object.getOwnPropertyDescriptor(globalThis, name)` first; on Node 26 both names exist natively).

Tests (stub `document` explicitly as `undefined` in the server cases, since `vi.stubGlobal` is what makes them deterministic on every Node version):

```ts
it.each(["sessionStorage", "localStorage"] as const)(
  "%s: without a document, falls back to memory and never writes to the global",
  (name) => {
    const fake = fakeStorage();
    vi.stubGlobal(name, fake);
    vi.stubGlobal("document", undefined);
    const create = name === "sessionStorage" ? createSessionStorage : createLocalStorage;
    const a = create();
    a.setCustomerToken("tok-a");
    expect(fake.setItem).not.toHaveBeenCalled();
    expect(create().getCustomerToken()).toBeNull(); // a second instance shares nothing
    expect(a.getCustomerToken()).toBe("tok-a");
    expect(console.warn).toHaveBeenCalledWith(
      `[emporix] ${name} unavailable; falling back to in-memory storage`,
    );
  },
);

it("without a document, never reads the localStorage global (Node 26 warns on that read)", () => {
  const getter = vi.fn(() => fakeStorage());
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: getter });
  vi.stubGlobal("document", undefined);
  createLocalStorage();
  expect(getter).not.toHaveBeenCalled();
});

it.each(["sessionStorage", "localStorage"] as const)(
  "%s: with a document, uses the Web Storage as in a browser",
  (name) => {
    const fake = fakeStorage();
    vi.stubGlobal(name, fake);
    vi.stubGlobal("document", { cookie: "" });
    const create = name === "sessionStorage" ? createSessionStorage : createLocalStorage;
    create().setCustomerToken("tok");
    expect(fake.setItem).toHaveBeenCalledWith("emporix.customerToken", "tok");
    expect(console.warn).not.toHaveBeenCalled();
  },
);

it.each(["sessionStorage", "localStorage"] as const)(
  "%s: with a document but no storage (Review Focus 2), falls back to memory",
  (name) => { /* stub document { cookie: "" } and `name` as undefined; expect the warning and a working memory store */ },
);

it("in an edge runtime with neither (Review Focus 1), both fall back without throwing", () => {
  /* stub document, localStorage and sessionStorage as undefined; both factories return a store whose setCartId/getCartId round-trip */
});
```

- [ ] **Step 2: Run them to verify the guard is missing**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/core/browser-storage.test.ts`
Expected: the two "without a document, falls back to memory" cases and the "never reads the localStorage global" case FAIL (the fake receives `setItem`; the getter is called). The other cases pass already.

- [ ] **Step 3: Implement `documentStorage(name)` and use it in both factories**

Returns `browser.document === undefined ? undefined : browser[name]`, with the `document` check first. `createLocalStorage` / `createSessionStorage` replace `browser.localStorage` / `browser.sessionStorage` with `documentStorage("localStorage")` / `documentStorage("sessionStorage")`; nothing else in their bodies changes. Update both JSDocs: they fall back to memory wherever there is no `document`, because on a server such as Node 26 the built-in Web Storage is one store shared by every request; a server that shims a global `document` defeats this check (Review Focus 3).

- [ ] **Step 4: Run the file, then the React storage tests that cover the browser path**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/core/browser-storage.test.ts`
Expected: all PASS.
Run: `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react exec vitest run tests/storage.test.ts tests/session-storage.test.ts` (on Node 22 or 24)
Expected: all PASS (jsdom has a `document`, so nothing changes there).

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/browser-storage.ts packages/sdk/tests/core/browser-storage.test.ts
git commit -m "fix(sdk): keep web storage off servers that define it" -m "<why: Node 26's process-wide sessionStorage, SSR writes; what: document check first>"
```

### Task 2: Changeset, verification, live check, PR

**Files:**
- Create: `.changeset/web-storage-server-guard.md`
- Modify (builder's call, per spec): one sentence where storage backends are chosen in `packages/react/README.md`, only if it reads naturally there.

**Interfaces:**
- Consumes: Task 1's unchanged `createLocalStorage` / `createSessionStorage`.

- [ ] **Step 1: Write the changeset** — front matter `"@viu/emporix-sdk": patch`; first line `fix(sdk): keep web storage off servers that define it`; body states the user-visible effect: on Node 26 (and with `--localstorage-file`, and on Deno) `createSessionStorage()` / `createLocalStorage()` no longer use the runtime's server-wide store, so requests stop sharing a customer token; browsers are unchanged; React, Angular and Next pick it up through their dependency.

- [ ] **Step 2: Full verification from the repo root**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm -r test`
Expected: exit 0 for all four; the SDK test count goes up by the new file's cases.

- [ ] **Step 3: Break on purpose** — make `documentStorage` ignore `document` (return `browser[name]` directly), re-run `tests/core/browser-storage.test.ts`.
Expected: the three cases named in Task 1 Step 2 FAIL. Restore, re-run, expect PASS. Record both results for the PR body.

- [ ] **Step 4: Live check on real Node 26 globals** (Review Focus 4) — a scratchpad script (outside the repo) that imports `createSessionStorage` and `createLocalStorage` from `packages/sdk/dist/index.js` by absolute path, writes a token through one `createSessionStorage()` instance, and prints: the second instance's `getCustomerToken()`, and `globalThis.sessionStorage.getItem("emporix.customerToken")`.
Run: `/opt/homebrew/opt/node@26/bin/node <script>`
Expected: `null` and `null`, and stderr shows only the two `[emporix] … falling back` warnings, no `localStorage is not available` warning. Repeat on main's `dist` first if you want the before picture (expected: the global holds the token).

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add .changeset/web-storage-server-guard.md   # plus the README line if added
git commit -m "docs(sdk): describe the web storage guard in a changeset"
git push https://github.com/viuteam/emporix-sdk.git fix/web-storage-server-guard:fix/web-storage-server-guard
gh pr create --repo viuteam/emporix-sdk --base main --title "fix(sdk): keep web storage off servers that define it" --body-file <scratchpad>/pr-body.md
```

PR body: the Node 26 globals table from the spec, the two SSR writers, approach A and why not B/C, Review Focus 3 as a known limitation, verification results from Steps 2–4, and "not reproduced through a running Next.js app". Then bind the PR with the `ccd_pr` tools and offer Auto-fix; do not poll CI.
