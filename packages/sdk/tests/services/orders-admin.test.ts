import { describe, it, expect, vi } from "vitest";
import { SalesOrdersService, OrdersService } from "../../src/services/orders";

function ctxWith(request: ReturnType<typeof vi.fn>) {
  return {
    tenant: "acme",
    // `requestWithMeta` is derived from the same stub so a paginated facade
    // (which goes through `core/paged.ts`) sees the same answers, with no
    // pagination headers.
    http: {
      request,
      requestWithMeta: async (o: unknown) => ({ data: await request(o), headers: new Headers() }),
    },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const so = (req: ReturnType<typeof vi.fn>): SalesOrdersService => new SalesOrdersService(ctxWith(req));
const os = (req: ReturnType<typeof vi.fn>): OrdersService => new OrdersService(ctxWith(req));
const SB = "/order-v2/acme/salesorders";
const LEB = "/order-v2/acme/legal-entity-orders";
const SVC = { kind: "service" } as const;
const CUST = { kind: "customer", token: "T" } as const;

describe("SalesOrdersService CRUD", () => {
  it("list wraps the array into PaginatedItems and forwards auth + paging", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "o1" }]);
    const res = await so(l).list(SVC, { pageSize: 10, q: "status:COMPLETED" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: SB,
        auth: { kind: "service" },
        query: expect.objectContaining({ pageNumber: 1, pageSize: 10, q: "status:COMPLETED" }),
      }),
    );
    expect(res).toEqual({ items: [{ id: "o1" }], pageNumber: 1, pageSize: 10, hasNextPage: false });
  });

  it("search POSTs /salesorders/search with the body and returns the array", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "o1" }]);
    const res = await so(s).search({ q: "status:COMPLETED" } as never, SVC);
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/search`, body: { q: "status:COMPLETED" }, auth: SVC }));
    expect(res).toEqual([{ id: "o1" }]);
  });

  it("create POSTs /salesorders and returns the ResourceLocation", async () => {
    const c = vi.fn().mockResolvedValue({ id: "o1" });
    const res = await so(c).create({} as never, SVC);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: SB, body: {}, auth: SVC }));
    expect(res).toEqual({ id: "o1" });
  });

  it("replace PUTs /salesorders/{id} then re-fetches the sales-order", async () => {
    const r = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "o1" });
    const res = await so(r).replace("o1", {} as never, SVC);
    expect(r.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ method: "PUT", path: `${SB}/o1`, body: {}, auth: SVC }));
    expect(r.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${SB}/o1`, auth: SVC }));
    expect(res).toEqual({ id: "o1" });
  });

  it("delete DELETEs /salesorders/{id}", async () => {
    const d = vi.fn().mockResolvedValue(undefined);
    await so(d).delete("o1", SVC);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${SB}/o1`, auth: SVC }));
  });
});

describe("SalesOrdersService actions", () => {
  it("transition ops hit /salesorders/{id}/transitions and historical-transitions", async () => {
    const lt = vi.fn().mockResolvedValue([{ status: "COMPLETED" }]);
    await so(lt).listTransitions("o1", SVC);
    expect(lt).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${SB}/o1/transitions`, auth: SVC }));

    const t = vi.fn().mockResolvedValue(undefined);
    await so(t).transition("o1", { status: "COMPLETED" } as never, SVC);
    expect(t).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/o1/transitions`, body: { status: "COMPLETED" }, auth: SVC }));

    const h = vi.fn().mockResolvedValue({ transitions: [] });
    await so(h).listHistoricalTransitions("o1", SVC);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${SB}/o1/historical-transitions`, auth: SVC }));
  });

  it("calculate / updateEntries / split POST the right paths", async () => {
    const c = vi.fn().mockResolvedValue({});
    await so(c).calculate("o1", {} as never, SVC);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/o1/calculations`, body: {}, auth: SVC }));

    const e = vi.fn().mockResolvedValue({ id: "o1" });
    await so(e).updateEntries("o1", {} as never, SVC);
    expect(e).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/o1/entries`, body: {}, auth: SVC }));

    const s = vi.fn().mockResolvedValue({ orders: [] });
    await so(s).split("o1", {} as never, SVC);
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${SB}/o1/split`, body: {}, auth: SVC }));
  });
});

describe("OrdersService legal-entity reads", () => {
  it("listForLegalEntity GETs /legal-entity-orders/{leId} wrapped into PaginatedItems", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "o1" }]);
    const res = await os(l).listForLegalEntity("le1", CUST, { pageSize: 25 });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: `${LEB}/le1`,
        auth: CUST,
        query: expect.objectContaining({ pageNumber: 1, pageSize: 25 }),
      }),
    );
    expect(res).toEqual({ items: [{ id: "o1" }], pageNumber: 1, pageSize: 25, hasNextPage: false });
  });

  it("getForLegalEntity GETs /legal-entity-orders/{leId}/{orderId}", async () => {
    const g = vi.fn().mockResolvedValue({ id: "o1" });
    await os(g).getForLegalEntity("le1", "o1", CUST);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${LEB}/le1/o1`, auth: CUST }));
  });
});
