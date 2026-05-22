import { describe, it, expect, vi } from "vitest";
import { SiteService } from "../../src/services/site";
import { auth } from "../../src/core/auth";

function ctxWith(request: ReturnType<typeof vi.fn>): ConstructorParameters<typeof SiteService>[0] {
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

describe("SiteService", () => {
  it("list() GETs /site/{tenant}/sites with anonymous auth by default", async () => {
    const request = vi.fn().mockResolvedValue([
      {
        code: "Netherlands",
        name: "Netherlands",
        active: true,
        default: true,
        defaultLanguage: "nl",
        languages: ["nl"],
        currency: "EUR",
        homeBase: { address: { country: "NL", zipCode: "1011" } },
        shipToCountries: ["NL"],
      },
    ]);
    const svc = new SiteService(ctxWith(request));

    const sites = await svc.list();

    expect(sites).toHaveLength(1);
    expect(sites[0]?.code).toBe("Netherlands");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/site/viu/sites",
        auth: expect.objectContaining({ kind: "anonymous" }),
      }),
    );
  });

  it("list() honours an explicit AuthContext", async () => {
    const request = vi.fn().mockResolvedValue([]);
    const svc = new SiteService(ctxWith(request));
    await svc.list(auth.customer("tok"));
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ auth: expect.objectContaining({ kind: "customer" }) }),
    );
  });

  it("get(code) GETs /site/{tenant}/sites/{code}", async () => {
    const request = vi.fn().mockResolvedValue({
      code: "ThermoBrand_DE",
      name: "ThermoBrand Germany",
      active: true,
      default: false,
      defaultLanguage: "de",
      languages: ["en", "de"],
      currency: "EUR",
      homeBase: { address: { country: "DE", zipCode: "12345" } },
      shipToCountries: ["DE"],
    });
    const svc = new SiteService(ctxWith(request));
    const site = await svc.get("ThermoBrand_DE");
    expect(site.code).toBe("ThermoBrand_DE");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/site/viu/sites/ThermoBrand_DE",
      }),
    );
  });

  it("current() returns the site flagged default: true", async () => {
    const request = vi.fn().mockResolvedValue([
      {
        code: "X",
        name: "X",
        active: true,
        default: false,
        defaultLanguage: "en",
        languages: ["en"],
        currency: "EUR",
        homeBase: { address: { country: "DE", zipCode: "1" } },
        shipToCountries: ["DE"],
      },
      {
        code: "Y",
        name: "Y",
        active: true,
        default: true,
        defaultLanguage: "en",
        languages: ["en"],
        currency: "EUR",
        homeBase: { address: { country: "DE", zipCode: "1" } },
        shipToCountries: ["DE"],
      },
      {
        code: "Z",
        name: "Z",
        active: true,
        default: false,
        defaultLanguage: "en",
        languages: ["en"],
        currency: "EUR",
        homeBase: { address: { country: "DE", zipCode: "1" } },
        shipToCountries: ["DE"],
      },
    ]);
    const svc = new SiteService(ctxWith(request));
    const site = await svc.current();
    expect(site.code).toBe("Y");
  });

  it("current() throws a descriptive error when no site is flagged default", async () => {
    const request = vi.fn().mockResolvedValue([
      {
        code: "X",
        name: "X",
        active: true,
        default: false,
        defaultLanguage: "en",
        languages: ["en"],
        currency: "EUR",
        homeBase: { address: { country: "DE", zipCode: "1" } },
        shipToCountries: ["DE"],
      },
    ]);
    const svc = new SiteService(ctxWith(request));
    await expect(svc.current()).rejects.toThrow(/no default site/i);
  });
});
