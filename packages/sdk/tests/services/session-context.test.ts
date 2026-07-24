import { describe, it, expect, vi } from "vitest";
import { SessionContextService } from "../../src/services/session-context";
import { auth } from "../../src/core/auth";

function ctxWith(
  request: ReturnType<typeof vi.fn>,
): ConstructorParameters<typeof SessionContextService>[0] {
  return {
    tenant: "viu",
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

describe("SessionContextService.get", () => {
  it("GETs /session-context/{tenant}/me/context", async () => {
    const request = vi.fn().mockResolvedValue({
      sessionId: "s1",
      siteCode: "main",
      currency: "CHF",
      targetLocation: "CH",
      metadata: { version: 3 },
    });
    const svc = new SessionContextService(ctxWith(request));
    const sc = await svc.get();
    expect(sc?.siteCode).toBe("main");
    expect(sc?.metadata?.version).toBe(3);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/session-context/viu/me/context",
      }),
    );
  });

  it("returns null on 404 (no session context yet — happens before first cart)", async () => {
    const e: { status?: number } = Object.assign(new Error("not found"), { status: 404 });
    const request = vi.fn().mockRejectedValue(e);
    const svc = new SessionContextService(ctxWith(request));
    const sc = await svc.get();
    expect(sc).toBeNull();
  });

  it("propagates non-404 errors", async () => {
    const e: { status?: number } = Object.assign(new Error("boom"), { status: 500 });
    const request = vi.fn().mockRejectedValue(e);
    const svc = new SessionContextService(ctxWith(request));
    await expect(svc.get()).rejects.toThrow(/boom/);
  });
});

describe("SessionContextService.patch", () => {
  it("PATCHes with siteCode + metadata.version (lazy GET to fetch version)", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ sessionId: "s1", siteCode: "old", metadata: { version: 7 } })
      .mockResolvedValueOnce(undefined);
    const svc = new SessionContextService(ctxWith(request));
    await svc.patch({ siteCode: "new" });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "GET",
        path: "/session-context/viu/me/context",
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: "PATCH",
        path: "/session-context/viu/me/context",
        body: expect.objectContaining({
          siteCode: "new",
          metadata: { version: 7 },
        }),
      }),
    );
  });

  it("skips PATCH gracefully when GET returns 404 (no session yet)", async () => {
    const e: { status?: number } = Object.assign(new Error("not found"), { status: 404 });
    const request = vi.fn().mockRejectedValueOnce(e);
    const svc = new SessionContextService(ctxWith(request));
    const applied = await svc.patch({ siteCode: "new" });
    expect(applied).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns true when PATCH applies successfully", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ metadata: { version: 1 } })
      .mockResolvedValueOnce(undefined);
    const svc = new SessionContextService(ctxWith(request));
    const applied = await svc.patch({ siteCode: "X" });
    expect(applied).toBe(true);
  });

  it("honours an explicit version (skips the GET)", async () => {
    const request = vi.fn().mockResolvedValueOnce(undefined);
    const svc = new SessionContextService(ctxWith(request));
    const applied = await svc.patch({ siteCode: "Y", version: 42 });
    expect(applied).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          siteCode: "Y",
          metadata: { version: 42 },
        }),
      }),
    );
  });

  it("passes the explicit AuthContext through", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ metadata: { version: 1 } })
      .mockResolvedValueOnce(undefined);
    const svc = new SessionContextService(ctxWith(request));
    await svc.patch({ siteCode: "X" }, auth.customer("tok"));
    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ auth: expect.objectContaining({ kind: "customer" }) }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ auth: expect.objectContaining({ kind: "customer" }) }),
    );
  });
});

describe("SessionContextService attributes", () => {
  it("addAttribute POSTs to /me/context/attributes", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const svc = new SessionContextService(ctxWith(request));
    await svc.addAttribute({ key: "k", value: "v" } as never);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "POST",
        path: "/session-context/viu/me/context/attributes",
        body: { key: "k", value: "v" },
      }),
    );
  });

  it("removeAttribute DELETEs /me/context/attributes/{name}", async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    const svc = new SessionContextService(ctxWith(request));
    await svc.removeAttribute("color");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        path: "/session-context/viu/me/context/attributes/color",
      }),
    );
  });
});
