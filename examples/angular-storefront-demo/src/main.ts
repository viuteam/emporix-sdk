import { provideBrowserGlobalErrorListeners } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { provideRouter, withInMemoryScrolling } from "@angular/router";
import { EmporixClient } from "@viu/emporix-sdk";
import { provideEmporix } from "@viu/emporix-sdk-angular";
import { createLocalStorage } from "@viu/emporix-sdk-angular/storage";
import { readConfig } from "./app/config";
import { routes } from "./app/routes";
import { Setup } from "./app/setup";
import { Shell } from "./app/shell";

/**
 * Two bootstraps, chosen by whether the demo is configured.
 *
 * `provideEmporix` takes a constructed client, so the tenant has to be known
 * before the injector exists. Reading the config here — before bootstrap —
 * avoids a factory provider that would have to represent "not configured yet" as
 * a valid client. The setup screen writes localStorage and reloads.
 */
const config = readConfig();

if (config === null) {
  void bootstrapApplication(Setup, {
    providers: [provideBrowserGlobalErrorListeners()],
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
  });
} else {
  const client = new EmporixClient({
    tenant: config.tenant,
    // Storefront-only. A backend secret must never reach browser code — this
    // client id is public by design and carries no scopes beyond the storefront.
    credentials: {
      storefront: {
        clientId: config.storefrontClientId,
        // Bound at anonymous login so `prices.matchByContext` can resolve. All
        // three have to agree with a price list on the tenant or prices come
        // back empty — which looks like a bug and is a configuration mismatch.
        context: {
          ...(config.currency !== undefined ? { currency: config.currency } : {}),
          ...(config.siteCode !== undefined ? { siteCode: config.siteCode } : {}),
          ...(config.targetLocation !== undefined
            ? { targetLocation: config.targetLocation }
            : {}),
          ...(config.language !== undefined ? { language: config.language } : {}),
        },
      },
    },
    ...(config.host !== undefined ? { host: config.host } : {}),
    // Shorter than the SDK defaults (10s connect / 60s read). A storefront that
    // sits on a spinner for a minute reads as broken, and the most common cause
    // is a mistyped client id — which should surface as an error, fast.
    timeouts: { connectMs: 8_000, readMs: 15_000 },
  });

  void bootstrapApplication(Shell, {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideRouter(routes, withInMemoryScrolling({ scrollPositionRestoration: "top" })),
      provideEmporix({
        client,
        // localStorage rather than memory: the cart id and the customer token
        // have to survive a reload, which is the whole point of a storefront
        // session.
        storage: createLocalStorage(),
        ...(config.siteCode !== undefined ? { initialSiteCode: config.siteCode } : {}),
        ...(config.language !== undefined ? { initialLanguage: config.language } : {}),
      }),
    ],
  }).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err);
  });
}
