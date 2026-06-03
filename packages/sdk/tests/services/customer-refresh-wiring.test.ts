import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { EmporixClient, auth } from "../../src";

let seenTokens: string[] = [];
const server = setupServer(
  mhttp.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc", token_type: "Bearer", expires_in: 3599 }),
  ),
  mhttp.get("https://api.emporix.io/customer/acme/me", ({ request }) => {
    const tok = request.headers.get("authorization");
    seenTokens.push(tok ?? "");
    if (tok === "Bearer OLD") return HttpResponse.json({ e: 1 }, { status: 401 });
    return HttpResponse.json({ id: "c1" });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  seenTokens = [];
});
afterAll(() => server.close());

function client() {
  return new EmporixClient({
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  } as never);
}

describe("EmporixClient customer-token refresher wiring", () => {
  it("exposes setCustomerTokenRefresher", () => {
    expect(typeof client().setCustomerTokenRefresher).toBe("function");
  });

  it("a registered refresher drives refresh-and-retry across services", async () => {
    const c = client();
    let calls = 0;
    c.setCustomerTokenRefresher({
      refresh: async () => {
        calls += 1;
        return "NEW";
      },
    });
    const me = (await c.customers.me(auth.customer("OLD"))) as { id?: string };
    expect(me.id).toBe("c1");
    expect(calls).toBe(1);
    expect(seenTokens).toEqual(["Bearer OLD", "Bearer NEW"]);
  });

  it("clearing the refresher restores throw-on-401", async () => {
    const c = client();
    c.setCustomerTokenRefresher({ refresh: async () => "NEW" });
    c.setCustomerTokenRefresher(null);
    await expect(c.customers.me(auth.customer("OLD"))).rejects.toThrow();
    expect(seenTokens).toEqual(["Bearer OLD"]);
  });
});
