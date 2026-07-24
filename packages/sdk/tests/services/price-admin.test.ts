import { describe, it, expect, vi } from "vitest";
import { PriceService } from "../../src/services/price";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof PriceService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("PriceService flat prices admin", () => {
  it("create / list / get / upsert / delete / search / bulk hit the right method+path", async () => {
    const c = vi.fn().mockResolvedValue({ id: "p1" });
    await new PriceService(ctxWith(c)).create({} as never);
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/price/acme/prices", auth: { kind: "service" } }),
    );

    const l = vi.fn().mockResolvedValue([{ id: "p1" }]);
    await new PriceService(ctxWith(l)).list();
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/prices" }));

    const g = vi.fn().mockResolvedValue({ id: "p1" });
    await new PriceService(ctxWith(g)).get("p1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/prices/p1" }));

    const u = vi.fn().mockResolvedValue({ id: "p1" });
    await new PriceService(ctxWith(u)).upsert("p1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/prices/p1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new PriceService(ctxWith(d)).delete("p1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/price/acme/prices/p1" }));

    const s = vi.fn().mockResolvedValue([{ id: "p1" }]);
    await new PriceService(ctxWith(s)).search({});
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/prices/search" }));

    const bc = vi.fn().mockResolvedValue([{ status: 201 }]);
    await new PriceService(ctxWith(bc)).bulkCreate([] as never);
    expect(bc).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/prices/bulk" }));

    const bu = vi.fn().mockResolvedValue([{ status: 200 }]);
    await new PriceService(ctxWith(bu)).bulkUpsert([] as never);
    expect(bu).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/prices/bulk" }));
  });

  it("honors an explicit auth override", async () => {
    const r = vi.fn().mockResolvedValue([]);
    await new PriceService(ctxWith(r)).list(undefined, { kind: "raw", token: "T" });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "T" } }));
  });
});

describe("prices.models", () => {
  it("CRUD hits /priceModels", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "m1" }]);
    await new PriceService(ctxWith(l)).models.list();
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/price/acme/priceModels", auth: { kind: "service" } }),
    );

    const c = vi.fn().mockResolvedValue({ id: "m1" });
    await new PriceService(ctxWith(c)).models.create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/priceModels" }));

    const g = vi.fn().mockResolvedValue({ id: "m1" });
    await new PriceService(ctxWith(g)).models.get("m1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/priceModels/m1" }));

    const u = vi.fn().mockResolvedValue({ id: "m1" });
    await new PriceService(ctxWith(u)).models.upsert("m1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/priceModels/m1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new PriceService(ctxWith(d)).models.delete("m1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/price/acme/priceModels/m1" }));
  });
});

describe("prices.lists core", () => {
  it("CRUD + search hit /price-lists", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "pl1" }]);
    await new PriceService(ctxWith(l)).lists.list();
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/price/acme/price-lists", auth: { kind: "service" } }),
    );

    const c = vi.fn().mockResolvedValue({ id: "pl1" });
    await new PriceService(ctxWith(c)).lists.create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/price-lists" }));

    const s = vi.fn().mockResolvedValue([{ id: "pl1" }]);
    await new PriceService(ctxWith(s)).lists.search({});
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: "/price/acme/price-lists/search" }));

    const g = vi.fn().mockResolvedValue({ id: "pl1" });
    await new PriceService(ctxWith(g)).lists.get("pl1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/price/acme/price-lists/pl1" }));

    const u = vi.fn().mockResolvedValue({ id: "pl1" });
    await new PriceService(ctxWith(u)).lists.upsert("pl1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: "/price/acme/price-lists/pl1" }));

    const d = vi.fn().mockResolvedValue(undefined);
    await new PriceService(ctxWith(d)).lists.delete("pl1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: "/price/acme/price-lists/pl1" }));
  });
});

describe("prices.lists nested prices", () => {
  it("single-price ops under /price-lists/{listId}/prices", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "x" }]);
    await new PriceService(ctxWith(l)).lists.listPrices("pl1");
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/price/acme/price-lists/pl1/prices" }),
    );

    const a = vi.fn().mockResolvedValue({ id: "x" });
    await new PriceService(ctxWith(a)).lists.addPrice("pl1", {} as never);
    expect(a).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/price/acme/price-lists/pl1/prices" }),
    );

    const g = vi.fn().mockResolvedValue({ id: "x" });
    await new PriceService(ctxWith(g)).lists.getPrice("pl1", "x");
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: "/price/acme/price-lists/pl1/prices/x" }),
    );

    const u = vi.fn().mockResolvedValue({ id: "x" });
    await new PriceService(ctxWith(u)).lists.upsertPrice("pl1", "x", {} as never);
    expect(u).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: "/price/acme/price-lists/pl1/prices/x" }),
    );

    const d = vi.fn().mockResolvedValue(undefined);
    await new PriceService(ctxWith(d)).lists.deletePrice("pl1", "x");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: "/price/acme/price-lists/pl1/prices/x" }),
    );
  });

  it("search + bulk ops under /price-lists/{listId}/prices", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "x" }]);
    await new PriceService(ctxWith(s)).lists.searchPrices("pl1", {});
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/price/acme/price-lists/pl1/prices/search" }),
    );

    const bc = vi.fn().mockResolvedValue([{ status: 201 }]);
    await new PriceService(ctxWith(bc)).lists.bulkCreatePrices("pl1", [] as never);
    expect(bc).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: "/price/acme/price-lists/pl1/prices/bulk" }),
    );

    const bu = vi.fn().mockResolvedValue([{ status: 200 }]);
    await new PriceService(ctxWith(bu)).lists.bulkUpsertPrices("pl1", [] as never);
    expect(bu).toHaveBeenCalledWith(
      expect.objectContaining({ method: "PUT", path: "/price/acme/price-lists/pl1/prices/bulk" }),
    );

    const bd = vi.fn().mockResolvedValue([{ status: 204 }]);
    await new PriceService(ctxWith(bd)).lists.bulkDeletePrices("pl1", {} as never);
    expect(bd).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: "/price/acme/price-lists/pl1/prices/bulk" }),
    );
  });
});
