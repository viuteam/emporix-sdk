# Production Hardening Round 2 (Roadmap 4–7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four next roadmap items from the 2026-06-11 review in one PR: (1) HTTP/auth/cookie hardening incl. typed timeout/network errors and session-response validation, (2) SSR prefetch-key alignment + provider/CompanyContext StrictMode safety, (3) useSyncExternalStore migration for render-time storage reads, (4) emporix-scoped query defaults on any QueryClient.

**Architecture:** Task 1 hardens `packages/sdk` (http.ts timeout window + error taxonomy, token-endpoint timeouts, `toSession()` dedup+validation in customer.ts, idempotent-flag sweep) plus the react cookie adapter's `Secure` default. Task 2 makes `ssr.ts` reuse `emporixKey`, replaces the provider's render-phase side effects with ref-guarded idempotent wiring, and adds cancellation/serialization to CompanyContext. Task 3 introduces `useCustomerToken()`/`useCartId()` built on `useSyncExternalStore` and migrates all render-time `storage.get*()` reads. Task 4 applies `qc.setQueryDefaults(["emporix"], …)` to whatever QueryClient is in use.

**Tech Stack:** TypeScript (strict, `exactOptionalPropertyTypes`), Vitest + MSW (`msw/node`), @testing-library/react (jsdom), React 18/19, TanStack Query v5, Changesets.

**Branch & PR:** Work on the already-created `fix/production-hardening-2` (branched from main at `0f171fd`). One PR against `main`. Commitlint: scope from allowlist (`http`, `sdk`, `auth`, `customer`, `react`, `repo`, `examples`, …), first word after scope a lowercase verb. Pre-commit runs lint + typecheck (typecheck needs built dists; run `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` first if dist is stale).

**Pre-verified facts (don't re-derive):**
- `request()` fetch/timeout region: `packages/sdk/src/core/http.ts:108-131` — `clearTimeout` happens in the `finally` (line 127) **before** `res.text()` (line 130). `requestRaw()` equivalent at `http.ts:228-249`. The only timeout reads are `o.timeoutMs ?? this.opts.timeouts.readMs` (http.ts:111, 231) — `connectMs` is never read anywhere.
- Token-endpoint fetches without timeout: `auth.ts:250` (`requestServiceToken`) and `auth.ts:342` (`fetchAnonymous`). `DefaultTokenProvider` already holds the full `ResolvedConfig` (`auth.ts:168`), which includes `timeouts` — but the test files construct it with `cfg as never` literals that LACK `timeouts`, so any new read must be `this.cfg.timeouts?.readMs ?? 60_000` (optional-chained) or the cfg literals must gain a `timeouts` member.
- Error taxonomy: `EmporixError(message, status?, body?)` base at `errors.ts:19-34`; subclasses are one-liners (`errors.ts:36-45`); all are re-exported from `packages/sdk/src/index.ts:1-4`.
- The 4 wire-mapping sites in `customer.ts`: `login` (81-114), `refresh` (125-153), `socialLogin` (180-217), `exchangeToken` (227-255) — all use `wire.access_token ?? wire.accessToken ?? ""`.
- Read-only POSTs for the idempotent sweep: `price.ts` `matchByContext` (93-99) + `match` (107-113), `availability.ts` `getMany` request (75-81), `product.ts` `searchByIds` (120-130) + `searchByCodes` (165-175), and `category.ts` has the same POST `/product/${tenant}/products/search` pattern around line 119-133.
- Cookie storage: `packages/react/src/storage/cookie.ts:23` — `const secure = opts.secure ?? false;`. Cookie tests live in `packages/react/tests/storage.test.ts` (no dedicated cookie file); jsdom origin is `http://localhost`, and jsdom's cookie jar REJECTS `Secure` cookies over http — so the default must be protocol-sniffing, not hard `true`.
- `ssr.ts` (53 lines) hand-rolls 3 query keys that can never match the hooks: `useProduct` keys `emporixKey("product",[id],{tenant,authKind,siteCode,language})` (use-products.ts:21, siteCode/language always present, `null` when unset via use-read-site.ts:12), `useCart` keys `emporixKey("cart",[id, activeCompany?.id ?? null],{tenant,authKind,siteCode,language})` (use-cart.ts:34-38), `useOrder` keys `emporixKey("orders",[orderId ?? null],{tenant,authKind,language})` — NO siteCode (use-order.ts:20-24). `emporixKey` (hooks/internal/query-keys.ts) drops only `undefined` fields, keeps `null`.
- Provider render-phase side effects: `provider.tsx:132-133` (storage write inside `useMemo`) and `provider.tsx:148-154` (`useState` lazy init calling `attachAnonymousStore` — runs once per component instance, NOT per (client,storage) pair as its comment claims). Fallback QueryClient in `useMemo` at `provider.tsx:138-143`. `DEFAULT_QUERY_OPTIONS` at `provider.tsx:60-64`.
- **Timing constraint:** the anonymous-store attach and the `initialCustomerToken` write MUST happen before the children's first render/effects (React Query starts fetching in child effects, which run BEFORE parent effects). A plain `useEffect` in the provider is too late — use a render-phase ref-guard (idempotent, re-runs on identity change) instead.
- CompanyContext: `load` at `company-context.tsx:128-158` (auto-`switchTo` when exactly 1 company, line 147-148), effect `useEffect(() => { void load(); }, [load])` at 160-162 with NO cancellation, `switchTo` at 84-126 calls `client.customers.refresh({refreshToken, legalEntityId?})` (96-99) — token-rotating. `activeRef.current = activeCompany` render-write at line 82.
- Render-time storage reads to migrate (full inventory, RENDER-classified): `use-read-auth.ts:20,31`; `use-cart.ts:32` and `use-cart.ts:219` (useActiveCart `useState(() => storage.getCartId())` + manual subscribeAll effect at 227-234); `use-checkout.ts:82`; `use-company.ts:9`; `use-my-companies.ts:9`; `use-company-groups.ts:11`; `use-company-locations.ts:11`; `use-customer-addresses.ts:27`; `use-order.ts:17`; `use-my-orders.ts:25`; `use-my-orders-infinite.ts:23`; `use-my-segments.ts:31,51,66,88,113,144,168`; `use-cloud-functions.ts:56`. CALLBACK/EFFECT reads (mutationFns, switch pipelines, refresher) stay as-is. The provider's `useState` site/language initializers (provider.tsx:339,348) are intentional mount-only initial state — OUT of scope.
- Shared store infra: `hooks/internal/customer-session-store.ts` (WeakMap per storage, `getSnapshot/setState/subscribe`) — token mirrored only via an effect in `use-customer-session.ts:77-80`; the store does NOT self-subscribe to storage yet. `EmporixStorage.subscribe` is token-only; `subscribeAll` delivers the changed key name. Both memory and localStorage adapters fire them on same-tab writes (no cross-tab wiring exists).
- staleTime: 10 hook files have `useQuery`/`useInfiniteQuery` with NO staleTime (use-my-orders, use-company-contacts, use-company-groups, use-cart, use-my-companies, use-sales-order, use-company, use-customer-addresses, use-order, use-company-locations). The provider defaults apply ONLY to the fallback QueryClient; the next-app-router example passes `new QueryClient()` → RQ defaults (staleTime 0, refetchOnWindowFocus true, retry 3).
- Test conventions: react tests = MSW + `renderHook` from `@testing-library/react`, wrapper building `EmporixClient` (tenant `acme`) + `createMemoryStorage` + `QueryClient({defaultOptions:{queries:{retry:false}}})`. ZERO StrictMode usage in `packages/react/tests/`. SDK token tests construct `new DefaultTokenProvider(cfg as never)` with module-level cfg literals. `provider-b2b.test.tsx:19-24` has a known-good MSW handler for `GET https://api.emporix.io/customer-management/acme/legal-entities`.
- Examples: nothing imports `@viu/emporix-sdk-react/ssr` (0 matches). `examples/next-app-router/app/providers.tsx` passes `new QueryClient()` with no defaults; `app/layout.tsx` reads the token cookie (Next 15 async `cookies()`).

---

## Task 1: SDK HTTP/Auth hardening + cookie Secure default

**Files:**
- Modify: `packages/sdk/src/core/errors.ts` (two new classes), `packages/sdk/src/index.ts:1-4` (exports)
- Modify: `packages/sdk/src/core/http.ts:108-131` (request) and `:228-249` (requestRaw)
- Modify: `packages/sdk/src/core/auth.ts` (`requestServiceToken`, `fetchAnonymous`)
- Modify: `packages/sdk/src/services/customer.ts` (toSession dedup + validation)
- Modify: `packages/sdk/src/services/price.ts`, `availability.ts`, `product.ts`, `category.ts` (idempotent flags)
- Modify: `packages/react/src/storage/cookie.ts:23` (Secure default)
- Tests: `packages/sdk/tests/http-retry.test.ts` (extend), `packages/sdk/tests/http-basic.test.ts` (extend), `packages/sdk/tests/token-provider-service.test.ts` (extend), `packages/sdk/tests/services/customer.test.ts` (extend), `packages/sdk/tests/services/price.test.ts` (extend), `packages/react/tests/storage.test.ts` (extend)
- Create: `.changeset/http-timeout-hardening.md`, `.changeset/cookie-secure-default.md`

### 1.1 Typed timeout/network errors + body read inside the timeout window + connectMs

- [ ] **Step 1: Write the failing tests** — append to `packages/sdk/tests/http-retry.test.ts` (inside the existing describe; `client()` helper, `provider`, `LevelResolver`, `MemoryLogger`, `HttpClient` are in scope). Widen the errors import to include `EmporixTimeoutError, EmporixNetworkError`:

```ts
  it("wraps an abort timeout in EmporixTimeoutError", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/slow", async () => {
        await new Promise((r) => setTimeout(r, 200));
        return HttpResponse.json({ ok: true });
      }),
    );
    await expect(
      client().request({ method: "GET", path: "/slow", auth: { kind: "service" }, timeoutMs: 30 }),
    ).rejects.toBeInstanceOf(EmporixTimeoutError);
  });

  it("wraps a connection failure in EmporixNetworkError", async () => {
    server.use(
      mhttp.get("https://api.emporix.io/dead", () => HttpResponse.error()),
    );
    await expect(
      client().request({ method: "GET", path: "/dead", auth: { kind: "service" } }),
    ).rejects.toBeInstanceOf(EmporixNetworkError);
  });

  it("bounds the response BODY read by the timeout, not just the headers", async () => {
    // Headers arrive instantly, the body stalls forever: a stream that never closes.
    server.use(
      mhttp.get("https://api.emporix.io/stalled-body", () => {
        const stream = new ReadableStream({ start() { /* never enqueue, never close */ } });
        return new HttpResponse(stream, { headers: { "Content-Type": "application/json" } });
      }),
    );
    await expect(
      client().request({ method: "GET", path: "/stalled-body", auth: { kind: "service" }, timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(EmporixTimeoutError);
  }, 10_000);
```

- [ ] **Step 2: Run to verify they fail.** `pnpm -F @viu/emporix-sdk test -- http-retry` → expect: TS error `EmporixTimeoutError` not exported (or, once classes exist, raw `AbortError`/`TypeError` instead of the typed classes; the stalled-body test would HANG without the fix — vitest kills it at the 10s test timeout).

- [ ] **Step 3: Add the error classes.** In `packages/sdk/src/core/errors.ts`, after `EmporixServerError` (line 45):

```ts
/** Request aborted by the configured connect/read timeout. No HTTP status. */
export class EmporixTimeoutError extends EmporixError {}
/** DNS/TLS/connection-level failure before or during the exchange. No HTTP status. */
export class EmporixNetworkError extends EmporixError {}
```

In `packages/sdk/src/index.ts`, add both to the existing error re-export list.

- [ ] **Step 4: Restructure the timeout window in `request()`.** Replace `packages/sdk/src/core/http.ts:108-131` (from `const controller = …` through `const parsed = …`) with:

```ts
      const controller = new AbortController();
      const overallMs = o.timeoutMs ?? this.opts.timeouts.readMs;
      // connectMs bounds time-to-headers (fetch resolving); the overall timer
      // bounds headers + body. timeoutMs overrides the overall budget only.
      const connectMs = Math.min(this.opts.timeouts.connectMs, overallMs);
      const overallTimer = setTimeout(() => controller.abort(), overallMs);
      let connectTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
        () => controller.abort(),
        connectMs,
      );
      const isFormData =
        typeof FormData !== "undefined" && o.body instanceof FormData;
      const init: RequestInit = {
        method: o.method,
        headers: this.buildHeaders(o, token, isFormData),
        signal: controller.signal,
      };
      if (o.body !== undefined) {
        init.body = isFormData ? (o.body as FormData) : JSON.stringify(o.body);
      }
      let res: Response;
      let text: string;
      try {
        res = await fetch(url, init);
        // Headers are in — the connect budget no longer applies; the body
        // read stays bounded by the overall timer (a stalled stream would
        // otherwise hang forever past clearTimeout).
        clearTimeout(connectTimer);
        connectTimer = undefined;
        text = await res.text();
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          throw new EmporixTimeoutError(
            `${o.method} ${o.path} timed out after ${overallMs}ms (connect budget ${connectMs}ms)`,
          );
        }
        throw new EmporixNetworkError(
          `${o.method} ${o.path} network failure: ${(err as Error).message}`,
        );
      } finally {
        if (connectTimer !== undefined) clearTimeout(connectTimer);
        clearTimeout(overallTimer);
      }
      const parsed = text ? safeJson(text) : undefined;
```

Add `EmporixTimeoutError, EmporixNetworkError` to the http.ts import from `./errors` (currently imports `errorFromResponse`).

- [ ] **Step 5: Same wrapping in `requestRaw()`.** Replace the `try { return await fetch(url, init); } finally { clearTimeout(timer); }` tail (http.ts:244-248) with:

```ts
    try {
      return await fetch(url, init);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new EmporixTimeoutError(
          `${o.method} ${o.path} timed out after ${o.timeoutMs ?? this.opts.timeouts.readMs}ms`,
        );
      }
      throw new EmporixNetworkError(
        `${o.method} ${o.path} network failure: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
```

(`requestRaw` keeps its single timer — the caller owns the body stream; do NOT arm a body timer there.)

- [ ] **Step 6: Run** `pnpm -F @viu/emporix-sdk test -- http-retry` → all pass. Then the full sdk suite: `pnpm -F @viu/emporix-sdk test` → expect ALL pass. Note: if any existing test asserted a raw `TypeError`/`AbortError` from network failures, update it to the typed classes — search `AbortError` and `fetch failed` in `packages/sdk/tests/` first.

### 1.2 Token-endpoint timeouts

- [ ] **Step 1: Failing tests.** Append to `packages/sdk/tests/token-provider-service.test.ts` (uses module-level `cfg`; import `EmporixTimeoutError` from `../src/core/errors` and `delay` from `msw`):

```ts
  it("times out a hung /oauth/token instead of blocking forever", async () => {
    server.use(
      http.post("https://api.emporix.io/oauth/token", async () => {
        await delay(2_000);
        return HttpResponse.json({ access_token: "late", expires_in: 3600 });
      }),
    );
    const p = new DefaultTokenProvider({
      ...cfg,
      timeouts: { connectMs: 50, readMs: 50 },
    } as never);
    await expect(p.getToken("backend")).rejects.toBeInstanceOf(EmporixTimeoutError);
  });
```

And the anonymous twin in `packages/sdk/tests/token-provider-anon.test.ts` (same pattern against `GET https://api.emporix.io/customerlogin/auth/anonymous/login`, provider built from that file's `cfg` spread with `timeouts: { connectMs: 50, readMs: 50 }`, asserting `p.getAnonymousToken()` rejects with `EmporixTimeoutError`).

- [ ] **Step 2: Run to verify they fail** (they hang into rejection only after MSW's 2s delay resolves — i.e. they FAIL by resolving instead of rejecting). `pnpm -F @viu/emporix-sdk test -- token-provider`

- [ ] **Step 3: Implement a shared bounded fetch in `DefaultTokenProvider`.** In `packages/sdk/src/core/auth.ts`, add a private method (import `EmporixTimeoutError, EmporixNetworkError` from `./errors`):

```ts
  /**
   * fetch with the configured read timeout. Token endpoints sit in front of
   * single-flight locks — one hung call would otherwise block every request
   * on this credential set forever.
   */
  private async boundedFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
    const ms = this.cfg.timeouts?.readMs ?? 60_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new EmporixTimeoutError(`token request timed out after ${ms}ms`);
      }
      throw new EmporixNetworkError(`token request network failure: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
```

(`this.cfg.timeouts?.readMs` is optional-chained on purpose: test cfg literals built with `as never` lack `timeouts`.) Then replace `await fetch(`${this.cfg.host}/oauth/token`, {…})` (auth.ts:250) with `await this.boundedFetch(`${this.cfg.host}/oauth/token`, {…})` (same init minus signal), and `await fetch(url, { method: "GET" })` (auth.ts:342) with `await this.boundedFetch(url, { method: "GET" })`.

- [ ] **Step 4: Run** `pnpm -F @viu/emporix-sdk test -- token-provider` → pass, then full sdk suite → pass.

### 1.3 `toSession()` dedup + wire validation (customer.ts)

- [ ] **Step 1: Failing tests.** Append to `packages/sdk/tests/services/customer.test.ts` (imports already include `EmporixAuthError`):

```ts
  it("login() rejects a 200 with no access token instead of fabricating an empty session", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/login", () =>
        HttpResponse.json({ token_type: "Bearer" }),
      ),
    );
    await expect(svc().login({ email: "a@b.co", password: "p" })).rejects.toBeInstanceOf(
      EmporixAuthError,
    );
  });

  it("refresh() rejects a 200 with no access token", async () => {
    server.use(
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () =>
        HttpResponse.json({}),
      ),
    );
    await expect(svc().refresh({ refreshToken: "rt" })).rejects.toBeInstanceOf(EmporixAuthError);
  });
```

- [ ] **Step 2: Run to verify they fail** (`customerToken: ""` today → resolves). `pnpm -F @viu/emporix-sdk test -- services/customer`

- [ ] **Step 3: Implement.** In `packages/sdk/src/services/customer.ts`, add module-level (above the class; import `EmporixAuthError` from `../core/errors`):

```ts
/** Union of the wire shapes the four session endpoints return. snake_case is
 * canonical; camelCase is the deprecated fallback (vendored spec, design §2). */
interface WireSession {
  access_token?: string;
  saas_token?: string;
  refresh_token?: string;
  session_id?: string;
  expires_in?: string | number;
  accessToken?: string;
  saasToken?: string;
  refreshToken?: string;
  social_access_token?: string;
  social_id_token?: string;
}

/** Wire→facade mapping shared by login/refresh/socialLogin/exchangeToken.
 * Throws instead of fabricating an empty session: `customerToken: ""` would
 * read as authenticated downstream and 401-loop every subsequent call. */
function toSession(
  endpoint: string,
  wire: WireSession,
  opts: { carrySaasToken?: string } = {},
): CustomerSession {
  const customerToken = wire.access_token ?? wire.accessToken;
  if (!customerToken) {
    throw new EmporixAuthError(`${endpoint}: response missing access_token`, undefined, wire);
  }
  return {
    customerToken,
    saasToken: wire.saas_token ?? wire.saasToken ?? opts.carrySaasToken ?? "",
    refreshToken: wire.refresh_token ?? wire.refreshToken ?? "",
    sessionId: wire.session_id,
    expiresIn: wire.expires_in != null ? Number(wire.expires_in) : undefined,
    ...(wire.social_access_token ? { socialAccessToken: wire.social_access_token } : {}),
    ...(wire.social_id_token ? { socialIdToken: wire.social_id_token } : {}),
  };
}
```

Then in each of the four methods: type the `this.ctx.http.request<WireSession>(…)` call with the shared interface (drop the inline wire type), delete the inline return-mapping block, and return:
- `login`: `return toSession("login", wire);`
- `refresh`: `return toSession("refresh", wire, input.saasToken !== undefined ? { carrySaasToken: input.saasToken } : {});` (refresh never returns a saas token — the original carried `input.saasToken ?? ""` forward)
- `socialLogin`: `return toSession("socialLogin", wire);`
- `exchangeToken`: `return toSession("exchangeToken", wire);`

- [ ] **Step 4: Run** `pnpm -F @viu/emporix-sdk test -- services/customer` → pass; full sdk suite → pass. (Existing tests pin the happy-path mapping — they prove `toSession` is faithful.)

### 1.4 Idempotent sweep for read-only POSTs

- [ ] **Step 1: Failing test.** Append to `packages/sdk/tests/services/price.test.ts` — read its `svc()` helper first; if it builds `HttpClient` with `retry: { maxAttempts: 1 }`, construct a local 3-attempt service in the test (mirror the helper verbatim, only changing `maxAttempts: 3` and adding `sleep: () => Promise.resolve()`):

```ts
  it("retries match-prices on a transient 5xx (read-only POST, opted in as idempotent)", async () => {
    let calls = 0;
    server.use(
      http.post("https://api.emporix.io/price/acme/match-prices-by-context", () => {
        calls += 1;
        if (calls < 2) return HttpResponse.json({ e: 1 }, { status: 503 });
        return HttpResponse.json([]);
      }),
    );
    const res = await retryingSvc().matchByContext({ items: [] });
    expect(res).toEqual([]);
    expect(calls).toBe(2);
  });
```

- [ ] **Step 2: Run to verify it fails** (`calls` stays 1, rejects). `pnpm -F @viu/emporix-sdk test -- services/price`

- [ ] **Step 3: Add `idempotent: true`** to these request objects (each is a pure read over POST): `price.ts` `matchByContext` + `match`; `availability.ts` `getMany`; `product.ts` `searchByIds` + `searchByCodes` (both `this.ctx.http.request<Product[]>` calls); `category.ts` the POST `/product/${tenant}/products/search` call (~line 119-133). Example (price.ts):

```ts
    const rows = await this.ctx.http.request<MatchResponse[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/match-prices-by-context`,
      auth: requireContextAuth(auth),
      body: input,
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
    });
```

- [ ] **Step 4: Run** price tests → pass; full sdk suite → pass.

### 1.5 Cookie `Secure` default

- [ ] **Step 1: Failing test.** Append to `packages/react/tests/storage.test.ts` inside the `cookie storage` describe (uses a cookie-setter spy because jsdom's readback hides attributes, and jsdom rejects Secure cookies on its http origin):

```ts
  it("appends the Secure attribute when secure is enabled", () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    const writes: string[] = [];
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: original.get,
      set(v: string) {
        writes.push(v);
        original.set!.call(document, v);
      },
    });
    try {
      createCookieStorage({ secure: true }).setCustomerToken("x");
      expect(writes.at(-1)).toContain("; Secure");
    } finally {
      Object.defineProperty(document, "cookie", original);
    }
  });

  it("defaults Secure off on http origins (jsdom) so localhost dev keeps working", () => {
    const original = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;
    const writes: string[] = [];
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: original.get,
      set(v: string) {
        writes.push(v);
        original.set!.call(document, v);
      },
    });
    try {
      createCookieStorage().setCustomerToken("x");
      expect(writes.at(-1)).not.toContain("; Secure");
    } finally {
      Object.defineProperty(document, "cookie", original);
    }
  });
```

(The first test passes already — it pins existing behavior. The protocol-sniffing default is what's new; on jsdom/http it must stay off, on https it must turn on — the https branch is covered by reading the implementation, since jsdom can't change origin per-test cheaply.)

- [ ] **Step 2: Implement.** In `packages/react/src/storage/cookie.ts` replace line 23:

```ts
  // Default: Secure on https origins. Tokens must not ride plain-http
  // cookies in production; localhost/http dev keeps working without opts.
  const secure =
    opts.secure ?? (typeof location !== "undefined" && location.protocol === "https:");
```

Also update the factory JSDoc (line 17) to say "Secure defaults to on for https origins; override with `secure: false` only for non-https dev setups."

- [ ] **Step 3: Run** `pnpm -F @viu/emporix-sdk-react test -- storage` → pass; full react suite → pass.

### 1.6 Changesets + commits

- [ ] **Step 1: Changesets.** Create `.changeset/http-timeout-hardening.md`:

```md
---
"@viu/emporix-sdk": minor
---

harden the HTTP and token layers: timeouts and connection failures now throw typed `EmporixTimeoutError`/`EmporixNetworkError` (previously raw `AbortError`/`TypeError` escaped the SDK's error taxonomy); the response body read is bounded by the timeout (a stalled stream no longer hangs forever); `timeouts.connectMs` is now actually enforced as the time-to-headers budget; `/oauth/token` and anonymous-login fetches are bounded by `timeouts.readMs` (one hung token call no longer blocks every request behind the single-flight lock); `login`/`refresh`/`socialLogin`/`exchangeToken` now throw `EmporixAuthError` on a 2xx response missing `access_token` instead of fabricating an empty session; read-only POST search endpoints (`products.searchByIds`/`searchByCodes`, `price.match`/`matchByContext`, `availability.getMany`, category product search) are marked `idempotent: true` and retry on 5xx/429 again.
```

Create `.changeset/cookie-secure-default.md`:

```md
---
"@viu/emporix-sdk-react": patch
---

default the cookie storage adapter's `Secure` attribute to on for https origins. Token cookies no longer ride plain http in production by default; localhost/http dev is unaffected (protocol-sniffed). Pass `secure: false` explicitly only for non-https deployments.
```

- [ ] **Step 2: Commits** (split by scope; include the matching tests in each):

```bash
git add packages/sdk/src/core/errors.ts packages/sdk/src/core/http.ts packages/sdk/src/index.ts packages/sdk/tests/http-retry.test.ts
git commit -m "fix(http): bound body reads and wrap timeouts in typed errors"

git add packages/sdk/src/core/auth.ts packages/sdk/tests/token-provider-service.test.ts packages/sdk/tests/token-provider-anon.test.ts
git commit -m "fix(auth): bound token endpoint fetches with the read timeout"

git add packages/sdk/src/services/customer.ts packages/sdk/tests/services/customer.test.ts
git commit -m "fix(customer): reject session responses missing access_token"

git add packages/sdk/src/services/price.ts packages/sdk/src/services/availability.ts packages/sdk/src/services/product.ts packages/sdk/src/services/category.ts packages/sdk/tests/services/price.test.ts .changeset/http-timeout-hardening.md
git commit -m "fix(sdk): mark read-only post endpoints idempotent"

git add packages/react/src/storage/cookie.ts packages/react/tests/storage.test.ts .changeset/cookie-secure-default.md
git commit -m "fix(react): default cookie storage to secure on https origins"
```

---

## Task 2: SSR key alignment + provider/CompanyContext StrictMode safety

**Files:**
- Modify: `packages/react/src/ssr.ts` (full rewrite of the 3 key constructions)
- Modify: `packages/react/src/provider.tsx:126-154` (memo purity + ref-guarded wiring), `:138-143` (fallback QueryClient)
- Modify: `packages/react/src/company-context.tsx` (cancellation, serialization, ref write)
- Create: `examples/next-app-router/app/product/[id]/page.tsx`, `examples/next-app-router/app/product/[id]/product-detail.tsx` (HydrationBoundary demo)
- Tests: `packages/react/tests/ssr.test.ts` (extend), `packages/react/tests/provider.test.tsx` (extend), `packages/react/tests/use-active-company-bootstrap.test.tsx` (extend)
- Create: `.changeset/ssr-keys-and-strictmode.md`

### 2.1 SSR prefetch keys

- [ ] **Step 1: Failing test.** Append to `packages/react/tests/ssr.test.ts` (read its existing imports/handlers first and reuse them; it already tests the prefetch helpers — add a hydration-contract test that proves the HOOK reads the prefetched entry without a second fetch):

```tsx
  it("prefetchProduct writes the exact key useProduct reads (zero client refetch)", async () => {
    let productHits = 0;
    server.use(
      http.get("https://api.emporix.io/product/acme/products/p1", () => {
        productHits += 1;
        return HttpResponse.json({ id: "p1", name: "Prefetched" });
      }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    await prefetchProduct(qc, client, "p1"); // server side: anonymous, no site ctx
    expect(productHits).toBe(1);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={qc}>
        {children}
      </EmporixProvider>
    );
    const { result } = renderHook(() => useProduct("p1"), { wrapper });
    // Cache hit: data is available synchronously, and no second request fires.
    expect(result.current.data).toEqual({ id: "p1", name: "Prefetched" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(productHits).toBe(1);
  });
```

(Needed imports if missing in that file: `useProduct` from `../src/hooks/use-products`, `EmporixProvider` from `../src/provider`, `createMemoryStorage` from `../src/storage/memory`, `renderHook, waitFor` from `@testing-library/react`, `QueryClient` from `@tanstack/react-query`, `ReactNode` type. Note: the hook runs with NO site context mounted → `useReadSite()` returns `{siteCode: null, language: null}`, matching the prefetch default.)

- [ ] **Step 2: Run to verify it fails** (`result.current.data` is `undefined`, `productHits` becomes 2 — key mismatch). `pnpm -F @viu/emporix-sdk-react test -- ssr`

- [ ] **Step 3: Rewrite the key construction in `packages/react/src/ssr.ts`.** Add `import { emporixKey } from "./hooks/internal/query-keys";` (pure module, no React — keeps the ssr entry server-safe). Replace the three functions' bodies:

```ts
/** Site/language discriminators for SSR prefetch keys. MUST mirror what the
 * client's `useReadSite()` will resolve to at hydration time — `null` when the
 * client mounts without a bound site (the default), the actual codes when the
 * provider is mounted with `initialSiteCode`/`initialLanguage`. */
export interface PrefetchSiteOpts {
  siteCode?: string | null;
  language?: string | null;
}

export async function prefetchProduct(
  qc: QueryClient,
  client: EmporixClient,
  productId: string,
  authCtx: AuthContext = auth.anonymous(),
  opts: PrefetchSiteOpts = {},
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: emporixKey("product", [productId], {
      tenant: client.tenant,
      authKind: authCtx.kind,
      siteCode: opts.siteCode ?? null,
      language: opts.language ?? null,
    }),
    queryFn: () => client.products.get(productId, undefined, authCtx),
  });
}

export async function prefetchCart(
  qc: QueryClient,
  client: EmporixClient,
  cartId: string,
  authCtx: AuthContext,
  opts: PrefetchSiteOpts & { activeCompanyId?: string | null } = {},
): Promise<void> {
  await qc.prefetchQuery({
    queryKey: emporixKey("cart", [cartId, opts.activeCompanyId ?? null], {
      tenant: client.tenant,
      authKind: authCtx.kind,
      siteCode: opts.siteCode ?? null,
      language: opts.language ?? null,
    }),
    queryFn: () => client.carts.get(cartId, authCtx),
  });
}

export async function prefetchOrder(
  qc: QueryClient,
  client: EmporixClient,
  orderId: string,
  authCtx: AuthContext,
  opts: { saasToken?: string; language?: string | null } = {},
): Promise<void> {
  await qc.prefetchQuery({
    // NOTE: useOrder keys WITHOUT siteCode (language only) — keep in sync.
    queryKey: emporixKey("orders", [orderId], {
      tenant: client.tenant,
      authKind: authCtx.kind,
      language: opts.language ?? null,
    }),
    queryFn: () =>
      client.orders.get(orderId, authCtx, opts.saasToken ? { saasToken: opts.saasToken } : {}),
  });
}
```

Keep the existing JSDoc headers; update the prefetchProduct one to mention the `opts` mirror-contract. If `packages/react/tests/ssr.test.ts` has existing assertions pinning the OLD (broken) key shapes, update them to the new shapes — they were pinning the bug.

- [ ] **Step 4: Run** `pnpm -F @viu/emporix-sdk-react test -- ssr` → pass.

### 2.2 Provider: pure memo + ref-guarded wiring + stable fallback QueryClient

- [ ] **Step 1: Failing test.** Append to `packages/react/tests/provider.test.tsx` (it has `mkClient()`, `renderHook`, `EmporixProvider`, `createMemoryStorage`, `AnonymousSessionStore` type):

```tsx
  it("re-attaches the anonymous store when the client prop changes", () => {
    const storage = createMemoryStorage();
    storage.setAnonymousSession({ refreshToken: "rt-1", sessionId: "s-1" });
    const clientA = mkClient();
    const clientB = mkClient();
    const { rerender } = renderHook(() => useEmporix(), {
      wrapper: ({ children }) => (
        <EmporixProvider client={currentClient} storage={storage}>
          {children}
        </EmporixProvider>
      ),
      initialProps: {},
    });
    // The harness above can't swap props through renderHook's wrapper closure —
    // use a mutable binding + rerender instead:
    function read(client: EmporixClient) {
      return (client.tokenProvider as { readAnonymousStore?: () => unknown }) ;
    }
    expect(true).toBe(true);
  });
```

The wrapper-closure approach above is awkward — implement it instead as a plain `render` test with a tiny harness component:

```tsx
  it("re-attaches the anonymous store when the client prop changes", () => {
    const storage = createMemoryStorage();
    storage.setAnonymousSession({ refreshToken: "rt-1", sessionId: "s-1" });
    const clientA = mkClient();
    const clientB = mkClient();
    const attached: EmporixClient[] = [];
    // attachAnonymousStore is the SDK's public wiring hook — spy on both clients.
    for (const c of [clientA, clientB]) {
      const orig = c.tokenProvider.attachAnonymousStore?.bind(c.tokenProvider);
      c.tokenProvider.attachAnonymousStore = (store: AnonymousSessionStore) => {
        attached.push(c);
        orig?.(store);
      };
    }
    const ui = (client: EmporixClient) => (
      <EmporixProvider client={client} storage={storage}>
        <div />
      </EmporixProvider>
    );
    const { rerender } = render(ui(clientA));
    expect(attached).toContain(clientA);
    rerender(ui(clientB));
    expect(attached).toContain(clientB); // FAILS today: useState lazy init never re-runs
  });

  it("keeps the fallback QueryClient stable across rerenders", () => {
    const client = mkClient();
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useQueryClient());
      return null;
    }
    const ui = (
      <EmporixProvider client={client} storage={createMemoryStorage()}>
        <Probe />
      </EmporixProvider>
    );
    const { rerender } = render(ui);
    rerender(ui);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(new Set(seen).size).toBe(1); // one stable instance
  });
```

(Delete the first abandoned sketch — only the two `render`-based tests go in. `render` and `useQueryClient` are already imported in this file.)

- [ ] **Step 2: Run to verify the attach test fails.** `pnpm -F @viu/emporix-sdk-react test -- provider.test` — expect: `attached` lacks `clientB`. (The QueryClient stability test passes today via useMemo — it pins the behavior against the upcoming change; useMemo is allowed to drop its cache, useState is not.)

- [ ] **Step 3: Implement.** In `packages/react/src/provider.tsx`:

(a) Make the memo pure — replace lines 126-137 with:

```ts
  const value = useMemo<EmporixContextValue>(() => {
    const s =
      storage ??
      createMemoryStorage(
        initialCustomerToken !== undefined ? { initial: initialCustomerToken } : {},
      );
    return { client, storage: s };
  }, [client, storage, initialCustomerToken]);
```

(b) Replace the `useState` lazy-init block (lines 145-154) with a render-phase ref-guard that also owns the initial-token seed. A plain `useEffect` is deliberately NOT used: React Query starts fetching in the CHILDREN's effects, which run before the provider's own effect — the anonymous store and the seeded token must be in place before that. The wiring is idempotent (attach overwrites a field; the token seed checks for null), so the guarded render-phase call is safe under StrictMode's double-render:

```ts
  // Idempotent wiring that must precede the children's first fetch effects:
  // (1) attach the storage-backed anonymous-session adapter to the SDK token
  // provider, (2) seed the SSR-provided customer token into external storage.
  // Ref-guarded so it re-runs when (client, storage) identity changes — a
  // useState lazy initializer runs once per component INSTANCE and silently
  // skips re-wiring on prop swaps; a useEffect runs AFTER children fetch.
  const wiredRef = useRef<{ client: EmporixClient; storage: EmporixStorage } | null>(null);
  if (wiredRef.current?.client !== client || wiredRef.current?.storage !== value.storage) {
    client.tokenProvider.attachAnonymousStore?.({
      read: () => value.storage.getAnonymousSession(),
      write: (s) => value.storage.setAnonymousSession(s),
    });
    if (initialCustomerToken && storage && storage.getCustomerToken() === null) {
      storage.setCustomerToken(initialCustomerToken);
    }
    wiredRef.current = { client, storage: value.storage };
  }
```

(Add `useRef` to the react import if missing; `EmporixStorage` is already imported.)

(c) Replace the fallback-QueryClient `useMemo` (lines 138-143) with state (useMemo caches may be discarded by React, silently dropping the whole query cache mid-session):

```ts
  const [fallbackQc] = useState(
    () => new QueryClient({ defaultOptions: { queries: DEFAULT_QUERY_OPTIONS } }),
  );
  const qc = queryClient ?? fallbackQc;
```

- [ ] **Step 4: Run** `pnpm -F @viu/emporix-sdk-react test -- provider` → pass; full react suite → pass (the b2b/bootstrap/telemetry suites exercise the provider heavily — they are the regression net for the wiring change).

### 2.3 CompanyContext: cancellation + serialized switching + no render-phase ref write

- [ ] **Step 1: Failing test.** Append to `packages/react/tests/use-active-company-bootstrap.test.tsx` (read its existing handlers/wrapper first; it stubs anonymous login + legal-entities. Add a counting refresh handler and a StrictMode wrapper — `StrictMode` from `react`):

```tsx
  it("bootstrap auto-switch refreshes the token exactly once under StrictMode", async () => {
    let refreshHits = 0;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([{ id: "le-solo", name: "Solo GmbH", type: "COMPANY" }]),
      ),
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () => {
        refreshHits += 1;
        return HttpResponse.json({
          access_token: `cust-${refreshHits}`,
          refresh_token: `rt-${refreshHits}`,
        });
      }),
    );
    const storage = createMemoryStorage({ initial: "cust-0" });
    storage.setRefreshToken("rt-0");
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <EmporixProvider
          client={client}
          storage={storage}
          queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {children}
        </EmporixProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useActiveCompany(), { wrapper });
    await waitFor(() => expect(result.current.activeCompany?.id).toBe("le-solo"));
    // StrictMode double-mounts: without cancellation BOTH loads auto-switch and
    // BOTH consume the same refresh token — server-side rotation would 401.
    expect(refreshHits).toBe(1);
  });
```

- [ ] **Step 2: Run to verify it fails** (`refreshHits === 2`). `pnpm -F @viu/emporix-sdk-react test -- use-active-company-bootstrap`

- [ ] **Step 3: Implement in `packages/react/src/company-context.tsx`:**

(a) Move the ref write out of render — replace lines 80-82 with:

```ts
  // Ref so switchTo can capture the latest `activeCompany` for telemetry `from`.
  // Written in an effect: render-phase ref writes are illegal under concurrent
  // rendering (an abandoned render's value could leak into a committed pass).
  const activeRef = useRef<LegalEntity | null>(null);
  useEffect(() => {
    activeRef.current = activeCompany;
  }, [activeCompany]);
```

(b) Serialize `switchTo` — add directly above the `switchTo` useCallback (line 84):

```ts
  // Serializes token-rotating switches: two concurrent switchTo calls would
  // both read the same refresh token; with server-side rotation the second
  // consumes a stale token (401, worst case session revocation).
  const switchChain = useRef<Promise<void>>(Promise.resolve());
```

and wrap the existing body: rename the current async callback body into an inner `const run = async (): Promise<void> => { …existing body unchanged… };` and end the callback with:

```ts
      const task = switchChain.current.then(run, run);
      switchChain.current = task.catch(() => {
        /* keep the chain alive after a failed switch */
      });
      return task;
```

(The `useCallback` wrapper, deps `[client, storage, qc, emit]`, and everything inside `run` stay byte-identical.)

(c) Cancellation in `load` — replace lines 128-162 (the `load` callback + its effect) with:

```ts
  const load = useCallback(
    async (signal?: { cancelled: boolean }) => {
      const token = storage.getCustomerToken();
      if (!token) {
        if (signal?.cancelled) return;
        setMyCompanies([]);
        setActive(null);
        setStatus("idle");
        return;
      }
      setStatus("loading");
      try {
        const companies = await client.companies.listMine(auth.customer(token));
        if (signal?.cancelled) return; // unmounted (StrictMode probe) — no state, no auto-switch
        setMyCompanies(companies);
        const persisted = initialActiveLegalEntityId ?? storage.getActiveLegalEntityId();
        const matched = persisted ? companies.find((c) => c.id === persisted) ?? null : null;
        if (matched) {
          setActive(matched);
          if (storage.getActiveLegalEntityId() !== matched.id) {
            storage.setActiveLegalEntityId(matched.id ?? null);
          }
        } else if (companies.length === 1) {
          await switchTo(companies[0] ?? null);
        } else {
          setActive(null);
          if (persisted && !matched) storage.setActiveLegalEntityId(null);
        }
        if (signal?.cancelled) return;
        setStatus("idle");
      } catch (e) {
        if (signal?.cancelled) return;
        setError(e);
        setStatus("error");
      }
    },
    [client, storage, initialActiveLegalEntityId, switchTo],
  );

  useEffect(() => {
    const signal = { cancelled: false };
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);
```

Check the second effect (token-presence transitions, lines 164-176): its `void load()` call stays valid because `signal` is optional. `refetchMyCompanies: load` in the context value (line 212) also stays valid — TypeScript treats `(signal?) => Promise<void>` as assignable to `() => Promise<void>`.

- [ ] **Step 4: Run** `pnpm -F @viu/emporix-sdk-react test -- company` and the bootstrap/switch/b2b suites, then the full react suite → all pass.

### 2.4 HydrationBoundary demo (examples)

- [ ] **Step 1: Create `examples/next-app-router/app/product/[id]/product-detail.tsx`:**

```tsx
"use client";

import { useProduct } from "@viu/emporix-sdk-react";

/** Client component: reads the product from the hydrated React-Query cache —
 * a cache HIT when the RSC prefetched with matching siteCode/language. */
export function ProductDetail({ productId }: { productId: string }): React.JSX.Element {
  const { data, isLoading, error } = useProduct(productId);
  if (isLoading) return <p>Loading…</p>;
  if (error) return <p>Failed to load product.</p>;
  return (
    <article>
      <h1>{typeof data?.name === "string" ? data.name : productId}</h1>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </article>
  );
}
```

- [ ] **Step 2: Create `examples/next-app-router/app/product/[id]/page.tsx`:**

```tsx
import { QueryClient, dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { prefetchProduct } from "@viu/emporix-sdk-react/ssr";
import { ProductDetail } from "./product-detail";

// Server Component: prefetch with the SDK, hand the dehydrated cache to the
// client. The prefetch key matches useProduct's key (anonymous, no site ctx)
// so hydration is a cache hit — zero client refetch.
const sdk = new EmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "mytenant",
  credentials: {
    storefront: { clientId: process.env.NEXT_PUBLIC_EMPORIX_STOREFRONT_CLIENT_ID ?? "" },
  },
  logger: false,
});

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params; // Next 15: params is async
  const qc = new QueryClient();
  await prefetchProduct(qc, sdk, id);
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProductDetail productId={id} />
    </HydrationBoundary>
  );
}
```

- [ ] **Step 3: Verify the example compiles.** `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build && pnpm -F @viu/emporix-examples-next-app-router typecheck` (check the exact package name in `examples/next-app-router/package.json` `name` field first; adjust the filter accordingly). Expected: clean. NOTE: the demo page's `useProduct` runs without a mounted site context only if the layout's `Providers` doesn't bind one — it doesn't (no `initialSiteCode`), so siteCode/language are `null` on both sides. If `examples/next-app-router` typecheck fails on `Promise<{ id: string }>` params, match the params typing style used by Next 15.5 in that example.

### 2.5 Changeset + commits

- [ ] **Step 1:** Create `.changeset/ssr-keys-and-strictmode.md`:

```md
---
"@viu/emporix-sdk-react": patch
---

fix the RSC/SSR prefetch pipeline and StrictMode safety: `prefetchProduct`/`prefetchCart`/`prefetchOrder` now build their query keys through the same `emporixKey` builder the hooks use (previously the keys never matched — `siteCode`/`language`/company discriminators were missing — so hydration was always a cache miss and the client refetched); new `siteCode`/`language`/`activeCompanyId` options mirror the client context. The provider's anonymous-store wiring and `initialCustomerToken` seed now re-run when the `client`/`storage` props change and no longer execute inside `useMemo`; the fallback QueryClient is held in state (a dropped memo cache could previously discard the whole query cache). CompanyContext bootstrap is cancellation-safe under StrictMode and company switches are serialized — the token-rotating refresh can no longer double-fire with the same refresh token.
```

- [ ] **Step 2: Commits:**

```bash
git add packages/react/src/ssr.ts packages/react/tests/ssr.test.ts
git commit -m "fix(react): align ssr prefetch keys with hook query keys"

git add packages/react/src/provider.tsx packages/react/tests/provider.test.tsx
git commit -m "fix(react): rewire provider side effects for strict mode"

git add packages/react/src/company-context.tsx packages/react/tests/use-active-company-bootstrap.test.tsx .changeset/ssr-keys-and-strictmode.md
git commit -m "fix(react): serialize company bootstrap and switching"

git add examples/next-app-router/app/product
git commit -m "docs(examples): add rsc prefetch hydration demo page"
```

---

## Task 3: useSyncExternalStore migration for render-time storage reads

**Files:**
- Modify: `packages/react/src/hooks/internal/customer-session-store.ts` (self-subscribe to storage)
- Create: `packages/react/src/hooks/internal/use-storage-snapshot.ts` (`useCustomerToken`, `useCartId`)
- Modify: `packages/react/src/hooks/internal/use-read-auth.ts` (consume `useCustomerToken`)
- Modify: `packages/react/src/hooks/use-customer-session.ts` (drop the now-redundant mirror effect)
- Modify (mechanical migration): `use-cart.ts`, `use-checkout.ts`, `use-company.ts`, `use-my-companies.ts`, `use-company-groups.ts`, `use-company-locations.ts`, `use-customer-addresses.ts`, `use-order.ts`, `use-my-orders.ts`, `use-my-orders-infinite.ts`, `use-my-segments.ts`, `use-cloud-functions.ts`
- Tests: Create `packages/react/tests/use-storage-snapshot.test.tsx`; extend `packages/react/tests/use-my-companies.test.tsx`
- Create: `.changeset/reactive-storage-reads.md`

**Design constraints (read before coding):**
- `getServerSnapshot` must read the store (NOT hardcode `null`): the Next example seeds a memory storage with `initialCustomerToken` on the server — server-rendered output must reflect that token, exactly as the current render-time reads do. Hydration-mismatch with persistent adapters is pre-existing and out of scope.
- `EmporixStorage.subscribe` is token-only and optional; `subscribeAll` delivers the changed key. Memory + localStorage adapters fire both on same-tab writes. A storage without `subscribe`/`subscribeAll` simply isn't reactive — same as today, no regression.
- CALLBACK/EFFECT-position reads (mutationFns, switch pipelines, the provider refresher, `onboardCustomerCart`) are deliberately NOT migrated — they read fresh state at call time, which is correct.
- The provider's `useState` lazy site/language initializers (provider.tsx:339,348) are intentional mount-only initial state — NOT migrated.

### 3.1 Store self-subscription + snapshot hooks

- [ ] **Step 1: Failing tests.** Create `packages/react/tests/use-storage-snapshot.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCustomerToken, useCartId } from "../src/hooks/internal/use-storage-snapshot";
import type { ReactNode } from "react";

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useCustomerToken / useCartId", () => {
  it("re-renders on an external storage token write (login from anywhere)", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerToken(), { wrapper: wrap(storage) });
    expect(result.current).toBeNull();
    act(() => storage.setCustomerToken("cust"));
    expect(result.current).toBe("cust"); // FAILS pre-fix only if hooks read storage raw
    act(() => storage.setCustomerToken(null));
    expect(result.current).toBeNull();
  });

  it("re-renders on cartId writes and ignores other keys", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCartId(), { wrapper: wrap(storage) });
    expect(result.current).toBeNull();
    act(() => storage.setCartId("c-1"));
    expect(result.current).toBe("c-1");
    act(() => storage.setSiteCode("main")); // unrelated key — value must stay stable
    expect(result.current).toBe("c-1");
  });

  it("two consumers always observe the same token (no tearing across the tree)", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(
      () => ({ a: useCustomerToken(), b: useCustomerToken() }),
      { wrapper: wrap(storage) },
    );
    act(() => storage.setCustomerToken("t-1"));
    expect(result.current.a).toBe("t-1");
    expect(result.current.b).toBe("t-1");
  });
});
```

- [ ] **Step 2: Run to verify it fails** (module doesn't exist). `pnpm -F @viu/emporix-sdk-react test -- use-storage-snapshot`

- [ ] **Step 3: Make the customer-session store self-subscribe.** In `packages/react/src/hooks/internal/customer-session-store.ts`, inside `getCustomerSessionStore` after the `store` object literal is built (before `stores.set(storage, store)`):

```ts
  // Mirror external token writes (login/logout from any consumer, telemetry-
  // driven flows) into the store, so EVERY subscriber — not just
  // useCustomerSession — observes token changes. Lifetime: the subscription
  // lives exactly as long as the storage instance that owns this store.
  storage.subscribe?.((t) => {
    store.setState((s) => (s.token === t ? s : { ...s, token: t }));
  });
```

Then in `packages/react/src/hooks/use-customer-session.ts` DELETE the now-redundant mirror effect (lines 77-80, the `useEffect` whose body is `return storage.subscribe?.((t) => setSession((s) => ({ ...s, token: t })));`) and remove `useEffect` from the react import ONLY if nothing else in the file uses it (it does — `honourPreferredSite` flows don't, but check; if unused, remove).

- [ ] **Step 4: Create `packages/react/src/hooks/internal/use-storage-snapshot.ts`:**

```ts
import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useEmporix } from "../../provider";
import { getCustomerSessionStore } from "./customer-session-store";

/**
 * Reactive render-time view of the stored customer token. Replaces raw
 * `storage.getCustomerToken()` reads in hook bodies, which (a) never
 * re-rendered on login/logout — `enabled` gates stayed stale until an
 * unrelated re-render — and (b) could tear under concurrent rendering.
 * Server snapshot reads the same store: a server-side memory storage seeded
 * with `initialCustomerToken` must render authenticated markup.
 */
export function useCustomerToken(): string | null {
  const { storage } = useEmporix();
  const store = useMemo(() => getCustomerSessionStore(storage), [storage]);
  const getToken = useCallback(() => store.getSnapshot().token, [store]);
  return useSyncExternalStore(store.subscribe, getToken, getToken);
}

/**
 * Reactive render-time view of the stored cart id. Subscribes to the
 * storage's key-level change feed; storages without `subscribeAll` are
 * non-reactive (unchanged from the previous behavior).
 */
export function useCartId(): string | null {
  const { storage } = useEmporix();
  const subscribe = useCallback(
    (onChange: () => void) =>
      storage.subscribeAll?.((key) => {
        if (key === "cartId") onChange();
      }) ?? (() => {}),
    [storage],
  );
  const getCartId = useCallback(() => storage.getCartId(), [storage]);
  return useSyncExternalStore(subscribe, getCartId, getCartId);
}
```

- [ ] **Step 5: Run** `pnpm -F @viu/emporix-sdk-react test -- use-storage-snapshot` → pass. Full react suite → pass (the deleted mirror effect is covered by `use-customer-session.test.tsx`'s "shares the in-memory saasToken" + external-write tests — they must stay green via the store's self-subscription).

### 3.2 Migrate `useReadAuth`/`useCustomerOnlyCtx` (covers 26+ call sites at once)

- [ ] **Step 1: Failing test.** Append to `packages/react/tests/use-my-companies.test.tsx` (read its existing handlers/wrapper; it stubs `GET https://api.emporix.io/customer-management/acme/legal-entities` — if not, copy the handler from provider-b2b.test.tsx:19-24):

```tsx
  it("starts fetching when a login token appears in storage (reactive enabled-gate)", async () => {
    const storage = createMemoryStorage(); // no token: hook disabled, no fetch
    const { result } = renderHook(() => useMyCompanies(), { wrapper: wrapperWith(storage) });
    expect(result.current.fetchStatus).toBe("idle");
    act(() => storage.setCustomerToken("cust"));
    // Pre-fix this NEVER fires: the raw storage read doesn't re-render the hook.
    await waitFor(() => expect(result.current.data?.length).toBeGreaterThan(0));
  });
```

(`wrapperWith(storage)`: reuse/adapt that file's existing wrapper helper so it accepts a storage instance; add `act` to the testing-library import.)

- [ ] **Step 2: Run to verify it fails** (times out: `fetchStatus` stays `idle`). `pnpm -F @viu/emporix-sdk-react test -- use-my-companies`

- [ ] **Step 3: Migrate the chokepoint.** Rewrite `packages/react/src/hooks/internal/use-read-auth.ts` (whole file; both hooks now call `useCustomerToken()` unconditionally — hooks must not be skipped by the `override` early-return):

```ts
import { auth, type AuthContext } from "@viu/emporix-sdk";
import { useCustomerToken } from "./use-storage-snapshot";

/** Options accepted by every read hook to override the per-call auth context. */
export interface QueryOpts {
  auth?: AuthContext;
}

/**
 * Picks the auth context for a read hook. If `override` is given, returns it.
 * Otherwise: customer if a token is in storage, anonymous as fallback.
 * Token reads go through `useCustomerToken` (useSyncExternalStore) so the
 * context — and every query key carrying `ctx.kind` — updates reactively on
 * login/logout instead of waiting for an unrelated re-render.
 */
export function useReadAuth(override?: AuthContext): { ctx: AuthContext } {
  const token = useCustomerToken();
  if (override) return { ctx: override };
  return token ? { ctx: auth.customer(token) } : { ctx: auth.anonymous() };
}

/**
 * Returns a customer `AuthContext` from the stored token. Throws if no token
 * exists in storage — use for hooks that are intentionally customer-only
 * (profile updates, password change, address management, payment modes).
 */
export function useCustomerOnlyCtx(): AuthContext {
  const token = useCustomerToken();
  if (!token) {
    throw new Error("Requires a logged-in customer (no token in storage)");
  }
  return auth.customer(token);
}
```

(The `useEmporix` import drops out. The render-time throw of `useCustomerOnlyCtx` is pinned by `use-customer-profile.test.tsx:87/:119` — behavior unchanged.)

- [ ] **Step 4: Run the full react suite** → the new use-my-companies test still FAILS (use-my-companies reads storage directly, not via useReadAuth) but nothing else may regress. Then proceed to 3.3 which turns it green.

### 3.3 Migrate the direct-read hooks (mechanical)

- [ ] **Step 1: Apply the same two-line change to every RENDER-position read.** Pattern — replace:

```ts
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
```

with:

```ts
  const { client } = useEmporix();
  const token = useCustomerToken();
```

(plus `import { useCustomerToken } from "./internal/use-storage-snapshot";` — keep `storage` in the destructuring ONLY where the hook also uses it elsewhere, e.g. in a mutationFn). Sites:
- `use-checkout.ts:82` (`usePaymentModes`; file keeps other `storage` uses — check before dropping)
- `use-company.ts:9`, `use-my-companies.ts:9`, `use-company-groups.ts:11`, `use-company-locations.ts:11`
- `use-customer-addresses.ts:27`
- `use-order.ts:17`, `use-my-orders.ts:25`, `use-my-orders-infinite.ts:23`
- `use-my-segments.ts:31,51,66,88,113,144,168` (7 hooks, same file — one import)
- `use-cloud-functions.ts:56` (`useCloudFunction` only; the mutationFn read at :38 STAYS)

- [ ] **Step 2: `useCart` cartId read.** In `use-cart.ts:32` replace `const resolvedId = cartId ?? storage.getCartId() ?? undefined;` with:

```ts
  const storedCartId = useCartId();
  const resolvedId = cartId ?? storedCartId ?? undefined;
```

(import `useCartId` from `./internal/use-storage-snapshot`; `storage` stays destructured — `resolveId` in `useCartMutations` and other callback reads still use it).

- [ ] **Step 3: `useActiveCart` simplification.** In `use-cart.ts:207-272`: delete the `useState(() => storage.getCartId())` (line 219) AND the manual `subscribeAll` effect (lines 223-234); replace with `const cartId = useCartId();`. In the bootstrap `.then` (lines 251-257), drop the `setCartId(cart.id)` call — `storage.setCartId(cart.id)` already notifies `useCartId` via subscribeAll. Everything else stays.

- [ ] **Step 4: Run** `pnpm -F @viu/emporix-sdk-react test -- use-my-companies` → the reactive test passes. Full react suite → ALL pass (use-active-cart.test.tsx + use-cart-company-aware.test.tsx are the regression net for Step 2-3).

### 3.4 Changeset + commits

- [ ] **Step 1:** Create `.changeset/reactive-storage-reads.md`:

```md
---
"@viu/emporix-sdk-react": patch
---

make auth/cart state reads reactive: all render-time `storage.getCustomerToken()`/`getCartId()` reads now go through `useSyncExternalStore`-backed snapshots. Login/logout and cart-id writes immediately re-render dependent hooks — previously `enabled` gates (e.g. `usePaymentModes`, `useMyCompanies`, order hooks) stayed stale until an unrelated re-render, and sibling components could tear under concurrent rendering. Storage adapters without `subscribe`/`subscribeAll` behave as before (non-reactive).
```

- [ ] **Step 2: Commits:**

```bash
git add packages/react/src/hooks/internal/customer-session-store.ts packages/react/src/hooks/internal/use-storage-snapshot.ts packages/react/src/hooks/use-customer-session.ts packages/react/tests/use-storage-snapshot.test.tsx
git commit -m "feat(react): add reactive storage snapshot hooks"

git add packages/react/src/hooks .changeset/reactive-storage-reads.md packages/react/tests/use-my-companies.test.tsx
git commit -m "fix(react): subscribe render-time storage reads to changes"
```

---

## Task 4: Emporix-scoped query defaults on any QueryClient

**Files:**
- Modify: `packages/react/src/provider.tsx` (apply `setQueryDefaults` to the active qc; simplify the fallback)
- Modify: `docs/react.md` (document the scoped defaults)
- Test: `packages/react/tests/provider.test.tsx` (extend)
- Create: `.changeset/scoped-query-defaults.md`

- [ ] **Step 1: Failing tests.** Append to `packages/react/tests/provider.test.tsx`:

```tsx
  it("applies emporix-scoped defaults to a consumer-supplied QueryClient", () => {
    const qc = new QueryClient(); // bare client, like examples/next-app-router
    render(
      <EmporixProvider client={mkClient()} storage={createMemoryStorage()} queryClient={qc}>
        <div />
      </EmporixProvider>,
    );
    const defaults = qc.getQueryDefaults(["emporix"]);
    expect(defaults.staleTime).toBe(30_000);
    expect(defaults.refetchOnWindowFocus).toBe(false);
    expect(defaults.retry).toBe(1);
  });

  it("keeps consumer-set emporix defaults (theirs win over ours)", () => {
    const qc = new QueryClient();
    qc.setQueryDefaults(["emporix"], { staleTime: 5_000 });
    render(
      <EmporixProvider client={mkClient()} storage={createMemoryStorage()} queryClient={qc}>
        <div />
      </EmporixProvider>,
    );
    const defaults = qc.getQueryDefaults(["emporix"]);
    expect(defaults.staleTime).toBe(5_000); // consumer override preserved
    expect(defaults.refetchOnWindowFocus).toBe(false); // ours fill the gaps
  });
```

- [ ] **Step 2: Run to verify they fail** (`getQueryDefaults(["emporix"])` is empty today for a consumer qc). `pnpm -F @viu/emporix-sdk-react test -- provider.test`

- [ ] **Step 3: Implement.** In `packages/react/src/provider.tsx`, directly after the `qc` resolution from Task 2.2(c) (`const qc = queryClient ?? fallbackQc;`), add a ref-guarded render-phase application (same timing rationale as the wiring block: child queries mount before any provider effect):

```ts
  // Scope our balanced defaults to the ["emporix"] key namespace on WHATEVER
  // QueryClient is in use — consumer-supplied clients previously ran SDK
  // queries with React-Query factory defaults (staleTime 0, focus refetch,
  // retry 3 → multiplied by the SDK's own HTTP retry). Consumer-set emporix
  // defaults win: theirs are spread last. Host-app queries outside the
  // namespace are untouched. Ref-guarded: re-applies only for a new client.
  const defaultsRef = useRef<QueryClient | null>(null);
  if (defaultsRef.current !== qc) {
    qc.setQueryDefaults(["emporix"], {
      ...DEFAULT_QUERY_OPTIONS,
      ...qc.getQueryDefaults(["emporix"]),
    });
    defaultsRef.current = qc;
  }
```

Simplify the fallback from Task 2.2(c) — the constructor defaults are now redundant:

```ts
  const [fallbackQc] = useState(() => new QueryClient());
  const qc = queryClient ?? fallbackQc;
```

Update the `DEFAULT_QUERY_OPTIONS` JSDoc (provider.tsx:55-59): it no longer applies "only to the fallback QueryClient" — it is scoped to `["emporix"]` on the active client.

- [ ] **Step 4: Run** `pnpm -F @viu/emporix-sdk-react test -- provider.test` → pass. Full react suite → pass. WATCH FOR: tests that passed a bare `new QueryClient()` and relied on `staleTime: 0` refetch behavior — if any fail, they were depending on the unconfigured-client bug; adjust them to set their own emporix-scoped defaults explicitly (e.g. `qc.setQueryDefaults(["emporix"], { staleTime: 0, retry: false })`) and note it in the commit body.

- [ ] **Step 5: Document.** In `docs/react.md`, find the provider/QueryClient section (grep "queryClient") and add: "The provider applies balanced defaults (`staleTime: 30s`, `refetchOnWindowFocus: false`, `retry: 1`) to the `["emporix"]` key namespace of whatever QueryClient is active — including one you pass in. Your own `setQueryDefaults(["emporix"], …)` values take precedence, and per-hook options always win. Queries outside the `emporix` namespace are never touched."

- [ ] **Step 6: Changeset + commit.** Create `.changeset/scoped-query-defaults.md`:

```md
---
"@viu/emporix-sdk-react": patch
---

apply the provider's balanced query defaults (`staleTime: 30s`, no focus refetch, `retry: 1`) to the `["emporix"]` namespace of any QueryClient — including consumer-supplied ones, which previously ran SDK queries with React-Query factory defaults (focus-refetch storms + retry amplification against the live tenant). Consumer-set emporix-scoped defaults and per-hook options still win; host-app queries are untouched.
```

```bash
git add packages/react/src/provider.tsx packages/react/tests/provider.test.tsx docs/react.md .changeset/scoped-query-defaults.md
git commit -m "fix(react): scope query defaults to the emporix namespace"
```

---

## Task 5: Final verification + PR

- [ ] **Step 1:** `pnpm -r build && pnpm -r test && pnpm typecheck` → every package builds, all tests pass (sdk grows by ~10 tests, react by ~10), tsc clean. Also `pnpm -F @viu/emporix-sdk-react check:dist` → banner guard green.
- [ ] **Step 2:** `pnpm changeset status` → 5 changeset files; `@viu/emporix-sdk` minor + `@viu/emporix-sdk-react` patches (linked → both release at minor).
- [ ] **Step 3:** `git branch --show-current` → `fix/production-hardening-2`. Push: `git push -u origin fix/production-hardening-2`. KNOWN ISSUE: the sandbox has no SSH identity (`ssh-add -l` → empty) — if push fails with `Permission denied (publickey)`, STOP and hand the push command to the user (`! git push -u origin fix/production-hardening-2`); do not retry.
- [ ] **Step 4:** PR against `main`, title `fix(repo): harden timeouts, ssr keys, reactive reads, and query defaults`, body summarizing the four tasks (one bullet each: what + why + the user-visible behavior change), the test plan commands from Step 1, and a follow-ups section (cross-tab storage events; exports-map per-condition types; mutation-cache purge on logout — all pre-existing, listed in the 2026-06-11 review). End the body with the Claude Code attribution line. Use `gh pr create` if available, otherwise hand the compare-URL flow to the user.

---

## Self-review notes (done at plan time)

- **Spec coverage:** roadmap row 4 → Task 1 (B6 validation via toSession, B7 timeouts/error taxonomy/connectMs, B8 cookie, + idempotent sweep follow-up from PR #125); row 5 → Task 2 (B4 ssr keys + demo, B5 provider wiring/fallback-qc, B9 company-context + render-ref); row 6 → Task 3; row 7 → Task 4. One-PR constraint → Task 5. ✓
- **Deliberate deviations from the review's sketches:** (1) provider wiring uses a render-phase ref-guard instead of `useEffect` — child fetch effects run before parent effects, so an effect would attach the anonymous store too late and re-create guest sessions on reload; documented in the code comment. (2) `getServerSnapshot` reads the store instead of returning `null` — preserves SSR-with-`initialCustomerToken` rendering; the `null`-server-snapshot idea would regress it. (3) Cookie `Secure` defaults to protocol-sniffing, not hard `true` — jsdom (tests) and localhost-http would otherwise silently drop every cookie write.
- **Type consistency:** `useCustomerToken`/`useCartId` defined in Task 3.1 are consumed in 3.2/3.3 with matching signatures; `boundedFetch`, `toSession`, `WireSession`, `PrefetchSiteOpts`, `EmporixTimeoutError`/`EmporixNetworkError` each defined before use; Task 4 builds on Task 2.2(c)'s `fallbackQc` shape and simplifies it explicitly. ✓
- **Known execution risks flagged inline:** msw `delay` import (1.2), `as never` cfg literals lacking `timeouts` (1.2), jsdom Secure-cookie rejection (1.5), price-test retry config (1.4), Next 15 async `params` typing (2.4), tests relying on unconfigured QueryClients (4.4). Each step says what to do when hit.


