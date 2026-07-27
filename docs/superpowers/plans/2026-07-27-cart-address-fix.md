# Cart Address Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `cart.setShippingAddress` / `cart.setBillingAddress` — they PUT to paths that 404 — by switching to `PUT /carts/{cartId}` with a merged `addresses` array, and add `setAddresses` for setting both in one request.

**Architecture:** Both existing methods keep their public signature and `Promise<Cart>` return, but internally become read → merge → PUT → re-fetch so the other address type survives. A shared private helper does the merge. `setAddresses` is a single PUT (no leading read) with explicit full-replace semantics.

**Tech Stack:** TypeScript, Vitest (vi-mock harness + MSW for the facade-coverage suite).

## Global Constraints

- Package: `@viu/emporix-sdk`. Release bump: **minor** (fix + new method).
- **Do not change the public signatures** of `setShippingAddress` / `setBillingAddress` — React hooks (`use-cart.ts:195-196`) and `docs/react.md` depend on them and must stay untouched.
- Every method keeps `requireCartAuth(auth)` and resolves it **once** into a local `cartAuth`, then reuses it for all sub-requests (matching `applyCoupon` / `refresh` in the same file).
- The merged `addresses` array must resend the untouched address type **verbatim as read from the cart** — this is what the live probe verified preserves it.
- `type` is always forced by the method (`"SHIPPING"` / `"BILLING"`), overriding whatever the caller put in `address.type`.
- Commitlint: scope `cart` is allowed; subject's first word must be a lowercase verb.

## File Structure

- **Modify** `packages/sdk/src/services/cart.ts` — add a private `mergeAddress` helper, rewrite the two methods, add `setAddresses` (the two methods sit at lines 326-352).
- **Modify** `packages/sdk/tests/services/facade-coverage.test.ts` — replace the two dead MSW handlers (lines 84-89) with a `PUT /carts/cart1` handler.
- **Modify** `packages/sdk/tests/services/cart-admin.test.ts` — add the regression tests.
- **Create** `.changeset/cart-address-fix.md`.

---

### Task 1: Fix the two address setters

**Files:**
- Modify: `packages/sdk/src/services/cart.ts`
- Modify: `packages/sdk/tests/services/facade-coverage.test.ts` (MSW handlers)
- Test: `packages/sdk/tests/services/cart-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: existing `CartService`, `requireCartAuth`, `this.get`, `Cart`, `CartAddress`.
- Produces: unchanged public signatures
  - `setShippingAddress(cartId: string, address: CartAddress, auth: AuthContext): Promise<Cart>`
  - `setBillingAddress(cartId: string, address: CartAddress, auth: AuthContext): Promise<Cart>`
  - plus a private `mergeAddress(cartId, address, type, cartAuth): Promise<Cart>`

- [ ] **Step 1: Write the failing regression test**

Append to `packages/sdk/tests/services/cart-admin.test.ts`:

```ts
describe("CartService address setters (regression: #159-class path bug)", () => {
  const SHIP = { contactName: "Ship", city: "Zurich" };
  const BILL_EXISTING = { type: "BILLING", contactName: "Bill", city: "Bern", zipCode: "3000" };

  it("setShippingAddress reads, merges and PUTs /carts/{id} — preserving BILLING", async () => {
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1", addresses: [BILL_EXISTING] }) // GET
      .mockResolvedValueOnce(undefined) // PUT
      .mockResolvedValueOnce({ id: "c1", addresses: [BILL_EXISTING, { ...SHIP, type: "SHIPPING" }] }); // re-fetch
    const res = await svc(r).setShippingAddress("c1", SHIP, CUST);

    expect(r.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1` }));

    const put = r.mock.calls[1]?.[0];
    expect(put).toEqual(expect.objectContaining({ method: "PUT", path: `${B}/c1`, auth: CUST }));
    // the untouched BILLING must be resent verbatim, or the server wipes it
    expect(put.body.addresses).toEqual([BILL_EXISTING, { ...SHIP, type: "SHIPPING" }]);

    expect(r.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1` }));
    expect(res.addresses).toHaveLength(2);
  });

  it("setBillingAddress preserves an existing SHIPPING entry", async () => {
    const shipExisting = { type: "SHIPPING", contactName: "Ship", city: "Zurich" };
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1", addresses: [shipExisting] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "c1", addresses: [] });
    await svc(r).setBillingAddress("c1", { contactName: "Bill" }, CUST);
    expect(r.mock.calls[1]?.[0].body.addresses).toEqual([
      shipExisting,
      { contactName: "Bill", type: "BILLING" },
    ]);
  });

  it("replaces an existing entry of the same type instead of duplicating it", async () => {
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1", addresses: [{ type: "SHIPPING", contactName: "Old" }, BILL_EXISTING] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "c1", addresses: [] });
    await svc(r).setShippingAddress("c1", SHIP, CUST);
    const sent = r.mock.calls[1]?.[0].body.addresses;
    expect(sent).toHaveLength(2);
    expect(sent.filter((a: { type: string }) => a.type === "SHIPPING")).toEqual([{ ...SHIP, type: "SHIPPING" }]);
    expect(sent).toContainEqual(BILL_EXISTING);
  });

  it("forces the type even when the caller passes a contradicting one", async () => {
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1", addresses: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "c1", addresses: [] });
    await svc(r).setShippingAddress("c1", { ...SHIP, type: "BILLING" } as never, CUST);
    expect(r.mock.calls[1]?.[0].body.addresses).toEqual([{ ...SHIP, type: "SHIPPING" }]);
  });

  it("handles a cart with no addresses yet", async () => {
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1" }) // no addresses key at all
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "c1", addresses: [] });
    await svc(r).setShippingAddress("c1", SHIP, CUST);
    expect(r.mock.calls[1]?.[0].body.addresses).toEqual([{ ...SHIP, type: "SHIPPING" }]);
  });

  it("rejects a non-cart auth context before any request", async () => {
    const r = vi.fn();
    await expect(svc(r).setShippingAddress("c1", SHIP, SVC)).rejects.toBeInstanceOf(EmporixValidationError);
    expect(r).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- cart-admin`
Expected: FAIL — the current implementation issues a single PUT to `/carts/c1/shipping-address`, so the GET-first assertion fails.

- [ ] **Step 3: Replace the two methods in `cart.ts`**

In `packages/sdk/src/services/cart.ts`, replace the whole `setShippingAddress` + `setBillingAddress` block (lines 326-352, from `/** Sets the shipping address. */` through the closing `}` of `setBillingAddress`) with:

```ts
  /**
   * Sets the cart's shipping address, preserving the billing address.
   *
   * The API has no per-type address endpoint: addresses live in the cart's
   * `addresses` array, written via `PUT /carts/{cartId}`. That array is a **full
   * replace** — sending only one type leaves the other as an empty stub — so
   * this method reads the cart, merges, writes, and re-fetches. Use
   * {@link setAddresses} to set both in a single request.
   */
  async setShippingAddress(
    cartId: string,
    address: CartAddress,
    auth: AuthContext,
  ): Promise<Cart> {
    return this.mergeAddress(cartId, address, "SHIPPING", requireCartAuth(auth));
  }

  /**
   * Sets the cart's billing address, preserving the shipping address. See
   * {@link setShippingAddress} for why this reads before writing.
   */
  async setBillingAddress(
    cartId: string,
    address: CartAddress,
    auth: AuthContext,
  ): Promise<Cart> {
    return this.mergeAddress(cartId, address, "BILLING", requireCartAuth(auth));
  }

  /**
   * Sets both cart addresses in one request (`PUT /carts/{cartId}`), skipping
   * the read that {@link setShippingAddress} needs.
   *
   * **This replaces the cart's address set**: a type you omit is cleared, and
   * `{}` clears both. Use it when you already hold both addresses (a checkout
   * form submitting them together); use the per-type setters to change one and
   * keep the other.
   */
  async setAddresses(
    cartId: string,
    addresses: { shipping?: CartAddress; billing?: CartAddress },
    auth: AuthContext,
  ): Promise<Cart> {
    const cartAuth = requireCartAuth(auth);
    const next: CartAddress[] = [];
    if (addresses.shipping) next.push({ ...addresses.shipping, type: "SHIPPING" });
    if (addresses.billing) next.push({ ...addresses.billing, type: "BILLING" });
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${cartId}`,
      auth: cartAuth,
      body: { addresses: next },
    });
    return this.get(cartId, cartAuth);
  }

  /**
   * Reads the cart, replaces the entry of `type` with `address` (keeping every
   * other type verbatim — resending it unchanged is what stops the server from
   * wiping it), writes, and returns the re-fetched cart.
   */
  private async mergeAddress(
    cartId: string,
    address: CartAddress,
    type: "SHIPPING" | "BILLING",
    cartAuth: AuthContext,
  ): Promise<Cart> {
    const current = await this.get(cartId, cartAuth);
    const others = (current.addresses ?? []).filter((a) => a.type !== type);
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${cartId}`,
      auth: cartAuth,
      body: { addresses: [...others, { ...address, type }] },
    });
    return this.get(cartId, cartAuth);
  }
```

- [ ] **Step 4: Update the dead MSW handlers**

In `packages/sdk/tests/services/facade-coverage.test.ts`, replace lines 84-89 (the two `shipping-address` / `billing-address` handlers) with a single handler for the real endpoint:

```ts
  http.put("https://api.emporix.io/cart/acme/carts/cart1", () =>
    new HttpResponse(null, { status: 204 }),
  ),
```

The existing `http.get(".../carts/cart1")` handler (line 60) already serves both the read and the re-fetch.

- [ ] **Step 5: Run the tests**

Run: `pnpm -F @viu/emporix-sdk test -- "cart-admin|facade-coverage"`
Expected: PASS — the 6 new regression tests plus the existing facade-coverage suite.

- [ ] **Step 6: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

Note: `Cart["addresses"]` is optional in the generated type, hence the
`?? []`. If `a.type` is not narrowed as expected, compare against the string
literal directly — do not widen the public types to work around it.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/services/cart.ts packages/sdk/tests/services/cart-admin.test.ts packages/sdk/tests/services/facade-coverage.test.ts
git commit -m "fix(cart): set addresses via cart PUT instead of nonexistent per-type paths"
```

---

### Task 2: Test `setAddresses`

**Files:**
- Test: `packages/sdk/tests/services/cart-admin.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `setAddresses` from Task 1.
- Produces: no new source — this task only proves the single-PUT contract.

- [ ] **Step 1: Write the test**

Append to `packages/sdk/tests/services/cart-admin.test.ts`:

```ts
describe("CartService.setAddresses", () => {
  it("PUTs both addresses in one request, with no leading read", async () => {
    const r = vi
      .fn()
      .mockResolvedValueOnce(undefined) // PUT
      .mockResolvedValueOnce({ id: "c1", addresses: [] }); // re-fetch
    await svc(r).setAddresses(
      "c1",
      { shipping: { contactName: "Ship" }, billing: { contactName: "Bill" } },
      CUST,
    );
    expect(r).toHaveBeenCalledTimes(2);
    const put = r.mock.calls[0]?.[0];
    expect(put).toEqual(expect.objectContaining({ method: "PUT", path: `${B}/c1`, auth: CUST }));
    expect(put.body.addresses).toEqual([
      { contactName: "Ship", type: "SHIPPING" },
      { contactName: "Bill", type: "BILLING" },
    ]);
    expect(r.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1` }));
  });

  it("sends only the given type — documented as clearing the other", async () => {
    const r = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "c1" });
    await svc(r).setAddresses("c1", { shipping: { contactName: "Ship" } }, CUST);
    expect(r.mock.calls[0]?.[0].body.addresses).toEqual([{ contactName: "Ship", type: "SHIPPING" }]);
  });

  it("sends an empty array when given none", async () => {
    const r = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "c1" });
    await svc(r).setAddresses("c1", {}, CUST);
    expect(r.mock.calls[0]?.[0].body.addresses).toEqual([]);
  });

  it("rejects a non-cart auth context before any request", async () => {
    const r = vi.fn();
    await expect(svc(r).setAddresses("c1", {}, SVC)).rejects.toBeInstanceOf(EmporixValidationError);
    expect(r).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm -F @viu/emporix-sdk test -- cart-admin`
Expected: PASS (the 6 from Task 1 plus these 4).

- [ ] **Step 3: Commit**

```bash
git add packages/sdk/tests/services/cart-admin.test.ts
git commit -m "test(cart): cover setAddresses single-put contract"
```

---

### Task 3: Changeset + full verification

**Files:**
- Create: `.changeset/cart-address-fix.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/cart-address-fix.md`:

```md
---
"@viu/emporix-sdk": minor
---

Fix `carts.setShippingAddress` and `carts.setBillingAddress`, which called
`/carts/{id}/shipping-address` and `/carts/{id}/billing-address` — paths that do
not exist and returned 404 on every call (verified against a live tenant). Cart
addresses are set through `PUT /carts/{id}` with an `addresses` array. Because
that array is a full replace — sending one type leaves the other as an empty
stub — both methods now read the cart, merge in the new address, write, and
return the re-fetched cart. Their signatures are unchanged.

Adds `carts.setAddresses(cartId, { shipping, billing }, auth)` for setting both
in a single request, skipping the read. Note it **replaces** the address set: an
omitted type is cleared.
```

- [ ] **Step 2: Run the full SDK unit suite**

Run: `pnpm -F @viu/emporix-sdk test`
Expected: PASS.

- [ ] **Step 3: Run the React suite** (the cart hooks call these methods)

Run: `pnpm -F @viu/emporix-sdk-react test`
Expected: PASS — signatures are unchanged, so the hooks and their mocks still fit.

- [ ] **Step 4: Repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Build the SDK**

Run: `pnpm -F @viu/emporix-sdk build`
Expected: `dist/` written, no errors.

- [ ] **Step 6: Commit**

```bash
git add .changeset/cart-address-fix.md
git commit -m "chore(cart): add changeset for cart address fix"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `setShippingAddress` → read/merge/PUT/re-fetch, signature unchanged | 1 |
| `setBillingAddress` → mirror case | 1 |
| `type` forced by the method | 1 (test) |
| Cart with no existing addresses | 1 (test) |
| `requireCartAuth` still guards both | 1, 2 (tests) |
| `setAddresses` single PUT, replace semantics | 1 (impl), 2 (tests) |
| Dead MSW handlers replaced | 1 |
| Changeset | 3 |
| React hooks / docs untouched | verified by Task 3 Step 3 |

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Behavioral correctness against the live probes:** the merge resends the
untouched address **verbatim as read** (`others` comes straight from the GET
response), which is precisely the shape the live CASE B probe confirmed
preserves it. Sending a partially reconstructed object was *not* verified and is
therefore avoided. `setAddresses` deliberately reproduces the replace semantics
the probes showed, and says so in its docstring rather than hiding it. ✓

**Auth handling:** `requireCartAuth` is called once per public method and the
resolved context threads into every sub-request, so a rejected context throws
before any HTTP call — asserted in both tasks. `mergeAddress` takes the
already-resolved context and never re-guards. ✓

**Request-count contract:** the per-type setters cost 3 requests (GET, PUT,
GET) and `setAddresses` costs 2 (PUT, GET). Both are asserted, so an accidental
extra round-trip fails the suite. ✓
