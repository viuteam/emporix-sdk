import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { EmporixClient } from '@viu/emporix-sdk';
import { provideEmporix } from '@viu/emporix-sdk-angular';
import { createLocalStorage } from '@viu/emporix-sdk-angular/storage';
import { routes } from './app.routes';

const client = new EmporixClient({
  tenant: 'viu',
  // Storefront-only: never put a backend secret in browser code.
  credentials: {
    storefront: {
      clientId: '',
      // Bound at anonymous-login so prices.matchByContext can resolve.
      context: { currency: 'CHF', siteCode: 'main', targetLocation: 'CH' },
    },
  },
});

/**
 * The point of this file is the two imports above.
 *
 * This example exists to prove that a tsup-built artifact survives
 * `ng build --configuration production` with AOT and `ngJitMode: false` — the
 * premise the whole package rests on. Importing from both the root entry and the
 * `/storage` subpath exercises the `exports` map as a consumer's bundler sees
 * it, not just as tsc sees it.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideEmporix({ client, storage: createLocalStorage() }),
  ],
};
