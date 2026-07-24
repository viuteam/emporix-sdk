# Storefront Facade Completeness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 20 storefront-relevant facade methods (+ React-Query hooks) across `carts`, `customers`, `categories`, `payments`, `sessionContext`, rounding out the storefront subset found missing in the coverage audit.

**Architecture:** Extend five existing services — no new services, channels, or client accessors. Each method wraps one live endpoint via `ctx.http.request`, aliases the exact generated request/response type, and follows the service's existing auth default. State-changing cart ops (204/empty responses) re-fetch and return the `Cart` (the pattern PR #159 established). React hooks wrap each method: reads via the internal `useEmporixQuery` factory, writes via `useMutation` (cart writes join the existing `useCartMutations` bundle).

**Tech Stack:** TypeScript, `@hey-api/openapi-ts`-generated types, Vitest + MSW (`msw/node`) for SDK, Vitest + jsdom + MSW + `@testing-library/react` for React, `@tanstack/react-query`.

## Global Constraints

- Backward-compatible: only add methods/types; never rename or change existing ones (the four methods fixed in #159 stay as-is).
- Never hand-author wire shapes — alias generated types from `packages/sdk/src/generated/<service>/types.gen.ts`.
- Commit scopes (commitlint): use `cart`, `customer`, `category`, `payment`, `sdk`, `react`. Subject's first word after the scope is a lowercase verb.
- Commit footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Test host is `https://api.emporix.io`, tenant `acme`. Each SDK test file already has a `server` (MSW `setupServer`, with an anonymous-login handler) and an `svc()` factory returning the service instance — reuse them; add per-test handlers with `server.use(...)`.
- Verify commands: SDK `pnpm -F @viu/emporix-sdk exec vitest run <file>`; React `pnpm -F @viu/emporix-sdk-react exec vitest run <file>`. Build before examples/react typecheck: `pnpm -F @viu/emporix-sdk build`.
- Auth in tests: anonymous → `{ kind: "anonymous" }` (harness serves the anon login); customer → `{ kind: "customer", token: "CUST" }`.

---

## Phase 1 — Cart (`packages/sdk/src/services/cart.ts`, tests `tests/services/cart.test.ts`)

### Task 1: `cart.validate`

**Files:**
- Modify: `packages/sdk/src/services/cart.ts` (import + type + method)
- Modify: `packages/sdk/src/index.ts:54-62` (export `CartValidationResult`)
- Test: `packages/sdk/tests/services/cart.test.ts`

**Interfaces:**
- Produces: `validate(cartId: string, auth: AuthContext): Promise<CartValidationResult>`; public `CartValidationResult` (alias of generated `CartValidationResult`).

- [ ] **Step 1: Write the failing test**

```ts
it("validate GETs the cart validation result", async () => {
  server.use(
    http.get("https://api.emporix.io/cart/acme/carts/cart1/validate", () =>
      HttpResponse.json({ isValid: false, itemsValidationDetails: [{ id: "0", errors: [] }] }),
    ),
  );
  const r = await svc().validate("cart1", { kind: "anonymous" });
  expect(r.isValid).toBe(false);
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/cart.test.ts`
Expected: FAIL — `svc(...).validate is not a function` / TS `Property 'validate' does not exist`.

- [ ] **Step 3: Implement**

In `cart.ts`, add `CartValidationResult` to the `../generated/cart` import, then add the public type alias near the other cart type aliases:

```ts
/** Result of validating a cart's items (generated). */
export type CartValidationResult = GeneratedCartValidationResult;
```

(Import it as `CartValidationResult as GeneratedCartValidationResult`.) Add the method to `CartService`:

```ts
/** Validates the cart's items (pricing/consistency checks). */
async validate(cartId: string, auth: AuthContext): Promise<CartValidationResult> {
  return this.ctx.http.request<CartValidationResult>({
    method: "GET",
    path: `${this.base()}/${cartId}/validate`,
    auth: requireCartAuth(auth),
  });
}
```

In `packages/sdk/src/index.ts`, add `CartValidationResult` to the `export type { … } from "./services/cart";` block.

- [ ] **Step 4: Run test — expect PASS**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/cart.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/src/index.ts packages/sdk/tests/services/cart.test.ts
git commit -m "feat(cart): add carts.validate"
```

### Task 2: `cart.listItems`

**Files:** Modify `cart.ts`, `index.ts`; Test `cart.test.ts`.
**Interfaces:** Produces `listItems(cartId: string, auth: AuthContext): Promise<CartItem[]>`; public `CartItem` (alias of generated `CartItemResponse`).

- [ ] **Step 1: Failing test**

```ts
it("listItems GETs the cart items", async () => {
  server.use(
    http.get("https://api.emporix.io/cart/acme/carts/cart1/items", () =>
      HttpResponse.json([{ id: "0", quantity: 2 }, { id: "1", quantity: 1 }]),
    ),
  );
  const items = await svc().listItems("cart1", { kind: "anonymous" });
  expect(items).toHaveLength(2);
  expect(items[0]?.id).toBe("0");
});
```

- [ ] **Step 2: Run — expect FAIL** (`listItems is not a function`)

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/cart.test.ts`

- [ ] **Step 3: Implement**

Add `CartItemResponse` to the `../generated/cart` import; add alias:

```ts
/** A single cart item as returned by the Cart service (generated). */
export type CartItem = CartItemResponse;
```

Method:

```ts
/** Lists the items in a cart with calculated prices. */
async listItems(cartId: string, auth: AuthContext): Promise<CartItem[]> {
  return this.ctx.http.request<CartItem[]>({
    method: "GET",
    path: `${this.base()}/${cartId}/items`,
    auth: requireCartAuth(auth),
  });
}
```

Add `CartItem` to the cart export block in `index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/src/index.ts packages/sdk/tests/services/cart.test.ts
git commit -m "feat(cart): add carts.listItems"
```

### Task 3: `cart.refresh`

**Files:** Modify `cart.ts`; Test `cart.test.ts`.
**Interfaces:** Produces `refresh(cartId: string, auth: AuthContext): Promise<Cart>` (PUT 204 → re-fetch via `this.get`).

- [ ] **Step 1: Failing test**

```ts
it("refresh PUTs then returns the re-fetched cart", async () => {
  server.use(
    http.put("https://api.emporix.io/cart/acme/carts/cart1/refresh", () =>
      new HttpResponse(null, { status: 204 }),
    ),
    http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
      HttpResponse.json({ id: "cart1", items: [{ id: "i1" }] }),
    ),
  );
  const cart = await svc().refresh("cart1", { kind: "anonymous" });
  expect(cart.id).toBe("cart1");
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```ts
/** Refreshes a cart and its items (re-prices), then returns the updated cart. */
async refresh(cartId: string, auth: AuthContext): Promise<Cart> {
  const cartAuth = requireCartAuth(auth);
  await this.ctx.http.request<void>({
    method: "PUT",
    path: `${this.base()}/${cartId}/refresh`,
    auth: cartAuth,
  });
  return this.get(cartId, cartAuth);
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/tests/services/cart.test.ts
git commit -m "feat(cart): add carts.refresh"
```

### Task 4: `cart.changeSite`

**Files:** Modify `cart.ts`; Test `cart.test.ts`.
**Interfaces:** Produces `changeSite(cartId: string, siteCode: string, auth: AuthContext): Promise<Cart>` (POST → re-fetch).

- [ ] **Step 1: Failing test**

```ts
it("changeSite POSTs the site then returns the re-fetched cart", async () => {
  let body: unknown;
  server.use(
    http.post("https://api.emporix.io/cart/acme/carts/cart1/changeSite", async ({ request }) => {
      body = await request.json();
      return new HttpResponse(null, { status: 200 });
    }),
    http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
      HttpResponse.json({ id: "cart1", items: [] }),
    ),
  );
  const cart = await svc().changeSite("cart1", "USA", { kind: "anonymous" });
  expect(cart.id).toBe("cart1");
  expect(body).toEqual({ siteCode: "USA" });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```ts
/** Changes the cart's site (re-prices to the new site's currency), then returns the updated cart. */
async changeSite(cartId: string, siteCode: string, auth: AuthContext): Promise<Cart> {
  const cartAuth = requireCartAuth(auth);
  await this.ctx.http.request<void>({
    method: "POST",
    path: `${this.base()}/${cartId}/changeSite`,
    auth: cartAuth,
    body: { siteCode },
  });
  return this.get(cartId, cartAuth);
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/tests/services/cart.test.ts
git commit -m "feat(cart): add carts.changeSite"
```

### Task 5: `cart.changeCurrency`

**Files:** Modify `cart.ts`; Test `cart.test.ts`.
**Interfaces:** Produces `changeCurrency(cartId: string, currency: string, auth: AuthContext): Promise<Cart>` (POST → re-fetch).

- [ ] **Step 1: Failing test**

```ts
it("changeCurrency POSTs the currency then returns the re-fetched cart", async () => {
  let body: unknown;
  server.use(
    http.post("https://api.emporix.io/cart/acme/carts/cart1/changeCurrency", async ({ request }) => {
      body = await request.json();
      return new HttpResponse(null, { status: 200 });
    }),
    http.get("https://api.emporix.io/cart/acme/carts/cart1", () =>
      HttpResponse.json({ id: "cart1", items: [] }),
    ),
  );
  const cart = await svc().changeCurrency("cart1", "USD", { kind: "anonymous" });
  expect(cart.id).toBe("cart1");
  expect(body).toEqual({ currency: "USD" });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```ts
/** Changes the cart's currency (re-prices), then returns the updated cart. */
async changeCurrency(cartId: string, currency: string, auth: AuthContext): Promise<Cart> {
  const cartAuth = requireCartAuth(auth);
  await this.ctx.http.request<void>({
    method: "POST",
    path: `${this.base()}/${cartId}/changeCurrency`,
    auth: cartAuth,
    body: { currency },
  });
  return this.get(cartId, cartAuth);
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/tests/services/cart.test.ts
git commit -m "feat(cart): add carts.changeCurrency"
```

### Task 6: `cart.updateItemsBatch`

**Files:** Modify `cart.ts`, `index.ts`; Test `cart.test.ts`.
**Interfaces:** Produces `updateItemsBatch(cartId: string, items: CartItemsBatchUpdateInput, auth: AuthContext): Promise<CartItemsBatchUpdateResult>`; public aliases of generated `CartItemsBatchUpdateRequest` / `CartItemsBatchUpdateResponse`.

- [ ] **Step 1: Failing test**

```ts
it("updateItemsBatch PUTs the items batch and returns per-entry results", async () => {
  server.use(
    http.put("https://api.emporix.io/cart/acme/carts/cart1/itemsBatch", () =>
      HttpResponse.json([{ index: 0, status: 200, id: "0" }]),
    ),
  );
  const res = await svc().updateItemsBatch(
    "cart1",
    [{ id: "0", quantity: 3 } as unknown as CartItemsBatchUpdateInput[number]],
    { kind: "anonymous" },
  );
  expect(res[0]?.status).toBe(200);
});
```

Add `import type { CartItemsBatchUpdateInput } from "../../src/services/cart";` if the test file does not already import from cart.

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

Add `CartItemsBatchUpdateRequest`, `CartItemsBatchUpdateResponse` to the `../generated/cart` import; add aliases:

```ts
/** Request body for updating multiple cart items (generated). */
export type CartItemsBatchUpdateInput = CartItemsBatchUpdateRequest;
/** Per-entry response for a multi-item update (generated). */
export type CartItemsBatchUpdateResult = CartItemsBatchUpdateResponse;
```

Method:

```ts
/**
 * Updates multiple cart items in one request (`PUT …/itemsBatch`). Like
 * `addItemsBatch`, the response carries a per-entry `status`; partial failures
 * do not throw — inspect each entry.
 */
async updateItemsBatch(
  cartId: string,
  items: CartItemsBatchUpdateInput,
  auth: AuthContext,
): Promise<CartItemsBatchUpdateResult> {
  return this.ctx.http.request<CartItemsBatchUpdateResult>({
    method: "PUT",
    path: `${this.base()}/${cartId}/itemsBatch`,
    auth: requireCartAuth(auth),
    body: items,
  });
}
```

Export `CartItemsBatchUpdateInput`, `CartItemsBatchUpdateResult` from the cart block in `index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/src/index.ts packages/sdk/tests/services/cart.test.ts
git commit -m "feat(cart): add carts.updateItemsBatch"
```

---

## Phase 2 — Customer (`packages/sdk/src/services/customer.ts`, tests `tests/services/customer.test.ts`)

### Task 7: `customer.confirmSignup`

**Files:** Modify `customer.ts`; Test `customer.test.ts`.
**Interfaces:** Produces `confirmSignup(token: string, auth?: AuthContext): Promise<CustomerSession>` (GET double opt-in; response is `CustomerToken`, mapped via the existing `toSession`). Default auth anonymous.

- [ ] **Step 1: Failing test**

```ts
it("confirmSignup activates via double opt-in and returns a session", async () => {
  server.use(
    http.get("https://api.emporix.io/customer/acme/signup/optin/Tok123", () =>
      HttpResponse.json({ access_token: "cust", refresh_token: "rt", expires_in: 2591999 }),
    ),
  );
  const s = await svc().confirmSignup("Tok123");
  expect(s.customerToken).toBe("cust");
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```ts
/**
 * Completes double opt-in signup with the emailed token, creating the account
 * and returning a logged-in {@link CustomerSession}. Default auth: anonymous.
 */
async confirmSignup(
  token: string,
  auth: AuthContext = { kind: "anonymous" },
): Promise<CustomerSession> {
  const wire = await this.ctx.http.request<WireSession>({
    method: "GET",
    path: `/customer/${this.ctx.tenant}/signup/optin/${encodeURIComponent(token)}`,
    auth,
  });
  return toSession("confirmSignup", wire);
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add customers.confirmSignup (double opt-in)"
```

### Task 8: `customer.resendActivation`

**Files:** Modify `customer.ts`, `index.ts`; Test `customer.test.ts`.
**Interfaces:** Produces `resendActivation(input: ResendActivationInput, auth?: AuthContext): Promise<void>`; public `ResendActivationInput` (alias generated `RefreshToken`). Default auth anonymous.

- [ ] **Step 1: Failing test**

```ts
it("resendActivation POSTs the email", async () => {
  let body: unknown;
  server.use(
    http.post("https://api.emporix.io/customer/acme/signup/optin/refresh_token", async ({ request }) => {
      body = await request.json();
      return new HttpResponse(null, { status: 202 });
    }),
  );
  await expect(svc().resendActivation({ email: "a@b.co" })).resolves.toBeUndefined();
  expect(body).toEqual({ email: "a@b.co" });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

Add `RefreshToken` to the `../generated/customer` import; add alias `export type ResendActivationInput = RefreshToken;`. Method:

```ts
/** Resends the double opt-in activation link. Default auth: anonymous. */
async resendActivation(
  input: ResendActivationInput,
  auth: AuthContext = { kind: "anonymous" },
): Promise<void> {
  await this.ctx.http.request<void>({
    method: "POST",
    path: `/customer/${this.ctx.tenant}/signup/optin/refresh_token`,
    auth,
    body: input,
  });
}
```

Export `ResendActivationInput` from the customer block in `index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/src/index.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add customers.resendActivation"
```

### Task 9: `customer.changeEmail`

**Files:** Modify `customer.ts`, `index.ts`; Test `customer.test.ts`.
**Interfaces:** Produces `changeEmail(input: ChangeEmailInput, auth?: AuthContext): Promise<void>`; public `ChangeEmailInput` (alias generated `ChangeEmailRequestDto`). Requires customer auth.

- [ ] **Step 1: Failing test**

```ts
it("changeEmail POSTs the change request with the customer bearer", async () => {
  let authz: string | null = null;
  server.use(
    http.post("https://api.emporix.io/customer/acme/me/accounts/internal/email/change", ({ request }) => {
      authz = request.headers.get("authorization");
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await expect(
    svc().changeEmail(
      { email: "a@b.co", password: "p", newEmail: "c@d.co" },
      { kind: "customer", token: "CUST" },
    ),
  ).resolves.toBeUndefined();
  expect(authz).toBe("Bearer CUST");
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

Add `ChangeEmailRequestDto` to the `../generated/customer` import; add `export type ChangeEmailInput = ChangeEmailRequestDto;`. Method:

```ts
/** Requests a login-email change (emails a confirmation token). Requires customer/raw auth. */
async changeEmail(input: ChangeEmailInput, auth?: AuthContext): Promise<void> {
  await this.ctx.http.request<void>({
    method: "POST",
    path: `/customer/${this.ctx.tenant}/me/accounts/internal/email/change`,
    auth: requireCustomer(auth),
    body: input,
  });
}
```

Export `ChangeEmailInput` from the customer block in `index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/src/index.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add customers.changeEmail"
```

### Task 10: `customer.confirmEmailChange`

**Files:** Modify `customer.ts`, `index.ts`; Test `customer.test.ts`.
**Interfaces:** Produces `confirmEmailChange(input: ConfirmEmailChangeInput, auth?: AuthContext): Promise<void>`; public `ConfirmEmailChangeInput` (alias generated `UpdateEmail`). Default auth anonymous.

- [ ] **Step 1: Failing test**

```ts
it("confirmEmailChange POSTs the token with anonymous auth", async () => {
  let body: unknown;
  server.use(
    http.post("https://api.emporix.io/customer/acme/me/accounts/internal/email/change/confirm", async ({ request }) => {
      body = await request.json();
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await expect(svc().confirmEmailChange({ token: "T" })).resolves.toBeUndefined();
  expect(body).toEqual({ token: "T" });
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

Add `UpdateEmail` to the `../generated/customer` import; add `export type ConfirmEmailChangeInput = UpdateEmail;`. Method:

```ts
/** Confirms a login-email change with the emailed token. Default auth: anonymous. */
async confirmEmailChange(
  input: ConfirmEmailChangeInput,
  auth: AuthContext = { kind: "anonymous" },
): Promise<void> {
  await this.ctx.http.request<void>({
    method: "POST",
    path: `/customer/${this.ctx.tenant}/me/accounts/internal/email/change/confirm`,
    auth,
    body: input,
  });
}
```

Export `ConfirmEmailChangeInput` from the customer block in `index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/src/index.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add customers.confirmEmailChange"
```

### Task 11: `customer.addresses.get`

**Files:** Modify `customer.ts`; Test `customer.test.ts`.
**Interfaces:** Produces `addresses.get(id: string, auth?: AuthContext): Promise<Address>`.

- [ ] **Step 1: Failing test**

```ts
it("addresses.get GETs one address", async () => {
  server.use(
    http.get("https://api.emporix.io/customer/acme/me/addresses/ad1", () =>
      HttpResponse.json({ id: "ad1", city: "Berlin" }),
    ),
  );
  const a = await svc().addresses.get("ad1", { kind: "customer", token: "CUST" });
  expect(a.id).toBe("ad1");
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — add to the `addresses` object literal in `customer.ts`:

```ts
get: async (id: string, auth?: AuthContext): Promise<Address> =>
  this.ctx.http.request<Address>({
    method: "GET",
    path: `/customer/${this.ctx.tenant}/me/addresses/${id}`,
    auth: requireCustomer(auth),
  }),
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add customers.addresses.get"
```

### Task 12: `customer.addresses.addTags`

**Files:** Modify `customer.ts`; Test `customer.test.ts`.
**Interfaces:** Produces `addresses.addTags(id: string, tags: string[], auth?: AuthContext): Promise<void>` (POST `…/tags?tags=<csv>`).

- [ ] **Step 1: Failing test**

```ts
it("addresses.addTags POSTs tags as a comma-separated query", async () => {
  let url = "";
  server.use(
    http.post("https://api.emporix.io/customer/acme/me/addresses/ad1/tags", ({ request }) => {
      url = request.url;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await expect(
    svc().addresses.addTags("ad1", ["BILLING", "SHIPPING"], { kind: "customer", token: "CUST" }),
  ).resolves.toBeUndefined();
  expect(new URL(url).searchParams.get("tags")).toBe("BILLING,SHIPPING");
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — add to the `addresses` object:

```ts
addTags: async (id: string, tags: string[], auth?: AuthContext): Promise<void> => {
  await this.ctx.http.request<void>({
    method: "POST",
    path: `/customer/${this.ctx.tenant}/me/addresses/${id}/tags`,
    query: { tags: tags.join(",") },
    auth: requireCustomer(auth),
  });
},
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add customers.addresses.addTags"
```

### Task 13: `customer.addresses.removeTags`

**Files:** Modify `customer.ts`; Test `customer.test.ts`.
**Interfaces:** Produces `addresses.removeTags(id: string, tags: string[], auth?: AuthContext): Promise<void>` (DELETE `…/tags?tags=<csv>`).

- [ ] **Step 1: Failing test**

```ts
it("addresses.removeTags DELETEs with the tags query", async () => {
  let url = "";
  server.use(
    http.delete("https://api.emporix.io/customer/acme/me/addresses/ad1/tags", ({ request }) => {
      url = request.url;
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await expect(
    svc().addresses.removeTags("ad1", ["BILLING"], { kind: "customer", token: "CUST" }),
  ).resolves.toBeUndefined();
  expect(new URL(url).searchParams.get("tags")).toBe("BILLING");
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — add to the `addresses` object:

```ts
removeTags: async (id: string, tags: string[], auth?: AuthContext): Promise<void> => {
  await this.ctx.http.request<void>({
    method: "DELETE",
    path: `/customer/${this.ctx.tenant}/me/addresses/${id}/tags`,
    query: { tags: tags.join(",") },
    auth: requireCustomer(auth),
  });
},
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/customer.ts packages/sdk/tests/services/customer.test.ts
git commit -m "feat(customer): add customers.addresses.removeTags"
```

---

## Phase 3 — Category (`packages/sdk/src/services/category.ts`, tests `tests/services/category.test.ts`)

Category methods default to anonymous (`ANON`). `Category` and `CategoryNode` types already exist in `category.ts`; no new type or index export is needed.

### Task 14: `category.parents`

- [ ] **Step 1: Failing test** (in `category.test.ts`)

```ts
it("parents GETs the ancestor categories", async () => {
  server.use(
    http.get("https://api.emporix.io/category/acme/categories/c1/parents", () =>
      HttpResponse.json([{ id: "root" }, { id: "mid" }]),
    ),
  );
  const parents = await svc().parents("c1", { kind: "anonymous" });
  expect(parents.map((c) => c.id)).toEqual(["root", "mid"]);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/category.test.ts`

- [ ] **Step 3: Implement** — add to `CategoryService`:

```ts
/** Lists a category's ancestor categories (breadcrumb-up). Default auth: anonymous. */
async parents(categoryId: string, auth: AuthContext = ANON): Promise<Category[]> {
  return this.ctx.http.request<Category[]>({
    method: "GET",
    path: `/category/${this.ctx.tenant}/categories/${categoryId}/parents`,
    auth,
  });
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/tests/services/category.test.ts
git commit -m "feat(category): add categories.parents"
```

### Task 15: `category.childCategories`

**Interfaces:** Produces `childCategories(categoryId: string, auth?: AuthContext): Promise<Category[]>` (dedicated `/subcategories`; distinct from the existing `subcategories()` which reads `/assignments`).

- [ ] **Step 1: Failing test**

```ts
it("childCategories GETs the dedicated subcategories endpoint", async () => {
  server.use(
    http.get("https://api.emporix.io/category/acme/categories/c1/subcategories", () =>
      HttpResponse.json([{ id: "child1" }]),
    ),
  );
  const kids = await svc().childCategories("c1", { kind: "anonymous" });
  expect(kids[0]?.id).toBe("child1");
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```ts
/**
 * Lists a category's direct child categories via the dedicated
 * `…/subcategories` endpoint. (The older `subcategories()` reads `/assignments`
 * and is kept for backward compatibility.) Default auth: anonymous.
 */
async childCategories(categoryId: string, auth: AuthContext = ANON): Promise<Category[]> {
  return this.ctx.http.request<Category[]>({
    method: "GET",
    path: `/category/${this.ctx.tenant}/categories/${categoryId}/subcategories`,
    auth,
  });
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/tests/services/category.test.ts
git commit -m "feat(category): add categories.childCategories"
```

### Task 16: `category.getTree`

**Interfaces:** Produces `getTree(categoryId: string, auth?: AuthContext): Promise<CategoryNode>` (single tree by id; existing `tree()` lists all).

- [ ] **Step 1: Failing test**

```ts
it("getTree GETs a single category tree by id", async () => {
  server.use(
    http.get("https://api.emporix.io/category/acme/category-trees/c1", () =>
      HttpResponse.json({ id: "c1", name: { en: "Root" } }),
    ),
  );
  const tree = await svc().getTree("c1", { kind: "anonymous" });
  expect(tree.id).toBe("c1");
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```ts
/** Retrieves one category tree by its root category id. Default auth: anonymous. */
async getTree(categoryId: string, auth: AuthContext = ANON): Promise<CategoryNode> {
  return this.ctx.http.request<CategoryNode>({
    method: "GET",
    path: `/category/${this.ctx.tenant}/category-trees/${encodeURIComponent(categoryId)}`,
    auth,
  });
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/category.ts packages/sdk/tests/services/category.test.ts
git commit -m "feat(category): add categories.getTree"
```

---

## Phase 4 — Payment (`packages/sdk/src/services/payment.ts`, tests `tests/services/payment.test.ts`)

Both methods default to anonymous (`ANON`), matching `listPaymentModes` ("no scope required").

### Task 17: `payments.getMode`

**Interfaces:** Produces `getMode(id: string, auth?: AuthContext): Promise<PaymentMode>`.

- [ ] **Step 1: Failing test** (in `payment.test.ts`)

```ts
it("getMode GETs a single frontend payment mode", async () => {
  server.use(
    http.get("https://api.emporix.io/payment-gateway/acme/paymentmodes/frontend/pm1", () =>
      HttpResponse.json({ id: "pm1", code: "CARD" }),
    ),
  );
  const mode = await svc().getMode("pm1", { kind: "anonymous" });
  expect(mode.id).toBe("pm1");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/payment.test.ts`

- [ ] **Step 3: Implement** — add to `PaymentGatewayService`:

```ts
/** Retrieves a single frontend payment mode by id. Defaults to anonymous (no scope required). */
async getMode(id: string, authCtx: AuthContext = ANON): Promise<PaymentMode> {
  return this.ctx.http.request<PaymentMode>({
    method: "GET",
    path: `/payment-gateway/${this.ctx.tenant}/paymentmodes/frontend/${id}`,
    auth: authCtx,
  });
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/payment.ts packages/sdk/tests/services/payment.test.ts
git commit -m "feat(payment): add payments.getMode"
```

### Task 18: `payments.initialize`

**Files:** Modify `payment.ts`, `index.ts`; Test `payment.test.ts`.
**Interfaces:** Produces `initialize(input: InitializePaymentInput, auth?: AuthContext): Promise<InitializePaymentResult>`; public aliases of generated `InitializePaymentRequest` / `InitializePaymentResponse`.

- [ ] **Step 1: Failing test**

```ts
it("initialize POSTs the frontend initialize request", async () => {
  server.use(
    http.post("https://api.emporix.io/payment-gateway/acme/payment/frontend/initialize", () =>
      HttpResponse.json({ paymentId: "p1" }),
    ),
  );
  const res = await svc().initialize(
    { orderId: "o1" } as unknown as InitializePaymentInput,
    { kind: "anonymous" },
  );
  expect((res as { paymentId?: string }).paymentId).toBe("p1");
});
```

Add `import type { InitializePaymentInput } from "../../src/services/payment";` to the test if not present.

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

Add `InitializePaymentRequest`, `InitializePaymentResponse` to the `../generated/payment` import; add aliases:

```ts
/** Frontend payment-initialize request (generated). */
export type InitializePaymentInput = InitializePaymentRequest;
/** Frontend payment-initialize response (generated). */
export type InitializePaymentResult = InitializePaymentResponse;
```

Method:

```ts
/** Initializes a payment from the frontend. Defaults to anonymous (no scope required). */
async initialize(
  input: InitializePaymentInput,
  authCtx: AuthContext = ANON,
): Promise<InitializePaymentResult> {
  return this.ctx.http.request<InitializePaymentResult>({
    method: "POST",
    path: `/payment-gateway/${this.ctx.tenant}/payment/frontend/initialize`,
    auth: authCtx,
    body: input,
  });
}
```

Export `InitializePaymentInput`, `InitializePaymentResult` from the payment block in `index.ts:70-75`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/payment.ts packages/sdk/src/index.ts packages/sdk/tests/services/payment.test.ts
git commit -m "feat(payment): add payments.initialize"
```

---

## Phase 5 — Session-Context (`packages/sdk/src/services/session-context.ts`, tests `tests/services/session-context.test.ts`)

Both default to anonymous (session derived from the token); no optimistic-locking version.

### Task 19: `sessionContext.addAttribute`

**Files:** Modify `session-context.ts`, `session-context-types.ts`, `index.ts`; Test `session-context.test.ts`.
**Interfaces:** Produces `addAttribute(attribute: SessionAttributeInput, auth?: AuthContext): Promise<void>`; public `SessionAttributeInput` (alias generated `ContextAttribute`).

- [ ] **Step 1: Failing test**

```ts
it("addAttribute POSTs an attribute to the own context", async () => {
  let body: unknown;
  server.use(
    http.post("https://api.emporix.io/session-context/acme/me/context/attributes", async ({ request }) => {
      body = await request.json();
      return new HttpResponse(null, { status: 201 });
    }),
  );
  await expect(svc().addAttribute({ key: "k", value: "v" } as unknown as SessionAttributeInput)).resolves.toBeUndefined();
  expect(body).toEqual({ key: "k", value: "v" });
});
```

Add `import type { SessionAttributeInput } from "../../src/services/session-context";` to the test if not present.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk exec vitest run tests/services/session-context.test.ts`

- [ ] **Step 3: Implement**

In `session-context-types.ts`, add `import type { ContextAttribute } from "../generated/session-context";` and `export type SessionAttributeInput = ContextAttribute;`. In `session-context.ts`, import `SessionAttributeInput` from `./session-context-types`, add it to the local `export type { … }` re-export, and add the method to `SessionContextService`:

```ts
/** Adds an attribute to the current session context. Default auth: anonymous. */
async addAttribute(
  attribute: SessionAttributeInput,
  authCtx: AuthContext = ANON,
): Promise<void> {
  await this.ctx.http.request<void>({
    method: "POST",
    path: `/session-context/${this.ctx.tenant}/me/context/attributes`,
    body: attribute,
    auth: authCtx,
  });
}
```

Export `SessionAttributeInput` from `index.ts:123` (`export type { SessionContext, SessionContextPatch, SessionAttributeInput } from "./services/session-context";`).

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/session-context.ts packages/sdk/src/services/session-context-types.ts packages/sdk/src/index.ts packages/sdk/tests/services/session-context.test.ts
git commit -m "feat(sdk): add sessionContext.addAttribute"
```

### Task 20: `sessionContext.removeAttribute`

**Files:** Modify `session-context.ts`; Test `session-context.test.ts`.
**Interfaces:** Produces `removeAttribute(name: string, auth?: AuthContext): Promise<void>`.

- [ ] **Step 1: Failing test**

```ts
it("removeAttribute DELETEs a named attribute from the own context", async () => {
  server.use(
    http.delete("https://api.emporix.io/session-context/acme/me/context/attributes/color", () =>
      new HttpResponse(null, { status: 204 }),
    ),
  );
  await expect(svc().removeAttribute("color")).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**

```ts
/** Removes a named attribute from the current session context. Default auth: anonymous. */
async removeAttribute(name: string, authCtx: AuthContext = ANON): Promise<void> {
  await this.ctx.http.request<void>({
    method: "DELETE",
    path: `/session-context/${this.ctx.tenant}/me/context/attributes/${encodeURIComponent(name)}`,
    auth: authCtx,
  });
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/session-context.ts packages/sdk/tests/services/session-context.test.ts
git commit -m "feat(sdk): add sessionContext.removeAttribute"
```

---

## Phase 6 — Build gate before React hooks

React and examples typecheck against the built `dist/` of the SDK. Build once before Phase 7.

### Task 21: Build the SDK

- [ ] **Step 1:** Run `pnpm -F @viu/emporix-sdk build` — expect success (no TS errors).
- [ ] **Step 2:** Run `pnpm -F @viu/emporix-sdk exec vitest run` — expect all SDK tests pass (includes the 20 new tests).
- [ ] **Step 3:** No commit (build artifacts are gitignored).

---

## Phase 7 — React hooks (`packages/react`)

Read hooks use `useEmporixQuery` (see `packages/react/src/hooks/use-categories.ts` for the exact shape). Write hooks use `useMutation`; cart writes extend the `useCartMutations` bundle in `packages/react/src/hooks/use-cart.ts`. Export every new hook from the package root `packages/react/src/index.ts` following the existing hook-export lines. Hook tests follow `packages/react/tests/use-categories.test.tsx` (mount with the provider wrapper, MSW handlers, assert resolved data / invalidation).

### Task 22: Category read hooks (`useCategoryParents`, `useChildCategories`, `useCategoryTree`)

**Files:** Modify `packages/react/src/hooks/use-categories.ts`, `packages/react/src/index.ts`; Test `packages/react/tests/use-categories.test.tsx`.

- [ ] **Step 1: Failing test** — add to `use-categories.test.tsx`:

```tsx
it("useChildCategories fetches dedicated subcategories", async () => {
  server.use(
    http.get("https://api.emporix.io/category/acme/categories/c1/subcategories", () =>
      HttpResponse.json([{ id: "child1" }]),
    ),
  );
  const { result } = renderHook(() => useChildCategories("c1"), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.[0]?.id).toBe("child1");
});
```

(Import `useChildCategories` from `../src/hooks/use-categories`. Use the file's existing `Wrapper`/`server` harness.)

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-categories.test.tsx`

- [ ] **Step 3: Implement** — add three hooks to `use-categories.ts`:

```ts
/** Ancestor categories of a category (breadcrumb-up). Disabled on empty id. */
export function useCategoryParents(
  categoryId: string | undefined,
  options: QueryOpts = {},
): UseQueryResult<Category[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "category-parents", args: [categoryId ?? null],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: typeof categoryId === "string" && categoryId !== "",
    queryFn: (ctx) => client.categories.parents(categoryId as string, ctx),
    staleTime: CATEGORIES_STALE_TIME,
  });
}

/** Direct child categories via the dedicated `/subcategories` endpoint. Disabled on empty id. */
export function useChildCategories(
  categoryId: string | undefined,
  options: QueryOpts = {},
): UseQueryResult<Category[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "child-categories", args: [categoryId ?? null],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: typeof categoryId === "string" && categoryId !== "",
    queryFn: (ctx) => client.categories.childCategories(categoryId as string, ctx),
    staleTime: CATEGORIES_STALE_TIME,
  });
}

/** One category tree by root id. Disabled on empty id. */
export function useCategoryTree(
  categoryId: string | undefined,
  options: QueryOpts = {},
): UseQueryResult<CategoryNode> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "category-tree", args: [categoryId ?? null],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: typeof categoryId === "string" && categoryId !== "",
    queryFn: (ctx) => client.categories.getTree(categoryId as string, ctx),
    staleTime: CATEGORIES_STALE_TIME,
  });
}
```

Add `CategoryNode` to the `@viu/emporix-sdk` type import at the top of `use-categories.ts`. Export the three hooks from `packages/react/src/index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-categories.ts packages/react/src/index.ts packages/react/tests/use-categories.test.tsx
git commit -m "feat(react): add useCategoryParents/useChildCategories/useCategoryTree"
```

### Task 23: Cart read hooks (`useCartValidation`, `useCartItems`)

**Files:** Modify `packages/react/src/hooks/use-cart.ts`, `packages/react/src/index.ts`; Test `packages/react/tests/use-cart.test.tsx`.

- [ ] **Step 1: Failing test** — add to `use-cart.test.tsx`:

```tsx
it("useCartItems lists items for the active cart", async () => {
  server.use(
    http.get("https://api.emporix.io/cart/acme/carts/cart1/items", () =>
      HttpResponse.json([{ id: "0" }]),
    ),
  );
  const { result } = renderHook(() => useCartItems("cart1"), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.[0]?.id).toBe("0");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-cart.test.tsx`

- [ ] **Step 3: Implement** — add two read hooks to `use-cart.ts` (customer-or-anonymous cart reads use `mode: "read-auth"`):

```ts
/** Validates the given cart's items. Disabled on empty id. */
export function useCartValidation(
  cartId: string | undefined,
  options: QueryOpts = {},
): UseQueryResult<CartValidationResult> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "cart-validation", args: [cartId ?? null],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: typeof cartId === "string" && cartId !== "",
    queryFn: (ctx) => client.carts.validate(cartId as string, ctx),
    staleTime: 0,
  });
}

/** Lists the items in the given cart. Disabled on empty id. */
export function useCartItems(
  cartId: string | undefined,
  options: QueryOpts = {},
): UseQueryResult<CartItem[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "full", resource: "cart-items", args: [cartId ?? null],
    ...(options.auth ? { authOverride: options.auth } : {}),
    enabled: typeof cartId === "string" && cartId !== "",
    queryFn: (ctx) => client.carts.listItems(cartId as string, ctx),
  });
}
```

Import `CartValidationResult`, `CartItem`, `QueryOpts`, `UseQueryResult`, `useEmporixQuery` at the top of `use-cart.ts` (mirror `use-categories.ts`). Export both hooks from `packages/react/src/index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/src/index.ts packages/react/tests/use-cart.test.tsx
git commit -m "feat(react): add useCartValidation/useCartItems"
```

### Task 24: Cart write hooks in the `useCartMutations` bundle (`refresh`, `changeSite`, `changeCurrency`, `updateItemsBatch`)

**Files:** Modify `packages/react/src/hooks/use-cart.ts` (the `useCartMutations` return + its `Mut`/bundle type); Test `packages/react/tests/use-cart.test.tsx`.

- [ ] **Step 1: Failing test**

```tsx
it("cart mutations: refresh / changeSite / changeCurrency", async () => {
  server.use(
    http.put("https://api.emporix.io/cart/acme/carts/cart1/refresh", () => new HttpResponse(null, { status: 204 })),
    http.post("https://api.emporix.io/cart/acme/carts/cart1/changeSite", () => new HttpResponse(null, { status: 200 })),
    http.post("https://api.emporix.io/cart/acme/carts/cart1/changeCurrency", () => new HttpResponse(null, { status: 200 })),
    http.get("https://api.emporix.io/cart/acme/carts/cart1", () => HttpResponse.json({ id: "cart1", items: [] })),
  );
  const { result } = renderHook(() => useCartMutations("cart1"), { wrapper: Wrapper });
  await act(async () => { await result.current.refresh.mutateAsync(undefined); });
  await act(async () => { await result.current.changeSite.mutateAsync({ siteCode: "USA" }); });
  await act(async () => { await result.current.changeCurrency.mutateAsync({ currency: "USD" }); });
  expect(result.current.changeCurrency.isSuccess).toBe(true);
});
```

(Match the exact `useCartMutations` invocation the file already uses — it may take the cart id or resolve it internally; mirror the existing `updateItem`/`applyCoupon` tests in this file.)

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — in the `useCartMutations` return object add, alongside the existing `applyCoupon`/`removeCoupon` entries:

```ts
refresh: make((id) => client.carts.refresh(id, ctx)),
changeSite: make((id, v: { siteCode: string }) => client.carts.changeSite(id, v.siteCode, ctx)),
changeCurrency: make((id, v: { currency: string }) => client.carts.changeCurrency(id, v.currency, ctx)),
updateItemsBatch: make((id, v: { items: CartItemsBatchUpdateInput }) =>
  client.carts.updateItemsBatch(id, v.items, ctx).then(() => client.carts.get(id, ctx))),
```

Add these keys to the `Mut<…>`-typed bundle interface (`refresh: Mut<void>`, `changeSite: Mut<{ siteCode: string }>`, `changeCurrency: Mut<{ currency: string }>`, `updateItemsBatch: Mut<{ items: CartItemsBatchUpdateInput }>`). Import `CartItemsBatchUpdateInput` from `@viu/emporix-sdk`. `updateItemsBatch` chains a `carts.get` so the bundle's `Promise<Cart>` contract holds.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-cart.ts packages/react/tests/use-cart.test.tsx
git commit -m "feat(react): add cart refresh/changeSite/changeCurrency/updateItemsBatch mutations"
```

### Task 25: Customer credential & signup hooks (`useChangeEmail`, `useConfirmEmailChange`, `useConfirmSignup`, `useResendActivation`)

**Files:** Create `packages/react/src/hooks/use-customer-credentials.ts`; Modify `packages/react/src/index.ts`; Test `packages/react/tests/use-customer-credentials.test.tsx`.

- [ ] **Step 1: Failing test** (new file `use-customer-credentials.test.tsx`, mirror `use-customer-profile.test.tsx` harness)

```tsx
it("useChangeEmail POSTs the change request", async () => {
  server.use(
    http.post("https://api.emporix.io/customer/acme/me/accounts/internal/email/change", () =>
      new HttpResponse(null, { status: 204 }),
    ),
  );
  const { result } = renderHook(() => useChangeEmail(), { wrapper: Wrapper });
  await act(async () => {
    await result.current.mutateAsync({ email: "a@b.co", password: "p", newEmail: "c@d.co" });
  });
  expect(result.current.isSuccess).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-customer-credentials.test.tsx`

- [ ] **Step 3: Implement** — create `use-customer-credentials.ts`. `useChangeEmail` uses the stored customer token via `useCustomerOnlyCtx()` (the exact helper `useChangePassword` uses, from `./internal/use-read-auth`); `useConfirmEmailChange`, `useConfirmSignup`, `useResendActivation` use an anonymous context (`auth.anonymous()`, mirroring `use-password-reset.ts`):

```ts
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import type {
  ChangeEmailInput, ConfirmEmailChangeInput, ResendActivationInput, CustomerSession,
} from "@viu/emporix-sdk";
import { auth } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx } from "./internal/use-read-auth";

/** Requests a login-email change (requires a signed-in customer). */
export function useChangeEmail(): UseMutationResult<void, unknown, ChangeEmailInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useMutation({ mutationFn: (input) => client.customers.changeEmail(input, ctx) });
}

/** Confirms a login-email change with the emailed token (anonymous). */
export function useConfirmEmailChange(): UseMutationResult<void, unknown, ConfirmEmailChangeInput> {
  const { client } = useEmporix();
  return useMutation({ mutationFn: (input) => client.customers.confirmEmailChange(input, auth.anonymous()) });
}

/** Completes double opt-in signup, returning a logged-in session (anonymous). */
export function useConfirmSignup(): UseMutationResult<CustomerSession, unknown, string> {
  const { client } = useEmporix();
  return useMutation({ mutationFn: (token) => client.customers.confirmSignup(token, auth.anonymous()) });
}

/** Resends the activation link (anonymous). */
export function useResendActivation(): UseMutationResult<void, unknown, ResendActivationInput> {
  const { client } = useEmporix();
  return useMutation({ mutationFn: (input) => client.customers.resendActivation(input, auth.anonymous()) });
}
```

Export all four hooks from `packages/react/src/index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-customer-credentials.ts packages/react/src/index.ts packages/react/tests/use-customer-credentials.test.tsx
git commit -m "feat(react): add email-change and signup activation hooks"
```

### Task 26: Address hooks (`useCustomerAddress`, `useAddAddressTags`, `useRemoveAddressTags`)

**Files:** Modify `packages/react/src/hooks/use-customer-addresses.ts`, `packages/react/src/index.ts`; Test `packages/react/tests/use-customer-addresses.test.tsx`.

- [ ] **Step 1: Failing test**

```tsx
it("useAddAddressTags POSTs tags then invalidates addresses", async () => {
  server.use(
    http.post("https://api.emporix.io/customer/acme/me/addresses/ad1/tags", () => new HttpResponse(null, { status: 204 })),
  );
  const { result } = renderHook(() => useAddAddressTags(), { wrapper: Wrapper });
  await act(async () => { await result.current.mutateAsync({ id: "ad1", tags: ["BILLING"] }); });
  expect(result.current.isSuccess).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-customer-addresses.test.tsx`

- [ ] **Step 3: Implement** — in `use-customer-addresses.ts`, reuse the file's existing helpers: `useCustomerOnlyCtx()` (from `./internal/use-read-auth`) for the mutation `ctx`, the module-level `ADDRESSES_KEY` const for invalidation, and `useQueryClient` (already imported for the existing address mutations). Add:

```ts
/** Reads one customer address. Customer-gated. */
export function useCustomerAddress(id: string | undefined): UseQueryResult<Address> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "customer-address", args: [id ?? null],
    enabled: typeof id === "string" && id !== "",
    queryFn: (ctx) => client.customers.addresses.get(id as string, ctx),
  });
}

/** Adds tags to a customer address, then invalidates the addresses list. */
export function useAddAddressTags(): UseMutationResult<void, unknown, { id: string; tags: string[] }> {
  const { client } = useEmporix(); const qc = useQueryClient(); const ctx = useCustomerOnlyCtx();
  return useMutation({
    mutationFn: ({ id, tags }) => client.customers.addresses.addTags(id, tags, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ADDRESSES_KEY }),
  });
}

/** Removes tags from a customer address, then invalidates the addresses list. */
export function useRemoveAddressTags(): UseMutationResult<void, unknown, { id: string; tags: string[] }> {
  const { client } = useEmporix(); const qc = useQueryClient(); const ctx = useCustomerOnlyCtx();
  return useMutation({
    mutationFn: ({ id, tags }) => client.customers.addresses.removeTags(id, tags, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ADDRESSES_KEY }),
  });
}
```

`useCustomerAddress` uses the internal `useEmporixQuery` (add its import if not present). Export the three hooks from `packages/react/src/index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-customer-addresses.ts packages/react/src/index.ts packages/react/tests/use-customer-addresses.test.tsx
git commit -m "feat(react): add address get + tag mutation hooks"
```

### Task 27: Payment hooks (`usePaymentMode`, `useInitializePayment`)

**Files:** Modify `packages/react/src/hooks/use-checkout.ts` (co-locate with the existing `usePaymentModes`); Modify `packages/react/src/index.ts`; Test `packages/react/tests/use-payment-modes.test.tsx` (existing file).

- [ ] **Step 1: Failing test**

```tsx
it("usePaymentMode fetches one frontend mode", async () => {
  server.use(
    http.get("https://api.emporix.io/payment-gateway/acme/paymentmodes/frontend/pm1", () =>
      HttpResponse.json({ id: "pm1", code: "CARD" }),
    ),
  );
  const { result } = renderHook(() => usePaymentMode("pm1"), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data?.id).toBe("pm1");
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-payment-modes.test.tsx`

- [ ] **Step 3: Implement** — add both hooks to `use-checkout.ts` (where `usePaymentModes` lives). The mutation resolves auth with `useReadAuth()` exactly as `usePaymentModes` does (`const { ctx } = useReadAuth();`):

```ts
/** Reads one frontend payment mode. Customer-or-anonymous. Disabled on empty id. */
export function usePaymentMode(id: string | undefined): UseQueryResult<PaymentMode> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "read-auth", site: "none", resource: "payment-mode", args: [id ?? null],
    enabled: typeof id === "string" && id !== "",
    queryFn: (ctx) => client.payments.getMode(id as string, ctx),
  });
}

/** Initializes a frontend payment. Customer-or-anonymous. */
export function useInitializePayment(): UseMutationResult<InitializePaymentResult, unknown, InitializePaymentInput> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();
  return useMutation({ mutationFn: (input) => client.payments.initialize(input, ctx) });
}
```

Import `PaymentMode`, `InitializePaymentInput`, `InitializePaymentResult` from `@viu/emporix-sdk` (and `useMutation`/`UseMutationResult` from `@tanstack/react-query` if not already imported in this file). Export both hooks from `packages/react/src/index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-checkout.ts packages/react/src/index.ts packages/react/tests/use-payment-modes.test.tsx
git commit -m "feat(react): add usePaymentMode/useInitializePayment"
```

### Task 28: Session-context attribute hooks (`useAddSessionAttribute`, `useRemoveSessionAttribute`)

**Files:** Create `packages/react/src/hooks/use-session-context.ts`; Modify `packages/react/src/index.ts`; Test `packages/react/tests/use-session-context.test.tsx`.

- [ ] **Step 1: Failing test**

```tsx
it("useRemoveSessionAttribute DELETEs a named attribute", async () => {
  server.use(
    http.delete("https://api.emporix.io/session-context/acme/me/context/attributes/color", () =>
      new HttpResponse(null, { status: 204 }),
    ),
  );
  const { result } = renderHook(() => useRemoveSessionAttribute(), { wrapper: Wrapper });
  await act(async () => { await result.current.mutateAsync("color"); });
  expect(result.current.isSuccess).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm -F @viu/emporix-sdk-react exec vitest run tests/use-session-context.test.tsx`

- [ ] **Step 3: Implement** — create `use-session-context.ts`. These default to anonymous (the SDK derives the session from the token); on success invalidate the session-context query key if the codebase has one (check `use-*` for an existing session-context read; if none, omit invalidation):

```ts
import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import type { SessionAttributeInput } from "@viu/emporix-sdk";
import { auth } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

/** Adds an attribute to the current session context (anonymous). */
export function useAddSessionAttribute(): UseMutationResult<void, unknown, SessionAttributeInput> {
  const { client } = useEmporix();
  return useMutation({ mutationFn: (attr) => client.sessionContext.addAttribute(attr, auth.anonymous()) });
}

/** Removes a named attribute from the current session context (anonymous). */
export function useRemoveSessionAttribute(): UseMutationResult<void, unknown, string> {
  const { client } = useEmporix();
  return useMutation({ mutationFn: (name) => client.sessionContext.removeAttribute(name, auth.anonymous()) });
}
```

Export both hooks from `packages/react/src/index.ts`.

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```bash
git add packages/react/src/hooks/use-session-context.ts packages/react/src/index.ts packages/react/tests/use-session-context.test.tsx
git commit -m "feat(react): add session-context attribute hooks"
```

---

## Phase 8 — Finalize

### Task 29: Full verification, docs, changeset

**Files:** Create `.changeset/storefront-facade-completeness.md`; optionally update `docs/`.

- [ ] **Step 1: Build both packages**

Run: `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build` — expect success.

- [ ] **Step 2: Full test + typecheck**

Run: `pnpm -r test` (expect all pass, incl. the new SDK + React tests) and `pnpm typecheck` (expect clean — validates examples against the rebuilt `dist/`).

- [ ] **Step 3: Write the changeset**

Create `.changeset/storefront-facade-completeness.md`:

```markdown
---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add storefront-facing facade methods and matching React hooks: cart
`validate`/`listItems`/`refresh`/`changeSite`/`changeCurrency`/`updateItemsBatch`;
customer double opt-in (`confirmSignup`/`resendActivation`), login-email change
(`changeEmail`/`confirmEmailChange`), and address `get`/`addTags`/`removeTags`;
category `parents`/`childCategories`/`getTree`; payment `getMode`/`initialize`;
session-context `addAttribute`/`removeAttribute`. Additive and backward-compatible.
```

- [ ] **Step 4: Commit**

```bash
git add .changeset/storefront-facade-completeness.md
git commit -m "chore(sdk): add changeset for storefront facade completeness"
```

- [ ] **Step 5: Push + open PR** (base `main`, branch `feat/storefront-facade-completeness`). PR body summarizes the 20 methods + hooks per service; ends with the Claude Code footer.

---

## Notes for the implementer

- If an assumed response shape is wrong at runtime (the spec flags `categories.parents`/`childCategories`/`getTree` and the payment frontend responses), confirm the generated type in `src/generated/<service>/types.gen.ts` and adjust the alias — never hand-author the shape.
- Where a React task says "mirror the existing helper" (customer-auth-context, payment auth resolution, address query key), open the referenced file and copy the exact symbol — do not invent names. These are the only under-specified points and each has a concrete reference file.
- Keep `getItem` (cart) and `validateToken` (customer) OUT — they were dropped in the design (YAGNI).
