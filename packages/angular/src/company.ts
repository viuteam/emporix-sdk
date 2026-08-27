import { computed, inject, signal, type Signal, type WritableSignal } from "@angular/core";
import { auth, type EmporixClient, type EmporixStorage, type LegalEntity } from "@viu/emporix-sdk";
import { EMPORIX_COMPANY } from "./tokens";

export type CompanyMode = "b2c" | "b2b" | "unresolved";

export interface EmporixCompanyState {
  /** The active legal entity. `null` means B2C. */
  activeCompany: Signal<LegalEntity | null>;
  /** Every legal entity the signed-in customer is assigned to. */
  myCompanies: Signal<readonly LegalEntity[]>;
  /**
   * `b2b` — a company is active.
   * `b2c` — none active, and at most one available.
   * `unresolved` — several available and none picked. **Render a picker.** A
   * storefront that treats this as B2C shows one company's prices to a buyer who
   * belongs to another.
   */
  mode: Signal<CompanyMode>;
  status: Signal<"idle" | "loading" | "switching" | "error">;
  error: Signal<unknown>;
}

/** Writable handles, for the switch functions in `company-switch.ts`. */
export interface CompanyStateWritables {
  activeCompany: WritableSignal<LegalEntity | null>;
  myCompanies: WritableSignal<readonly LegalEntity[]>;
  status: WritableSignal<"idle" | "loading" | "switching" | "error">;
  error: WritableSignal<unknown>;
  /** Re-runs the bootstrap: list the companies and resolve the active one. */
  reload: () => Promise<void>;
  /**
   * The injector's single serialized rescope, already bound to this state.
   *
   * Lives here rather than being built by `injectCompanySwitch` so the
   * bootstrap's auto-pick and every user click share one queue — see
   * `createRescope`.
   */
  rescope: (target: LegalEntity | null) => Promise<void>;
}

export type EmporixCompanyInternal = EmporixCompanyState & { internal: CompanyStateWritables };

/**
 * Resolve and track the active legal entity.
 *
 * Mirrors `createSiteState`: one factory, called once per injector, exposing
 * read-only signals plus writable handles that only `company-switch.ts` holds.
 *
 * Resolution order on bootstrap: explicit `initialLegalEntityId` → storage →
 * `null`. The id is then matched against what the tenant says the customer is
 * assigned to, because a persisted id the customer no longer belongs to must not
 * silently stay active.
 *
 * **A customer with exactly one company is switched into it automatically**, and
 * that switch rescopes the token — the same behaviour React has. A single-company
 * B2B customer should not have to pick.
 *
 * Re-runs on token-*presence* transitions only, so login and logout rebootstrap
 * while a mid-session token swap does not. Without that distinction the
 * auto-pick would fire on the token the switch itself just wrote and clobber an
 * explicit B2C choice.
 */
export function createCompanyState(
  client: EmporixClient,
  storage: EmporixStorage,
  init: { legalEntityId?: string },
  rescope: (state: CompanyStateWritables, target: LegalEntity | null) => Promise<void>,
): EmporixCompanyInternal {
  const activeCompany = signal<LegalEntity | null>(null);
  const myCompanies = signal<readonly LegalEntity[]>([]);
  const status = signal<"idle" | "loading" | "switching" | "error">("idle");
  const error = signal<unknown>(null);

  const mode = computed<CompanyMode>(() => {
    if (activeCompany() !== null) return "b2b";
    return myCompanies().length > 1 ? "unresolved" : "b2c";
  });

  const writables: CompanyStateWritables = {
    activeCompany,
    myCompanies,
    status,
    error,
    reload: async () => {
      await load();
    },
    rescope: (target) => rescope(writables, target),
  };

  async function load(): Promise<void> {
    const token = storage.getCustomerToken();
    if (token === null) {
      // Logged out: no companies, no active entity, and nothing to fetch.
      myCompanies.set([]);
      activeCompany.set(null);
      status.set("idle");
      return;
    }
    status.set("loading");
    try {
      const companies = await client.companies.listMine(auth.customer(token));
      myCompanies.set(companies);

      const persisted = init.legalEntityId ?? storage.getActiveLegalEntityId();
      const matched =
        persisted !== null && persisted !== undefined
          ? (companies.find((c) => c.id === persisted) ?? null)
          : null;

      if (matched !== null) {
        activeCompany.set(matched);
        if (storage.getActiveLegalEntityId() !== matched.id) {
          storage.setActiveLegalEntityId(matched.id ?? null);
        }
      } else if (companies.length === 1) {
        // One company means there is nothing to choose. Goes through the rescope
        // so the token is scoped to it, not just the local signal.
        await writables.rescope(companies[0] ?? null);
      } else {
        activeCompany.set(null);
        // A persisted id the customer is no longer assigned to is stale, and
        // leaving it would resurrect it on the next reload.
        if (persisted !== null && persisted !== undefined) storage.setActiveLegalEntityId(null);
      }
      status.set("idle");
    } catch (e) {
      error.set(e);
      status.set("error");
    }
  }

  void load();

  let previousToken = storage.getCustomerToken();
  storage.subscribe?.((next) => {
    const becameAuthenticated = previousToken === null && next !== null;
    const becameAnonymous = previousToken !== null && next === null;
    previousToken = next;
    if (becameAuthenticated || becameAnonymous) void load();
  });

  return {
    activeCompany: activeCompany.asReadonly(),
    myCompanies: myCompanies.asReadonly(),
    mode,
    status: status.asReadonly(),
    error: error.asReadonly(),
    internal: writables,
  };
}

/**
 * The active-company context: read-only signals.
 *
 * Read this to render; use `injectCompanySwitch()` to change it. Splitting them
 * is the same reason the site context is split — a component that only shows the
 * company name cannot accidentally hold a function that rotates the session
 * token.
 */
export function injectEmporixCompany(): EmporixCompanyState {
  return inject(EMPORIX_COMPANY);
}
