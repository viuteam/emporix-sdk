import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useCompanyContacts } from "../src/hooks/use-company-contacts";
import { useCompanyLocations } from "../src/hooks/use-company-locations";
import { useCompanyGroups } from "../src/hooks/use-company-groups";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "anon-rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/customer-management/acme/contact-assignments", () =>
    HttpResponse.json([{ id: "ca-1", type: "CONTACT" }]),
  ),
  http.get("https://api.emporix.io/customer-management/acme/locations", () =>
    HttpResponse.json([{ id: "loc-1", name: "HQ", type: "HEADQUARTER" }]),
  ),
  http.get("https://api.emporix.io/iam/acme/groups", () =>
    HttpResponse.json([{ id: "grp-admin", role: "ADMIN", b2b: { legalEntityId: "le-1" } }]),
  ),
);
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage({ initial: "cust" })) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={new QueryClient()}>
      {children}
    </EmporixProvider>
  );
}

describe("useCompanyContacts / useCompanyLocations / useCompanyGroups", () => {
  it("useCompanyContacts fetches contacts for one company", async () => {
    const { result } = renderHook(() => useCompanyContacts("le-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.id).toBe("ca-1");
  });

  it("useCompanyLocations fetches locations for one company", async () => {
    const { result } = renderHook(() => useCompanyLocations("le-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.type).toBe("HEADQUARTER");
  });

  it("useCompanyGroups fetches IAM groups for one company", async () => {
    const { result } = renderHook(() => useCompanyGroups("le-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.role).toBe("ADMIN");
  });
});
