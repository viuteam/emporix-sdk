import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import {
  type Customer,
  type CustomerUpdateInput,
  type PasswordChangeInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerCtxResolver } from "./internal/use-read-auth";

/**
 * Updates the logged-in customer's profile and invalidates the `me` query.
 * Without a customer token the mutation fails; rendering does not.
 */
export function useUpdateCustomer(): UseMutationResult<Customer, unknown, CustomerUpdateInput> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  const qc = useQueryClient();
  return useMutation<Customer, unknown, CustomerUpdateInput>({
    mutationFn: (patch) => client.customers.update(patch, customerCtx()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["emporix", "customer", "me"] });
    },
  });
}

/**
 * Changes the customer's password. No cache invalidation — no read query
 * surfaces the password. Without a customer token the mutation fails;
 * rendering does not.
 */
export function useChangePassword(): UseMutationResult<void, unknown, PasswordChangeInput> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  return useMutation<void, unknown, PasswordChangeInput>({
    mutationFn: (input) => client.customers.changePassword(input, customerCtx()),
  });
}
