import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useActiveSite, useSites } from "../src/hooks/use-sites";
import type { ReactNode } from "react";

const SITES = [
  {
    code: "main", name: "Main", active: true, default: true, defaultLanguage: "en",
    languages: ["en", "de"], currency: "EUR", availableCurrencies: ["EUR", "CHF"],
    homeBase: { address: { country: "DE", zipCode: "1" } }, shipToCountries: ["DE"],
  },
  {
    code: "ch", name: "CH", active: true, default: false, defaultLanguage: "de",
    languages: ["de"], currency: "CHF", availableCurrencies: ["CHF"],
    homeBase: { address: { country: "CH", zipCode: "1" } }, shipToCountries: ["CH"],
  },
];

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/site/acme/sites", () => HttpResponse.json(SITES)),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(initialSiteCode?: string) {
  const client = new EmporixClient({ tenant: "acme", credentials: { storefront: { clientId: "sf" } }, logger: false });
  const storage = createMemoryStorage();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider
      client={client}
      storage={storage}
      queryClient={queryClient}
      {...(initialSiteCode !== undefined ? { initialSiteCode } : {})}
    >
      {children}
    </EmporixProvider>
  );
}

describe("useActiveSite", () => {
  it("returns the site whose code matches the active siteCode", async () => {
    const { result } = renderHook(() => useActiveSite(), { wrapper: wrap("ch") });
    await waitFor(() => expect(result.current?.code).toBe("ch"));
    expect(result.current?.currency).toBe("CHF");
  });

  it("returns undefined when the active code has no matching site", async () => {
    const { result } = renderHook(() => ({ active: useActiveSite(), sites: useSites() }), {
      wrapper: wrap("does-not-exist"),
    });
    await waitFor(() => expect(result.current.sites.isSuccess).toBe(true));
    expect(result.current.active).toBeUndefined();
  });

  it("returns undefined when there is no active siteCode", () => {
    const { result } = renderHook(() => useActiveSite(), { wrapper: wrap() });
    expect(result.current).toBeUndefined();
  });
});
