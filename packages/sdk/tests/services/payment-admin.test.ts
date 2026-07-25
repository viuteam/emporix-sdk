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

describe("PaymentGatewayService.transactions", () => {
  it("reads hit the transaction paths and forward paging", async () => {
    const l = vi.fn().mockResolvedValue([{ id: "t1" }]);
    await svc(l).transactions.list({ pageSize: 10, sort: "created:desc" });
    expect(l).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: TX,
        auth: { kind: "service" },
        query: expect.objectContaining({ pageSize: 10, sort: "created:desc" }),
      }),
    );

    const bare = vi.fn().mockResolvedValue([]);
    await svc(bare).transactions.list();
    expect(bare.mock.calls[0]?.[0]).not.toHaveProperty("query");

    const g = vi.fn().mockResolvedValue({ id: "t1" });
    await svc(g).transactions.get("t1");
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: `${TX}/t1`, auth: { kind: "service" } }));
  });

  it("authorize POSTs the backend authorize path", async () => {
    const a = vi.fn().mockResolvedValue({ successful: true });
    await svc(a).transactions.authorize({} as never);
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${P}/authorize`, body: {}, auth: { kind: "service" } }));
  });

  it("capture/refund send a body only when given; cancel never does", async () => {
    const c = vi.fn().mockResolvedValue({ successful: true, captureId: "c1" });
    const res = await svc(c).transactions.capture("t1", { amount: 10, currency: "CHF" });
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${P}/t1/capture`, body: { amount: 10, currency: "CHF" }, auth: { kind: "service" } }),
    );
    expect(res).toEqual({ successful: true, captureId: "c1" });

    const cb = vi.fn().mockResolvedValue({ successful: true });
    await svc(cb).transactions.capture("t1");
    expect(cb.mock.calls[0]?.[0]).not.toHaveProperty("body");

    const r = vi.fn().mockResolvedValue({ successful: true });
    await svc(r).transactions.refund("t1", { amount: 5 });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${P}/t1/refund`, body: { amount: 5 } }));

    const rb = vi.fn().mockResolvedValue({ successful: true });
    await svc(rb).transactions.refund("t1");
    expect(rb.mock.calls[0]?.[0]).not.toHaveProperty("body");

    const x = vi.fn().mockResolvedValue({ successful: true });
    await svc(x).transactions.cancel("t1");
    expect(x).toHaveBeenCalledWith(expect.objectContaining({ method: "POST", path: `${P}/t1/cancel`, auth: { kind: "service" } }));
    expect(x.mock.calls[0]?.[0]).not.toHaveProperty("body");
  });
});
