import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { EmporixClient, auth } from "@viu/emporix-sdk";
import { prefetchProduct } from "../src/ssr";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.get("https://api.emporix.io/product/acme/products/p1", () =>
    HttpResponse.json({ id: "p1", name: "Widget" }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("ssr", () => {
  it("prefetchProduct fills a QueryClient that dehydrates", async () => {
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    const qc = new QueryClient();
    await prefetchProduct(qc, client, "p1", auth.anonymous());
    const state = dehydrate(qc);
    expect(JSON.stringify(state)).toContain("Widget");
  });
});
