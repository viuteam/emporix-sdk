import { inject, signal, type Signal } from "@angular/core";
import { injectQueryClient } from "@tanstack/angular-query-experimental";
import {
  auth,
  type ChangeEmailInput,
  type ConfirmEmailChangeInput,
  type EmporixClient,
  type EmporixStorage,
  type PasswordChangeInput,
  type ResendActivationInput,
} from "@viu/emporix-sdk";
import { EMPORIX_CLIENT, EMPORIX_STORAGE } from "./tokens";

/**
 * Credential and email management for the signed-in-or-not customer.
 *
 * The four operations split into two auth models, and getting that wrong is the
 * whole difficulty:
 *
 * - `changePassword` and `changeEmail` **require a customer token**. They act on
 *   an account the caller is already holding.
 * - `confirmEmailChange` and `resendActivation` are **anonymous**. Their input is
 *   a token or an address that arrived by email, at a point where there is no
 *   session — gating them on a login would make a confirmation link unusable.
 *
 * `confirmSignup` is the fifth operation of this family and deliberately lives on
 * {@link injectCustomerSession} instead: it returns a `CustomerSession`, so it
 * establishes a login and needs the same cart-onboarding and preferred-site
 * handling as `login` itself.
 */
export interface EmporixCustomerCredentials {
  /** In flight for any of the four operations. */
  isPending: Signal<boolean>;
  /** The last failure, cleared when the next call starts. */
  error: Signal<Error | null>;
  /** Requires a signed-in customer. No cache is invalidated — no read exposes a password. */
  changePassword(input: PasswordChangeInput): Promise<void>;
  /** Requests a login-email change. Requires a signed-in customer. */
  changeEmail(input: ChangeEmailInput): Promise<void>;
  /** Confirms a login-email change with the emailed token. Anonymous by design. */
  confirmEmailChange(input: ConfirmEmailChangeInput): Promise<void>;
  /** Resends the double opt-in activation link. Anonymous by design. */
  resendActivation(input: ResendActivationInput): Promise<void>;
}

/** Credential and email management. Must be called in an injection context. */
export function injectCustomerCredentials(): EmporixCustomerCredentials {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const qc = injectQueryClient();

  const isPending = signal(false);
  const error = signal<Error | null>(null);

  const run = async <T>(work: () => Promise<T>): Promise<T> => {
    error.set(null);
    isPending.set(true);
    try {
      return await work();
    } catch (e) {
      error.set(e instanceof Error ? e : new Error(String(e)));
      throw e;
    } finally {
      isPending.set(false);
    }
  };

  /**
   * The customer context, or a thrown error.
   *
   * Thrown here rather than passed as `undefined`: the SDK would reject it at its
   * own boundary anyway, and a local throw names which operation was attempted
   * without a session.
   */
  const customerCtx = (operation: string) => {
    const token = storage.getCustomerToken();
    if (token === null) {
      throw new Error(`${operation} requires a signed-in customer`);
    }
    return auth.customer(token);
  };

  return {
    isPending: isPending.asReadonly(),
    error: error.asReadonly(),

    changePassword: (input) =>
      run(async () => {
        await client.customers.changePassword(input, customerCtx("changePassword"));
        // Deliberately no invalidation: no read query surfaces a password, so
        // there is nothing stale to drop.
      }),

    changeEmail: (input) =>
      run(async () => {
        await client.customers.changeEmail(input, customerCtx("changeEmail"));
        // The address on file has not changed yet — Emporix sends a confirmation
        // first — but the profile carries the pending state, so refetch it.
        await qc.invalidateQueries({ queryKey: ["emporix", "customer-me"] });
      }),

    confirmEmailChange: (input) =>
      run(async () => {
        // Anonymous on purpose: the token arrived by email and the visitor
        // following that link has no session.
        await client.customers.confirmEmailChange(input, auth.anonymous());
        await qc.invalidateQueries({ queryKey: ["emporix", "customer-me"] });
      }),

    resendActivation: (input) =>
      run(async () => {
        await client.customers.resendActivation(input, auth.anonymous());
      }),
  };
}
