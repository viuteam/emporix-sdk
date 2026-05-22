import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, act } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useSiteContext } from "../src/hooks/use-site-context";
import type { EmporixStorage } from "../src/storage";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon",
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "rt",
      sessionId: "s",
    }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeClient(staticSite?: string) {
  return new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: {
        clientId: "sf",
        ...(staticSite ? { context: { siteCode: staticSite } } : {}),
      },
    },
    logger: false,
  });
}

function wrap(
  opts: {
    storage?: EmporixStorage;
    initialSiteCode?: string;
    staticSite?: string;
  } = {},
) {
  const client = makeClient(opts.staticSite);
  const storage = opts.storage ?? createMemoryStorage();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={client}
      storage={storage}
      queryClient={queryClient}
      {...(opts.initialSiteCode !== undefined ? { initialSiteCode: opts.initialSiteCode } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("useSiteContext — initial-state resolution", () => {
  it("uses initialSiteCode prop when provided", () => {
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ initialSiteCode: "ThermoBrand_DE", staticSite: "main" }),
    });
    expect(result.current.siteCode).toBe("ThermoBrand_DE");
  });

  it("falls back to storage.getSiteCode() when no prop", () => {
    const storage = createMemoryStorage();
    storage.setSiteCode("WarmTech_DE");
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ storage, staticSite: "main" }),
    });
    expect(result.current.siteCode).toBe("WarmTech_DE");
  });

  it("falls back to client.config.storefront.context.siteCode when storage is empty", () => {
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ staticSite: "main" }),
    });
    expect(result.current.siteCode).toBe("main");
  });

  it("falls back to null when nothing is configured", () => {
    const { result } = renderHook(() => useSiteContext(), { wrapper: wrap() });
    expect(result.current.siteCode).toBeNull();
  });

  it("currency and targetLocation are null in MS-2 (populated in MS-4)", () => {
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ initialSiteCode: "X" }),
    });
    expect(result.current.currency).toBeNull();
    expect(result.current.targetLocation).toBeNull();
  });
});

describe("useSiteContext — setSite", () => {
  it("updates state + storage", () => {
    const storage = createMemoryStorage();
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ storage }),
    });
    act(() => {
      result.current.setSite("ThermoBrand_DE");
    });
    expect(result.current.siteCode).toBe("ThermoBrand_DE");
    expect(storage.getSiteCode()).toBe("ThermoBrand_DE");
  });

  it("clears storage.cartId on site switch (carts are site-aware)", () => {
    const storage = createMemoryStorage();
    storage.setCartId("old-cart-on-old-site");
    storage.setSiteCode("old-site");
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ storage }),
    });
    act(() => {
      result.current.setSite("new-site");
    });
    expect(storage.getCartId()).toBeNull();
  });

  it("setSite(null) clears the active site", () => {
    const storage = createMemoryStorage();
    storage.setSiteCode("X");
    const { result } = renderHook(() => useSiteContext(), {
      wrapper: wrap({ storage }),
    });
    act(() => {
      result.current.setSite(null);
    });
    expect(result.current.siteCode).toBeNull();
    expect(storage.getSiteCode()).toBeNull();
  });
});
