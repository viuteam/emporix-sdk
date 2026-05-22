import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useSites, useDefaultSite } from "../src/hooks/use-sites";
import type { ReactNode } from "react";

const SITES = [
  {
    code: "ThermoBrand_DE",
    name: "ThermoBrand Germany",
    active: true,
    default: false,
    defaultLanguage: "de",
    languages: ["en", "de"],
    currency: "EUR",
    homeBase: { address: { country: "DE", zipCode: "12345" } },
    shipToCountries: ["DE"],
  },
  {
    code: "main",
    name: "Main",
    active: true,
    default: true,
    defaultLanguage: "de",
    languages: ["de"],
    currency: "CHF",
    homeBase: { address: { country: "CH", zipCode: "8000" } },
    shipToCountries: ["CH"],
  },
];

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
  http.get("https://api.emporix.io/site/acme/sites", () => HttpResponse.json(SITES)),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap() {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient}>
      {children}
    </EmporixProvider>
  );
}

describe("useSites", () => {
  it("returns the list of active sites", async () => {
    const { result } = renderHook(() => useSites(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((s) => s.code)).toEqual(["ThermoBrand_DE", "main"]);
  });
});

describe("useDefaultSite", () => {
  it("returns the site flagged default: true", async () => {
    const { result } = renderHook(() => useDefaultSite(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.code).toBe("main");
  });
});
