import { describe, it, expect, vi, afterEach } from "vitest";
import { EmporixClient, auth } from "../src/index";
import type { AnonymousSession, TokenProvider } from "../src/core/auth";

/** A fetch double that records calls and answers with JSON. */
function recordingFetch(body: unknown = { id: "p1" }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl: typeof globalThis.fetch = (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { calls, impl };
}

/**
 * Minimal TokenProvider: only `getToken` and `getAnonymousToken` are required by
 * the interface. Used to keep token traffic out of the assertions.
 */
const stubProvider: TokenProvider = {
  getToken: () => Promise.resolve("svc"),
  getAnonymousToken: (): Promise<AnonymousSession> =>
    Promise.resolve({
      accessToken: "anon",
      refreshToken: "rt",
      sessionId: "s",
      expiresIn: 3599,
    }),
};

afterEach(() => vi.restoreAllMocks());

describe("EmporixConfig.fetch", () => {
  it("routes API requests through the injected fetch", async () => {
    const { calls, impl } = recordingFetch();
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
      tokenProvider: stubProvider,
      fetch: impl,
    });

    const product = await client.products.get("p1", undefined, auth.anonymous());

    expect(product).toEqual({ id: "p1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/product/acme/products/p1");
    expect(calls[0]!.init?.method).toBe("GET");
  });

  it("does NOT route token requests through the injected fetch", async () => {
    // Real DefaultTokenProvider this time, so an anonymous login actually fires.
    const globalSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "anon",
          token_type: "Bearer",
          expires_in: 3599,
          refresh_token: "rt",
          sessionId: "s",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const { calls, impl } = recordingFetch();
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
      fetch: impl,
    });

    await client.products.get("p1", undefined, auth.anonymous());

    // The anonymous login went to the global fetch...
    expect(
      globalSpy.mock.calls.filter((c) =>
        String(c[0]).includes("/customerlogin/auth/anonymous/login"),
      ),
    ).toHaveLength(1);
    // ...and never to the injected one.
    expect(calls.some((c) => c.url.includes("/customerlogin/"))).toBe(false);
    // The product request did go to the injected one.
    expect(calls.some((c) => c.url.includes("/product/acme/products/p1"))).toBe(true);
  });

  it("falls back to the global fetch when no fetch is configured", async () => {
    const globalSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const client = new EmporixClient({
      tenant: "acme",
      credentials: { storefront: { clientId: "sf" } },
      logger: false,
      tokenProvider: stubProvider,
    });

    await client.products.get("p1", undefined, auth.anonymous());

    expect(
      globalSpy.mock.calls.some((c) => String(c[0]).includes("/product/acme/products/p1")),
    ).toBe(true);
  });
});
