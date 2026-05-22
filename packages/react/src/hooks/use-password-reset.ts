import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import {
  auth,
  type PasswordResetRequestInput,
  type PasswordResetConfirmInput,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

/**
 * The 2-step anonymous password-reset flow. `request` triggers the reset
 * email; `confirm` consumes the token + new password. Both use anonymous
 * auth — the user is by definition locked out when running this flow.
 */
export interface PasswordResetApi {
  request: UseMutationResult<void, unknown, PasswordResetRequestInput>;
  confirm: UseMutationResult<void, unknown, PasswordResetConfirmInput>;
}

export function usePasswordReset(): PasswordResetApi {
  const { client } = useEmporix();
  const anonCtx = auth.anonymous();
   
  return {
    request: useMutation<void, unknown, PasswordResetRequestInput>({
      mutationFn: (input) => client.customers.requestPasswordReset(input, anonCtx),
    }),
    confirm: useMutation<void, unknown, PasswordResetConfirmInput>({
      mutationFn: (input) => client.customers.confirmPasswordReset(input, anonCtx),
    }),
  };
   
}
