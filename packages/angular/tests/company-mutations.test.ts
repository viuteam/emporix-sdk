import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestBed } from "@angular/core/testing";
import { QueryClient } from "@tanstack/angular-query-experimental";
import { createMemoryStorage, type EmporixStorage } from "@viu/emporix-sdk";
import { provideEmporix } from "../src/provide";
import {
  injectCompanyMutations,
  type EmporixCompanyMutations,
} from "../src/injectables/companies";

type Mock = ReturnType<typeof vi.fn>;

let storage: EmporixStorage;
let qc: QueryClient;
let client: {
  companies: { create: Mock; update: Mock; delete: Mock; listMine: Mock };
  locations: { create: Mock; update: Mock; delete: Mock };
  contacts: { assign: Mock; update: Mock; unassign: Mock };
  customerGroups: { addMember: Mock; removeMember: Mock };
};

function boot(signedIn: boolean): void {
  storage = createMemoryStorage();
  if (signedIn) storage.setCustomerToken("t1");
  qc = new QueryClient();
  const ok = (): Mock => vi.fn(async () => ({ id: "x" }));
  client = {
    companies: { create: ok(), update: ok(), delete: ok(), listMine: vi.fn(async () => []) },
    locations: { create: ok(), update: ok(), delete: ok() },
    contacts: { assign: ok(), update: ok(), unassign: ok() },
    customerGroups: { addMember: ok(), removeMember: ok() },
  };
  TestBed.configureTestingModule({
    providers: [
      provideEmporix({
        client: { tenant: "acme", config: {}, ...client } as never,
        storage,
        queryClient: qc,
      }),
    ],
  });
}

/**
 * Eleven near-identical methods do not need eleven hand-written tests; they need
 * one assertion that each is wired to the facade method it claims. A method
 * pointing at its neighbour — `updateLocation` calling `locations.create` —
 * typechecks, passes a smoke test that only checks «something was called», and
 * is invisible in review.
 */
const methods: Array<[string, (m: EmporixCompanyMutations) => Promise<unknown>, () => Mock]> = [
  ["createCompany", (m) => m.createCompany({} as never), () => client.companies.create],
  [
    "updateCompany",
    (m) => m.updateCompany({ id: "le1", patch: {} as never }),
    () => client.companies.update,
  ],
  ["deleteCompany", (m) => m.deleteCompany("le1"), () => client.companies.delete],
  ["createLocation", (m) => m.createLocation({} as never), () => client.locations.create],
  [
    "updateLocation",
    (m) => m.updateLocation({ id: "loc1", patch: {} as never }),
    () => client.locations.update,
  ],
  ["deleteLocation", (m) => m.deleteLocation("loc1"), () => client.locations.delete],
  ["assignContact", (m) => m.assignContact({} as never), () => client.contacts.assign],
  [
    "updateContactAssignment",
    (m) => m.updateContactAssignment({ id: "c1", patch: {} as never }),
    () => client.contacts.update,
  ],
  ["unassignContact", (m) => m.unassignContact("c1"), () => client.contacts.unassign],
  [
    "addGroupMember",
    (m) => m.addGroupMember({ groupId: "g1", member: {} as never }),
    () => client.customerGroups.addMember,
  ],
  [
    "removeGroupMember",
    (m) => m.removeGroupMember({ groupId: "g1", userId: "u1" }),
    () => client.customerGroups.removeMember,
  ],
];

describe.each(methods)("injectCompanyMutations.%s", (_name, call, facade) => {
  beforeEach(() => {
    boot(true);
  });

  it("calls its own facade method and no other", async () => {
    const m = TestBed.runInInjectionContext(() => injectCompanyMutations());
    await call(m);
    expect(facade()).toHaveBeenCalledTimes(1);
    const others = Object.values(client)
      .flatMap((svc) => Object.values(svc))
      .filter((fn) => fn !== facade() && fn !== client.companies.listMine);
    for (const other of others) expect(other).not.toHaveBeenCalled();
  });

  it("invalidates the company keys", async () => {
    const spy = vi.spyOn(qc, "invalidateQueries");
    const m = TestBed.runInInjectionContext(() => injectCompanyMutations());
    await call(m);
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "my-companies"] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ["emporix", "company-locations"] });
  });

  it("is customer-gated and spends no request for a guest", async () => {
    boot(false);
    const m = TestBed.runInInjectionContext(() => injectCompanyMutations());
    await expect(call(m)).rejects.toThrow(/requires a signed-in customer/);
    expect(facade()).not.toHaveBeenCalled();
  });
});
