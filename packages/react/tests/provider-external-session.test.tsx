import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider, useEmporix } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveCompany } from "../src/company-context";
import { useCustomerToken } from "../src/hooks/internal/use-storage-snapshot";
import { useEmporixQuery } from "../src/hooks/internal/use-emporix-query";
import { useCustomerSession } from "../src/hooks/use-customer-session";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function client(tenant = "acme"): EmporixClient {
  // No credentials at all: a host-owned token needs none. validateConfig only
  // requires the object to exist, and DefaultTokenProvider checks lazily.
  return new EmporixClient({ tenant, credentials: {}, logger: false });
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

  it("a rotated token reaches its readers without updating them while the provider renders", () => {
    const c = client();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const storage = createMemoryStorage();
    const seen: (string | null)[] = [];
    function RotationReader() {
      const token = useCustomerToken();
      seen.push(token);
      return <span>{token}</span>;
    }
    const Harness = ({ token }: { token: string }) => (
      <EmporixProvider
        client={c}
        queryClient={qc}
        storage={storage}
        customerSession="external"
        initialCustomerToken={token}
      >
        <RotationReader />
      </EmporixProvider>
    );

    // React logs this warning once per rendering component per module, and the
    // rendering component is always EmporixProvider: an earlier test in this
    // file that triggered it would hide it from this one.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<Harness token="host-1" />);
    rerender(<Harness token="host-2" />);
    const messages = errorSpy.mock.calls.map((args) => args.map(String).join(" "));
    errorSpy.mockRestore();

    // The first render already has the token: no anonymous first pass.
    expect(seen[0]).toBe("host-1");
    expect(seen.at(-1)).toBe("host-2");
    expect(messages.filter((m) => m.includes("Cannot update a component"))).toEqual([]);
  });

  it("a token that changes with the tenant is what the new tenant's first requests send", async () => {
    const sent: string[] = [];
    server.use(
      http.get("https://api.emporix.io/product/:tenant/products/p1", ({ request, params }) => {
        sent.push(`product ${String(params.tenant)} ${request.headers.get("authorization")}`);
        return HttpResponse.json({ id: "p1" });
      }),
      http.get("https://api.emporix.io/customer/:tenant/me", ({ request, params }) => {
        sent.push(`me ${String(params.tenant)} ${request.headers.get("authorization")}`);
        return HttpResponse.json({ id: "c1" });
      }),
    );
    const clients = { acme: client("acme"), other: client("other") };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const storage = createMemoryStorage();
    // Both render-time token readers: the read-hook factory and the session hook.
    function TenantReader() {
      const { client: c } = useEmporix();
      useEmporixQuery({
        mode: "customer",
        site: "none",
        resource: "product",
        args: ["p1"] as const,
        queryFn: (ctx) => c.products.get("p1", undefined, ctx),
      });
      useCustomerSession();
      return null;
    }
    // A dashboard host switches tenants by re-rendering the module with a new
    // appState: the client and the token change in the same render, and the
    // tenant in every query key makes that render fetch.
    const Harness = ({ tenant, token }: { tenant: keyof typeof clients; token: string }) => (
      <EmporixProvider
        client={clients[tenant]}
        queryClient={qc}
        storage={storage}
        customerSession="external"
        initialCustomerToken={token}
      >
        <TenantReader />
      </EmporixProvider>
    );

    const { rerender } = render(<Harness tenant="acme" token="acme-1" />);
    await waitFor(() => expect(sent).toHaveLength(2));
    rerender(<Harness tenant="other" token="other-1" />);
    await waitFor(() => expect(sent).toHaveLength(4));
    expect([...sent].sort()).toEqual([
      "me acme Bearer acme-1",
      "me other Bearer other-1",
      "product acme Bearer acme-1",
      "product other Bearer other-1",
    ]);
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

  it("reports a 401 through onCustomerSessionExpired and issues no refresh request", async () => {
    let expired = 0;
    let refreshCalls = 0;
    server.use(
      http.get("https://api.emporix.io/product/acme/products/p1", () =>
        HttpResponse.json({ message: "expired" }, { status: 401 }),
      ),
      // customers.refresh is a GET on /customer/{tenant}/refreshauthtoken
      // (packages/sdk/src/services/customer.ts:160) — not a POST.
      http.get("https://api.emporix.io/customer/acme/refreshauthtoken", () => {
        refreshCalls += 1;
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    const c = client();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const storage = createMemoryStorage();
    // A refresh token IS present — the point is that external mode ignores it.
    storage.setRefreshToken("rt-1");

    render(
      <EmporixProvider
        client={c}
        queryClient={qc}
        storage={storage}
        customerSession="external"
        initialCustomerToken="host-1"
        onCustomerSessionExpired={() => {
          expired += 1;
        }}
      >
        <span>mounted</span>
      </EmporixProvider>,
    );

    await expect(
      c.products.get("p1", undefined, { kind: "customer", token: "host-1" }),
    ).rejects.toThrow();
    await waitFor(() => expect(expired).toBe(1));
    expect(refreshCalls).toBe(0);
  });

  it("warns when autoRefreshCustomerToken is combined with external mode", () => {
    const warnings: unknown[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args) => {
      warnings.push(args[0]);
    });
    const c = client();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <EmporixProvider
        client={c}
        queryClient={qc}
        customerSession="external"
        initialCustomerToken="host-1"
        autoRefreshCustomerToken
      >
        <span>mounted</span>
      </EmporixProvider>,
    );
    expect(warnings.some((w) => String(w).includes("autoRefreshCustomerToken is ignored"))).toBe(
      true,
    );
    spy.mockRestore();
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

  it("seeds an empty slot before the children's first render", () => {
    server.use(
      http.get("https://api.emporix.io/customer-management/acme/legal-entities", () =>
        HttpResponse.json([]),
      ),
    );
    const seen: (string | null)[] = [];
    function OwnedSeedReader() {
      seen.push(useCustomerToken());
      return null;
    }
    render(
      <EmporixProvider
        client={client()}
        queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        storage={createMemoryStorage()}
        initialCustomerToken="ssr-1"
      >
        <OwnedSeedReader />
      </EmporixProvider>,
    );
    // The first render, not just eventually: one without the token would key
    // and fetch every read anonymously.
    expect(seen[0]).toBe("ssr-1");
  });
});
