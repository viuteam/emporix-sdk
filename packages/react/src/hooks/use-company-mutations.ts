import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type LegalEntity,
  type LegalEntityCreate,
  type LegalEntityUpdate,
  type ContactAssignment,
  type ContactAssignmentCreate,
  type ContactAssignmentUpdate,
  type Location,
  type LocationCreate,
  type LocationUpdate,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

/**
 * Internal: build an `AuthContext` from the stored customer token. The
 * mutation throws inside `mutationFn` if the token is missing — this matches
 * `useAddressMutations` and produces a typed React-Query error.
 */
function useCustomerAuthResolver(): () => AuthContext {
  const { storage } = useEmporix();
  return () => {
    const token = storage.getCustomerToken();
    if (!token) throw new Error("Mutation requires a logged-in customer token");
    return auth.customer(token);
  };
}

// ---- Companies ----

export function useCreateCompany(): UseMutationResult<{ id: string }, unknown, LegalEntityCreate> {
  const { client } = useEmporix();
  const resolveAuth = useCustomerAuthResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => client.companies.create(input, resolveAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emporix", "companies", "mine"] }),
  });
}

export function useUpdateCompany(): UseMutationResult<
  LegalEntity,
  unknown,
  { id: string; patch: LegalEntityUpdate }
> {
  const { client } = useEmporix();
  const resolveAuth = useCustomerAuthResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => client.companies.update(id, patch, resolveAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emporix", "companies"] }),
  });
}

export function useDeleteCompany(): UseMutationResult<void, unknown, string> {
  const { client } = useEmporix();
  const resolveAuth = useCustomerAuthResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.companies.delete(id, resolveAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["emporix", "companies"] }),
  });
}

// ---- Contacts ----

export function useAssignContact(): UseMutationResult<
  { id: string },
  unknown,
  ContactAssignmentCreate
> {
  const { client } = useEmporix();
  const resolveAuth = useCustomerAuthResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => client.contacts.assign(input, resolveAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("contacts") }),
  });
}

export function useUpdateContactAssignment(): UseMutationResult<
  ContactAssignment,
  unknown,
  { id: string; patch: ContactAssignmentUpdate }
> {
  const { client } = useEmporix();
  const resolveAuth = useCustomerAuthResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => client.contacts.update(id, patch, resolveAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("contacts") }),
  });
}

export function useUnassignContact(): UseMutationResult<void, unknown, string> {
  const { client } = useEmporix();
  const resolveAuth = useCustomerAuthResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.contacts.unassign(id, resolveAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("contacts") }),
  });
}

// ---- Locations ----

export function useCreateLocation(): UseMutationResult<{ id: string }, unknown, LocationCreate> {
  const { client } = useEmporix();
  const resolveAuth = useCustomerAuthResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => client.locations.create(input, resolveAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("locations") }),
  });
}

export function useUpdateLocation(): UseMutationResult<
  Location,
  unknown,
  { id: string; patch: LocationUpdate }
> {
  const { client } = useEmporix();
  const resolveAuth = useCustomerAuthResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => client.locations.update(id, patch, resolveAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("locations") }),
  });
}

export function useDeleteLocation(): UseMutationResult<void, unknown, string> {
  const { client } = useEmporix();
  const resolveAuth = useCustomerAuthResolver();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => client.locations.delete(id, resolveAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("locations") }),
  });
}
