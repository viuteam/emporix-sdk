import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectOrderMutations } from "../src/injectables/orders";

/**
 * `reorder` is the only method here with logic rather than a call, and every
 * assertion below is a shape that would have been wrong if ported from the
 * method names: order lines live under `entries`, each needs a complete price
 * row or Emporix answers 400, the quantity is `orderedAmount`, and the batch
 * response is a bare array whose entries carry an HTTP-style `status`.
 */
const priced = (id: string) => ({
  itemYrn: `yrn:product::${id}`,
  orderedAmount: 2,
  price: {
    priceId: `pr-${id}`,
    originalAmount: 100,
    effectiveAmount: 100,
    currency: "CHF",
  },
});

type Mock = ReturnType<typeof vi.fn>;
interface Calls {
  orderGet: Mock;
  addItemsBatch: Mock;
  cancel: Mock;
  transition: Mock;
  salesOrderGet: Mock;
  salesOrderUpdate: Mock;
}

let storage: EmporixStorage;
let qc: QueryClient;
let calls: Calls;

function boot(signedIn: boolean, overrides: Record<string, unknown> = {}): void {
  storage = createMemoryStorage();
  if (signedIn) storage.setCustomerToken("t1");
  qc = new QueryClient();
  calls = {
    orderGet: vi.fn(async () => ({ id: "EON1", entries: [priced("p1")] })),
    addItemsBatch: vi.fn(async () => [{ index: 0, status: 201 }]),
    cancel: vi.fn(async () => undefined),
    transition: vi.fn(async () => undefined),
    salesOrderGet: vi.fn(async () => ({ id: "EON1" })),
    salesOrderUpdate: vi.fn(async () => ({ id: "EON1" })),
    ...overrides,
  } as unknown as Calls;
  const client = {
    tenant: "acme",
    config: {},
    orders: { get: calls.orderGet, cancel: calls.cancel, transition: calls.transition },
    salesOrders: { get: calls.salesOrderGet, update: calls.salesOrderUpdate },
    carts: { addItemsBatch: calls.addItemsBatch },
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient: qc })],
  });
}

const tick = (): void => TestBed.inject(ApplicationRef).tick();

describe("injectOrderMutations", () => {
  beforeEach(() => {
    boot(true);
    storage.setCartId("cart-1");
  });

  it("reorder reads the order and batches its priced entries into the cart", async () => {
    const m = TestBed.runInInjectionContext(() => injectOrderMutations());
    const result = await m.reorder({ orderId: "EON1" });
    tick();
    expect(calls.orderGet).toHaveBeenCalled();
    const [cartId, body] = calls.addItemsBatch.mock.calls[0] as [string, unknown[]];
    expect(cartId).toBe("cart-1");
    expect(body).toEqual([
      {
        itemYrn: "yrn:product::p1",
        quantity: 2,
        price: {
          priceId: "pr-p1",
          originalAmount: 100,
          effectiveAmount: 100,
          currency: "CHF",
        },
      },
    ]);
    expect(result).toEqual({ added: 1, skipped: 0, errors: [] });
  });

  /**
   * An entry with no price row cannot be re-added at all: internal-type cart
   * items require a `priceId`. Skipping it and saying so beats a 400 that takes
   * the whole reorder down with it.
   */
  it("reorder skips entries without a complete price row", async () => {
    boot(true, {
      orderGet: vi.fn(async () => ({
        entries: [priced("p1"), { itemYrn: "yrn:product::p2", orderedAmount: 1 }],
      })),
    });
    storage.setCartId("cart-1");
    const m = TestBed.runInInjectionContext(() => injectOrderMutations());
    const result = await m.reorder({ orderId: "EON1" });
    expect((calls.addItemsBatch.mock.calls[0] as [string, unknown[]])[1]).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it("reorder makes no batch call when nothing is re-addable", async () => {
    boot(true, { orderGet: vi.fn(async () => ({ entries: [{ itemYrn: "y" }] })) });
    storage.setCartId("cart-1");
    const m = TestBed.runInInjectionContext(() => injectOrderMutations());
    const result = await m.reorder({ orderId: "EON1" });
    expect(calls.addItemsBatch).not.toHaveBeenCalled();
    expect(result).toEqual({ added: 0, skipped: 1, errors: [] });
  });

  /** Partial failure is reported, not thrown: nine of ten lines is not an error page. */
  it("reorder reports per-entry failures without throwing", async () => {
    boot(true, {
      orderGet: vi.fn(async () => ({ entries: [priced("p1"), priced("p2")] })),
      addItemsBatch: vi.fn(async () => [
        { index: 0, status: 201 },
        { index: 1, status: 409, errorMessage: "out of stock" },
      ]),
    });
    storage.setCartId("cart-1");
    const m = TestBed.runInInjectionContext(() => injectOrderMutations());
    const result = await m.reorder({ orderId: "EON1" });
    expect(result.added).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(String(result.errors[0])).toContain("409");
  });

  it("reorder fails when there is no cart to add to", async () => {
    storage.setCartId(null);
    const m = TestBed.runInInjectionContext(() => injectOrderMutations());
    await expect(m.reorder({ orderId: "EON1" })).rejects.toThrow(/cartId/);
    expect(m.error()?.message).toMatch(/cartId/);
  });

  it("cancel and transition pass the customer context and the stored saas token", async () => {
    storage.setSaasToken?.("saas-1");
    const m = TestBed.runInInjectionContext(() => injectOrderMutations());
    await m.cancel({ orderId: "EON1" });
    expect(calls.cancel).toHaveBeenCalledWith(
      "EON1",
      expect.objectContaining({ kind: "customer" }),
      expect.objectContaining({ saasToken: "saas-1" }),
    );
    await m.transition({ orderId: "EON1", status: "SHIPPED" as never, comment: "sent" });
    expect(calls.transition).toHaveBeenCalledWith(
      "EON1",
      "SHIPPED",
      expect.anything(),
      expect.objectContaining({ comment: "sent" }),
    );
  });

  it("surfaces a failure on error() and rethrows it", async () => {
    boot(true, {
      cancel: vi.fn(async () => {
        throw new Error("409 not cancellable");
      }),
    });
    const m = TestBed.runInInjectionContext(() => injectOrderMutations());
    await expect(m.cancel({ orderId: "EON1" })).rejects.toThrow("409 not cancellable");
    expect(m.error()?.message).toBe("409 not cancellable");
    expect(m.isPending()).toBe(false);
  });

  it("invalidates the order keys after a successful write", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => injectOrderMutations());
    await m.updateSalesOrder({ orderId: "EON1", patch: {} as never });
    expect(calls.salesOrderUpdate).toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "my-orders"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "sales-order"] });
  });
});
