import { inject } from "@angular/core";
import { injectQueryClient } from "@tanstack/angular-query-experimental";
import { auth, type AuthContext, type EmporixClient, type EmporixStorage } from "@viu/emporix-sdk";
import { EMPORIX_CLIENT, EMPORIX_SITE_INTERNAL, EMPORIX_STORAGE } from "./tokens";
import type { SiteStateWritables } from "./site";

/**
 * The `isSwitching`-bracketed async tail shared by all three switches: flip the
 * in-flight flag, await the server work, surface a failure via `switchError`
 * WITHOUT rolling back the already-applied optimistic state.
 *
 * No rollback is deliberate: by the time the server work fails, the cache has
 * been invalidated and the UI has moved on. Reverting would show the user a site
 * or currency they did not choose.
 */
async function runSwitch(work: () => Promise<unknown>, w: SiteStateWritables): Promise<void> {
  w.isSwitching.set(true);
  try {
    await work();
  } catch (e) {
    w.switchError.set(e instanceof Error ? e : new Error(String(e)));
  } finally {
    w.isSwitching.set(false);
  }
}

/** Resolve the auth context from whatever token is stored right now. */
const ctxFor = (storage: EmporixStorage): AuthContext => {
  const token = storage.getCustomerToken();
  return token !== null ? auth.customer(token) : auth.anonymous();
};

export interface EmporixSiteSwitch {
  /** Switch the active site. `null` unbinds it. Optimistic; the cart is dropped. */
  setSite(code: string | null): Promise<void>;
  /** Switch currency. Must be in the active site's `availableCurrencies`. */
  setCurrency(currency: string): Promise<void>;
  /** Switch language. Does not touch the cart — language does not affect price. */
  setLanguage(language: string): Promise<void>;
}

/** The site mutation API. Must be called in an injection context. */
export function injectEmporixSiteSwitch(): EmporixSiteSwitch {
  const client: EmporixClient = inject(EMPORIX_CLIENT);
  const storage: EmporixStorage = inject(EMPORIX_STORAGE);
  const w = inject(EMPORIX_SITE_INTERNAL);
  const qc = injectQueryClient();

  return {
    async setSite(code) {
      storage.setSiteCode(code);
      // Carts are site-bound: keeping one across a switch prices it wrongly.
      storage.setCartId(null);
      w.siteCode.set(code);
      w.switchError.set(null);
      void qc.invalidateQueries({ queryKey: ["emporix"] });

      if (code === null) {
        w.currency.set(null);
        w.targetLocation.set(null);
        return;
      }

      await runSwitch(async () => {
        const site = await client.sites.get(code, ctxFor(storage));
        const nextCurrency = site.currency ?? null;
        const nextTarget = site.homeBase?.address?.country ?? null;
        w.currency.set(nextCurrency);
        w.targetLocation.set(nextTarget);
        // Reset the language if the new site does not offer the active one.
        if (
          site.languages &&
          !site.languages.includes(w.language() ?? "") &&
          site.defaultLanguage
        ) {
          w.language.set(site.defaultLanguage);
          client.setStorefrontContext({ language: site.defaultLanguage });
        }
        await client.sessionContext.patch(
          {
            siteCode: code,
            ...(nextCurrency !== null ? { currency: nextCurrency } : {}),
            ...(nextTarget !== null ? { targetLocation: nextTarget } : {}),
          },
          ctxFor(storage),
        );
      }, w);
    },

    async setCurrency(currency) {
      // Carts are currency-bound — drop it so a fresh one is created.
      storage.setCartId(null);
      w.currency.set(currency);
      w.switchError.set(null);
      // Re-bind the anonymous price context so guest pricing changes even
      // before a session or cart exists; sessionContext.patch cannot do that.
      client.setStorefrontContext({ currency });
      void qc.invalidateQueries({ queryKey: ["emporix"] });
      await runSwitch(async () => {
        const code = w.siteCode();
        await client.sessionContext.patch(
          { currency, ...(code !== null ? { siteCode: code } : {}) },
          ctxFor(storage),
        );
      }, w);
    },

    async setLanguage(language) {
      storage.setLanguage(language);
      w.language.set(language);
      w.switchError.set(null);
      // The Accept-Language source — applies to anonymous and pre-session reads.
      client.setStorefrontContext({ language });
      void qc.invalidateQueries({ queryKey: ["emporix"] });
      await runSwitch(async () => {
        const code = w.siteCode();
        await client.sessionContext.patch(
          { language, ...(code !== null ? { siteCode: code } : {}) },
          ctxFor(storage),
        );
      }, w);
    },
  };
}
