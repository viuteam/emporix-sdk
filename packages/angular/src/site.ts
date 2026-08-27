import { inject, signal, type Signal, type WritableSignal } from "@angular/core";
import { auth, type EmporixClient, type EmporixStorage } from "@viu/emporix-sdk";
import { EMPORIX_SITE } from "./tokens";

/** The active site, as read by consumers. */
export interface EmporixSiteState {
  siteCode: Signal<string | null>;
  currency: Signal<string | null>;
  language: Signal<string | null>;
  targetLocation: Signal<string | null>;
  isSwitching: Signal<boolean>;
  switchError: Signal<Error | null>;
}

/** Writable handles, for the switch functions in `site-switch.ts`. */
export interface SiteStateWritables {
  siteCode: WritableSignal<string | null>;
  currency: WritableSignal<string | null>;
  language: WritableSignal<string | null>;
  targetLocation: WritableSignal<string | null>;
  isSwitching: WritableSignal<boolean>;
  switchError: WritableSignal<Error | null>;
}

export type EmporixSiteInternal = EmporixSiteState & { internal: SiteStateWritables };

/**
 * Resolve and derive the active site.
 *
 * Resolution order, matching React exactly: explicit init value → storage →
 * `client.config.credentials.storefront.context` → `null`.
 *
 * Then one best-effort fetch of the site DTO to fill in `currency`,
 * `targetLocation` and a default `language`. Only fields still `null` are
 * filled: a currency seeded from config or storage is the user's choice and
 * outranks the site default. A failed fetch is silent — `switchError` is
 * reserved for switches the user initiated and can retry, and a mount-time 502
 * has no action attached to it.
 */
export function createSiteState(
  client: EmporixClient,
  storage: EmporixStorage,
  init: { siteCode?: string; language?: string },
): EmporixSiteInternal {
  const ctx = client.config?.credentials?.storefront?.context;

  const siteCode = signal<string | null>(
    init.siteCode ?? storage.getSiteCode() ?? ctx?.siteCode ?? null,
  );
  const currency = signal<string | null>(ctx?.currency ?? null);
  const language = signal<string | null>(
    init.language ?? storage.getLanguage() ?? ctx?.language ?? null,
  );
  const targetLocation = signal<string | null>(null);
  const isSwitching = signal(false);
  const switchError = signal<Error | null>(null);

  // Push the resolved language to the SDK so the very first reads carry
  // Accept-Language. Signal state alone never reaches the client.
  const initialLanguage = language();
  if (initialLanguage !== null) client.setStorefrontContext({ language: initialLanguage });

  const code = siteCode();
  if (code !== null && (currency() === null || language() === null || targetLocation() === null)) {
    const token = storage.getCustomerToken();
    void client.sites
      .get(code, token !== null ? auth.customer(token) : auth.anonymous())
      .then((site) => {
        // Bail if the active site changed while this request was in flight.
        // Without this, a user calling `setSite(null)` during startup gets their
        // choice silently overwritten: `setSite(null)` clears the currency
        // synchronously, then this callback lands, sees `currency() === null`
        // and refills it from the site that is no longer active. React guards
        // the same race with a `cancelled` flag in its effect cleanup; here the
        // site code is the token, which also handles a switch to a third site.
        if (siteCode() !== code) return;
        if (currency() === null) currency.set(site.currency ?? null);
        targetLocation.set(site.homeBase?.address?.country ?? null);
        if (language() === null && site.defaultLanguage) {
          language.set(site.defaultLanguage);
          client.setStorefrontContext({ language: site.defaultLanguage });
        }
      })
      .catch(() => {
        // Best-effort. A user-initiated switch surfaces real errors through
        // switchError; this one has nothing the user could do about it.
      });
  }

  const writables: SiteStateWritables = {
    siteCode,
    currency,
    language,
    targetLocation,
    isSwitching,
    switchError,
  };
  return {
    siteCode: siteCode.asReadonly(),
    currency: currency.asReadonly(),
    language: language.asReadonly(),
    targetLocation: targetLocation.asReadonly(),
    isSwitching: isSwitching.asReadonly(),
    switchError: switchError.asReadonly(),
    internal: writables,
  };
}

/** The active site state. Must be called in an injection context. */
export function injectEmporixSite(): EmporixSiteState {
  return inject(EMPORIX_SITE);
}
