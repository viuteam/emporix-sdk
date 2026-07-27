import { describe, it, expect, vi } from "vitest";
import { TenantConfigService } from "../../src/services/tenant-config";
import { ClientConfigService } from "../../src/services/client-config";

function ctxWith(request: ReturnType<typeof vi.fn>) {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const tenantCfg = (req: ReturnType<typeof vi.fn>): TenantConfigService => new TenantConfigService(ctxWith(req));
const clientCfg = (req: ReturnType<typeof vi.fn>): ClientConfigService => new ClientConfigService(ctxWith(req));

describe("configuration reads", () => {
  it("listGlobal GETs /global-configurations with the SERVICE default", async () => {
    const g = vi.fn().mockResolvedValue([{ key: "k", value: 1 }]);
    const res = await tenantCfg(g).listGlobal();
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/configuration/acme/global-configurations",
        auth: { kind: "service" },
      }),
    );
    expect(res).toEqual([{ key: "k", value: 1 }]);
  });

  it("listClients GETs /clients with the SERVICE default", async () => {
    const c = vi.fn().mockResolvedValue(["storefront", "backoffice"]);
    const res = await clientCfg(c).listClients();
    expect(c).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/configuration/acme/clients",
        auth: { kind: "service" },
      }),
    );
    expect(res).toEqual(["storefront", "backoffice"]);
  });

  it("both honor an explicit auth override", async () => {
    const g = vi.fn().mockResolvedValue([]);
    await tenantCfg(g).listGlobal({ kind: "raw", token: "X" });
    expect(g).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));

    const c = vi.fn().mockResolvedValue([]);
    await clientCfg(c).listClients({ kind: "raw", token: "X" });
    expect(c).toHaveBeenCalledWith(expect.objectContaining({ auth: { kind: "raw", token: "X" } }));
  });
});
