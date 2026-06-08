import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http as mhttp, HttpResponse } from "msw";
import { EmporixClient, auth } from "../src";
import type { TokenProvider } from "../src/core/auth";

function makeProvider(setAnonymousContext = vi.fn()): TokenProvider {
  return {
    getToken: async () => "SVC",
    getAnonymousToken: async () => ({
      accessToken: "ANON",
      refreshToken: "r",
      sessionId: "s",
      expiresIn: 3599,
    }),
    setAnonymousContext,
  } as unknown as TokenProvider;
}

let acceptLanguage: string | null = null;
const server = setupServer(
  mhttp.get("https://api.emporix.io/site/acme/sites", ({ request }) => {
    acceptLanguage = request.headers.get("accept-language");
    return HttpResponse.json([]);
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  acceptLanguage = null;
});
afterAll(() => server.close());

function makeClient(tokenProvider: TokenProvider) {
  return new EmporixClient({
    tenant: "acme",
    credentials: {
      backend: { clientId: "b", secret: "s" },
      storefront: { clientId: "sf" },
    },
    tokenProvider,
    logger: false,
  });
}

describe("EmporixClient.setStorefrontContext language", () => {
  it("sends Accept-Language on a service call after setStorefrontContext({ language })", async () => {
    const client = makeClient(makeProvider());
    client.setStorefrontContext({ language: "de" });
    await client.sites.list(auth.anonymous());
    expect(acceptLanguage).toBe("de");
  });

  it("a language-only change does NOT re-mint the anonymous token", async () => {
    const setAnonymousContext = vi.fn();
    const client = makeClient(makeProvider(setAnonymousContext));
    client.setStorefrontContext({ language: "de" });
    expect(setAnonymousContext).not.toHaveBeenCalled();
  });

  it("a currency change still re-mints (setAnonymousContext called without language)", async () => {
    const setAnonymousContext = vi.fn();
    const client = makeClient(makeProvider(setAnonymousContext));
    client.setStorefrontContext({ currency: "USD" });
    expect(setAnonymousContext).toHaveBeenCalledWith({ currency: "USD" });
  });
});
