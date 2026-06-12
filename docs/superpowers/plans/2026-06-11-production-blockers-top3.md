# Production Blockers Top-3 (B1–B3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three production blockers from the 2026-06-11 enterprise code review in one PR: (B1) stop retrying non-idempotent POSTs in the SDK HTTP layer, (B2) purge the entire `["emporix"]` query-cache namespace on logout, (B3) ship `"use client"` banners in the React package's client dist entries, with a CI guard.

**Architecture:** B1 adds an idempotency gate plus an `idempotent?: boolean` opt-in flag to the retry logic in `HttpClient.request`, and caps rogue `Retry-After` values at the existing 8s backoff ceiling. B2 collapses two scoped `removeQueries` calls into one namespace-wide purge. B3 splits the react tsup config into a bannered client build and a banner-free `ssr` build, verified by a `check:dist` node script wired into `pr-check.yml`.

**Tech Stack:** TypeScript (strict), tsup/esbuild, Vitest + MSW (`msw/node`), @testing-library/react, Changesets, GitHub Actions.

**Branch & PR:** Work directly on the already-created `feature/analyse` branch (verify with `git branch --show-current`). One PR against `main`. Commits must pass commitlint: scope from the allowlist (`http`, `react`, `repo`, …), first word after the scope a lowercase verb.

**Pre-verified facts (so you don't have to re-derive them):**
- `HttpClient.request` retry block: `packages/sdk/src/core/http.ts:162-173`. `RequestOptions` interface: `http.ts:11-21`.
- Logout purge: `packages/react/src/hooks/use-customer-session.ts:201-202`.
- No existing test counts POST attempts on 5xx — `packages/sdk/tests/services/cart.test.ts:155` and `price.test.ts:142/170` assert error outcomes only, so B1 breaks nothing.
- tsup `banner` is required because esbuild silently drops `"use client"` directives from bundled output.
- Existing test conventions: SDK HTTP tests live in `packages/sdk/tests/http-retry.test.ts` (MSW `setupServer`, shared `attempts` counter reset in `afterEach`, `sleep: () => Promise.resolve()`); react session tests in `packages/react/tests/use-customer-session.test.tsx` (MSW + `renderHook` + `EmporixProvider` wrapper).

---

## Task 1: B1 — Idempotency gate for HTTP retry (SDK)

**Files:**
- Modify: `packages/sdk/src/core/http.ts:11-21` (RequestOptions) and `packages/sdk/src/core/http.ts:162-173` (retry block)
- Test: `packages/sdk/tests/http-retry.test.ts` (extend)
- Create: `.changeset/post-retry-idempotency.md`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("HttpClient retry + 401 asymmetry", ...)` block in `packages/sdk/tests/http-retry.test.ts`. Also add `EmporixServerError` to the existing import from `../src/core/errors` (it currently imports only `EmporixAuthError`), and make sure `HttpClient`, `LevelResolver`, `MemoryLogger`, and `provider` are in scope (they already are at module level).

```ts
  it("does not retry POST on 5xx (non-idempotent)", async () => {
    server.use(
      mhttp.post("https://api.emporix.io/orders", () => {
        attempts += 1;
        return HttpResponse.json({ e: 1 }, { status: 503 });
      }),
    );
    await expect(
      client().request({ method: "POST", path: "/orders", auth: { kind: "service" }, body: {} }),
    ).rejects.toBeInstanceOf(EmporixServerError);
    expect(attempts).toBe(1);
  });

  it("does not retry POST on 429", async () => {
    server.use(
      mhttp.post("https://api.emporix.io/orders", () => {
        attempts += 1;
        return HttpResponse.json({ e: 1 }, { status: 429, headers: { "Retry-After": "0" } });
      }),
    );
    await expect(
      client().request({ method: "POST", path: "/orders", auth: { kind: "service" }, body: {} }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });

  it("does not retry PATCH on 5xx (non-idempotent by spec)", async () => {
    server.use(
      mhttp.patch("https://api.emporix.io/orders/o1", () => {
        attempts += 1;
        return HttpResponse.json({ e: 1 }, { status: 503 });
      }),
    );
    await expect(
      client().request({ method: "PATCH", path: "/orders/o1", auth: { kind: "service" }, body: {} }),
    ).rejects.toBeInstanceOf(EmporixServerError);
    expect(attempts).toBe(1);
  });

  it("still retries PUT on 5xx (idempotent by spec)", async () => {
    server.use(
      mhttp.put("https://api.emporix.io/orders/o1", () => {
        attempts += 1;
        if (attempts < 3) return HttpResponse.json({ e: 1 }, { status: 503 });
        return HttpResponse.json({ ok: true });
      }),
    );
    const r = await client().request<{ ok: boolean }>({
      method: "PUT", path: "/orders/o1", auth: { kind: "service" }, body: {},
    });
    expect(r.ok).toBe(true);
    expect(attempts).toBe(3);
  });

  it("retries POST on 5xx when explicitly marked idempotent (read-only search endpoints)", async () => {
    server.use(
      mhttp.post("https://api.emporix.io/products/search", () => {
        attempts += 1;
        if (attempts < 3) return HttpResponse.json({ e: 1 }, { status: 503 });
        return HttpResponse.json({ ok: true });
      }),
    );
    const r = await client().request<{ ok: boolean }>({
      method: "POST", path: "/products/search", auth: { kind: "service" }, body: {}, idempotent: true,
    });
    expect(r.ok).toBe(true);
    expect(attempts).toBe(3);
  });

  it("caps a rogue Retry-After at the 8s backoff ceiling", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/rated-long", () => {
        attempts += 1;
        if (attempts < 2) {
          return HttpResponse.json({ e: 1 }, { status: 429, headers: { "Retry-After": "86400" } });
        }
        return HttpResponse.json({ ok: true });
      }),
    );
    const slept: number[] = [];
    const resolver = new LevelResolver({ level: "silent" });
    const c = new HttpClient({
      host: "https://api.emporix.io",
      provider,
      logger: new MemoryLogger(resolver, { service: "http" }),
      retry: { maxAttempts: 3 },
      timeouts: { connectMs: 500, readMs: 500 },
      sleep: (ms) => { slept.push(ms); return Promise.resolve(); },
    });
    const r = await c.request<{ ok: boolean }>({
      method: "GET", path: "/rated-long", auth: { kind: "service" },
    });
    expect(r.ok).toBe(true);
    expect(slept).toEqual([8000]); // 86400s capped to 8000ms
  });
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm -F @viu/emporix-sdk test -- http-retry`
Expected: the POST/PATCH tests FAIL with `expected 3 to be 1` (attempts), `idempotent` may also produce a TS error (property does not exist) — both confirm the gate is missing. The PUT test passes already (current behavior).

- [ ] **Step 3: Implement the gate in `packages/sdk/src/core/http.ts`**

(a) Extend `RequestOptions` — insert after the `timeoutMs?: number;` member (line 20):

```ts
  /**
   * Marks this request as safe to retry on 5xx/429 despite a non-idempotent
   * method. GET/PUT/DELETE retry by default; POST/PATCH only with this flag
   * (a 5xx can arrive after the server already committed — retrying e.g.
   * placeOrder would duplicate the order/charge).
   */
  idempotent?: boolean;
```

(b) Replace the retry block (currently lines 162-173):

```ts
      // Retry 5xx / 429.
      const retryable = res.status >= 500 || res.status === 429;
      if (retryable && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter >= 0
            ? retryAfter * 1000
            : Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.random() * 100;
        log.warn("retryable failure", { status: res.status, attempt, backoffMs: backoff });
        await this.sleep(backoff);
        continue;
      }
```

with:

```ts
      // Retry 5xx / 429 — gated on idempotency: a 5xx can arrive AFTER the
      // server committed the write (e.g. placeOrder), so replaying a POST
      // could duplicate orders/charges. GET/PUT/DELETE are idempotent by
      // spec; POST/PATCH retry only when the caller opts in.
      const idempotent =
        o.method === "GET" ||
        o.method === "PUT" ||
        o.method === "DELETE" ||
        o.idempotent === true;
      const retryable = idempotent && (res.status >= 500 || res.status === 429);
      if (retryable && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get("Retry-After"));
        const backoff =
          Number.isFinite(retryAfter) && retryAfter >= 0
            ? Math.min(retryAfter * 1000, 8000) // cap rogue Retry-After (e.g. 86400)
            : Math.min(1000 * 2 ** (attempt - 1), 8000) + Math.random() * 100;
        log.warn("retryable failure", { status: res.status, attempt, backoffMs: backoff });
        await this.sleep(backoff);
        continue;
      }
```

- [ ] **Step 4: Run the retry tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk test -- http-retry`
Expected: ALL tests in `http-retry.test.ts` PASS (4 pre-existing + 6 new).

- [ ] **Step 5: Run the full SDK suite (regression check)**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS. (Pre-verified: no existing test counts POST attempts; `cart.test.ts:155` / `price.test.ts:142/170` assert error outcomes only.)

- [ ] **Step 6: Author the changeset**

Create `.changeset/post-retry-idempotency.md`:

```md
---
"@viu/emporix-sdk": minor
---

fix the HTTP retry to never replay non-idempotent requests: POST/PATCH responses with 5xx/429 are no longer retried automatically (a 5xx can arrive after the server committed — retrying `placeOrder` could duplicate orders/charges). Read-only POST endpoints can opt back in via the new `RequestOptions.idempotent: true` flag. Numeric `Retry-After` waits are now capped at 8s.
```

(`minor` because `idempotent` is a new public API surface on `RequestOptions`.)

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/core/http.ts packages/sdk/tests/http-retry.test.ts .changeset/post-retry-idempotency.md
git commit -m "fix(http): skip 5xx/429 retry for non-idempotent methods"
```

**Explicitly out of scope (do NOT do here):** marking existing read-only POST endpoints (`products.searchByIds`, `price.matchByContext`, …) with `idempotent: true` — that is a follow-up sweep, not a blocker.

---

## Task 2: B2 — Logout purges the entire emporix cache namespace (React)

**Files:**
- Modify: `packages/react/src/hooks/use-customer-session.ts:201-202`
- Test: `packages/react/tests/use-customer-session.test.tsx` (extend)
- Create: `.changeset/logout-purges-namespace.md`

- [ ] **Step 1: Write the failing test**

Insert after the test `"logout clears the stored cart id (the customer cart is invalid anonymously)"` (around line 137) in `packages/react/tests/use-customer-session.test.tsx`. All needed imports (`QueryClient`, `EmporixClient`, `EmporixProvider`, `createMemoryStorage`, `renderHook`, `act`, `ReactNode`) already exist at the top of the file.

```tsx
  it("logout purges the entire emporix cache namespace (cross-user data)", async () => {
    const storage = createMemoryStorage({ initial: "cust" });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    const wrap = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
        {children}
      </EmporixProvider>
    );
    // Customer-scoped caches the old logout left alive: payment-modes is keyed
    // by authKind (no user id, 10-min staleTime), orders likewise — a later
    // login as a DIFFERENT customer would be served this data from cache.
    const paymentModesKey = ["emporix", "payment-modes", { tenant: "acme", authKind: "customer" }];
    const ordersKey = ["emporix", "orders", "list", { tenant: "acme", authKind: "customer" }];
    queryClient.setQueryData(paymentModesKey, [{ id: "card" }]);
    queryClient.setQueryData(ordersKey, { items: [{ id: "o-1" }] });

    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrap });
    await act(async () => {
      await result.current.logout();
    });

    expect(queryClient.getQueryData(paymentModesKey)).toBeUndefined();
    expect(queryClient.getQueryData(ordersKey)).toBeUndefined();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-session`
Expected: the new test FAILS — `getQueryData(paymentModesKey)` returns `[{ id: "card" }]` instead of `undefined` (only `customer`/`cart` keys are removed today).

- [ ] **Step 3: Implement the namespace purge**

In `packages/react/src/hooks/use-customer-session.ts`, replace lines 201-202:

```ts
    qc.removeQueries({ queryKey: ["emporix", "customer"] });
    qc.removeQueries({ queryKey: ["emporix", "cart"] });
```

with:

```ts
    // Purge EVERYTHING under the emporix namespace: customer-scoped caches
    // (payment-modes, orders, …) are keyed by authKind without a user id, so
    // a later login as a different customer would be served the previous
    // customer's data straight from cache. bootstrap-cart.ts already
    // documents this contract.
    qc.removeQueries({ queryKey: ["emporix"] });
```

- [ ] **Step 4: Run the session tests to verify they pass**

Run: `pnpm -F @viu/emporix-sdk-react test -- use-customer-session`
Expected: ALL tests in the file PASS (the broader purge is a superset of the old behavior, so the pre-existing logout tests keep passing).

- [ ] **Step 5: Run the full react suite (regression check)**

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: PASS.

- [ ] **Step 6: Author the changeset**

Create `.changeset/logout-purges-namespace.md`:

```md
---
"@viu/emporix-sdk-react": patch
---

fix logout to purge the entire `["emporix"]` query-cache namespace. Previously only the `customer` and `cart` keys were removed, so customer-scoped caches without a user discriminator (payment modes, order lists) survived logout and could be served to the next logged-in customer straight from cache.
```

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/hooks/use-customer-session.ts packages/react/tests/use-customer-session.test.tsx .changeset/logout-purges-namespace.md
git commit -m "fix(react): purge entire emporix cache namespace on logout"
```

---

## Task 3: B3 — `"use client"` banner in client dist entries + CI guard (React)

**Files:**
- Create: `packages/react/scripts/check-dist.mjs`
- Modify: `packages/react/package.json` (add `check:dist` script)
- Modify: `packages/react/tsup.config.ts` (full rewrite, split config)
- Modify: `.github/workflows/pr-check.yml` (guard step after "Build pkgs", line 37-38)
- Create: `.changeset/react-use-client-banner.md`

- [ ] **Step 1: Create the dist guard (this is the "failing test")**

Create `packages/react/scripts/check-dist.mjs`:

```js
// Guards the RSC boundary contract of the published package:
// - client entries (index/provider/hooks/storage) MUST start with "use client"
//   (esbuild drops source directives; tsup must re-add them via `banner`).
// - the ssr entry MUST stay directive-free so it remains importable from
//   React Server Components.
import { readFileSync } from "node:fs";

const HEAD_BYTES = 200;
const mustHaveBanner = ["index", "provider", "hooks", "storage"];
const mustNotHaveBanner = ["ssr"];
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

if (failed) process.exit(1);
console.log('dist "use client" banners OK');
```

In `packages/react/package.json`, add to `"scripts"` (next to `"build": "tsup"`):

```json
    "check:dist": "node scripts/check-dist.mjs",
```

- [ ] **Step 2: Build and run the guard to verify it fails**

Run: `pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-sdk-react check:dist`
Expected: FAIL with `FAIL dist/index.js: missing "use client" banner` (and the same for provider/hooks/storage). Exit code 1.

- [ ] **Step 3: Rewrite `packages/react/tsup.config.ts`**

Replace the entire file with:

```ts
import { defineConfig } from "tsup";

const shared = {
  format: ["esm", "cjs"] as const,
  dts: true,
  sourcemap: true,
  treeshake: true,
  external: ["react", "react-dom", "@tanstack/react-query", "@viu/emporix-sdk"],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: "src/index.ts",
      provider: "src/provider.tsx",
      hooks: "src/hooks/index.ts",
      storage: "src/storage/index.ts",
    },
    clean: true,
    // RSC boundary marker: these entries evaluate createContext/hooks at
    // module scope and must load as Client Components under the Next.js App
    // Router. esbuild drops "use client" from bundled sources — the banner
    // re-adds it to every emitted file of this build.
    banner: { js: '"use client";' },
  },
  {
    ...shared,
    entry: { ssr: "src/ssr.ts" },
    // NO banner: ssr.ts must stay importable from Server Components.
    // clean MUST be false — a second `clean: true` would wipe the first
    // config's freshly written output.
    clean: false,
  },
]);
```

- [ ] **Step 4: Rebuild and run the guard to verify it passes**

Run: `pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-sdk-react check:dist`
Expected: `dist "use client" banners OK`, exit code 0.

Known-acceptable adjustment: if tsup turns out not to apply `banner` to the CJS output, relax the guard to check only `.js` for `mustHaveBanner` (the ESM build is what Next.js resolves) — but verify by reading `dist/index.cjs` first.

- [ ] **Step 5: Regression: react unit tests + repo typecheck against the new dist**

Run: `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react test && pnpm typecheck`
Expected: PASS. (Examples typecheck against the built `dist/` of both packages — both must be freshly built; the banner is a no-op string literal for non-RSC consumers, so nothing else changes.)

- [ ] **Step 6: Wire the guard into CI**

In `.github/workflows/pr-check.yml`, insert after the "Build pkgs" step (currently lines 35-38):

```yaml
      # esbuild silently drops "use client" directives — guard that the react
      # client entries keep their banner and ssr stays server-importable.
      - name: Check react dist "use client" banners
        run: pnpm -F @viu/emporix-sdk-react check:dist
```

(Keep YAML indentation identical to the neighboring steps: 6 spaces before `- name:`.)

- [ ] **Step 7: Author the changeset**

Create `.changeset/react-use-client-banner.md`:

```md
---
"@viu/emporix-sdk-react": patch
---

ship a `"use client"` directive in the built client entries (`.`, `./provider`, `./hooks`, `./storage`) so they load as Client Components under the Next.js App Router without every consumer having to add their own `"use client"` wrapper file. `./ssr` stays directive-free and remains importable from Server Components — in server code, import `prefetchProduct`/`prefetchCart`/`prefetchOrder` from `@viu/emporix-sdk-react/ssr`, not from the package root.
```

- [ ] **Step 8: Commit**

```bash
git add packages/react/tsup.config.ts packages/react/scripts/check-dist.mjs packages/react/package.json .github/workflows/pr-check.yml .changeset/react-use-client-banner.md
git commit -m "fix(react): ship use client banner in client dist entries"
```

---

## Task 4: Final verification + PR

**Files:** none (verification + git only)

- [ ] **Step 1: Full workspace verification**

```bash
pnpm -r build && pnpm -r test && pnpm typecheck
```
Expected: every package builds, all unit tests pass, repo-wide tsc clean.

- [ ] **Step 2: Verify the changesets are recognized**

Run: `pnpm changeset status`
Expected: lists `@viu/emporix-sdk` (minor) and `@viu/emporix-sdk-react` (patch) with the three changeset files. This is what CI's `changeset-check.yml` will verify.

- [ ] **Step 3: Confirm branch and push**

```bash
git branch --show-current   # expected: feature/analyse (NOT main)
git push -u origin feature/analyse
```

- [ ] **Step 4: Open the PR against `main`**

```bash
gh pr create --base main --title "fix(repo): harden retry idempotency, logout cache purge, and RSC entry markers" --body "$(cat <<'EOF'
## Summary

Fixes the three production blockers from the 2026-06-11 enterprise code review:

- **B1 (sdk, minor):** `HttpClient.request` no longer retries POST/PATCH on 5xx/429 — a 5xx can arrive after the server committed (e.g. `placeOrder`), so a replay could duplicate orders/charges. New `RequestOptions.idempotent: true` opt-in for read-only POSTs. Rogue `Retry-After` values are capped at 8s.
- **B2 (react, patch):** `logout()` now purges the entire `["emporix"]` query-cache namespace. Previously payment-modes/order caches (keyed by `authKind` without a user id) survived logout and could be served to the next customer.
- **B3 (react, patch):** Built client entries (`.`, `./provider`, `./hooks`, `./storage`) now carry a `"use client"` banner so they load as Client Components under the Next.js App Router; `./ssr` stays server-importable. A new `check:dist` guard runs in `pr-check.yml` so esbuild can never silently drop the directive again.

## Test plan

- [ ] `pnpm -r test` — new coverage: 6 retry-gate tests (`http-retry.test.ts`), 1 logout-purge test (`use-customer-session.test.tsx`)
- [ ] `pnpm -F @viu/emporix-sdk-react check:dist` — banner guard green
- [ ] `pnpm typecheck` — examples compile against the new dist
- [ ] `pnpm changeset status` — 3 changesets (sdk minor, react 2× patch)

Follow-up (not in this PR): mark read-only POST endpoints (`products.searchByIds`, `price.matchByContext`, …) `idempotent: true` to restore their retry resilience.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed. CI (`pr-check.yml` quality matrix + `changeset-check.yml`) must go green.

---

## Self-review notes (done at plan time)

- **Spec coverage:** B1 → Task 1 (gate + flag + Retry-After cap), B2 → Task 2, B3 → Task 3 (banner + split config + CI guard). One-PR constraint → Task 4. ✓
- **No placeholders:** every code step carries complete code; the only conditional is the documented CJS-banner fallback in Task 3 Step 4, with an explicit decision rule. ✓
- **Type consistency:** `idempotent?: boolean` (Task 1 Step 3a) matches its use in tests (Step 1) and the retry gate (Step 3b); `check:dist` script name matches package.json and the CI step. ✓
- **Known interaction:** Task 3 Step 5 needs the SDK dist built (examples typecheck) — the step includes `pnpm -F @viu/emporix-sdk build` explicitly. Task 1's behavior change makes `cart.test.ts`/`price.test.ts` 500-tests *faster*, not different — pre-verified. ✓
