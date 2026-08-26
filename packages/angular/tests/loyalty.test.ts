import { describe, expect, it, vi } from "vitest";
import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import {
  injectCouponMutations,
  injectMyRewardPoints,
  injectRedeemOptions,
  injectRewardPointMutations,
} from "../src/injectables/loyalty";
import { injectReturnMutations } from "../src/injectables/returns";

type Mock = ReturnType<typeof vi.fn>;
interface Calls {
  getMyPoints: Mock;
  listRedeemOptions: Mock;
  redeemMyPoints: Mock;
  validateCoupon: Mock;
  redeemCoupon: Mock;
  createReturn: Mock;
}

let storage: EmporixStorage;
let qc: QueryClient;
let calls: Calls;

function boot(signedIn: boolean, overrides: Partial<Calls> = {}): void {
  storage = createMemoryStorage();
  if (signedIn) storage.setCustomerToken("t1");
  qc = new QueryClient();
  calls = {
    getMyPoints: vi.fn(async () => 0),
    listRedeemOptions: vi.fn(async () => []),
    redeemMyPoints: vi.fn(async () => ({ couponCode: "C1" })),
    validateCoupon: vi.fn(async () => undefined),
    redeemCoupon: vi.fn(async () => ({ id: "red1" })),
    createReturn: vi.fn(async () => ({ id: "r1" })),
    ...overrides,
  } as unknown as Calls;
  const client = {
    tenant: "acme",
    config: {},
    rewardPoints: {
      getMyPoints: calls.getMyPoints,
      getMySummary: vi.fn(async () => ({})),
      listRedeemOptions: calls.listRedeemOptions,
      redeemMyPoints: calls.redeemMyPoints,
    },
    coupons: { validateCoupon: calls.validateCoupon, redeemCoupon: calls.redeemCoupon },
    returns: { createReturn: calls.createReturn },
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient: qc })],
  });
}

async function settleUntil(assertion: () => void): Promise<void> {
  await vi.waitFor(
    () => {
      TestBed.inject(ApplicationRef).tick();
      assertion();
    },
    { timeout: 5_000, interval: 25 },
  );
}

describe("reward points", () => {
  /**
   * The balance is a bare `number`, and `0` is a valid answer rather than an
   * error: the facade maps Emporix's 404 «No reward points found» to zero,
   * because for the signed-in customer that is what it means. A read that
   * treated 0 as «not loaded» would show a blank where it should show nothing
   * earned yet.
   */
  it("reads the balance as a number, zero included", async () => {
    boot(true);
    const q = TestBed.runInInjectionContext(() => injectMyRewardPoints());
    await settleUntil(() => expect(q.data()).toBe(0));
    expect(q.isError()).toBe(false);
  });

  /**
   * The facade defaults `listRedeemOptions` to a **service** context, because
   * managing options is service-only. The read is open to a customer token, and
   * a storefront must pass one — a service context does not exist in a browser.
   * This asserts the context that actually goes out.
   */
  it("redeem options go out with a customer context, never the service default", async () => {
    boot(true);
    TestBed.runInInjectionContext(() => injectRedeemOptions());
    await settleUntil(() => expect(calls.listRedeemOptions).toHaveBeenCalled());
    expect(calls.listRedeemOptions).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "customer" }),
    );
  });

  it("redeem options issue no request for a guest", async () => {
    boot(false);
    TestBed.runInInjectionContext(() => injectRedeemOptions());
    TestBed.inject(ApplicationRef).tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.listRedeemOptions).not.toHaveBeenCalled();
  });

  it("redeeming invalidates the balance and the summary", async () => {
    boot(true);
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => injectRewardPointMutations());
    await m.redeem({ points: 100 } as never);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "reward-points"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "reward-points-summary"] });
  });
});

describe("coupons", () => {
  /**
   * `validate` is a write, not a read. Emporix records the attempt against the
   * redemption, so caching it would be wrong and a re-render must not repeat it.
   * If this ever becomes an `inject…Query`, this test is what should stop it.
   */
  it("validate goes out once per call and is not cached", async () => {
    boot(true);
    const m = TestBed.runInInjectionContext(() => injectCouponMutations());
    await m.validate({ code: "SAVE10", redemption: {} as never });
    await m.validate({ code: "SAVE10", redemption: {} as never });
    expect(calls.validateCoupon).toHaveBeenCalledTimes(2);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
  });

  it("redeem invalidates the cart, whose totals change", async () => {
    boot(true);
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => injectCouponMutations());
    await expect(m.redeem({ code: "SAVE10", redemption: {} as never })).resolves.toEqual({
      id: "red1",
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "cart"] });
  });

  it("is customer-gated and spends no request for a guest", async () => {
    boot(false);
    const m = TestBed.runInInjectionContext(() => injectCouponMutations());
    await expect(m.redeem({ code: "X", redemption: {} as never })).rejects.toThrow(
      /requires a signed-in customer/,
    );
    expect(calls.redeemCoupon).not.toHaveBeenCalled();
  });
});

describe("returns", () => {
  it("creating a return invalidates the list", async () => {
    boot(true);
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => injectReturnMutations());
    await expect(m.create({ orderId: "EON1" } as never)).resolves.toEqual({ id: "r1" });
    expect(calls.createReturn).toHaveBeenCalledWith(
      { orderId: "EON1" },
      expect.objectContaining({ kind: "customer" }),
    );
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "returns"] });
  });

  it("is customer-gated", async () => {
    boot(false);
    const m = TestBed.runInInjectionContext(() => injectReturnMutations());
    await expect(m.create({} as never)).rejects.toThrow(/requires a signed-in customer/);
    expect(calls.createReturn).not.toHaveBeenCalled();
  });
});
