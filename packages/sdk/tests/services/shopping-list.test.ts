import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { ShoppingListService } from "../../src/services/shopping-list";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const CUST = { kind: "customer" as const, token: "cust-tok" };
const BASE = "https://api.emporix.io/shoppinglist/acme/shopping-lists";

function svc() {
  const cfg = {
    tenant: "acme", host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "shopping-list" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io", provider: tokenProvider, logger,
    retry: { maxAttempts: 1 }, timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new ShoppingListService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const ENVELOPE = [
  {
    customerId: "C1",
    default: {
      name: "default",
      items: [
        { id: 1, productId: "p1", quantity: 2 },
        { id: 2, productId: "p2", quantity: 1 },
      ],
    },
  },
];

describe("ShoppingListService", () => {
  it("list normalizes the wire envelopes into ShoppingList[] with the customer token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json(ENVELOPE);
      }),
    );
    const lists = await svc().list(CUST);
    expect(seenAuth).toBe("Bearer cust-tok");
    expect(lists).toHaveLength(1);
    expect(lists[0]).toMatchObject({ key: "default", name: "default" });
    expect(lists[0]?.items.map((i) => i.productId)).toEqual(["p1", "p2"]);
  });

  it("list passes the name filter as a query param", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.get(BASE, ({ request }) => {
        q = new URL(request.url).searchParams;
        return HttpResponse.json(ENVELOPE);
      }),
    );
    await svc().list(CUST, { name: "default" });
    expect((q as URLSearchParams | null)?.get("name")).toBe("default");
  });

  it("create POSTs the draft and returns the id", async () => {
    let body: unknown = null;
    server.use(
      http.post(BASE, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "C1" }, { status: 201 });
      }),
    );
    const res = await svc().create({ name: "wishlist", items: [{ productId: "p9", quantity: 3 }] }, CUST);
    expect(body).toEqual({ name: "wishlist", items: [{ productId: "p9", quantity: 3 }] });
    expect(res.id).toBe("C1");
  });

  it("delete DELETEs the customer path, with the name filter when given", async () => {
    let q: URLSearchParams | null = null;
    server.use(
      http.delete(`${BASE}/C1`, ({ request }) => {
        q = new URL(request.url).searchParams;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(svc().delete("C1", CUST, { name: "default" })).resolves.toBeUndefined();
    expect((q as URLSearchParams | null)?.get("name")).toBe("default");
  });

  it("addItem read-modify-writes: appends the item and PUTs the full list", async () => {
    let putBody: unknown = null;
    server.use(
      http.get(BASE, () => HttpResponse.json(ENVELOPE)),
      http.put(`${BASE}/C1`, async ({ request }) => {
        putBody = await request.json();
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await svc().addItem("C1", "default", { productId: "p3", quantity: 5 }, CUST);
    expect(putBody).toEqual({
      name: "default",
      items: [
        { id: 1, productId: "p1", quantity: 2 },
        { id: 2, productId: "p2", quantity: 1 },
        { productId: "p3", quantity: 5 },
      ],
    });
  });

  it("removeItem drops the matching productId", async () => {
    let putBody: { items: { productId: string }[] } | null = null;
    server.use(
      http.get(BASE, () => HttpResponse.json(ENVELOPE)),
      http.put(`${BASE}/C1`, async ({ request }) => {
        putBody = (await request.json()) as { items: { productId: string }[] };
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await svc().removeItem("C1", "default", "p1", CUST);
    expect((putBody as { items: { productId: string }[] } | null)?.items.map((i) => i.productId)).toEqual(["p2"]);
  });

  it("setItemQuantity updates an existing item; quantity<=0 removes it", async () => {
    const puts: { items: { productId: string; quantity: number }[] }[] = [];
    server.use(
      http.get(BASE, () => HttpResponse.json(ENVELOPE)),
      http.put(`${BASE}/C1`, async ({ request }) => {
        puts.push((await request.json()) as { items: { productId: string; quantity: number }[] });
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await svc().setItemQuantity("C1", "default", "p1", 9, CUST);
    expect(puts[0]?.items.find((i) => i.productId === "p1")?.quantity).toBe(9);
    await svc().setItemQuantity("C1", "default", "p2", 0, CUST);
    expect(puts[1]?.items.map((i) => i.productId)).toEqual(["p1"]);
  });

  it("item helpers throw EmporixNotFoundError for an unknown list name", async () => {
    server.use(http.get(BASE, () => HttpResponse.json(ENVELOPE)));
    await expect(svc().addItem("C1", "ghost", { productId: "p", quantity: 1 }, CUST))
      .rejects.toBeInstanceOf(EmporixNotFoundError);
  });
});

describe("ShoppingListService — one customer's lists", () => {
  const SVC = { kind: "service" as const };
  const TOKEN = http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  );

  it("getForCustomer GETs /{customerId} and normalizes its single envelope, with the name filter when given", async () => {
    const seen: { path: string; name: string | null }[] = [];
    server.use(
      TOKEN,
      http.get(`${BASE}/:customerId`, ({ request }) => {
        const url = new URL(request.url);
        seen.push({ path: url.pathname, name: url.searchParams.get("name") });
        return HttpResponse.json(ENVELOPE[0]);
      }),
    );
    const lists = await svc().getForCustomer("C/1", SVC);
    await svc().getForCustomer("C1", SVC, { name: "default" });
    expect(lists.map((l) => l.name)).toEqual(["default"]);
    expect(lists[0]?.items.map((i) => i.productId)).toEqual(["p1", "p2"]);
    expect(seen).toEqual([
      { path: "/shoppinglist/acme/shopping-lists/C%2F1", name: null },
      { path: "/shoppinglist/acme/shopping-lists/C1", name: "default" },
    ]);
  });

  it("addItem with a service token edits the target customer's list, not the first one of that name", async () => {
    let listedAll = false;
    let putBody: unknown = null;
    server.use(
      TOKEN,
      // With employee scope this answers every customer's lists and ignores `name`.
      http.get(BASE, () => {
        listedAll = true;
        return HttpResponse.json([
          { customerId: "A", default: { name: "default", items: [{ productId: "a-item", quantity: 1 }] } },
          { customerId: "B", default: { name: "default", items: [{ productId: "b-item", quantity: 1 }] } },
        ]);
      }),
      http.get(`${BASE}/B`, () =>
        HttpResponse.json({ customerId: "B", default: { name: "default", items: [{ productId: "b-item", quantity: 1 }] } }),
      ),
      http.put(`${BASE}/B`, async ({ request }) => {
        putBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await svc().addItem("B", "default", { productId: "new", quantity: 1 }, SVC);
    expect(listedAll).toBe(false);
    expect((putBody as { items?: { productId: string }[] } | null)?.items?.map((i) => i.productId)).toEqual([
      "b-item",
      "new",
    ]);
  });
});
