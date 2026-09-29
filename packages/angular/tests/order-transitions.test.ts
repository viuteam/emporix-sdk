import { describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectOrderMutations } from "../src/injectables/orders";

function boot(): QueryClient {
  const storage = createMemoryStorage();
  storage.setCustomerToken("t1");
  const qc = new QueryClient();
  const client = {
    tenant: "acme",
    config: {},
    orders: {
      listTransitions: vi.fn(async () => []),
      cancel: vi.fn(async () => undefined),
      transition: vi.fn(async () => undefined),
    },
  } as never;
  TestBed.configureTestingModule({
    providers: [provideEmporix({ client, storage, queryClient: qc })],
  });
  return qc;
}

describe("order transitions", () => {
  // A cancel or transition changes which transitions are still allowed, so the
  // order writes must refresh injectOrderTransitions' entries along with the orders.
  it.each([
    ["cancel", (m: ReturnType<typeof injectOrderMutations>) => m.cancel({ orderId: "o1" })],
    ["transition", (m: ReturnType<typeof injectOrderMutations>) => m.transition({ orderId: "o1", status: "DECLINED" })],
  ] as const)("%s invalidates the order transitions", async (_name, write) => {
    const qc = boot();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => injectOrderMutations());
    await write(m);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "order-transitions"] });
  });
});
