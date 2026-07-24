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
