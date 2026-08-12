import { EmporixClient } from "@viu/emporix-sdk";
import { resolveEnvironment } from "./environments";

const clients = new Map<string, EmporixClient>();

// Resolved once per module load. `import.meta.env.MODE` is the mode the bundle
// was built with, so a build:stage bundle talks to the stage API without any
// runtime configuration.
const { apiUrl } = resolveEnvironment(import.meta.env.MODE, import.meta.env);

/**
 * One client per tenant, memoized on tenant and NOT on the token: the token is
 * a request credential, and rebuilding the client on rotation would throw away
 * its caches.
 *
 * `credentials: {}` is legal and intended — the host owns the token, so no
 * client-credentials or storefront client id exist. `host` comes from
 * `environments.ts`, keyed on the build mode, because the dashboard's dev,
 * stage and prod environments each have their own API host.
 */
export function clientFor(tenant: string): EmporixClient {
  let c = clients.get(tenant);
  if (!c) {
    c = new EmporixClient({
      tenant,
      host: apiUrl,
      credentials: {},
    });
    clients.set(tenant, c);
  }
  return c;
}
