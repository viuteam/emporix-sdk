import { describe, it, expect, vi } from "vitest";
import { CartService } from "../../src/services/cart";
import { EmporixValidationError } from "../../src/core/errors";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof CartService>[0] {
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
const svc = (req: ReturnType<typeof vi.fn>): CartService => new CartService(ctxWith(req));
const B = "/cart/acme/carts";
const CUST = { kind: "customer", token: "T" } as const;
const SVC = { kind: "service" } as const;

describe("CartService backend ops", () => {
  it("search POSTs /carts/search with the q body and accepts a service auth", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "c1" }]);
    const res = await svc(s).search({ q: "status:ACTIVE" }, SVC, { pageSize: 10 });
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${B}/search`,
        body: { q: "status:ACTIVE" },
        auth: { kind: "service" },
        query: expect.objectContaining({ pageSize: 10 }),
      }),
    );
    expect(res).toEqual([{ id: "c1" }]);
  });

  it("delete DELETEs /carts/{cartId}", async () => {
    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).delete("c1", SVC);
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${B}/c1`, auth: { kind: "service" } }));
  });

  it("update PUTs then re-fetches the cart with the same auth", async () => {
    const u = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "c1", items: [] });
    const res = await svc(u).update("c1", { addresses: [] } as never, CUST);
    expect(u.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ method: "PUT", path: `${B}/c1`, body: { addresses: [] }, auth: CUST }));
    expect(u.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1`, auth: CUST }));
    expect(res).toEqual({ id: "c1", items: [] });
  });
});

describe("CartService storefront ops", () => {
  it("getItem/listDiscounts/getDeliveryRestrictions hit the right method+path", async () => {
    const g = vi.fn().mockResolvedValue({ id: "i1" });
    await svc(g).getItem("c1", "i1", CUST);
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/c1/items/i1`, auth: CUST }));

    const l = vi.fn().mockResolvedValue([{ discountId: "d1" }]);
    await svc(l).listDiscounts("c1", CUST);
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/c1/discounts`, auth: CUST }));

    const dt = vi.fn().mockResolvedValue({ leadTime: 2 });
    await svc(dt).getDeliveryRestrictions("c1", CUST);
    expect(dt).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${B}/c1/dtRestrictions`, auth: CUST }));
  });

  it("removeAllDiscounts DELETEs /discounts (no codes) then re-fetches the cart", async () => {
    const r = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "c1" });
    const res = await svc(r).removeAllDiscounts("c1", CUST);
    expect(r.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ method: "DELETE", path: `${B}/c1/discounts`, auth: CUST }));
    expect(r.mock.calls[0]?.[0]).not.toHaveProperty("query");
    expect(r.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1`, auth: CUST }));
    expect(res).toEqual({ id: "c1" });
  });

  it("removeDiscountByIndex DELETEs /discounts/{index} then re-fetches", async () => {
    const r = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "c1" });
    await svc(r).removeDiscountByIndex("c1", "0", CUST);
    expect(r.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ method: "DELETE", path: `${B}/c1/discounts/0`, auth: CUST }));
    expect(r.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1`, auth: CUST }));
  });
});

describe("CartService address setters (regression: #159-class path bug)", () => {
  const SHIP = { contactName: "Ship", city: "Zurich" };
  const BILL_EXISTING = { type: "BILLING", contactName: "Bill", city: "Bern", zipCode: "3000" };

  it("setShippingAddress reads, merges and PUTs /carts/{id} — preserving BILLING", async () => {
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1", addresses: [BILL_EXISTING] }) // GET
      .mockResolvedValueOnce(undefined) // PUT
      .mockResolvedValueOnce({ id: "c1", addresses: [BILL_EXISTING, { ...SHIP, type: "SHIPPING" }] }); // re-fetch
    const res = await svc(r).setShippingAddress("c1", SHIP, CUST);

    expect(r.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1` }));

    const put = r.mock.calls[1]?.[0];
    expect(put).toEqual(expect.objectContaining({ method: "PUT", path: `${B}/c1`, auth: CUST }));
    // the untouched BILLING must be resent verbatim, or the server wipes it
    expect(put.body.addresses).toEqual([BILL_EXISTING, { ...SHIP, type: "SHIPPING" }]);

    expect(r.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ method: "GET", path: `${B}/c1` }));
    expect(res.addresses).toHaveLength(2);
  });

  it("setBillingAddress preserves an existing SHIPPING entry", async () => {
    const shipExisting = { type: "SHIPPING", contactName: "Ship", city: "Zurich" };
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1", addresses: [shipExisting] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "c1", addresses: [] });
    await svc(r).setBillingAddress("c1", { contactName: "Bill" }, CUST);
    expect(r.mock.calls[1]?.[0].body.addresses).toEqual([
      shipExisting,
      { contactName: "Bill", type: "BILLING" },
    ]);
  });

  it("replaces an existing entry of the same type instead of duplicating it", async () => {
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1", addresses: [{ type: "SHIPPING", contactName: "Old" }, BILL_EXISTING] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "c1", addresses: [] });
    await svc(r).setShippingAddress("c1", SHIP, CUST);
    const sent = r.mock.calls[1]?.[0].body.addresses;
    expect(sent).toHaveLength(2);
    expect(sent.filter((a: { type: string }) => a.type === "SHIPPING")).toEqual([{ ...SHIP, type: "SHIPPING" }]);
    expect(sent).toContainEqual(BILL_EXISTING);
  });

  it("forces the type even when the caller passes a contradicting one", async () => {
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1", addresses: [] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "c1", addresses: [] });
    await svc(r).setShippingAddress("c1", { ...SHIP, type: "BILLING" } as never, CUST);
    expect(r.mock.calls[1]?.[0].body.addresses).toEqual([{ ...SHIP, type: "SHIPPING" }]);
  });

  it("handles a cart with no addresses yet", async () => {
    const r = vi
      .fn()
      .mockResolvedValueOnce({ id: "c1" }) // no addresses key at all
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ id: "c1", addresses: [] });
    await svc(r).setShippingAddress("c1", SHIP, CUST);
    expect(r.mock.calls[1]?.[0].body.addresses).toEqual([{ ...SHIP, type: "SHIPPING" }]);
  });

  it("rejects a non-cart auth context before any request", async () => {
    const r = vi.fn();
    await expect(svc(r).setShippingAddress("c1", SHIP, SVC)).rejects.toBeInstanceOf(EmporixValidationError);
    expect(r).not.toHaveBeenCalled();
  });
});

describe("CartService auth split", () => {
  it("a storefront op rejects a service auth and makes no request", async () => {
    const r = vi.fn();
    await expect(svc(r).listDiscounts("c1", SVC)).rejects.toBeInstanceOf(EmporixValidationError);
    expect(r).not.toHaveBeenCalled();
  });

  it("a backend op accepts a service auth", async () => {
    const r = vi.fn().mockResolvedValue([]);
    await svc(r).search({}, SVC);
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "service" } }));
  });
});
