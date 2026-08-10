import { EmporixClient } from "@viu/emporix-sdk";

const clients = new Map<string, EmporixClient>();

/**
 * One client per tenant, memoized on tenant and NOT on the token: the token is
 * a request credential, and rebuilding the client on rotation would throw away
 * its caches.
 *
 * `credentials: {}` is legal and intended — the host owns the token, so no
 * client-credentials or storefront client id exist. `host` is explicit because
 * the dashboard's dev environment is not the SDK's default host.
 */
export function clientFor(tenant: string): EmporixClient {
  let c = clients.get(tenant);
  if (!c) {
    c = new EmporixClient({
      tenant,
      host: import.meta.env.VITE_API_URL,
      credentials: {},
    });
    clients.set(tenant, c);
  }
  return c;
}
