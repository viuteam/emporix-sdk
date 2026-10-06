import { describe, expect, it, vi } from "vitest";
import { ApplicationRef, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectCompanySwitch } from "../src/company-switch";
import { injectActiveCart, injectCart } from "../src/injectables/cart";
import { injectPaymentModes } from "../src/injectables/checkout";
import { injectCustomerAddresses } from "../src/injectables/customer";

/**
 * Reads whose answer depends on the active legal entity key on it, as the React
 * bindings do: the cart, the cart bootstrap, the payment modes and the addresses.
 *
 * The switch drops the cart id and invalidates the `cart` reads, but a key that
 * ignores the company still lets the cache answer for the wrong one — most
 * visibly the bootstrap, whose `[no cart id, site]` entry from before the switch
 * is still fresh and not invalidated, and hands back the old company's cart.
 */
type Mock = ReturnType<typeof vi.fn>;

let storage: EmporixStorage;
let qc: QueryClient;
let getCurrent: Mock;

function boot(): void {
  storage = createMemoryStorage();
  storage.setCustomerToken("t1");
  storage.setRefreshToken?.("r1");
  qc = new QueryClient();
  getCurrent = vi
    .fn()
    .mockResolvedValueOnce({ id: "cart-A", items: [] })
    .mockResolvedValueOnce({ id: "cart-B", items: [] });
  const client = {
    tenant: "acme",
    config: { credentials: { storefront: { context: { siteCode: "main", currency: "CHF" } } } },
    sites: { get: async () => ({ currency: "CHF" }), list: async () => [{ code: "main" }] },
    sessionContext: { patch: async () => true },
    setStorefrontContext: vi.fn(),
    companies: { listMine: vi.fn(async () => [{ id: "le1" }, { id: "le2" }]) },
    customers: {
      refresh: vi.fn(async () => ({ customerToken: "t2", refreshToken: "r2", saasToken: null })),
      me: vi.fn(async () => ({ id: "c1" })),
      addresses: { list: vi.fn(async () => []) },
    },
    carts: {
      get: vi.fn(async (id: string) => ({ id, items: [] })),
      getCurrent,
    },
    payments: { listPaymentModes: vi.fn(async () => []) },
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
    { timeout: 2_000, interval: 25 },
  );
}

/** The args of the one query for `resource` — everything between the resource and the meta. */
function argsOf(resource: string): unknown[] | undefined {
  const q = qc
    .getQueryCache()
    .getAll()
    .find((e) => e.queryKey[1] === resource && e.getObserversCount() > 0);
  return q?.queryKey.slice(2, -1);
}

describe("company-dependent keys", () => {
  /**
   * Company to company. From no company the switch's invalidation happens to catch
   * the bootstrap — it matches every key element equal to the old id, and the old
   * id is `null` like the bootstrap's stored cart id — so that path hid the bug.
   */
  it("does not hand back the previous company's bootstrapped cart after a switch", async () => {
    boot();
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());
    await s.refetchMyCompanies();
    await s.setActiveCompany("le1");
    const active = TestBed.runInInjectionContext(() => injectActiveCart({ create: true }));
    await settleUntil(() => expect(active.data()?.id).toBe("cart-A"));

    await s.setActiveCompany("le2");

    await settleUntil(() => expect(active.data()?.id).toBe("cart-B"));
    expect(getCurrent).toHaveBeenCalledTimes(2);
    expect(storage.getCartId()).toBe("cart-B");
  });

  it("keys the cart, payment modes and addresses on the active company", async () => {
    boot();
    const s = TestBed.runInInjectionContext(() => injectCompanySwitch());
    await s.refetchMyCompanies();
    TestBed.runInInjectionContext(() => {
      injectCart(signal("cart-X"));
      injectPaymentModes();
      injectCustomerAddresses();
    });
    await settleUntil(() => expect(argsOf("cart")).toEqual(["cart-X", null]));
    expect(argsOf("payment-modes")).toEqual([null]);
    expect(argsOf("customer-addresses")).toEqual([null]);

    await s.setActiveCompany("le1");

    await settleUntil(() => expect(argsOf("cart")).toEqual(["cart-X", "le1"]));
    expect(argsOf("payment-modes")).toEqual(["le1"]);
    expect(argsOf("customer-addresses")).toEqual(["le1"]);
  });
});
