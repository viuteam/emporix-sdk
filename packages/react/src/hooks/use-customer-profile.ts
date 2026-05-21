import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import {
  type Customer,
  type CustomerUpdateInput,
  type PasswordChangeInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerOnlyCtx } from "./internal/use-read-auth";

/** Updates the logged-in customer's profile and invalidates the `me` query. */
export function useUpdateCustomer(): UseMutationResult<Customer, unknown, CustomerUpdateInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  const qc = useQueryClient();
  return useMutation<Customer, unknown, CustomerUpdateInput>({
    mutationFn: (patch) => client.customers.update(patch, ctx),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["emporix", "customer", "me"] });
    },
  });
}

/**
 * Changes the customer's password. No cache invalidation — no read query
 * surfaces the password.
 */
export function useChangePassword(): UseMutationResult<void, unknown, PasswordChangeInput> {
  const { client } = useEmporix();
  const ctx = useCustomerOnlyCtx();
  return useMutation<void, unknown, PasswordChangeInput>({
    mutationFn: (input) => client.customers.changePassword(input, ctx),
  });
}
