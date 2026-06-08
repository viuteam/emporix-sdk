import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixClient } from "@viu/emporix-sdk";
import { EmporixProvider } from "../src/provider";
import { createMemoryStorage } from "../src/storage/memory";
import { useProducts } from "../src/hooks/use-products";
import type { ReactNode } from "react";

const seenLanguages: string[] = [];
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({ access_token: "anon", token_type: "Bearer", expires_in: 3599, refresh_token: "rt", sessionId: "s" }),
  ),
  http.get("https://api.emporix.io/product/acme/products", ({ request }) => {
    const lang = request.headers.get("accept-language");
    if (lang) seenLanguages.push(lang);
    return HttpResponse.json([], { headers: { "X-Total-Count": "0" } });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenLanguages.length = 0;
});
afterAll(() => server.close());

function wrapper(initialLanguage: string) {
  const client = new EmporixClient({
    tenant: "acme",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <EmporixProvider client={client} storage={createMemoryStorage()} queryClient={queryClient} initialLanguage={initialLanguage}>
      {children}
    </EmporixProvider>
  );
}

describe("language reaches localized product reads", () => {
  it("sends the active language as Accept-Language", async () => {
    const { result } = renderHook(() => useProducts(), { wrapper: wrapper("de") });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(seenLanguages).toContain("de");
  });
});
