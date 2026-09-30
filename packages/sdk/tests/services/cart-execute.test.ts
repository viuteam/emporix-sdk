import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CartService, type CartCommand, type CartItemInput } from "../../src/services/cart";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";
import { EmporixNotFoundError, EmporixServerError } from "../../src/core/errors";

/** `c/1` must reach the wire as `c%2F1`; a space would be encoded by `new URL` anyway. */
const EXECUTE = "https://api.emporix.io/cart/acme/carts/c%2F1/execute";
const ANON = { kind: "anonymous" } as const;

const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc(maxAttempts = 1) {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "cart" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts }, timeouts: { connectMs: 1000, readMs: 1000 },
    sleep: async () => {},
  });
  return new CartService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const item: CartItemInput = {
  itemYrn: "urn:yaas:saasag:caasproduct:product:acme;p1",
  quantity: 2,
  price: { priceId: "pr1", originalAmount: 10, effectiveAmount: 10, currency: "CHF" },
};
const addThenGet: CartCommand[] = [
  { type: "AddCartItem", data: item },
  { type: "GetCart", options: { expandCalculation: true } },
];
const added = { index: 0, type: "AddCartItem", code: 201, status: "Created", data: { itemId: "3", yrn: "y" } };

describe("CartService.execute", () => {
  it("POSTs { commands } to the encoded cart path and returns the 207 body", async () => {
    let url = "";
    let body: unknown;
    server.use(
      http.post(EXECUTE, async ({ request }) => {
        url = request.url;
        body = await request.json();
        return HttpResponse.json(
          { results: [added, { index: 1, type: "GetCart", code: 200, status: "OK", data: { id: "c/1", items: [] } }] },
          { status: 207 },
        );
      }),
    );
    const res = await svc().execute("c/1", addThenGet, ANON);
    expect(new URL(url).pathname).toBe("/cart/acme/carts/c%2F1/execute");
    expect(body).toEqual({ commands: addThenGet });
    expect(res.results.map((r) => r.code)).toEqual([201, 200]);
  });

  it("sends onError and versioning in the query string, never in the body, and omits them when unset", async () => {
    const seen: Array<[string | null, string | null, string[]]> = [];
    server.use(
      http.post(EXECUTE, async ({ request }) => {
        const q = new URL(request.url).searchParams;
        const b = (await request.json()) as Record<string, unknown>;
        seen.push([q.get("onError"), q.get("versioning"), Object.keys(b)]);
        return HttpResponse.json({ results: [] }, { status: 207 });
      }),
    );
    await svc().execute("c/1", addThenGet, ANON, { onError: "resume", versioning: "follow" });
    await svc().execute("c/1", addThenGet, ANON);
    expect(seen).toEqual([
      ["resume", "follow", ["commands"]],
      [null, null, ["commands"]],
    ]);
  });

  it("throws the failed command's REST error by default, naming its index and type", async () => {
    server.use(
      http.post(EXECUTE, () =>
        HttpResponse.json(
          {
            results: [
              added,
              {
                index: 1, type: "UpdateCartItem", code: 404, status: "Not Found",
                data: { code: 404, status: "Not Found", message: "Cart item not found in cart c/1 with code 9" },
              },
            ],
          },
          { status: 207 },
        ),
      ),
    );
    const err = await svc()
      .execute("c/1", [{ type: "AddCartItem", data: item }, { type: "UpdateCartItem", data: { quantity: 1 }, options: { itemId: "9" } }], ANON)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmporixNotFoundError);
    expect(err).toMatchObject({ status: 404, body: { message: "Cart item not found in cart c/1 with code 9" } });
    expect((err as Error).message).toContain("command 1 (UpdateCartItem)");
  });

  it("resolves with every result under onError resume, failed ones included", async () => {
    server.use(
      http.post(EXECUTE, () =>
        HttpResponse.json(
          {
            results: [
              { index: 0, type: "DeleteCartItem", code: 404, status: "Not Found", data: { code: 404, status: "Not Found", message: "gone" } },
              { index: 1, type: "GetCart", code: 200, status: "OK", data: { id: "c/1", items: [] } },
            ],
          },
          { status: 207 },
        ),
      ),
    );
    const res = await svc().execute(
      "c/1",
      [{ type: "DeleteCartItem", options: { itemId: "gone" } }, { type: "GetCart" }],
      ANON,
      { onError: "resume" },
    );
    expect(res.results.map((r) => r.code)).toEqual([404, 200]);
  });

  it("does not retry a 5xx: replaying the chain would apply its writes twice", async () => {
    let calls = 0;
    server.use(
      http.post(EXECUTE, () => {
        calls += 1;
        return HttpResponse.json({ message: "down" }, { status: 503 });
      }),
    );
    await expect(svc(3).execute("c/1", addThenGet, ANON)).rejects.toBeInstanceOf(EmporixServerError);
    expect(calls).toBe(1);
  });

  it("forwards a service token unguarded", async () => {
    let authorization: string | null = null;
    server.use(
      http.post(EXECUTE, ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json({ results: [] }, { status: 207 });
      }),
    );
    await svc().execute("c/1", addThenGet, { kind: "service" });
    expect(authorization).toBe("Bearer svc-tok");
  });
});
