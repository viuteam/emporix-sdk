import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useShippingZones } from "../src/hooks/use-shipping";
import type { ReactNode } from "react";

const ZONES = [
  {
    id: "switzerland",
    default: true,
    name: { en: "Switzerland" },
    shipTo: [{ country: "CH" }],
    methods: [
      {
        id: "standard",
        name: { en: "Standard" },
        active: true,
        fees: [{ cost: { currency: "CHF", amount: 9.9 }, minOrderValue: { currency: "CHF", amount: 0 } }],
      },
    ],
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
  http.get("https://api.emporix.io/shipping/acme/main/zones", () => HttpResponse.json(ZONES)),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function wrap(storage = createMemoryStorage()) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { storefront: { clientId: "sf" } },
    logger: false,
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={storage} queryClient={qc}>
      {children}
    </EmporixProvider>
  );
}

describe("useShippingZones", () => {
  it("lists shipping zones with methods for a guest (anonymous) session", async () => {
    const { result } = renderHook(() => useShippingZones({ site: "main" }), {
      wrapper: wrap(createMemoryStorage()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.id).toBe("switzerland");
    expect(result.current.data?.[0]?.methods?.[0]?.id).toBe("standard");
  });

  it("lists shipping zones for a logged-in customer", async () => {
    const { result } = renderHook(() => useShippingZones({ site: "main" }), {
      wrapper: wrap(createMemoryStorage({ initial: "cust" })),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.id).toBe("switzerland");
  });
});
