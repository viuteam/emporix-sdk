import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { PriceService } from "../../src/services/price";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { MemoryLogger } from "../helpers/memory-logger";

let captured: { auth: string | null; body: unknown } | null = null;
const server = setupServer(
  http.get("https://api.emporix.io/customerlogin/auth/anonymous/login", () =>
    HttpResponse.json({
      access_token: "anon-tok", token_type: "Bearer", expires_in: 3599,
      refresh_token: "rt", sessionId: "s",
    }),
  ),
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
  http.post("https://api.emporix.io/price/acme/match-prices-by-context", async ({ request }) => {
    captured = { auth: request.headers.get("authorization"), body: await request.json() };
    return HttpResponse.json([
      { priceId: "pr1", effectiveValue: 9.9, totalValue: 19.8, includesTax: true },
    ]);
  }),
  http.post("https://api.emporix.io/price/acme/match-prices", async ({ request }) => {
    captured = { auth: request.headers.get("authorization"), body: await request.json() };
    return HttpResponse.json([{ priceId: "pr2", effectiveValue: 5 }]);
  }),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  captured = null;
});
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "price" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new PriceService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

describe("PriceService.matchByContext", () => {
  it("POSTs items only, defaults to the anonymous token, returns the match array", async () => {
    const res = await svc().matchByContext({
      items: [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 2 } }],
    });
    expect(captured?.auth).toBe("Bearer anon-tok");
    expect(captured?.body).toEqual({
      items: [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 2 } }],
    });
    expect(res[0]?.effectiveValue).toBe(9.9);
  });

  it("uses a customer token when given a customer AuthContext", async () => {
    await svc().matchByContext(
      { items: [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 1 } }] },
      { kind: "customer", token: "cust-tok" },
    );
    expect(captured?.auth).toBe("Bearer cust-tok");
  });
});

describe("PriceService.match", () => {
  it("POSTs explicit context, defaults to the service token", async () => {
    const res = await svc().match({
      targetCurrency: "CHF",
      siteCode: "main",
      targetLocation: { countryCode: "CH" },
      items: [{ itemId: { itemType: "PRODUCT", id: "p1" }, quantity: { quantity: 1 } }],
    });
    expect(captured?.auth).toBe("Bearer svc-tok");
    expect(captured?.body).toMatchObject({ targetCurrency: "CHF", siteCode: "main" });
    expect(res[0]?.priceId).toBe("pr2");
  });
});

describe("PriceService.matchByContextChunked", () => {
  const mkInput = (n: number) => ({
    items: Array.from({ length: n }, (_, i) => ({
      itemId: { itemType: "PRODUCT", id: `p${i}` },
      quantity: { quantity: 1 },
    })),
  });

  // Echoes one MatchResponse per received item, keyed by itemRef.id.
  const echoHandler = (onRequest?: () => void) =>
    http.post(
      "https://api.emporix.io/price/acme/match-prices-by-context",
      async ({ request }) => {
        onRequest?.();
        const body = (await request.json()) as {
          items?: { itemId?: { id?: string } }[];
        };
        const items = body.items ?? [];
        return HttpResponse.json(
          items.map((it) => ({
            priceId: `pr-${it.itemId?.id}`,
            itemRef: { itemType: "PRODUCT", id: it.itemId?.id },
            effectiveValue: 1,
          })),
        );
      },
    );

  it("splits 150 items into 3 requests at chunkSize 50 and returns every item", async () => {
    let posts = 0;
    server.use(echoHandler(() => { posts += 1; }));
    const res = await svc().matchByContextChunked(mkInput(150), { chunkSize: 50 });
    expect(posts).toBe(3);
    expect(res).toHaveLength(150);
    expect(new Set(res.map((r) => r.itemRef?.id)).size).toBe(150);
  });

  it("makes one request per item at chunkSize 1", async () => {
    let posts = 0;
    server.use(echoHandler(() => { posts += 1; }));
    const res = await svc().matchByContextChunked(mkInput(5), { chunkSize: 1 });
    expect(posts).toBe(5);
    expect(res).toHaveLength(5);
  });

  it("returns an empty array without any request when items is empty", async () => {
    let posts = 0;
    server.use(echoHandler(() => { posts += 1; }));
    const res = await svc().matchByContextChunked({ items: [] });
    expect(res).toEqual([]);
    expect(posts).toBe(0);
  });

  it("keeps successful chunks and calls onChunkError once when a chunk 500s", async () => {
    // chunkSize 1 over [p0, BAD, p2] → 3 chunks; the BAD chunk 500s.
    server.use(
      http.post(
        "https://api.emporix.io/price/acme/match-prices-by-context",
        async ({ request }) => {
          const body = (await request.json()) as { items?: { itemId?: { id?: string } }[] };
          const id = body.items?.[0]?.itemId?.id;
          if (id === "BAD") return HttpResponse.json({ code: 500 }, { status: 500 });
          return HttpResponse.json([{ priceId: `pr-${id}`, itemRef: { id }, effectiveValue: 1 }]);
        },
      ),
    );
    const input = {
      items: ["p0", "BAD", "p2"].map((id) => ({
        itemId: { itemType: "PRODUCT", id },
        quantity: { quantity: 1 },
      })),
    };
    const errors: number[] = [];
    const res = await svc().matchByContextChunked(input, {
      chunkSize: 1,
      onChunkError: (_err, idx) => errors.push(idx),
    });
    expect(res.map((r) => r.itemRef?.id).sort()).toEqual(["p0", "p2"]);
    expect(errors).toEqual([1]); // the BAD chunk is index 1
  });

  it("throws on the first chunk failure when throwOnAnyChunkError is set", async () => {
    server.use(
      http.post("https://api.emporix.io/price/acme/match-prices-by-context", async ({ request }) => {
        const body = (await request.json()) as { items?: { itemId?: { id?: string } }[] };
        if (body.items?.[0]?.itemId?.id === "BAD") return HttpResponse.json({ code: 500 }, { status: 500 });
        return HttpResponse.json([]);
      }),
    );
    const input = {
      items: ["p0", "BAD"].map((id) => ({ itemId: { itemType: "PRODUCT", id }, quantity: { quantity: 1 } })),
    };
    await expect(
      svc().matchByContextChunked(input, { chunkSize: 1, throwOnAnyChunkError: true }),
    ).rejects.toBeTruthy();
  });

  it("never runs more than `concurrency` requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    server.use(
      http.post("https://api.emporix.io/price/acme/match-prices-by-context", async ({ request }) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 15));
        const body = (await request.json()) as { items?: { itemId?: { id?: string } }[] };
        inFlight -= 1;
        return HttpResponse.json(
          (body.items ?? []).map((it) => ({ priceId: `pr-${it.itemId?.id}`, itemRef: { id: it.itemId?.id }, effectiveValue: 1 })),
        );
      }),
    );
    await svc().matchByContextChunked(mkInput(8), { chunkSize: 1, concurrency: 2 });
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("validates chunkSize and concurrency are >= 1", async () => {
    await expect(svc().matchByContextChunked(mkInput(1), { chunkSize: 0 })).rejects.toThrow(/chunkSize/);
    await expect(svc().matchByContextChunked(mkInput(1), { concurrency: 0 })).rejects.toThrow(/concurrency/);
  });
});
