import { describe, it, expect, vi } from "vitest";
import { FeeService } from "../../src/services/fee";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof FeeService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): FeeService => new FeeService(ctxWith(req));
const PF = "/fee/acme/productFees";
const IF = "/fee/acme/itemFees";

describe("FeeService product-fee delete", () => {
  it("deleteProductFee removes a single fee from a product", async () => {
    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).deleteProductFee("p1", "f1");
    expect(d).toHaveBeenCalledWith(
      expect.objectContaining({ method: "DELETE", path: `${PF}/p1/fees/f1`, auth: { kind: "service" } }),
    );
  });

  it("stays distinct from deleteProductFees (which clears all)", async () => {
    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).deleteProductFees("p1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${PF}/p1/fees` }));
  });
});

describe("FeeService product searches", () => {
  it("searchItemFeesByProductId POSTs siteCodes (plural) for one productId", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "if1" }]);
    const res = await svc(s).searchItemFeesByProductId({ productId: "p1", siteCodes: ["main", "ch"] });
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${IF}/searchByProductId`,
        body: { productId: "p1", siteCodes: ["main", "ch"] },
        auth: { kind: "service" },
      }),
    );
    expect(res).toEqual([{ id: "if1" }]);
  });

  it("searchItemFeesByProductIds POSTs productIds as a single string with one siteCode", async () => {
    const s = vi.fn().mockResolvedValue([]);
    await svc(s).searchItemFeesByProductIds({ productIds: "p1,p2", siteCode: "main" });
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: `${IF}/searchByProductIds`,
        body: { productIds: "p1,p2", siteCode: "main" },
        auth: { kind: "service" },
      }),
    );
  });

  it("honors an explicit auth override", async () => {
    const s = vi.fn().mockResolvedValue([]);
    await svc(s).searchItemFeesByProductId({ productId: "p1", siteCodes: [] }, { kind: "raw", token: "X" });
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});
