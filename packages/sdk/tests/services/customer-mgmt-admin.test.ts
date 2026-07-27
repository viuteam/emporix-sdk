import { describe, it, expect, vi } from "vitest";
import { CompaniesService } from "../../src/services/companies";
import { ContactsService } from "../../src/services/contacts";

function ctxWith(request: ReturnType<typeof vi.fn>) {
  return {
    tenant: "acme",
    http: { request },
    tokenProvider: { getToken: vi.fn() },
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), child: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
const companies = (req: ReturnType<typeof vi.fn>): CompaniesService => new CompaniesService(ctxWith(req));
const contacts = (req: ReturnType<typeof vi.fn>): ContactsService => new ContactsService(ctxWith(req));
const LE = "/customer-management/acme/legal-entities";
const CA = "/customer-management/acme/contact-assignments";
const CUST = { kind: "customer", token: "T" } as const;

describe("CompaniesService search + hierarchy", () => {
  it("search POSTs /legal-entities/search with the q body", async () => {
    const s = vi.fn().mockResolvedValue([{ id: "le1" }]);
    const res = await companies(s).search({ q: "name:Acme" }, CUST);
    expect(s).toHaveBeenCalledWith(
      expect.objectContaining({ method: "POST", path: `${LE}/search`, body: { q: "name:Acme" }, auth: CUST }),
    );
    expect(res).toEqual([{ id: "le1" }]);
  });

  it("parentHierarchy GETs the hierarchy path", async () => {
    const h = vi.fn().mockResolvedValue([{ id: "parent" }]);
    await companies(h).parentHierarchy("le1", CUST);
    expect(h).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${LE}/le1/parent-hierarchy`, auth: CUST }),
    );
  });
});

describe("ContactsService.get", () => {
  it("GETs one contact assignment by id", async () => {
    const g = vi.fn().mockResolvedValue({ id: "ca1" });
    const res = await contacts(g).get("ca1", CUST);
    expect(g).toHaveBeenCalledWith(
      expect.objectContaining({ method: "GET", path: `${CA}/ca1`, auth: CUST }),
    );
    expect(res).toEqual({ id: "ca1" });
  });
});
