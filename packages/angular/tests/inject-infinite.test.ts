import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage, type PaginatedItems } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectEmporixInfinite } from "../src/inject-query";

const fakeClient = { tenant: "acme" } as never;

async function settleUntil(assertion: () => void): Promise<void> {
  await vi.waitFor(
    () => {
      TestBed.inject(ApplicationRef).tick();
      assertion();
    },
    { timeout: 5_000, interval: 25 },
  );
}

/** Three pages of one item each, the way an Emporix endpoint answers. */
function page(n: number, total = 3): PaginatedItems<string> {
  return { items: [`item-${n}`], pageNumber: n, pageSize: 1, hasNextPage: n < total };
}

describe("injectEmporixInfinite", () => {
  let storage: EmporixStorage;

  beforeEach(() => {
    storage = createMemoryStorage();
    TestBed.configureTestingModule({
      providers: [
        provideEmporix({ client: fakeClient, storage, queryClient: new QueryClient() }),
      ],
    });
  });

  /**
   * The regression test for the bug that shipped in the first version: options
   * were built through `emporixQueryOptions`, whose `queryFn` takes no arguments,
   * so TanStack's `pageParam` was dropped and every page re-fetched page one.
   * Asserting the page NUMBERS rather than just the count is what catches it —
   * three calls all for page 1 would satisfy a length check.
   */
  it("passes the page number to fetchPage on every page", async () => {
    const seen: number[] = [];
    const fetchPage = vi.fn(async (pageNumber: number) => {
      seen.push(pageNumber);
      return page(pageNumber);
    });
    const query = TestBed.runInInjectionContext(() =>
      injectEmporixInfinite<string, readonly []>(() => ({
        resource: "things",
        args: [] as const,
        site: "none" as const,
        mode: "read-auth" as const,
        fetchPage,
      })),
    );

    await settleUntil(() => expect(query.data()?.pages.length).toBe(1));
    expect(seen).toEqual([1]);

    await query.fetchNextPage();
    await settleUntil(() => expect(query.data()?.pages.length).toBe(2));
    expect(seen).toEqual([1, 2]);

    await query.fetchNextPage();
    await settleUntil(() => expect(query.data()?.pages.length).toBe(3));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("stops when the server says hasNextPage is false", async () => {
    const query = TestBed.runInInjectionContext(() =>
      injectEmporixInfinite<string, readonly []>(() => ({
        resource: "things",
        args: [] as const,
        site: "none" as const,
        mode: "read-auth" as const,
        // One page only.
        fetchPage: async (n) => page(n, 1),
      })),
    );
    await settleUntil(() => expect(query.data()?.pages.length).toBe(1));
    // Termination is the server's answer, not an empty trailing fetch.
    expect(query.hasNextPage()).toBe(false);
  });

  it("does not fetch a customer-gated page without a token", async () => {
    const fetchPage = vi.fn(async (n: number) => page(n));
    TestBed.runInInjectionContext(() =>
      injectEmporixInfinite<string, readonly []>(() => ({
        resource: "my-things",
        args: [] as const,
        site: "none" as const,
        mode: "customer" as const,
        fetchPage,
      })),
    );
    TestBed.inject(ApplicationRef).tick();
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("enables and fetches once a token appears", async () => {
    const fetchPage = vi.fn(async (n: number) => page(n));
    const query = TestBed.runInInjectionContext(() =>
      injectEmporixInfinite<string, readonly []>(() => ({
        resource: "my-things",
        args: [] as const,
        site: "none" as const,
        mode: "customer" as const,
        fetchPage,
      })),
    );
    storage.setCustomerToken("t1");
    await settleUntil(() => expect(query.data()?.pages.length).toBe(1));
    expect(fetchPage).toHaveBeenCalledOnce();
  });
});
