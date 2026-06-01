# Shipping Service Binding (Phase 2 — Delivery Scheduling) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `client.shipping` with the delivery-scheduling cluster (19 ops): delivery windows, delivery times + slots, delivery cycles.

**Architecture:** The shipping OpenAPI was already fetched + generated in Phase 1, so the scheduling types already exist under `src/generated/shipping`. This plan **extends** `shipping-types.ts` (aliases) and `ShippingService` (methods). No codegen, no client wiring. PATCH uses a JSON-Patch op-array (`Patch`); slots use one schema for read + write; creates return an inline `{ id? }`; `generateDeliveryCycle` returns a `string`.

**Tech Stack:** TypeScript, Vitest + MSW, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-shipping-service-phase2-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/src/services/shipping-types.ts` | **extend** with scheduling aliases |
| `packages/sdk/src/services/shipping.ts` | **extend** `ShippingService` with scheduling methods |
| `packages/sdk/tests/services/shipping-types.test.ts` | **extend** type-level tests |
| `packages/sdk/tests/services/shipping.test.ts` | **extend** MSW tests |
| `docs/shipping.md` | fill the Phase 2 section |
| `.changeset/shipping-service-phase2.md` | release entry (sdk only) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/shipping-service-phase2` off current `main` (Phase 1 merged), commit spec + plan first:
```bash
git checkout main && git pull
git checkout -b feat/shipping-service-phase2
git add docs/superpowers/specs/2026-06-01-shipping-service-phase2-design.md docs/superpowers/plans/2026-06-01-shipping-service-phase2.md
git commit -m "docs(sdk): add shipping phase 2 design spec and plan"
```

---

## Task 1: Extend the public types

**Files:** modify `shipping-types.ts`; extend `shipping-types.test.ts`.

- [ ] **Step 1: Verify the generated names exist**

```bash
grep -nE "^export type (ActualDeliveryWindow|ActualDeliveryWindows|BasicDeliveryTime|DeliveryTime|UpdateDeliveryTime|SlotCreation|DeliveryCycle|DeliveryWindowValidationDto|Patch) =" packages/sdk/src/generated/shipping/types.gen.ts
```
Expected: all present (generated in Phase 1).

- [ ] **Step 2: Add failing type assertions** — append to `shipping-types.test.ts`'s import list and the `describe` body:

Add to the import:
```ts
  DeliveryWindow, DeliveryWindowList, DeliveryWindowValidation,
  DeliveryTime, DeliveryTimeList, DeliveryTimeInput, DeliveryTimeUpdate,
  DeliverySlot, DeliverySlotList, DeliveryCycleInput, ShippingPatch, DeliveryCreated,
```
Add a new `it`:
```ts
  it("Phase-2 scheduling types are usable", () => {
    expectTypeOf<DeliveryWindow>().not.toBeNever();
    expectTypeOf<DeliveryWindowList>().not.toBeNever();
    expectTypeOf<DeliveryWindowValidation>().not.toBeNever();
    expectTypeOf<DeliveryTime>().not.toBeNever();
    expectTypeOf<DeliveryTimeList>().toBeArray();
    expectTypeOf<DeliveryTimeInput>().not.toBeNever();
    expectTypeOf<DeliveryTimeUpdate>().not.toBeNever();
    expectTypeOf<DeliverySlot>().not.toBeNever();
    expectTypeOf<DeliverySlotList>().toBeArray();
    expectTypeOf<DeliveryCycleInput>().not.toBeNever();
    expectTypeOf<ShippingPatch>().toBeArray();
    expectTypeOf<DeliveryCreated>().not.toBeNever();
  });
```

- [ ] **Step 3: Verify it fails** — `pnpm -F @viu/emporix-sdk exec tsc --noEmit 2>&1 | grep shipping-types` (missing exports).

- [ ] **Step 4: Add the aliases** — append to `shipping-types.ts`. First extend the existing generated import with these names:

```ts
  ActualDeliveryWindow,
  ActualDeliveryWindows,
  BasicDeliveryTime,
  DeliveryTime as GenDeliveryTime,
  UpdateDeliveryTime,
  SlotCreation,
  DeliveryCycle as GenDeliveryCycle,
  DeliveryWindowValidationDto,
  Patch,
```
Then append the alias block:

```ts
// --- Phase 2: delivery scheduling ---

/** A delivery window for a cart/area. */
export type DeliveryWindow = ActualDeliveryWindow;
/** List of delivery windows. */
export type DeliveryWindowList = ActualDeliveryWindows;
/** Body for delivery-window validation / counter increment. */
export type DeliveryWindowValidation = DeliveryWindowValidationDto;

/** A delivery time (read shape). */
export type DeliveryTime = GenDeliveryTime;
/** List of delivery times (`GET /delivery-times`). */
export type DeliveryTimeList = DeliveryTime[];
/** Create body (`POST /delivery-times`). */
export type DeliveryTimeInput = BasicDeliveryTime;
/** Update body (`PUT /delivery-times/{id}`). */
export type DeliveryTimeUpdate = UpdateDeliveryTime;

/** A delivery time slot (read + write body). */
export type DeliverySlot = SlotCreation;
/** List of delivery time slots. */
export type DeliverySlotList = DeliverySlot[];

/** Body for `generateDeliveryCycle`. */
export type DeliveryCycleInput = GenDeliveryCycle;

/** JSON-Patch op-array (used by `patchDeliveryTime` / `patchSlot`). */
export type ShippingPatch = Patch;

/** Inline create response — the created resource's `{ id }`. */
export interface DeliveryCreated {
  id?: string;
}
```

> If a create's inline 201 carries more than `{ id }`, widen `DeliveryCreated`
> accordingly; if `Patch` is not an array upstream, adjust the test.

- [ ] **Step 5: Run test + typecheck** — `vitest run tests/services/shipping-types.test.ts` + `typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/services/shipping-types.ts packages/sdk/tests/services/shipping-types.test.ts
git commit -m "feat(sdk): add shipping phase 2 scheduling types"
```

---

## Task 2: Add scheduling methods to ShippingService

**Files:** modify `shipping.ts`; extend `shipping.test.ts`.

- [ ] **Step 1: Add failing tests** — append to `shipping.test.ts`:

```ts
describe("ShippingService — delivery windows", () => {
  it("getAreaDeliveryWindows / getCartDeliveryWindows GET tenant-scoped paths", async () => {
    let areaPath = "";
    server.use(
      http.get(`${BASE}/areaDeliveryTimes/area-1/cart-1`, ({ request }) => {
        areaPath = new URL(request.url).pathname;
        return HttpResponse.json([{ id: "w1" }]);
      }),
      http.get(`${BASE}/actualDeliveryWindows/cart-1`, () => HttpResponse.json([{ id: "w1" }])),
    );
    await svc().getAreaDeliveryWindows("area-1", "cart-1");
    await svc().getCartDeliveryWindows("cart-1");
    expect(areaPath).toBe("/shipping/acme/areaDeliveryTimes/area-1/cart-1");
  });

  it("incrementDeliveryWindowCounter / validateDeliveryWindow POST and resolve to void", async () => {
    let counterBody: unknown = null;
    server.use(
      http.post(`${BASE}/actualDeliveryWindows/incrementCounter`, async ({ request }) => {
        counterBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.post(`${BASE}/deliveryWindowValidation`, () => new HttpResponse(null, { status: 200 })),
    );
    await expect(svc().incrementDeliveryWindowCounter({ deliveryWindowId: "w1" } as never)).resolves.toBeUndefined();
    expect(counterBody).toEqual({ deliveryWindowId: "w1" });
    await expect(svc().validateDeliveryWindow({ deliveryWindowId: "w1" } as never)).resolves.toBeUndefined();
  });
});

describe("ShippingService — delivery times", () => {
  it("list / get / create / bulk / update / patch / delete", async () => {
    let createBody: unknown = null;
    let bulkBody: unknown = null;
    let patchBody: unknown = null;
    server.use(
      http.get(`${BASE}/delivery-times`, () => HttpResponse.json([{ id: "dt1" }])),
      http.get(`${BASE}/delivery-times/dt1`, () => HttpResponse.json({ id: "dt1" })),
      http.post(`${BASE}/delivery-times`, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ id: "dt1" }, { status: 201 });
      }),
      http.post(`${BASE}/delivery-times/bulk`, async ({ request }) => {
        bulkBody = await request.json();
        return HttpResponse.json([{ id: "dt1" }], { status: 201 });
      }),
      http.put(`${BASE}/delivery-times/dt1`, () => new HttpResponse(null, { status: 204 })),
      http.patch(`${BASE}/delivery-times/dt1`, async ({ request }) => {
        patchBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(`${BASE}/delivery-times/dt1`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().listDeliveryTimes()).resolves.toBeDefined();
    expect((await svc().getDeliveryTime("dt1")) as { id?: string }).toEqual({ id: "dt1" });
    expect((await svc().createDeliveryTime({ name: "Morning" } as never)).id).toBe("dt1");
    expect(createBody).toEqual({ name: "Morning" });
    await svc().createDeliveryTimesBulk([{ name: "Morning" }] as never);
    expect(bulkBody).toEqual([{ name: "Morning" }]);
    await expect(svc().updateDeliveryTime("dt1", { name: "AM" } as never)).resolves.toBeUndefined();
    await svc().patchDeliveryTime("dt1", [{ op: "replace", path: "/name", value: "AM" }] as never);
    expect(patchBody).toEqual([{ op: "replace", path: "/name", value: "AM" }]);
    await expect(svc().deleteDeliveryTime("dt1")).resolves.toBeUndefined();
  });
});

describe("ShippingService — slots & cycles", () => {
  it("slots: list / get / create / update / patch / delete / deleteAll", async () => {
    let createBody: unknown = null;
    server.use(
      http.get(`${BASE}/delivery-times/dt1/slots`, () => HttpResponse.json([{ id: "s1" }])),
      http.get(`${BASE}/delivery-times/dt1/slots/s1`, () => HttpResponse.json({ id: "s1" })),
      http.post(`${BASE}/delivery-times/dt1/slots`, async ({ request }) => {
        createBody = await request.json();
        return HttpResponse.json({ id: "s1" }, { status: 201 });
      }),
      http.put(`${BASE}/delivery-times/dt1/slots/s1`, () => new HttpResponse(null, { status: 204 })),
      http.patch(`${BASE}/delivery-times/dt1/slots/s1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/delivery-times/dt1/slots/s1`, () => new HttpResponse(null, { status: 204 })),
      http.delete(`${BASE}/delivery-times/dt1/slots`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().listSlots("dt1")).resolves.toBeDefined();
    expect((await svc().getSlot("dt1", "s1")) as { id?: string }).toEqual({ id: "s1" });
    expect((await svc().createSlot("dt1", { capacity: 10 } as never)).id).toBe("s1");
    expect(createBody).toEqual({ capacity: 10 });
    await expect(svc().updateSlot("dt1", "s1", { capacity: 12 } as never)).resolves.toBeUndefined();
    await expect(svc().patchSlot("dt1", "s1", [{ op: "replace", path: "/capacity", value: 12 }] as never)).resolves.toBeUndefined();
    await expect(svc().deleteSlot("dt1", "s1")).resolves.toBeUndefined();
    await expect(svc().deleteAllSlots("dt1")).resolves.toBeUndefined();
  });

  it("generateDeliveryCycle POSTs and returns a string", async () => {
    server.use(http.post(`${BASE}/delivery-cycles/generate`, () => HttpResponse.json("cycle-1", { status: 201 })));
    await expect(svc().generateDeliveryCycle({ from: "2026-06-01" } as never)).resolves.toBe("cycle-1");
  });
});
```

- [ ] **Step 2: Verify the new tests fail** — `vitest run tests/services/shipping.test.ts` (methods missing).

- [ ] **Step 3: Extend the service** — in `shipping.ts`, add the new types to the `import type` block **and** the `export type` re-export block:

```ts
  DeliveryWindowList,
  DeliveryWindowValidation,
  DeliveryTime,
  DeliveryTimeList,
  DeliveryTimeInput,
  DeliveryTimeUpdate,
  DeliverySlot,
  DeliverySlotList,
  DeliveryCycleInput,
  ShippingPatch,
  DeliveryCreated,
```
Then insert these methods into the `ShippingService` class (before the closing brace):

```ts
  // --- Phase 2: delivery windows ---

  /** Retrieve delivery windows for a delivery area + cart. */
  async getAreaDeliveryWindows(deliveryAreaId: string, cartId: string, auth: AuthContext = SERVICE): Promise<DeliveryWindowList> {
    return this.ctx.http.request<DeliveryWindowList>({
      method: "GET",
      path: `${this.base()}/areaDeliveryTimes/${encodeURIComponent(deliveryAreaId)}/${encodeURIComponent(cartId)}`,
      auth,
    });
  }

  /** Retrieve delivery windows for a cart. */
  async getCartDeliveryWindows(cartId: string, auth: AuthContext = SERVICE): Promise<DeliveryWindowList> {
    return this.ctx.http.request<DeliveryWindowList>({
      method: "GET",
      path: `${this.base()}/actualDeliveryWindows/${encodeURIComponent(cartId)}`,
      auth,
    });
  }

  /** Increment the delivery-window counter. */
  async incrementDeliveryWindowCounter(input: DeliveryWindowValidation, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/actualDeliveryWindows/incrementCounter`,
      auth,
      body: input,
    });
  }

  /** Validate a delivery window. Resolves when valid; throws otherwise. */
  async validateDeliveryWindow(input: DeliveryWindowValidation, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/deliveryWindowValidation`,
      auth,
      body: input,
    });
  }

  // --- Phase 2: delivery times ---

  /** List all delivery times. */
  async listDeliveryTimes(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<DeliveryTimeList> {
    return this.ctx.http.request<DeliveryTimeList>({
      method: "GET",
      path: `${this.base()}/delivery-times`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one delivery time. */
  async getDeliveryTime(deliveryTimeId: string, auth: AuthContext = SERVICE): Promise<DeliveryTime> {
    return this.ctx.http.request<DeliveryTime>({
      method: "GET",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}`,
      auth,
    });
  }

  /** Create a delivery time. */
  async createDeliveryTime(input: DeliveryTimeInput, auth: AuthContext = SERVICE): Promise<DeliveryCreated> {
    return this.ctx.http.request<DeliveryCreated>({
      method: "POST",
      path: `${this.base()}/delivery-times`,
      auth,
      body: input,
    });
  }

  /** Create multiple delivery times (`POST /delivery-times/bulk`). */
  async createDeliveryTimesBulk(inputs: DeliveryTimeInput[], auth: AuthContext = SERVICE): Promise<DeliveryCreated[]> {
    return this.ctx.http.request<DeliveryCreated[]>({
      method: "POST",
      path: `${this.base()}/delivery-times/bulk`,
      auth,
      body: inputs,
    });
  }

  /** Replace a delivery time. */
  async updateDeliveryTime(deliveryTimeId: string, input: DeliveryTimeUpdate, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a delivery time (JSON-Patch op array). */
  async patchDeliveryTime(deliveryTimeId: string, ops: ShippingPatch, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}`,
      auth,
      body: ops,
    });
  }

  /** Delete a delivery time. */
  async deleteDeliveryTime(deliveryTimeId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}`,
      auth,
    });
  }

  // --- Phase 2: delivery time slots ---

  /** List slots of a delivery time. */
  async listSlots(deliveryTimeId: string, auth: AuthContext = SERVICE): Promise<DeliverySlotList> {
    return this.ctx.http.request<DeliverySlotList>({
      method: "GET",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots`,
      auth,
    });
  }

  /** Retrieve one slot. */
  async getSlot(deliveryTimeId: string, slotId: string, auth: AuthContext = SERVICE): Promise<DeliverySlot> {
    return this.ctx.http.request<DeliverySlot>({
      method: "GET",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots/${encodeURIComponent(slotId)}`,
      auth,
    });
  }

  /** Create a slot in a delivery time. */
  async createSlot(deliveryTimeId: string, input: DeliverySlot, auth: AuthContext = SERVICE): Promise<DeliveryCreated> {
    return this.ctx.http.request<DeliveryCreated>({
      method: "POST",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots`,
      auth,
      body: input,
    });
  }

  /** Replace a slot. */
  async updateSlot(deliveryTimeId: string, slotId: string, input: DeliverySlot, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots/${encodeURIComponent(slotId)}`,
      auth,
      body: input,
    });
  }

  /** Partially update a slot (JSON-Patch op array). */
  async patchSlot(deliveryTimeId: string, slotId: string, ops: ShippingPatch, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots/${encodeURIComponent(slotId)}`,
      auth,
      body: ops,
    });
  }

  /** Delete a slot. */
  async deleteSlot(deliveryTimeId: string, slotId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots/${encodeURIComponent(slotId)}`,
      auth,
    });
  }

  /** Delete all slots of a delivery time. */
  async deleteAllSlots(deliveryTimeId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/delivery-times/${encodeURIComponent(deliveryTimeId)}/slots`,
      auth,
    });
  }

  // --- Phase 2: delivery cycles ---

  /** Generate a delivery cycle (`POST /delivery-cycles/generate`). Returns the cycle id. */
  async generateDeliveryCycle(input: DeliveryCycleInput, auth: AuthContext = SERVICE): Promise<string> {
    return this.ctx.http.request<string>({
      method: "POST",
      path: `${this.base()}/delivery-cycles/generate`,
      auth,
      body: input,
    });
  }
```

> `DeliveryWindow`/`DeliverySlot`/`DeliveryTime` etc. that are only re-exported
> (not used in signatures) belong in the `export type` block, not necessarily the
> `import type` block — import only what the method signatures reference, and
> re-export the full public set. If `generateDeliveryCycle`'s 201 body is not a
> bare string, adjust the return type + test mock.

- [ ] **Step 4: Run the full shipping test + typecheck + lint** — drop `as never` where the aliased inputs accept the literals.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/services/shipping.ts packages/sdk/tests/services/shipping.test.ts
git commit -m "feat(sdk): add shipping delivery scheduling (windows, times, slots, cycles)"
```

---

## Task 3: Documentation

**Files:** modify `docs/shipping.md`.

- [ ] **Step 1: Replace the Phase 2 note with a real section**

In `docs/shipping.md`, replace the trailing "Phase 2 (not yet bound)" note with:

````markdown
## Delivery scheduling (Phase 2)

```ts
// delivery windows
const windows = await client.shipping.getCartDeliveryWindows("cart-1");
await client.shipping.getAreaDeliveryWindows("area-1", "cart-1");
await client.shipping.validateDeliveryWindow({ /* … */ });

// delivery times + slots
const times = await client.shipping.listDeliveryTimes();
const { id: dtId } = await client.shipping.createDeliveryTime({ /* … */ });
await client.shipping.patchDeliveryTime(dtId, [{ op: "replace", path: "/name", value: "AM" }]);
const slots = await client.shipping.listSlots(dtId);
await client.shipping.createSlot(dtId, { /* … */ });
await client.shipping.deleteAllSlots(dtId);

// delivery cycles
const cycleId = await client.shipping.generateDeliveryCycle({ /* … */ });
```

`patchDeliveryTime` / `patchSlot` take a JSON-Patch op-array. `generateDeliveryCycle`
returns the new cycle id.
````

- [ ] **Step 2: Commit**

```bash
git add docs/shipping.md
git commit -m "docs(sdk): document shipping delivery scheduling"
```

---

## Task 4: Changeset

- [ ] **Step 1: `.changeset/shipping-service-phase2.md`**

```markdown
---
"@viu/emporix-sdk": minor
---

Extend `client.shipping` with delivery scheduling: delivery windows
(`getAreaDeliveryWindows`, `getCartDeliveryWindows`, `incrementDeliveryWindowCounter`,
`validateDeliveryWindow`), delivery times (`listDeliveryTimes`, `getDeliveryTime`,
`createDeliveryTime`, `createDeliveryTimesBulk`, `updateDeliveryTime`,
`patchDeliveryTime`, `deleteDeliveryTime`), delivery time slots (`listSlots`,
`getSlot`, `createSlot`, `updateSlot`, `patchSlot`, `deleteSlot`, `deleteAllSlots`),
and delivery cycles (`generateDeliveryCycle`). Server-side only.
```

- [ ] **Step 2: Verify** — `pnpm changeset status` (adds `@viu/emporix-sdk`).

- [ ] **Step 3: Commit**

```bash
git add .changeset/shipping-service-phase2.md
git commit -m "chore(release): add shipping phase 2 changeset"
```

---

## Final verification (after all tasks)

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint
pnpm -F @viu/emporix-sdk build
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 all 19 scheduling ops → Task 2 methods + tests (windows 4, times 7, slots 7, cycle 1). D2 same service → methods added to `ShippingService`; no wiring task (already wired). D3 no React / service-token → `const SERVICE` default. D4 aliasing → Task 1 (PATCH = `ShippingPatch`/`Patch` op-array; slot read=write = `SlotCreation`; creates → `DeliveryCreated`; cycle → `string`; updates/patches/deletes → void). No codegen task (types already generated in Phase 1). Docs/changeset → Tasks 3/4 (sdk only). No gaps.
- **Placeholder scan:** No TBD/TODO. All 19 methods have full code. Upstream-dependent uncertainties (inline create 201 shape, validate/increment/cycle responses) are concrete codegen-verify notes with fallbacks.
- **Type consistency:** New public names (`DeliveryWindow`/`DeliveryWindowList`/`DeliveryWindowValidation`/`DeliveryTime`/`DeliveryTimeList`/`DeliveryTimeInput`/`DeliveryTimeUpdate`/`DeliverySlot`/`DeliverySlotList`/`DeliveryCycleInput`/`ShippingPatch`/`DeliveryCreated`) are identical across Task 1 (defs + test), Task 2 (imports + re-exports + signatures), and the tests. Tenant paths `/shipping/acme/…` asserted. No new logger/wiring (Phase 1 already added `"shipping"`). Commit scopes `sdk`/`release`, lowercase verbs (commitlint-safe).
```
