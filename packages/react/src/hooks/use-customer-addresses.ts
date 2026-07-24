import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type Address,
  type AddressCreateInput,
  type AddressUpdateInput,
  type AuthContext,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx, type QueryOpts } from "./internal/use-read-auth";
import { useCustomerToken } from "./internal/use-storage-snapshot";
import { useEmporixQuery } from "./internal/use-emporix-query";
import { useActiveCompany } from "../company-context";

const ADDRESSES_KEY = ["emporix", "customer", "addresses"] as const;

/**
 * Lists the logged-in customer's addresses. Disabled when no customer token
 * is in storage (returns idle state, not an error).
 */
export function useCustomerAddresses(options: QueryOpts = {}): UseQueryResult<Address[]> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  const { activeCompany } = useActiveCompany();
  const ctx: AuthContext | null = options.auth ?? (token ? auth.customer(token) : null);
  return useQuery({
    queryKey: [
      ...ADDRESSES_KEY,
      { tenant: client.tenant, hasToken: token !== null, legalEntityId: activeCompany?.id ?? null },
    ],
    enabled: ctx !== null,
    queryFn: () => client.customers.addresses.list(ctx as AuthContext),
  });
}

/** Address CRUD mutations. Each invalidates `customer.addresses` on success. */
export interface AddressMutationsApi {
  add: UseMutationResult<Address, unknown, AddressCreateInput>;
  update: UseMutationResult<Address, unknown, { id: string; patch: AddressUpdateInput }>;
  remove: UseMutationResult<void, unknown, { id: string }>;
}

export function useAddressMutations(): AddressMutationsApi {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ADDRESSES_KEY });
  };

   
  return {
    add: useMutation<Address, unknown, AddressCreateInput>({
      mutationFn: (input) => client.customers.addresses.add(input, ctx),
      onSuccess: invalidate,
    }),
    update: useMutation<Address, unknown, { id: string; patch: AddressUpdateInput }>({
      mutationFn: ({ id, patch }) => client.customers.addresses.update(id, patch, ctx),
      onSuccess: invalidate,
    }),
    remove: useMutation<void, unknown, { id: string }>({
      mutationFn: ({ id }) => client.customers.addresses.remove(id, ctx),
      onSuccess: invalidate,
    }),
  };

}

/** Reads one of the logged-in customer's addresses. Disabled when no id/token. */
export function useCustomerAddress(id: string | undefined): UseQueryResult<Address> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "customer-address", args: [id ?? null],
    enabled: typeof id === "string" && id !== "",
    queryFn: (ctx) => client.customers.addresses.get(id as string, ctx),
  });
}

/** Adds tags to a customer address, then invalidates the addresses list. */
export function useAddAddressTags(): UseMutationResult<void, unknown, { id: string; tags: string[] }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tags }) => client.customers.addresses.addTags(id, tags, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ADDRESSES_KEY }),
  });
}

/** Removes tags from a customer address, then invalidates the addresses list. */
export function useRemoveAddressTags(): UseMutationResult<void, unknown, { id: string; tags: string[] }> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tags }) => client.customers.addresses.removeTags(id, tags, ctx),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ADDRESSES_KEY }),
  });
}
