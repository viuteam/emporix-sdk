import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import {
  auth,
  type ChangeEmailInput,
  type ConfirmEmailChangeInput,
  type ResendActivationInput,
  type CustomerSession,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useCustomerCtxResolver } from "./internal/use-read-auth";

/**
 * Requests a login-email change. Without a customer token the mutation fails;
 * rendering does not.
 */
export function useChangeEmail(): UseMutationResult<void, unknown, ChangeEmailInput> {
  const { client } = useEmporix();
  const customerCtx = useCustomerCtxResolver();
  return useMutation({ mutationFn: (input) => client.customers.changeEmail(input, customerCtx()) });
}

/** Confirms a login-email change with the emailed token (anonymous). */
export function useConfirmEmailChange(): UseMutationResult<void, unknown, ConfirmEmailChangeInput> {
  const { client } = useEmporix();
  return useMutation({
    mutationFn: (input) => client.customers.confirmEmailChange(input, auth.anonymous()),
  });
}

/** Completes double opt-in signup with the emailed token, returning a logged-in session (anonymous). */
export function useConfirmSignup(): UseMutationResult<CustomerSession, unknown, string> {
  const { client } = useEmporix();
  return useMutation({
    mutationFn: (token) => client.customers.confirmSignup(token, auth.anonymous()),
  });
}

/** Resends the double opt-in activation link (anonymous). */
export function useResendActivation(): UseMutationResult<void, unknown, ResendActivationInput> {
  const { client } = useEmporix();
  return useMutation({
    mutationFn: (input) => client.customers.resendActivation(input, auth.anonymous()),
  });
}
