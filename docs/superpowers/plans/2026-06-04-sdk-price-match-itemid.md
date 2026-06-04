# Phase 1 — Price-match `itemId` + `productIdFromYrn` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `PriceService` expose the real wire field `itemId` on match results (the codegen type wrongly calls it `itemRef`), and add a `productIdFromYrn` helper — both additive and non-breaking.

**Architecture:** A pure `normalizeMatch(raw)` maps each match row so `itemId` (canonical, incl. localized `name`) is exposed and the documented `itemRef` is kept populated-but-`@deprecated` (mirrored from `itemId`). Applied in `match` / `matchByContext`; `matchByContextChunked` composes `matchByContext` so it inherits normalization. `productIdFromYrn` is a standalone core util.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts` (codegen, untouched here), pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-04-sdk-shape-normalization-design.md` (Phase 1).

**Scope note (verified):** the generated `MatchResponse` already contains the rich fields (`priceModel`, `tierValues`, `tax`, `location`, `site`, `currency`, `originalValue`/`effectiveValue`/`totalValue`, `quantity`, `metadata`, `mixins`). The **only** gap is the item reference: live returns `itemId` (with `name`), the type declares `itemRef`. So this phase is narrowly the `itemId`/`itemRef` bridge + the YRN util.

---

## File structure

- **Create** `packages/sdk/src/core/yrn.ts` — `productIdFromYrn(yrn)` util (one responsibility: parse a product id out of an `itemYrn`).
- **Create** `packages/sdk/tests/core/yrn.test.ts` — its unit tests.
- **Modify** `packages/sdk/src/services/price.ts` — add `PriceMatchItemRef`, curated `PriceMatch`, `normalizeMatch`; apply in `match`/`matchByContext`.
- **Modify** `packages/sdk/tests/services/price.test.ts` — add normalization tests.
- **Modify** `packages/sdk/src/index.ts` — export `productIdFromYrn` and `PriceMatchItemRef`.
- **Create** `.changeset/price-match-itemid.md` — minor release entry.

---

## Task 1: `productIdFromYrn` util

**Files:**
- Create: `packages/sdk/src/core/yrn.ts`
- Test: `packages/sdk/tests/core/yrn.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sdk/tests/core/yrn.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { productIdFromYrn } from "../../src/core/yrn";

describe("productIdFromYrn", () => {
  it("extracts the product id after the last ';'", () => {
    expect(productIdFromYrn("urn:yaas:hybris:product:product:viu;0f1e2d3c-4b5a")).toBe(
      "0f1e2d3c-4b5a",
    );
  });

  it("returns '' for undefined or a yrn without ';'", () => {
    expect(productIdFromYrn(undefined)).toBe("");
    expect(productIdFromYrn("no-semicolon")).toBe("");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm -F @viu/emporix-sdk test -- --run yrn`
Expected: FAIL — `Cannot find module '../../src/core/yrn'`.

- [ ] **Step 3: Implement the util**

Create `packages/sdk/src/core/yrn.ts`:
```ts
/**
 * Extracts the product id from a product `itemYrn`
 * (`urn:yaas:hybris:product:product:<tenant>;<productId>`). Cart and order line
 * items carry only the YRN, not a bare product id. Returns "" when the YRN is
 * missing or has no `;` segment.
 */
export function productIdFromYrn(yrn: string | undefined): string {
  if (!yrn) return "";
  const semi = yrn.lastIndexOf(";");
  return semi >= 0 ? yrn.slice(semi + 1) : "";
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm -F @viu/emporix-sdk test -- --run yrn`
Expected: PASS (2 tests).

- [ ] **Step 5: Export from the public entry**

In `packages/sdk/src/index.ts`, immediately after the line `export { iterateAll } from "./core/context";`, add:
```ts
export { productIdFromYrn } from "./core/yrn";
```

- [ ] **Step 6: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/core/yrn.ts packages/sdk/tests/core/yrn.test.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): add productIdFromYrn helper"
```

---

## Task 2: Price-match `itemId` normalization

**Files:**
- Modify: `packages/sdk/src/services/price.ts`
- Test: `packages/sdk/tests/services/price.test.ts`
- Modify: `packages/sdk/src/index.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/sdk/tests/services/price.test.ts`, add a new `describe` block at the end of the file (before the final newline):
```ts
describe("PriceService — itemId normalization", () => {
  it("exposes itemId and mirrors it to the deprecated itemRef", async () => {
    server.use(
      http.post("https://api.emporix.io/price/acme/match-prices-by-context", () =>
        HttpResponse.json([
          {
            priceId: "pr1",
            effectiveValue: 1,
            currency: "CHF",
            itemId: { itemType: "PRODUCT", id: "p-1", name: { en: "Widget", de: "Widget" } },
          },
        ]),
      ),
    );
    const [m] = await svc().matchByContext({ items: [{ itemId: { itemType: "PRODUCT", id: "p-1" } }] });
    expect(m.itemId).toEqual({ itemType: "PRODUCT", id: "p-1", name: { en: "Widget", de: "Widget" } });
    expect(m.itemRef).toEqual({ itemType: "PRODUCT", id: "p-1" }); // mirrored (deprecated)
  });

  it("matchByContextChunked returns normalized rows", async () => {
    server.use(
      http.post("https://api.emporix.io/price/acme/match-prices-by-context", () =>
        HttpResponse.json([{ priceId: "pr1", itemId: { itemType: "PRODUCT", id: "p-1" } }]),
      ),
    );
    const out = await svc().matchByContextChunked(
      { items: [{ itemId: { itemType: "PRODUCT", id: "p-1" } }] },
      { chunkSize: 1 },
    );
    expect(out[0]?.itemId?.id).toBe("p-1");
    expect(out[0]?.itemRef?.id).toBe("p-1");
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm -F @viu/emporix-sdk test -- --run price`
Expected: FAIL — `m.itemId` is `undefined` (raw `itemId` is untyped and not surfaced), and TypeScript errors that `itemId`/`itemRef` are not on `PriceMatch`.

- [ ] **Step 3: Add the curated types + `normalizeMatch`**

In `packages/sdk/src/services/price.ts`, replace the existing `PriceMatch` type declaration:
```ts
/** A resolved price (full generated match-response schema). */
export type PriceMatch = MatchResponse;
```
with:
```ts
/** Item (product or price) a price was matched for. */
export interface PriceMatchItemRef {
  itemType?: string;
  id?: string;
  /** Localized (or plain) product name — present on the live API, absent from the OpenAPI doc. */
  name?: Record<string, string> | string;
}

/**
 * A resolved price. Superset of the generated match-response schema: the
 * deployed API returns the matched item under `itemId` (with a localized
 * `name`), while the OpenAPI doc/codegen call it `itemRef`.
 */
export type PriceMatch = Omit<MatchResponse, "itemRef"> & {
  /** Item the price was matched for, as returned by the API. */
  itemId?: PriceMatchItemRef;
  /**
   * @deprecated The OpenAPI doc names this `itemRef`, but the deployed API
   * returns `itemId`. Mirrored from `itemId` for back-compat — prefer `itemId`.
   */
  itemRef?: PriceMatchItemRef;
};

/**
 * Normalizes a raw match row: the deployed API returns `itemId`, while the
 * codegen type calls it `itemRef`. Expose `itemId` canonically and mirror it
 * to the deprecated `itemRef` so existing consumers keep working.
 */
function normalizeMatch(raw: MatchResponse): PriceMatch {
  const itemId = (raw as MatchResponse & { itemId?: PriceMatchItemRef }).itemId ?? raw.itemRef;
  const base = raw as PriceMatch;
  if (!itemId) return base;
  return { ...base, itemId, itemRef: { itemType: itemId.itemType, id: itemId.id } };
}
```

- [ ] **Step 4: Apply `normalizeMatch` in `matchByContext`**

In `packages/sdk/src/services/price.ts`, replace the body of `matchByContext`:
```ts
    return this.ctx.http.request<PriceMatch[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/match-prices-by-context`,
      auth: requireContextAuth(auth),
      body: input,
    });
```
with:
```ts
    const rows = await this.ctx.http.request<MatchResponse[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/match-prices-by-context`,
      auth: requireContextAuth(auth),
      body: input,
    });
    return rows.map(normalizeMatch);
```

- [ ] **Step 5: Apply `normalizeMatch` in `match`**

In the same file, replace the body of `match`:
```ts
    return this.ctx.http.request<PriceMatch[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/match-prices`,
      auth,
      body: input,
    });
```
with:
```ts
    const rows = await this.ctx.http.request<MatchResponse[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/match-prices`,
      auth,
      body: input,
    });
    return rows.map(normalizeMatch);
```

(`matchByContextChunked` is unchanged — it composes `matchByContext` and therefore returns already-normalized rows.)

- [ ] **Step 6: Fix the stale doc reference**

In the `matchByContextChunked` JSDoc, change the line:
```
   * `priceId` / `itemRef.id`.
```
to:
```
   * `priceId` / `itemId.id`.
```

- [ ] **Step 7: Run the tests, verify they pass**

Run: `pnpm -F @viu/emporix-sdk test -- --run price`
Expected: PASS — including the two new tests and all pre-existing price tests (rows without `itemId` pass through unchanged).

- [ ] **Step 8: Export the new type**

In `packages/sdk/src/index.ts`, add `PriceMatchItemRef` to the price type export block so it reads:
```ts
export type {
  PriceMatch,
  PriceMatchItemRef,
  PriceMatchByContextInput,
  PriceMatchInput,
  MatchByContextChunkedOptions,
} from "./services/price";
```

- [ ] **Step 9: Typecheck**

Run: `pnpm -F @viu/emporix-sdk typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/sdk/src/services/price.ts packages/sdk/tests/services/price.test.ts packages/sdk/src/index.ts
git commit -m "feat(price): expose canonical itemId on match results, deprecate itemRef"
```

---

## Task 3: Changeset, live re-verify, full build

**Files:**
- Create: `.changeset/price-match-itemid.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/price-match-itemid.md`:
```md
---
"@viu/emporix-sdk": minor
---

feat(price): expose canonical `itemId` on price-match results + `productIdFromYrn`

The deployed Emporix price API returns the matched item under `itemId` (with a
localized `name`), but the OpenAPI spec/codegen type calls it `itemRef` — so the
typed field was always `undefined` at runtime. `PriceService.match` /
`matchByContext` / `matchByContextChunked` now expose `itemId` canonically and
keep `itemRef` populated (mirrored from `itemId`) but `@deprecated`. Adds a
`productIdFromYrn(yrn)` helper to extract a product id from an `itemYrn`.
```

- [ ] **Step 2: Live re-verify the wire shape (spec requirement)**

The live response was confirmed this session (`itemId` present, `itemRef` absent,
`itemId.name` localized). Re-confirm with a throwaway script (delete after; reads
the public storefront clientId + no secret):
```bash
cat > /tmp/reverify-price.mjs <<'EOF'
const C="miFWH87by6AsfQxFSloirT8AV3IZL3seSaC3oR7phbGMV1hO", A="https://api.emporix.io";
const t=(await (await fetch(`${A}/customerlogin/auth/anonymous/login?tenant=viu&client_id=${C}&currency=CHF&siteCode=main&targetLocation=CH`)).json()).access_token;
const r=await (await fetch(`${A}/price/viu/match-prices-by-context`,{method:"POST",headers:{authorization:`Bearer ${t}`,"content-type":"application/json"},body:JSON.stringify({items:[{itemId:{itemType:"PRODUCT",id:"0f1e2d3c-4b5a"},quantity:{quantity:1}}]})})).json();
const m=r[0]; console.log("itemId:",JSON.stringify(m?.itemId),"| itemRef:",JSON.stringify(m?.itemRef));
EOF
node /tmp/reverify-price.mjs && rm -f /tmp/reverify-price.mjs
```
Expected: `itemId: {"itemType":"PRODUCT","id":"0f1e2d3c-4b5a","name":{…}} | itemRef: undefined`.

- [ ] **Step 3: Full build + repo verify**

Run:
```bash
pnpm -F @viu/emporix-sdk build
pnpm -r typecheck
pnpm -F @viu/emporix-sdk test
```
Expected: all green; the SDK test count increases by 4 (2 yrn + 2 price).

- [ ] **Step 4: Commit**

```bash
git add .changeset/price-match-itemid.md
git commit -m "chore(release): changeset for price itemId + productIdFromYrn"
```

---

## Task 4 (optional): de-duplicate in the storefront demo

The demo (now on `main`) hand-rolls `productIdFromYrn` and matches `x.itemId?.id ?? x.itemRef?.id` in `examples/storefront-demo/src/lib/adapters.ts`. Once this branch's SDK is rebuilt, the demo can import the SDK helper and rely on the typed `itemId`. Keep the demo's view-model shaping (Money/locale) — only the duplication goes.

**Files:** `examples/storefront-demo/src/lib/adapters.ts`

- [ ] **Step 1: Rebuild the SDK so the example sees the new exports**

Run: `pnpm -F @viu/emporix-sdk build`

- [ ] **Step 2: Use the SDK helper in the adapter**

In `examples/storefront-demo/src/lib/adapters.ts`, add `productIdFromYrn` to the existing `@viu/emporix-sdk` import, and delete the local `productIdFromYrn` definition (the one that does `yrn.lastIndexOf(";")`). Update `priceForProduct`'s matcher to prefer the typed field: `(x.itemId?.id ?? x.itemRef?.id) === productId` stays valid, but `itemId` is now typed.

- [ ] **Step 3: Typecheck the demo**

Run: `pnpm -F @viu/emporix-examples-storefront-demo typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add examples/storefront-demo/src/lib/adapters.ts
git commit -m "refactor(examples): use SDK productIdFromYrn + typed itemId"
```

---

## Completion

After all tasks: REQUIRED SUB-SKILL `superpowers:finishing-a-development-branch` — verify tests, present options (the user pushes/merges externally; `gh` is unavailable).

Branch: `feat/price-match-itemid` (off `main`, spec folded in). Push with `git push -u origin feat/price-match-itemid`.
