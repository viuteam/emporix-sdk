import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { EmporixClient } from "../src";
import type { TokenProvider } from "../src/core/auth";

const tokenProvider: TokenProvider = {
  getToken: async () => "SVC",
  getAnonymousToken: async () => ({
    accessToken: "ANON",
    refreshToken: "r",
    sessionId: "s",
    expiresIn: 3599,
  }),
};

const seen: Record<string, string | null> = {};
const server = setupServer(
  mhttp.post("https://api.emporix.io/product/acme/product-templates", ({ request }) => {
    seen.write = request.headers.get("content-language");
    return HttpResponse.json({ id: "t1" }, { status: 201 });
  }),
  mhttp.get("https://api.emporix.io/product/acme/products/p1", ({ request }) => {
    seen.read = request.headers.get("content-language");
    return HttpResponse.json({ id: "p1" });
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  for (const k of Object.keys(seen)) delete seen[k];
});
afterAll(() => server.close());

describe("EmporixConfig.contentLanguage", () => {
  it("is sent on writes and not on reads", async () => {
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" } },
      tokenProvider,
      logger: false,
      contentLanguage: "*",
    });

    // Product templates have no per-call option, so the client default is the
    // only way their localized attribute names can be sent as maps.
    await client.products.templates.create({ name: { de: "Stuhl", en: "Chair" } } as never);
    await client.products.get("p1");

    expect(seen).toEqual({ write: "*", read: null });
  });
});
