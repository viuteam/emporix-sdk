import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import {
  EmporixAuthError,
  EmporixClient,
  EmporixError,
  HttpClient,
  auth,
  createNoopLogger,
  createProxyModeTokenProvider,
  type EmporixConfig,
  type EmporixUnauthorizedInfo,
} from "../src/index";

const ORIGIN = "http://shop.test";
const BASE = `${ORIGIN}/emporix`;

/** Every request the proxy saw, with the headers that matter here. */
const seen: { url: string; authorization: string | null; csrf: string | null; tenant: string | null; language: string | null }[] = [];
/** Token endpoints, on both hosts: proxy mode must never reach either. */
let tokenCalls = 0;

const server = setupServer(
  http.all("*/customerlogin/auth/anonymous/*", () => {
    tokenCalls++;
    return HttpResponse.json({ access_token: "anon", refresh_token: "rt", sessionId: "s", expires_in: 3599 });
  }),
  http.post("*/oauth/token", () => {
    tokenCalls++;
    return HttpResponse.json({ access_token: "svc", expires_in: 3599 });
  }),
  http.all(`${BASE}/*`, ({ request }) => {
    seen.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      csrf: request.headers.get("x-csrf"),
      tenant: request.headers.get("emporix-tenant"),
      language: request.headers.get("accept-language"),
    });
    if (request.url.includes("/agentic/chat-stream")) {
      return new HttpResponse("data: one\n\ndata: two\n\n", {
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    if (request.url.includes("/download")) {
      return new HttpResponse("bytes", { headers: { "Content-Type": "application/octet-stream" } });
    }
    return HttpResponse.json({ id: "p1" });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => {
  seen.length = 0;
  tokenCalls = 0;
  vi.stubGlobal("location", { origin: ORIGIN });
});
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
afterAll(() => server.close());

function proxyClient(proxy: EmporixConfig["proxy"] = { headers: { "X-CSRF": "1" } }) {
  return new EmporixClient({
    tenant: "acme",
    host: "/emporix",
    credentials: {},
    logger: false,
    retry: { maxAttempts: 3 },
    proxy,
  });
}

/** Answer every proxied request with this status. */
function proxyAnswers(status: number) {
  server.use(http.all(`${BASE}/*`, () => HttpResponse.json({ message: "no session" }, { status })));
}

describe("proxy mode", () => {
  it("sends no Authorization, but the proxy headers, tenant and language, to the relative host", async () => {
    const client = proxyClient();
    client.setStorefrontContext({ language: "de" });

    await client.products.get("p1", undefined, auth.anonymous());
    await client.products.get("p1", undefined, auth.customer("must-not-leave-the-browser"));

    expect(seen).toHaveLength(2);
    for (const r of seen) {
      expect(r.url.startsWith(`${BASE}/product/acme/products/p1`)).toBe(true);
      expect(r.authorization).toBeNull();
      expect(r.csrf).toBe("1");
      expect(r.tenant).toBe("acme");
      expect(r.language).toBe("de");
    }
  });

  it("requests no token: neither anonymous login nor client credentials, and the provider refuses", async () => {
    const client = proxyClient();

    await client.products.get("p1", undefined, auth.anonymous());
    await client.carts.getCurrent(auth.customer("x"), { siteCode: "main" }).catch(() => undefined);

    expect(tokenCalls).toBe(0);
    await expect(client.customers.anonymous()).rejects.toBeInstanceOf(EmporixAuthError);
    expect(tokenCalls).toBe(0);
  });

  it("rejects auth.service() before any request is made", async () => {
    const client = proxyClient();

    await expect(client.products.get("p1", undefined, auth.service())).rejects.toThrow(
      /auth\.service\(\) is not available in proxy mode/,
    );
    expect(seen).toHaveLength(0);
    expect(tokenCalls).toBe(0);
  });

  it("sends credentials same-origin by default, and the configured value when set", async () => {
    const spy = vi.spyOn(globalThis, "fetch");

    await proxyClient().products.get("p1", undefined, auth.anonymous());
    await proxyClient({ credentials: "include" }).products.get("p1", undefined, auth.anonymous());

    expect(spy.mock.calls.map((c) => c[1]?.credentials)).toEqual(["same-origin", "include"]);
  });

  it("on a 401 calls onUnauthorized and every client listener once, then throws, without a retry", async () => {
    proxyAnswers(401);
    const fromConfig: EmporixUnauthorizedInfo[] = [];
    const fromListener: EmporixUnauthorizedInfo[] = [];
    const client = proxyClient({ headers: { "X-CSRF": "1" }, onUnauthorized: (i) => fromConfig.push(i) });
    client.onUnauthorized((i) => fromListener.push(i));
    const spy = vi.spyOn(globalThis, "fetch");

    // anonymous: outside proxy mode this 401 would re-authenticate and retry.
    await expect(client.products.get("p1", undefined, auth.anonymous())).rejects.toBeInstanceOf(
      EmporixAuthError,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(fromConfig).toEqual([{ method: "GET", path: "/product/acme/products/p1" }]);
    expect(fromListener).toEqual(fromConfig);
    expect(tokenCalls).toBe(0);
  });

  it("does not consult a registered customer-token refresher on a 401", async () => {
    proxyAnswers(401);
    const client = proxyClient();
    const refresh = vi.fn(async () => "fresh");
    client.setCustomerTokenRefresher({ refresh });

    await expect(client.products.get("p1", undefined, auth.customer("x"))).rejects.toBeInstanceOf(
      EmporixAuthError,
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  it("still throws the EmporixAuthError when onUnauthorized throws, and still notifies listeners", async () => {
    proxyAnswers(401);
    const listener = vi.fn();
    const client = proxyClient({
      onUnauthorized: () => {
        throw new Error("redirect failed");
      },
    });
    client.onUnauthorized(listener);

    await expect(client.products.get("p1", undefined, auth.anonymous())).rejects.toBeInstanceOf(
      EmporixAuthError,
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not report other statuses as unauthorized", async () => {
    proxyAnswers(403);
    const onUnauthorized = vi.fn();
    const client = proxyClient({ onUnauthorized });

    await expect(client.products.get("p1", undefined, auth.anonymous())).rejects.toBeInstanceOf(
      EmporixError,
    );
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  describe("requestRaw", () => {
    it("sends no Authorization but the proxy headers and credentials", async () => {
      const spy = vi.spyOn(globalThis, "fetch");

      const result = await proxyClient().media.download("a1", auth.customer("x"));

      expect(result.kind).toBe("bytes");
      expect(seen).toHaveLength(1);
      expect(seen[0]!.authorization).toBeNull();
      expect(seen[0]!.csrf).toBe("1");
      expect(spy.mock.calls[0]![1]?.credentials).toBe("same-origin");
    });

    it("maps a 401 to onUnauthorized and an EmporixAuthError", async () => {
      proxyAnswers(401);
      const onUnauthorized = vi.fn();

      await expect(
        proxyClient({ onUnauthorized }).media.download("a1", auth.anonymous()),
      ).rejects.toBeInstanceOf(EmporixAuthError);
      expect(onUnauthorized).toHaveBeenCalledWith({
        method: "GET",
        path: "/media/acme/assets/a1/download",
      });
    });
  });

  describe("requestStream", () => {
    it("sends no Authorization but the proxy headers and credentials", async () => {
      const spy = vi.spyOn(globalThis, "fetch");
      const chunks: string[] = [];

      for await (const c of proxyClient().ai.chatStream({ agentId: "a", message: "hi" } as never, {}, auth.customer("x"))) {
        chunks.push(c);
      }

      expect(chunks).toEqual(["one", "two"]);
      expect(seen[0]!.authorization).toBeNull();
      expect(seen[0]!.csrf).toBe("1");
      expect(spy.mock.calls[0]![1]?.credentials).toBe("same-origin");
    });

    it("maps a 401 to onUnauthorized and an EmporixAuthError", async () => {
      proxyAnswers(401);
      const onUnauthorized = vi.fn();
      const stream = proxyClient({ onUnauthorized }).ai.chatStream(
        { agentId: "a", message: "hi" } as never,
        {},
        auth.anonymous(),
      );

      await expect(async () => {
        for await (const _ of stream) {
          /* drain */
        }
      }).rejects.toBeInstanceOf(EmporixAuthError);
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    });
  });

  it("drops an Authorization header a caller passes in per request", async () => {
    const http = new HttpClient({
      host: "/emporix",
      provider: createProxyModeTokenProvider(),
      logger: createNoopLogger(),
      retry: { maxAttempts: 1 },
      timeouts: { connectMs: 1000, readMs: 1000 },
      proxy: { headers: { "X-CSRF": "1" }, credentials: "same-origin", onUnauthorized: undefined },
    });

    await http.request({
      method: "GET",
      path: "/product/acme/products/p1",
      auth: auth.anonymous(),
      headers: { authorization: "Bearer leaked", AUTHORIZATION: "Bearer leaked" },
    });

    expect(seen[0]!.authorization).toBeNull();
    expect(seen[0]!.csrf).toBe("1");
  });

  it("explains a relative host without a page origin", async () => {
    vi.stubGlobal("location", undefined);

    await expect(proxyClient().products.get("p1", undefined, auth.anonymous())).rejects.toThrow(
      /globalThis\.location is not available/,
    );
  });

  it("accepts empty credentials and refuses a token provider or service credentials", () => {
    expect(() => proxyClient()).not.toThrow();
    const base = { tenant: "acme", host: "/emporix", logger: false as const, proxy: {} };
    expect(
      () =>
        new EmporixClient({
          ...base,
          credentials: {},
          tokenProvider: { getToken: async () => "t", getAnonymousToken: async () => ({}) as never },
        }),
    ).toThrow(/mutually exclusive/);
    expect(
      () => new EmporixClient({ ...base, credentials: { backend: { clientId: "c", secret: "s" } } }),
    ).toThrow(/cannot be used in proxy mode/);
  });
});

describe("without proxy mode", () => {
  it("keeps the Authorization header and sends no credentials option", async () => {
    server.use(
      http.get("https://api.emporix.io/product/acme/products/p1", ({ request }) =>
        HttpResponse.json({ authorization: request.headers.get("authorization") }),
      ),
    );
    const spy = vi.spyOn(globalThis, "fetch");
    const client = new EmporixClient({ tenant: "acme", credentials: {}, logger: false });

    const res = (await client.products.get("p1", undefined, auth.customer("cust"))) as unknown as {
      authorization: string;
    };

    expect(res.authorization).toBe("Bearer cust");
    expect(spy.mock.calls[0]![1]).not.toHaveProperty("credentials");
    expect(client.config.proxy).toBeUndefined();
  });
});
