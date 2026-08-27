import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectEmporixQuery } from "../src/inject-query";

const fakeClient = { tenant: "acme" } as never;

/**
 * Run the effect and give any started fetch a turn to resolve.
 *
 * Use this before asserting that something did NOT happen. It is deliberately
 * not enough to assert that something DID: TanStack writes the query cache
 * immediately but notifies its signal-backed result through a batched scheduler,
 * so there is a window where `queryClient.getQueryCache()` already holds
 * `success` while `query.data()` is still `undefined`. Measured on Angular
 * 22.1.3 / zone.js 0.16.2: the cache had the value after one macrotask, the
 * signal after roughly 10 ms.
 *
 * `whenStable()` and `provideZonelessChangeDetection()` were the documented
 * fallbacks for the harness and were not needed.
 */
async function settle(): Promise<void> {
  const appRef = TestBed.inject(ApplicationRef);
  appRef.tick();
  await new Promise((r) => setTimeout(r, 0));
  appRef.tick();
}

/**
 * Wait for a signal-backed assertion, ticking on every retry.
 *
 * Bounded, so a value that never arrives still fails the test rather than
 * hanging — which is the whole reason not to just pile up `settle()` calls until
 * the suite goes green.
 */
async function settleUntil(assertion: () => void): Promise<void> {
  await vi.waitFor(() => {
    TestBed.inject(ApplicationRef).tick();
    assertion();
  });
}

describe("injectEmporixQuery", () => {
  let storage: EmporixStorage;
  let queryClient: QueryClient;

  beforeEach(() => {
    storage = createMemoryStorage();
    queryClient = new QueryClient();
    TestBed.configureTestingModule({
      providers: [provideEmporix({ client: fakeClient, storage, queryClient })],
    });
  });

  it("fetches and exposes the result", async () => {
    const queryFn = vi.fn(async () => "p1-data");
    const query = TestBed.runInInjectionContext(() =>
      injectEmporixQuery(() => ({
        resource: "product",
        args: ["p1"] as const,
        site: "none" as const,
        mode: "read-auth" as const,
        queryFn,
      })),
    );
    await settleUntil(() => expect(query.data()).toBe("p1-data"));
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it("does not fetch a customer-gated read without a token", async () => {
    const queryFn = vi.fn(async () => "orders");
    TestBed.runInInjectionContext(() =>
      injectEmporixQuery(() => ({
        resource: "my-orders",
        args: [] as const,
        site: "none" as const,
        mode: "customer" as const,
        queryFn,
      })),
    );
    await settle();
    expect(queryFn).not.toHaveBeenCalled();
  });

  /**
   * The reason this whole package uses signals. The token must be read INSIDE
   * injectQuery's options callback; read outside, the gate is evaluated once and
   * a customer who logs in never gets their data.
   */
  it("re-enables a customer-gated read when a token appears", async () => {
    const queryFn = vi.fn(async () => "orders");
    const query = TestBed.runInInjectionContext(() =>
      injectEmporixQuery(() => ({
        resource: "my-orders",
        args: [] as const,
        site: "none" as const,
        mode: "customer" as const,
        queryFn,
      })),
    );
    await settle();
    expect(queryFn).not.toHaveBeenCalled();

    storage.setCustomerToken("t1");
    await settleUntil(() => expect(query.data()).toBe("orders"));
    expect(queryFn).toHaveBeenCalledOnce();
  });

  it("re-keys a read-auth query on login, so anonymous data is not reused", async () => {
    const queryFn = vi.fn(async () => "data");
    TestBed.runInInjectionContext(() =>
      injectEmporixQuery(() => ({
        resource: "product",
        args: ["p1"] as const,
        site: "none" as const,
        mode: "read-auth" as const,
        queryFn,
      })),
    );
    await settle();
    storage.setCustomerToken("t1");
    await settle();

    const kinds = queryClient
      .getQueryCache()
      .getAll()
      .map((q) => (q.queryKey[3] as { authKind: string }).authKind);
    expect(kinds).toContain("anonymous");
    expect(kinds).toContain("customer");
  });

  it("accepts an explicit injector outside an injection context", async () => {
    const injector = TestBed.inject(ApplicationRef).injector;
    const query = injectEmporixQuery(
      () => ({
        resource: "product",
        args: ["p1"] as const,
        site: "none" as const,
        mode: "read-auth" as const,
        queryFn: async () => "v",
      }),
      { injector },
    );
    await settleUntil(() => expect(query.data()).toBe("v"));
  });
});
