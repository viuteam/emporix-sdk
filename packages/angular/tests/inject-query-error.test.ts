import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import { injectEmporixQuery } from "../src/inject-query";

const fakeClient = { tenant: "acme" } as never;

async function settleUntil(assertion: () => void): Promise<void> {
  // 5s, not the 1s default: the ["emporix"] retry policy allows one retry and
  // TanStack's exponential backoff schedules it ~1s out, so an error state is
  // not reachable inside the default window. That is the retry working, not a
  // hang — but it is exactly why the first version of this test looked like a
  // package bug.
  await vi.waitFor(
    () => {
      TestBed.inject(ApplicationRef).tick();
      assertion();
    },
    { timeout: 5_000, interval: 50 },
  );
}

/**
 * A rejecting queryFn must land in `isError`, not sit in `isPending` forever.
 *
 * Written after the storefront demo showed "Loading products…" indefinitely
 * against a bad client id: the 401 was visible in the console but the template
 * never reached its error branch, and it was not obvious whether the fault was
 * the package, the retry policy, or the SDK's auth layer.
 */
describe("injectEmporixQuery error propagation", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideEmporix({
          client: fakeClient,
          storage: createMemoryStorage(),
          queryClient: new QueryClient(),
        }),
      ],
    });
  });

  it("reaches isError when queryFn rejects", async () => {
    const query = TestBed.runInInjectionContext(() =>
      injectEmporixQuery(() => ({
        resource: "product",
        args: [] as const,
        site: "none" as const,
        mode: "read-auth" as const,
        queryFn: () => Promise.reject(new Error("401 unauthorized")),
      })),
    );
    await settleUntil(() => expect(query.isError()).toBe(true));
    expect(query.error()?.message).toBe("401 unauthorized");
    expect(query.isPending()).toBe(false);
  });
});
