import { computed, inject, type Signal } from "@angular/core";
import type { QueryClient } from "@tanstack/angular-query-experimental";
import type { EmporixClient, EmporixStorage, LegalEntity } from "@viu/emporix-sdk";
import { EMPORIX_COMPANY_INTERNAL } from "./tokens";
import type { CompanyStateWritables } from "./company";

/**
 * The rescope sequence, shared by the switch API and the bootstrap's auto-pick.
 *
 * Order matters and every step earns its place:
 *
 * 1. **Refresh the customer token with the new `legalEntityId`.** The scope lives
 *    server-side; a local-only switch shows B2B prices the API will not honour.
 * 2. **Persist the rotated refresh token.** Emporix may rotate it, and dropping
 *    the new one strands the session at the next refresh.
 * 3. **Drop the cart id.** The cart belongs to the old scope; keeping it prices
 *    the basket against a company the customer just left.
 * 4. **Persist and publish the new entity, then invalidate.**
 *
 * With no refresh token there is no rescope to make, so it falls back to
 * local-state-only rather than failing. That is the fresh-load-with-memory-storage
 * case: a scope that is right in the UI and stale on the next request beats a
 * switch that refuses to happen at all.
 */
async function rescopeTo(
  client: EmporixClient,
  storage: EmporixStorage,
  qc: QueryClient,
  state: CompanyStateWritables,
  target: LegalEntity | null,
): Promise<void> {
  const from = state.activeCompany()?.id ?? null;
  const refreshToken = storage.getRefreshToken?.() ?? null;
  const token = storage.getCustomerToken();

  if (refreshToken === null || token === null) {
    state.activeCompany.set(target);
    storage.setActiveLegalEntityId(target?.id ?? null);
    return;
  }

  const next = await client.customers.refresh({
    refreshToken,
    ...(target?.id !== undefined ? { legalEntityId: target.id } : {}),
  });
  storage.setCustomerToken(next.customerToken);
  if (next.refreshToken !== undefined && next.refreshToken !== null) {
    storage.setRefreshToken?.(next.refreshToken);
  }
  storage.setCartId(null);
  storage.setActiveLegalEntityId(target?.id ?? null);
  state.activeCompany.set(target);

  await qc.invalidateQueries({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      q.queryKey.some(
        (k) =>
          k === "cart" ||
          k === "cart-items" ||
          k === "my-companies" ||
          k === "company" ||
          k === "company-contacts" ||
          k === "company-groups" ||
          k === "company-locations" ||
          k === "customer-me" ||
          k === from ||
          (target !== null && k === target.id),
      ),
  });
}

/**
 * Builds the serialized rescope for one injector.
 *
 * **A queue, not a race guard.** Two concurrent switches would both read the
 * same refresh token, and Emporix may rotate it server-side, so the second call
 * spends a token the first already consumed: a 401 at best, a revoked session at
 * worst. `site-switch.ts` can get away with a race guard because it rotates
 * nothing; this cannot.
 *
 * Called once from `provideEmporix`, so the bootstrap's auto-pick and every
 * user click share one queue. Building it per injection — the obvious mistake —
 * would give each component its own chain and serialize nothing.
 */
export function createRescope(
  client: EmporixClient,
  storage: EmporixStorage,
  qc: QueryClient,
): (state: CompanyStateWritables, target: LegalEntity | null) => Promise<void> {
  let chain: Promise<void> = Promise.resolve();
  return (state, target) => {
    const run = (): Promise<void> => rescopeTo(client, storage, qc, state, target);
    const task = chain.then(run, run);
    // Keep the queue alive after a failure: one rejected switch must not wedge
    // every later one.
    chain = task.catch(() => undefined);
    return task;
  };
}

export interface EmporixCompanySwitch {
  /**
   * Switch the active legal entity, or `null` for B2C.
   *
   * Rejects an id the customer is not assigned to rather than sending it — the
   * server would answer with a scope error only after the token was rotated.
   *
   * Does not throw on a failed switch: the failure lands on `switchError` and
   * `status` goes to `error`, matching how the site switch reports.
   */
  setActiveCompany(legalEntityId: string | null): Promise<void>;
  /** Re-list the customer's companies and re-resolve the active one. */
  refetchMyCompanies(): Promise<void>;
  isSwitching: Signal<boolean>;
  switchError: Signal<unknown>;
}

/** The company mutation API. Must be called in an injection context. */
export function injectCompanySwitch(): EmporixCompanySwitch {
  const internal = inject(EMPORIX_COMPANY_INTERNAL);
  const w = internal.internal;

  return {
    isSwitching: computed(() => internal.status() === "switching"),
    switchError: internal.error,

    async setActiveCompany(legalEntityId) {
      w.error.set(null);
      w.status.set("switching");
      try {
        const target =
          legalEntityId === null
            ? null
            : (w.myCompanies().find((c) => c.id === legalEntityId) ?? null);
        if (legalEntityId !== null && target === null) {
          throw new Error(
            `setActiveCompany: "${legalEntityId}" is not one of the customer's companies`,
          );
        }
        await w.rescope(target);
        w.status.set("idle");
      } catch (e) {
        w.error.set(e);
        w.status.set("error");
      }
    },

    async refetchMyCompanies() {
      await w.reload();
    },
  };
}
