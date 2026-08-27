import { inject, signal, type Injector, type Signal } from "@angular/core";
import { injectQueryClient, type CreateQueryResult } from "@tanstack/angular-query-experimental";
import {
  auth,
  type Customer,
  type CustomerUpdateInput,
  type EmporixClient,
  type EmporixStorage,
  type PasswordResetConfirmInput,
  type PasswordResetRequestInput,
} from "@viu/emporix-sdk";
import { EMPORIX_CLIENT, EMPORIX_STORAGE } from "../tokens";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { requireCustomer, writeBundle } from "../write-bundle";

type AddressList = Awaited<ReturnType<EmporixClient["customers"]["addresses"]["list"]>>;
type AddressResult = Awaited<ReturnType<EmporixClient["customers"]["addresses"]["get"]>>;
type AddressAddInput = Parameters<EmporixClient["customers"]["addresses"]["add"]>[0];
type AddressUpdateInput = Parameters<EmporixClient["customers"]["addresses"]["update"]>[1];

export interface CustomerOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: CustomerOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};


/** The signed-in customer's saved addresses. Idle for a guest. */
export function injectCustomerAddresses(
  opts: CustomerOpts = {},
): CreateQueryResult<AddressList> {
  const { client } = injectEmporix();
  return injectEmporixQuery<AddressList, readonly []>(
    () => ({
      resource: "customer-addresses",
      args: [] as const,
      site: "none",
      mode: "customer",
      ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
      queryFn: (ctx) => client.customers.addresses.list(ctx),
    }),
    pass(opts),
  );
}

/** One of the signed-in customer's addresses. Disabled while the id is empty. */
export function injectCustomerAddress(
  id: Signal<string>,
  opts: CustomerOpts = {},
): CreateQueryResult<AddressResult> {
  const { client } = injectEmporix();
  return injectEmporixQuery<AddressResult, readonly [string]>(
    () => ({
      resource: "customer-address",
      args: [id()] as const,
      site: "none",
      mode: "customer",
      enabled: (opts.enabled ?? true) && id() !== "",
      queryFn: (ctx) => client.customers.addresses.get(id(), ctx),
    }),
    pass(opts),
  );
}

/** Updates the profile and refetches it. */
export interface EmporixUpdateCustomer {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  update(patch: CustomerUpdateInput): Promise<Customer>;
}

export function injectUpdateCustomer(): EmporixUpdateCustomer {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const qc = injectQueryClient();
  const isPending = signal(false);
  const error = signal<Error | null>(null);

  return {
    isPending: isPending.asReadonly(),
    error: error.asReadonly(),
    async update(patch) {
      error.set(null);
      isPending.set(true);
      try {
        const updated = await client.customers.update(
          patch,
          requireCustomer(storage, "updateCustomer"),
        );
        await qc.invalidateQueries({ queryKey: ["emporix", "customer-me"] });
        return updated;
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        error.set(err);
        throw err;
      } finally {
        isPending.set(false);
      }
    },
  };
}

/** Address writes. All customer-scoped; all refetch the address list. */
export interface EmporixAddressMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  add(input: AddressAddInput): Promise<unknown>;
  update(addressId: string, patch: AddressUpdateInput): Promise<unknown>;
  remove(addressId: string): Promise<unknown>;
  addTags(addressId: string, tags: string[]): Promise<unknown>;
  removeTags(addressId: string, tags: string[]): Promise<unknown>;
}

export function injectAddressMutations(): EmporixAddressMutations {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const b = writeBundle(
    [
      ["emporix", "customer-addresses"],
      ["emporix", "customer-address"],
    ],
    { customerOnly: true },
  );
  const write = b.write;

  return {
    isPending: b.isPending,
    error: b.error,
    add: (input) => write((ctx) => client.customers.addresses.add(input, ctx), "addAddress"),
    update: (addressId, patch) =>
      write(
        (ctx) => client.customers.addresses.update(addressId, patch, ctx),
        "updateAddress",
      ),
    remove: (addressId) =>
      write((ctx) => client.customers.addresses.remove(addressId, ctx), "removeAddress"),
    addTags: (addressId, tags) =>
      write(
        (ctx) => client.customers.addresses.addTags(addressId, tags, ctx),
        "addAddressTags",
      ),
    removeTags: (addressId, tags) =>
      write(
        (ctx) => client.customers.addresses.removeTags(addressId, tags, ctx),
        "removeAddressTags",
      ),
  };
}

/**
 * The two-step password reset.
 *
 * **Both steps are anonymous**, and that is not an oversight: the whole point of
 * this flow is that the customer is locked out. Requiring a session would make it
 * unreachable exactly when it is needed.
 */
export interface EmporixPasswordReset {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  /** Triggers the reset email. */
  request(input: PasswordResetRequestInput): Promise<void>;
  /** Consumes the emailed token together with the new password. */
  confirm(input: PasswordResetConfirmInput): Promise<void>;
}

export function injectPasswordReset(): EmporixPasswordReset {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const isPending = signal(false);
  const error = signal<Error | null>(null);

  const run = async (work: () => Promise<void>): Promise<void> => {
    error.set(null);
    isPending.set(true);
    try {
      await work();
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      error.set(err);
      throw err;
    } finally {
      isPending.set(false);
    }
  };

  return {
    isPending: isPending.asReadonly(),
    error: error.asReadonly(),
    request: (input) =>
      run(() => client.customers.requestPasswordReset(input, auth.anonymous())),
    confirm: (input) =>
      run(() => client.customers.confirmPasswordReset(input, auth.anonymous())),
  };
}
