import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, useEmporix } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client(): EmporixClient {
  // No credentials at all: a host-owned token needs none. validateConfig only
  // requires the object to exist, and DefaultTokenProvider checks lazily.
  return new EmporixClient({ tenant: "acme", credentials: {}, logger: false });
}

function wrap(opts: { token?: string; storage?: EmporixStorage }) {
  const c = client();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={c}
      queryClient={qc}
      customerSession="external"
      {...(opts.storage ? { storage: opts.storage } : {})}
      {...(opts.token !== undefined ? { initialCustomerToken: opts.token } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("EmporixProvider customerSession='external'", () => {
  it("seeds the host token into the memory fallback before children render", () => {
    const { result } = renderHook(() => useEmporix(), { wrapper: wrap({ token: "host-1" }) });
    expect(result.current.storage.getCustomerToken()).toBe("host-1");
  });

  it("a rotated token reaches storage without discarding the rest of it", async () => {
    const storage = createMemoryStorage();
    storage.setCartId("cart-9");
    const c = client();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    // `render` rather than `renderHook`: renderHook's `initialProps` go to the
    // hook callback, not to the wrapper, so a token passed that way never
    // reaches the provider at all.
    const Harness = ({ token }: { token: string }) => (
      <EmporixProvider
        client={c}
        queryClient={qc}
        storage={storage}
        customerSession="external"
        initialCustomerToken={token}
      >
        <span>mounted</span>
      </EmporixProvider>
    );

    const { rerender } = render(<Harness token="host-1" />);
    expect(storage.getCustomerToken()).toBe("host-1");

    rerender(<Harness token="host-2" />);
    await waitFor(() => expect(storage.getCustomerToken()).toBe("host-2"));
    // The whole point: rotation must not be implemented by rebuilding storage.
    expect(storage.getCartId()).toBe("cart-9");
  });

  it("makes no legal-entities request on mount even with a token present", async () => {
    // onUnhandledRequest: "error" in this file's server means an unexpected
    // legal-entities call fails the test by itself. The counter below is the
    // readable statement of the same thing.
    let calls = 0;
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () => {
        calls += 1;
        return HttpResponse.json([]);
      }),
    );
    const { result } = renderHook(() => useActiveCompany(), {
      wrapper: wrap({ token: "host-1" }),
    });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(calls).toBe(0);
    expect(result.current.mode).toBe("b2c");
    expect(result.current.myCompanies).toEqual([]);
  });

  it("setActiveCompany rejects with the external-mode reason, not 'provider not mounted'", async () => {
    const { result } = renderHook(() => useActiveCompany(), {
      wrapper: wrap({ token: "host-1" }),
    });
    await expect(result.current.setActiveCompany("le-1")).rejects.toThrow(/customerSession/);
    await expect(result.current.setActiveCompany("le-1")).rejects.not.toThrow(/not mounted/);
  });

  it("the rotated token is what the next request sends", async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get("https://api.emporix.io/product/acme/products/p1", ({ request }) => {
        seen.push(request.headers.get("authorization"));
        return HttpResponse.json({ id: "p1" });
      }),
    );
    const storage = createMemoryStorage({ initial: "host-2" });
    const c = client();
    await c.products.get("p1", undefined, {
      kind: "customer",
      token: storage.getCustomerToken()!,
    });
    expect(seen).toEqual(["Bearer host-2"]);
  });
});

describe("EmporixProvider customerSession='owned' (default)", () => {
  it("does not clobber a live session token with a stale initial one", () => {
    const storage = createMemoryStorage({ initial: "live" });
    const c = client();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useEmporix(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <EmporixProvider
          client={c}
          queryClient={qc}
          storage={storage}
          initialCustomerToken="stale-ssr"
        >
          {children}
        </EmporixProvider>
      ),
    });
    expect(result.current.storage.getCustomerToken()).toBe("live");
  });
});
