import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { QueryClient, dehydrate } from "@tanstack/react-query";
import { EmporixClient, auth } from "@viu/emporix-sdk";
import { prefetchProduct, prefetchOrder } from "../src/ssr";

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

describe("prefetchOrder", () => {
  it("prefetches the same cache key useOrder would read", async () => {
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-1", () =>
        HttpResponse.json({
          id: "o-1", orderNumber: "ORD-1", status: "CREATED",
          currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [],
        }),
      ),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    const qc = new QueryClient();
    await prefetchOrder(qc, client, "o-1", auth.customer("cust"));
    const cached = qc.getQueryData([
      "emporix",
      "orders",
      "o-1",
      { tenant: "acme", authKind: "customer" },
    ]);
    expect((cached as { orderNumber?: string } | undefined)?.orderNumber).toBe("ORD-1");
  });

  it("forwards opts.saasToken as the saas-token header", async () => {
    let saas: string | null = null;
    server.use(
      http.get("https://api.emporix.io/order-v2/acme/orders/o-2", ({ request }) => {
        saas = request.headers.get("saas-token");
        return HttpResponse.json({
          id: "o-2", orderNumber: "ORD-2", status: "CREATED",
          currency: "CHF", totalPrice: { amount: 10, currency: "CHF" }, items: [],
        });
      }),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    await prefetchOrder(new QueryClient(), client, "o-2", auth.customer("cust"), {
      saasToken: "saas-xyz",
    });
    expect(saas).toBe("saas-xyz");
  });
});
