import { type Injector, type Signal } from "@angular/core";
import type { CreateQueryResult } from "@tanstack/angular-query-experimental";
import type { EmporixClient } from "@viu/emporix-sdk";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { writeBundle } from "../write-bundle";

type Companies = Awaited<ReturnType<EmporixClient["companies"]["listMine"]>>;
type Company = Awaited<ReturnType<EmporixClient["companies"]["get"]>>;
type CompanyInput = Parameters<EmporixClient["companies"]["create"]>[0];
type CompanyPatch = Parameters<EmporixClient["companies"]["update"]>[1];
type Contacts = Awaited<ReturnType<EmporixClient["contacts"]["listForCompany"]>>;
type ContactInput = Parameters<EmporixClient["contacts"]["assign"]>[0];
type ContactPatch = Parameters<EmporixClient["contacts"]["update"]>[1];
type Contact = Awaited<ReturnType<EmporixClient["contacts"]["update"]>>;
type Groups = Awaited<ReturnType<EmporixClient["customerGroups"]["listForCompany"]>>;
type GroupMember = Parameters<EmporixClient["customerGroups"]["addMember"]>[1];
type GroupMemberAdded = Awaited<ReturnType<EmporixClient["customerGroups"]["addMember"]>>;
type Locations = Awaited<ReturnType<EmporixClient["locations"]["listForCompany"]>>;
type LocationInput = Parameters<EmporixClient["locations"]["create"]>[0];
type LocationPatch = Parameters<EmporixClient["locations"]["update"]>[1];
type Location = Awaited<ReturnType<EmporixClient["locations"]["update"]>>;

/** 1 minute — company structure is admin-driven, not shopper-driven. */
const COMPANIES_STALE = 60_000;

export interface CompanyOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: CompanyOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * The company reads.
 *
 * Each keys under its own `resource`, where React keys all four under
 * `"companies"`. Distinct keys mean one company's contacts do not invalidate
 * another's locations — with one shared key, adding a location refetches every
 * company panel on the page, and Emporix bills per request.
 */
export function injectMyCompanies(opts: CompanyOpts = {}): CreateQueryResult<Companies> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Companies, readonly []>(
    () => ({
      resource: "my-companies",
      args: [] as const,
      site: "none",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.companies.listMine(ctx),
      staleTime: COMPANIES_STALE,
    }),
    pass(opts),
  );
}

/** One legal entity by id. Disabled while the id is empty. */
export function injectCompany(
  legalEntityId: Signal<string>,
  opts: CompanyOpts = {},
): CreateQueryResult<Company> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Company, readonly [string]>(
    () => ({
      resource: "company",
      args: [legalEntityId()] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && legalEntityId() !== "",
      queryFn: (ctx) => client.companies.get(legalEntityId(), ctx),
      staleTime: COMPANIES_STALE,
    }),
    pass(opts),
  );
}

/** Contact assignments for one company. */
export function injectCompanyContacts(
  legalEntityId: Signal<string>,
  opts: CompanyOpts = {},
): CreateQueryResult<Contacts> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Contacts, readonly [string]>(
    () => ({
      resource: "company-contacts",
      args: [legalEntityId()] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && legalEntityId() !== "",
      queryFn: (ctx) => client.contacts.listForCompany(legalEntityId(), ctx),
      staleTime: COMPANIES_STALE,
    }),
    pass(opts),
  );
}

/** IAM groups for one company. */
export function injectCompanyGroups(
  legalEntityId: Signal<string>,
  opts: CompanyOpts = {},
): CreateQueryResult<Groups> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Groups, readonly [string]>(
    () => ({
      resource: "company-groups",
      args: [legalEntityId()] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && legalEntityId() !== "",
      queryFn: (ctx) => client.customerGroups.listForCompany(legalEntityId(), ctx),
      staleTime: COMPANIES_STALE,
    }),
    pass(opts),
  );
}

/** Locations for one company. */
export function injectCompanyLocations(
  legalEntityId: Signal<string>,
  opts: CompanyOpts = {},
): CreateQueryResult<Locations> {
  const { client } = injectEmporix();
  return injectEmporixQuery<Locations, readonly [string]>(
    () => ({
      resource: "company-locations",
      args: [legalEntityId()] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && legalEntityId() !== "",
      queryFn: (ctx) => client.locations.listForCompany(legalEntityId(), ctx),
      staleTime: COMPANIES_STALE,
    }),
    pass(opts),
  );
}

export interface EmporixCompanyMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  createCompany(input: CompanyInput): Promise<Company>;
  updateCompany(vars: { id: string; patch: CompanyPatch }): Promise<Company>;
  deleteCompany(id: string): Promise<void>;
  createLocation(input: LocationInput): Promise<Location>;
  updateLocation(vars: { id: string; patch: LocationPatch }): Promise<Location>;
  deleteLocation(id: string): Promise<void>;
  assignContact(input: ContactInput): Promise<Contact>;
  updateContactAssignment(vars: { id: string; patch: ContactPatch }): Promise<Contact>;
  unassignContact(id: string): Promise<void>;
  /**
   * Returns the assignment's id. React's hook types this `void` and drops it,
   * which means a caller that needs to reference the assignment it just made has
   * to re-list the group to find it.
   */
  addGroupMember(vars: { groupId: string; member: GroupMember }): Promise<GroupMemberAdded>;
  removeGroupMember(vars: { groupId: string; userId: string }): Promise<void>;
}

/**
 * Company writes: the entity, its locations, its contact assignments and its
 * group membership.
 *
 * One bundle invalidating all five company resources, because these reads are one
 * aggregate from a consumer's point of view: adding a location changes what
 * `injectCompany` should show, and assigning a contact changes who
 * `injectCompanyGroups` can list.
 *
 * Every input and patch type is derived from the facade with `Parameters<…>`
 * rather than restated. Under `exactOptionalPropertyTypes` a hand-written copy
 * diverges the moment the facade gains an optional field, and it diverges
 * silently.
 */
export function injectCompanyMutations(): EmporixCompanyMutations {
  const { client } = injectEmporix();
  const b = writeBundle(
    [
      ["emporix", "my-companies"],
      ["emporix", "company"],
      ["emporix", "company-contacts"],
      ["emporix", "company-groups"],
      ["emporix", "company-locations"],
    ],
    { customerOnly: true },
  );
  const write = b.write;

  return {
    isPending: b.isPending,
    error: b.error,
    createCompany: (input) =>
      write((ctx) => client.companies.create(input, ctx), "createCompany"),
    updateCompany: (v) =>
      write((ctx) => client.companies.update(v.id, v.patch, ctx), "updateCompany"),
    deleteCompany: (id) => write((ctx) => client.companies.delete(id, ctx), "deleteCompany"),
    createLocation: (input) =>
      write((ctx) => client.locations.create(input, ctx), "createLocation"),
    updateLocation: (v) =>
      write((ctx) => client.locations.update(v.id, v.patch, ctx), "updateLocation"),
    deleteLocation: (id) => write((ctx) => client.locations.delete(id, ctx), "deleteLocation"),
    assignContact: (input) => write((ctx) => client.contacts.assign(input, ctx), "assignContact"),
    updateContactAssignment: (v) =>
      write((ctx) => client.contacts.update(v.id, v.patch, ctx), "updateContactAssignment"),
    unassignContact: (id) =>
      write((ctx) => client.contacts.unassign(id, ctx), "unassignContact"),
    addGroupMember: (v) =>
      write((ctx) => client.customerGroups.addMember(v.groupId, v.member, ctx), "addGroupMember"),
    removeGroupMember: (v) =>
      write(
        (ctx) => client.customerGroups.removeMember(v.groupId, v.userId, ctx),
        "removeGroupMember",
      ),
  };
}
