import { describe, it, expect, vi } from "vitest";
import { PaymentGatewayService } from "../../src/services/payment";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof PaymentGatewayService>[0] {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const svc = (req: ReturnType<typeof vi.fn>): PaymentGatewayService => new PaymentGatewayService(ctxWith(req));
const C = "/payment-gateway/acme/paymentmodes/config";
const P = "/payment-gateway/acme/payment";
const TX = "/payment-gateway/acme/transactions";

describe("PaymentGatewayService.modes", () => {
  it("config CRUD hits the right method+path with SERVICE default", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "m1" }]);
    await svc(l).modes.list();
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: C, auth: { kind: "service" } }));

    const g = vi.fn().mockResolvedValue({ id: "m1" });
    await svc(g).modes.get("m1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${C}/m1`, auth: { kind: "service" } }));

    const c = vi.fn().mockResolvedValue({ id: "m1" });
    await svc(c).modes.create({} as never);
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: C, body: {}, auth: { kind: "service" } }));

    const u = vi.fn().mockResolvedValue({ id: "m1" });
    await svc(u).modes.update("m1", {} as never);
    expect(u).toHaveBeenCalledWith(expect.objectContaining({ method: "PUT", path: `${C}/m1`, body: {}, auth: { kind: "service" } }));

    const d = vi.fn().mockResolvedValue(undefined);
    await svc(d).modes.delete("m1");
    expect(d).toHaveBeenCalledWith(expect.objectContaining({ method: "DELETE", path: `${C}/m1`, auth: { kind: "service" } }));
  });

  it("sends no query on the config list (the endpoint takes none)", async () => {
    const l = vi.fn().mockResolvedValue([]);
    await svc(l).modes.list();
    expect(l.mock.calls[0]?.[0]).not.toHaveProperty("query");
  });

  it("honors an explicit auth override", async () => {
    const l = vi.fn().mockResolvedValue([]);
    await svc(l).modes.list({ kind: "raw", token: "X" });
    expect(l).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});
