# SSO socialLogin & RFC 8693 Token Exchange Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `CustomerService.socialLogin` (Authorization-Code code→token exchange) and `CustomerService.exchangeToken` (RFC 8693 token exchange), both returning the shared `CustomerSession`, and wire both into the React `useCustomerSession` hook.

**Architecture:** Two new `CustomerService` methods follow the exact pattern of the existing `login`/`refresh`/`logout` (default `anonymous` auth, query-param request, snake_case‑first wire→facade mapping, `Number()`-normalized `expires_in`). `CustomerSession` gains two optional `social*` fields. `useCustomerSession` gets two actions that store the token like `login`. No new `AuthContext` kind; no IdP redirect/PKCE in the SDK.

**Tech Stack:** TypeScript 5.x strict, vitest + msw, @testing-library/react + jsdom, Changesets.

**Spec:** `docs/superpowers/specs/2026-05-19-sso-token-exchange-design.md`.

**Branch:** `feat/sso-token-exchange` (already created from `main`).

---

### Task 1: `CustomerSession` gains optional social fields

**Files:**
- Modify: `packages/sdk/src/services/customer.ts` (the `CustomerSession` interface)

- [ ] **Step 1: Add the optional fields**

In `packages/sdk/src/services/customer.ts`, add to the `CustomerSession` interface (after the existing `expiresIn` field, keeping the existing JSDoc lines intact):

```ts
  /** Customer access-token lifetime in seconds. */
  expiresIn: number | undefined;
  /** Only set by `socialLogin`: the IdP access token echoed by Emporix. */
  socialAccessToken?: string;
  /** Only set by `socialLogin`: the IdP ID token echoed by Emporix. */
  socialIdToken?: string;
```

(Only the two `social*` lines are new; the `expiresIn` line already exists — shown for placement.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @viu/emporix-sdk typecheck`
Expected: clean (additive optional fields; existing `login`/`refresh` mappings still satisfy the type).

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/src/services/customer.ts
git commit -m "feat(customer): add optional social* fields to CustomerSession"
```

---

### Task 2: `CustomerService.socialLogin`

**Files:**
- Modify: `packages/sdk/src/services/customer.ts`
- Test: `packages/sdk/tests/services/customer.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("CustomerService", …)` block in `packages/sdk/tests/services/customer.test.ts` (the existing `svc()` helper auths anonymously and the shared `server` returns `access_token: "anon-tok"` for the anonymous login):

```ts
  it("socialLogin() exchanges the code with an anonymous token, maps snake_case + social tokens, normalizes string expires_in", async () => {
    let seen: { auth: string | null; url: string; sessionHeader: string | null } | null = null;
    server.use(
      http.post("https://api.emporix.io/customer/acme/socialLogin", ({ request }) => {
        seen = {
          auth: request.headers.get("authorization"),
          url: request.url,
          sessionHeader: request.headers.get("session-id"),
        };
        return HttpResponse.json({
          social_access_token: "idp-at",
          social_id_token: "idp-it",
          access_token: "cust-tok",
          saas_token: "saas-tok",
          refresh_token: "cust-rt",
          refresh_token_expires_in: "86399",
          token_type: "Bearer",
          expires_in: "14399",
          scope: "tenant=acme",
        });
      }),
    );
    const r = await svc().socialLogin({
      code: "auth-code",
      redirectUri: "https://shop/cb",
      codeVerifier: "verif",
      sessionId: "sess-1",
    });
    const u = new URL(seen!.url);
    expect(seen!.auth).toBe("Bearer anon-tok");
    expect(seen!.sessionHeader).toBe("sess-1");
    expect(u.searchParams.get("code")).toBe("auth-code");
    expect(u.searchParams.get("redirect_uri")).toBe("https://shop/cb");
    expect(u.searchParams.get("code_verifier")).toBe("verif");
    expect(r.customerToken).toBe("cust-tok");
    expect(r.saasToken).toBe("saas-tok");
    expect(r.refreshToken).toBe("cust-rt");
    expect(r.socialAccessToken).toBe("idp-at");
    expect(r.socialIdToken).toBe("idp-it");
    expect(r.expiresIn).toBe(14399); // string "14399" → number
    expect(r.sessionId).toBeUndefined(); // socialLogin response has no session_id
  });

  it("socialLogin() omits code_verifier and the session-id header when not provided", async () => {
    let seen: { url: string; sessionHeader: string | null } | null = null;
    server.use(
      http.post("https://api.emporix.io/customer/acme/socialLogin", ({ request }) => {
        seen = { url: request.url, sessionHeader: request.headers.get("session-id") };
        return HttpResponse.json({ access_token: "c", saas_token: "s", refresh_token: "r" });
      }),
    );
    await svc().socialLogin({ code: "c1", redirectUri: "https://shop/cb" });
    const u = new URL(seen!.url);
    expect(u.searchParams.has("code_verifier")).toBe(false);
    expect(seen!.sessionHeader).toBeNull();
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- customer`
Expected: FAIL — `svc().socialLogin` is not a function.

- [ ] **Step 3: Implement `socialLogin`**

In `packages/sdk/src/services/customer.ts`, add this method immediately **after** the existing `logout()` method and **before** `me()`:

```ts
  /**
   * Authorization-Code SSO: exchanges the IdP `code` for an Emporix customer
   * session via `POST /customer/{tenant}/socialLogin`. The browser performs
   * the IdP redirect itself; the SDK only does this Emporix exchange.
   * Default auth: anonymous (Emporix requires an anonymous Bearer). The
   * response has no `session_id` and returns `expires_in` as a string —
   * normalized to a number here.
   */
  async socialLogin(
    input: { code: string; redirectUri: string; codeVerifier?: string; sessionId?: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<CustomerSession> {
    const query: Record<string, string> = {
      code: input.code,
      redirect_uri: input.redirectUri,
    };
    if (input.codeVerifier) query.code_verifier = input.codeVerifier;
    const wire = await this.ctx.http.request<{
      social_access_token?: string;
      social_id_token?: string;
      access_token?: string;
      saas_token?: string;
      refresh_token?: string;
      session_id?: string;
      expires_in?: string | number;
      // Deprecated camelCase variants (Emporix spec marks these deprecated).
      accessToken?: string;
      saasToken?: string;
      refreshToken?: string;
    }>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/socialLogin`,
      query,
      auth,
      ...(input.sessionId ? { headers: { "session-id": input.sessionId } } : {}),
    });
    return {
      customerToken: wire.access_token ?? wire.accessToken ?? "",
      saasToken: wire.saas_token ?? wire.saasToken ?? "",
      refreshToken: wire.refresh_token ?? wire.refreshToken ?? "",
      sessionId: wire.session_id,
      expiresIn: wire.expires_in != null ? Number(wire.expires_in) : undefined,
      ...(wire.social_access_token ? { socialAccessToken: wire.social_access_token } : {}),
      ...(wire.social_id_token ? { socialIdToken: wire.social_id_token } : {}),
    };
  }
```

(`exactOptionalPropertyTypes` is on — the `social*` and `headers` fields use conditional spread, matching the existing `CheckoutService` pattern.)

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- customer && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add socialLogin (Authorization-Code exchange)"
```

---

### Task 3: `CustomerService.exchangeToken`

**Files:**
- Modify: `packages/sdk/src/services/customer.ts`
- Test: `packages/sdk/tests/services/customer.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe("CustomerService", …)` block:

```ts
  it("exchangeToken() posts subjectAccessToken + config with an anonymous token, maps snake_case, integer expires_in", async () => {
    let seen: { auth: string | null; url: string } | null = null;
    server.use(
      http.post("https://api.emporix.io/customer/acme/exchangeauthtoken", ({ request }) => {
        seen = { auth: request.headers.get("authorization"), url: request.url };
        return HttpResponse.json({
          subject_access_token: "idp-jwt",
          access_token: "cust-tok",
          saas_token: "saas-tok",
          refresh_token: "cust-rt",
          refresh_token_expires_in: 86399,
          token_type: "Bearer",
          expires_in: 14399,
          scope: "tenant=acme",
          session_id: "sess-9",
        });
      }),
    );
    const r = await svc().exchangeToken({ subjectToken: "idp-jwt", config: "Site_DE" });
    const u = new URL(seen!.url);
    expect(seen!.auth).toBe("Bearer anon-tok");
    expect(u.searchParams.get("subjectAccessToken")).toBe("idp-jwt");
    expect(u.searchParams.get("config")).toBe("Site_DE");
    expect(r.customerToken).toBe("cust-tok");
    expect(r.saasToken).toBe("saas-tok");
    expect(r.refreshToken).toBe("cust-rt");
    expect(r.sessionId).toBe("sess-9");
    expect(r.expiresIn).toBe(14399); // integer passes through Number() unchanged
    expect(r.socialAccessToken).toBeUndefined();
  });

  it("exchangeToken() omits config when not provided", async () => {
    let url = "";
    server.use(
      http.post("https://api.emporix.io/customer/acme/exchangeauthtoken", ({ request }) => {
        url = request.url;
        return HttpResponse.json({ access_token: "c", saas_token: "s", refresh_token: "r" });
      }),
    );
    await svc().exchangeToken({ subjectToken: "jwt" });
    expect(new URL(url).searchParams.has("config")).toBe(false);
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk test -- customer`
Expected: FAIL — `svc().exchangeToken` is not a function.

- [ ] **Step 3: Implement `exchangeToken`**

In `packages/sdk/src/services/customer.ts`, add this method immediately **after** the new `socialLogin()` method and **before** `me()`:

```ts
  /**
   * RFC 8693 token exchange: exchanges an external IdP JWT for an Emporix
   * customer session via `POST /customer/{tenant}/exchangeauthtoken`.
   * Emporix uses a proprietary query-param wire (not the RFC form body).
   * Default auth: anonymous. `config` selects a site-specific IdP config
   * (multi-site); omit for the tenant default. Returns `session_id` and a
   * fresh `saas_token`; `expires_in` is an integer (normalized anyway).
   */
  async exchangeToken(
    input: { subjectToken: string; config?: string },
    auth: AuthContext = { kind: "anonymous" },
  ): Promise<CustomerSession> {
    const query: Record<string, string> = { subjectAccessToken: input.subjectToken };
    if (input.config) query.config = input.config;
    const wire = await this.ctx.http.request<{
      access_token?: string;
      saas_token?: string;
      refresh_token?: string;
      session_id?: string;
      expires_in?: string | number;
      accessToken?: string;
      saasToken?: string;
      refreshToken?: string;
    }>({
      method: "POST",
      path: `/customer/${this.ctx.tenant}/exchangeauthtoken`,
      query,
      auth,
    });
    return {
      customerToken: wire.access_token ?? wire.accessToken ?? "",
      saasToken: wire.saas_token ?? wire.saasToken ?? "",
      refreshToken: wire.refresh_token ?? wire.refreshToken ?? "",
      sessionId: wire.session_id,
      expiresIn: wire.expires_in != null ? Number(wire.expires_in) : undefined,
    };
  }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @viu/emporix-sdk test -- customer && pnpm --filter @viu/emporix-sdk typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add exchangeToken (RFC 8693 token exchange)"
```

---

### Task 4: `useCustomerSession` — `socialLogin` + `exchangeToken` actions

**Files:**
- Modify: `packages/react/src/hooks/use-customer-session.ts`
- Test: `packages/react/tests/use-customer-session.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("useCustomerSession", …)` block in `packages/react/tests/use-customer-session.test.tsx` (the shared `server` already mocks the anonymous login; `wrapper(storage)` and `createMemoryStorage` are defined at the top of the file):

```tsx
  it("socialLogin stores the token", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/socialLogin", () =>
        HttpResponse.json({
          access_token: "sso-cust",
          saas_token: "saas",
          refresh_token: "sso-rt",
          expires_in: "14399",
        }),
      ),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    await act(async () => {
      await result.current.socialLogin({ code: "c", redirectUri: "https://shop/cb" });
    });
    expect(storage.getCustomerToken()).toBe("sso-cust");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.refreshToken).toBe("sso-rt");
  });

  it("exchangeToken stores the token", async () => {
    server.use(
      http.post("https://api.emporix.io/customer/acme/exchangeauthtoken", () =>
        HttpResponse.json({
          access_token: "ex-cust",
          saas_token: "saas",
          refresh_token: "ex-rt",
          expires_in: 14399,
          session_id: "s9",
        }),
      ),
    );
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useCustomerSession(), { wrapper: wrapper(storage) });
    await act(async () => {
      await result.current.exchangeToken({ subjectToken: "idp-jwt", config: "Site_DE" });
    });
    expect(storage.getCustomerToken()).toBe("ex-cust");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.refreshToken).toBe("ex-rt");
  });
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @viu/emporix-sdk-react test -- use-customer-session`
Expected: FAIL — `result.current.socialLogin` / `.exchangeToken` is not a function.

- [ ] **Step 3: Extend the hook**

In `packages/react/src/hooks/use-customer-session.ts`:

Add to the `CustomerSessionApi` interface (after the existing `signup` line):

```ts
  /** Authorization-Code SSO: exchanges an IdP `code` for a customer session. */
  socialLogin: (input: {
    code: string;
    redirectUri: string;
    codeVerifier?: string;
    sessionId?: string;
  }) => Promise<void>;
  /** RFC 8693 token exchange: exchanges an external IdP JWT for a session. */
  exchangeToken: (input: { subjectToken: string; config?: string }) => Promise<void>;
```

Add this helper **above** the existing `login` `useCallback` (it factors the
shared "store a CustomerSession into hook state" logic; reuse it from `login`
too is optional and out of scope — only the two new actions use it):

```ts
  const applySession = useCallback(
    async (session: {
      customerToken: string;
      refreshToken: string;
      saasToken: string;
    }) => {
      storage.setCustomerToken(session.customerToken);
      setToken(session.customerToken);
      setRefreshTok(session.refreshToken || null);
      setSaasTok(session.saasToken || null);
      await qc.invalidateQueries({ queryKey: ["emporix", "customer"] });
      await qc.invalidateQueries({ queryKey: ["emporix", "cart"] });
    },
    [storage, qc],
  );

  const socialLogin = useCallback(
    async (input: {
      code: string;
      redirectUri: string;
      codeVerifier?: string;
      sessionId?: string;
    }) => {
      await applySession(await client.customers.socialLogin(input));
    },
    [client, applySession],
  );

  const exchangeToken = useCallback(
    async (input: { subjectToken: string; config?: string }) => {
      await applySession(await client.customers.exchangeToken(input));
    },
    [client, applySession],
  );
```

Add `socialLogin` and `exchangeToken` to the returned object (next to
`login`, `signup`, `logout`, `refresh`, `refreshSession`):

```ts
    login,
    signup,
    socialLogin,
    exchangeToken,
    logout,
    refresh,
    refreshSession,
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @viu/emporix-sdk-react test -- use-customer-session && pnpm --filter @viu/emporix-sdk-react typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-customer-session.ts packages/react/tests/use-customer-session.test.tsx
git commit -m "feat(react): useCustomerSession socialLogin + exchangeToken actions"
```

---

### Task 5: Docs, changeset, green gate, finish

**Files:**
- Modify: `docs/auth.md`
- Create: `.changeset/sso-token-exchange.md`

- [ ] **Step 1: Update `docs/auth.md`**

Replace the closing paragraph of the **`## SSO / token exchange`** section
(currently states the flows are "out of scope for the SDK") with:

```markdown
The SDK supports both Emporix customer SSO flows directly:

- **Authorization Code (SSO):** the storefront performs the IdP redirect and
  PKCE itself, then calls `customers.socialLogin({ code, redirectUri,
  codeVerifier?, sessionId? })` (default `anonymous` auth). Emporix has no
  `/authorize` endpoint — only the code exchange is the SDK's concern.
- **RFC 8693 Token Exchange:** `customers.exchangeToken({ subjectToken,
  config? })` exchanges an external IdP JWT for an Emporix session (default
  `anonymous` auth; `config` selects a per-site IdP config).

Both return a `CustomerSession` (the caller then uses `auth.customer(token)`),
and `useCustomerSession().socialLogin` / `.exchangeToken` store it like
`login`. Registering the IdP / trusted issuer is a manual Emporix-support
provisioning step, not an SDK config. Note the platform quirk: `expires_in`
is a string from `socialLogin` and an integer from `exchangeToken` — the SDK
normalizes both to a number. `auth.raw(jwt)` and a custom `tokenProvider`
remain available for any flow the SDK does not model.
```

- [ ] **Step 2: Add the changeset**

Create `.changeset/sso-token-exchange.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix customer SSO support. `customers.socialLogin({ code, redirectUri,
codeVerifier?, sessionId? })` performs the Authorization-Code code exchange
(`POST /customer/{tenant}/socialLogin`); `customers.exchangeToken({
subjectToken, config? })` performs the RFC 8693 token exchange
(`POST /customer/{tenant}/exchangeauthtoken`). Both default to anonymous auth
and return a `CustomerSession` (now with optional `socialAccessToken` /
`socialIdToken` from socialLogin); `expires_in` is normalized to a number
across both flows. `useCustomerSession` gains `socialLogin` and
`exchangeToken` actions that store the session like `login`.
```

- [ ] **Step 3: Full green gate**

Run:

```bash
pnpm build && pnpm typecheck && pnpm -r --filter "./packages/*" test
```

Expected: build ok; typecheck clean across sdk/react/examples; sdk + react
suites pass; coverage ≥80% on `packages/*`. If react branch coverage dips
below 80%, add a focused test for the uncovered branch (e.g. the
`session.refreshToken || null` falsy path in `applySession`) — do not lower
the threshold.

- [ ] **Step 4: Commit**

```bash
git add docs/auth.md .changeset/sso-token-exchange.md
git commit -m "docs(repo): document SSO + token exchange; add changeset"
```

- [ ] **Step 5: Finish the branch**

Use **superpowers:finishing-a-development-branch** (verify tests → 4-option menu → execute choice).

---

## Self-Review

- **Spec coverage:** §A `CustomerSession` extension → Task 1; §B `socialLogin`
  → Task 2; §C `exchangeToken` → Task 3; §D React actions → Task 4; spec
  "Testing" → per-task TDD (anonymous Bearer, query params, `session-id`
  header presence/absence, `config` presence/absence, snake_case mapping,
  `expires_in` string **and** integer, `social*` populated/absent, default vs
  override auth); spec "Release/docs" → Task 5. Decisions 1–4 all reflected
  (no redirect/PKCE; hook extended; `config` optional per-call; reuse
  `CustomerSession` + optional `social*`, `Number()` normalize). No gaps.
- **Placeholder scan:** every code step contains complete code and exact
  commands; no TBD/"handle errors"/vague steps.
- **Type consistency:** `CustomerSession` (+`socialAccessToken?`/
  `socialIdToken?`), `socialLogin(input:{code,redirectUri,codeVerifier?,
  sessionId?})`, `exchangeToken(input:{subjectToken,config?})`, the wire
  query keys (`code`,`redirect_uri`,`code_verifier`,`subjectAccessToken`,
  `config`), the `session-id` header, and the `applySession` helper signature
  are used identically across Tasks 1–4, the React interface, tests, and the
  changeset. Auth default `{ kind: "anonymous" }` consistent with the
  existing `login`/`refresh` convention.
