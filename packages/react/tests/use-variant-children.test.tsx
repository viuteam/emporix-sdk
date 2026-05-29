import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useVariantChildren } from "../src/hooks/use-variant-children";
import type { ReactNode } from "react";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s",
    }),
  ),
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

describe("useVariantChildren", () => {
  it("fetches the variant children for a parent id", async () => {
    let seenQ: string | null = null;
    server.use(
      http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
        seenQ = new URL(request.url).searchParams.get("q");
        return HttpResponse.json([{ id: "v1" }, { id: "v2" }]);
      }),
    );
    const { result } = renderHook(() => useVariantChildren("parent-1"), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenQ).toBe("productType:VARIANT parentVariantId:parent-1");
    expect(result.current.data?.map((p) => p.id)).toEqual(["v1", "v2"]);
  });

  it("is disabled when parentVariantId is undefined", () => {
    const { result } = renderHook(() => useVariantChildren(undefined), { wrapper: wrap() });
    expect(result.current.fetchStatus).toBe("idle");
  });
});
