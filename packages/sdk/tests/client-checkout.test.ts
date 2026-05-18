import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { EmporixClient } from "../src/client";

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/checkout/acme/checkouts/order", () =>
    HttpResponse.json({ orderId: "EON9", paymentDetails: null, checkoutId: null }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("EmporixClient checkout/payments", () => {
  it("exposes checkout + payments and runs a checkout", async () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.payments).toBeDefined();
    const r = await sdk.checkout.placeOrder(
      {
        cartId: "c1",
        customer: { email: "a@b.co", id: "x" },
        shipping: { methodId: "m", zoneId: "z", methodName: "DHL", amount: 0 },
        addresses: [
          { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "SHIPPING" },
          { contactName: "A", street: "S", zipCode: "1", city: "B", country: "DE", type: "BILLING" },
        ],
        paymentMethods: [{ provider: "none" }],
      },
      { kind: "customer", token: "CUST" },
      { saasToken: "SAAS" },
    );
    expect(r.orderId).toBe("EON9");
  });
});
