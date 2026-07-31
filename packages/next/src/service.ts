import { EmporixClient, type ServiceCredentials } from "@viu/emporix-sdk";

export interface GetEmporixServiceClientOptions {
  /**
   * Named client-credentials sets. The key is the name you pass to
   * `auth.service(name)`.
   */
  credentials: Record<string, ServiceCredentials>;
  /** Default: `process.env.EMPORIX_TENANT`. */
  tenant?: string;
  /** Default: `process.env.EMPORIX_HOST`, else the SDK default. */
  host?: string;
}

const clients = new Map<string, EmporixClient>();

/**
 * A memoized `EmporixClient` holding one or more Emporix service accounts.
 *
 * **Server-only.** This module carries a client secret. Its `exports` entry
 * resolves to a throwing file outside the server graph, so importing it from a
 * `"use client"` module fails the build rather than shipping the secret to the
 * browser. Use it from a Route Handler, a Server Action or a Server Component.
 *
 * Call it at **module scope**, never inside a handler body. The SDK's token
 * cache lives on the client instance: a per-request client fetches a fresh
 * token per request and the cache does nothing. That memoization is the reason
 * this function exists.
 *
 * Token handling is entirely the SDK's: one cached token per credential set,
 * reused until `expires_in` minus a 60s buffer, behind a single-flight lock so
 * concurrent calls share one token request.
 *
 * There is deliberately **no `tagged` option**. A service client never receives
 * a `fetch`, because Next's fetch cache does not key on the `Authorization`
 * header — a cached privileged GET would be served to other visitors. An option
 * that can be set to `true` is an option someone eventually sets to `true`.
 *
 * There is deliberately **no `context` option**. `context` belongs to
 * `StorefrontCredentials` and is bound at anonymous login; a service client has
 * no storefront credentials and nowhere to put it.
 *
 * @example
 * ```ts
 * // lib/emporix-service.ts
 * export const service = getEmporixServiceClient({
 *   credentials: {
 *     productWriter: {
 *       clientId: process.env.EMPORIX_PRODUCT_WRITER_ID!,
 *       secret: process.env.EMPORIX_PRODUCT_WRITER_SECRET!,
 *       scope: "product.product_create",
 *     },
 *   },
 * });
 *
 * // app/api/products/route.ts
 * await service.products.create(input, {}, auth.service("productWriter"));
 * ```
 */
export function getEmporixServiceClient(
  opts: GetEmporixServiceClientOptions,
): EmporixClient {
  const tenant = opts.tenant ?? process.env.EMPORIX_TENANT;
  if (!tenant) {
    throw new Error(
      "getEmporixServiceClient: no tenant. Set EMPORIX_TENANT or pass { tenant }.",
    );
  }

  const names = Object.keys(opts.credentials);
  if (names.length === 0) {
    throw new Error(
      "getEmporixServiceClient: credentials is empty. Pass at least one named credential set.",
    );
  }
  for (const name of names) {
    const set = opts.credentials[name];
    if (!set?.clientId || !set.secret) {
      throw new Error(
        `getEmporixServiceClient: credential set "${name}" is missing clientId or secret. ` +
          "An unset environment variable yields an empty string, which Emporix rejects " +
          "as a 401 that looks like a permissions problem.",
      );
    }
  }

  const host = opts.host ?? process.env.EMPORIX_HOST;
  // The secrets are part of the key. They are already held in
  // ResolvedConfig.credentials for the life of the process, so this adds no
  // exposure — and a key without them could silently return a client carrying
  // the wrong secret for a set of the same name.
  const key = JSON.stringify({ tenant, host: host ?? "", credentials: opts.credentials });
  const cached = clients.get(key);
  if (cached) return cached;

  const client = new EmporixClient({
    tenant,
    credentials: { custom: opts.credentials },
    logger: false,
    ...(host !== undefined ? { host } : {}),
    // No `fetch`. See the note above — omitting it is the security property.
  });
  clients.set(key, client);
  return client;
}

/** Test-only: clears the memoization map so each test starts clean. */
export function __resetEmporixServiceClients(): void {
  clients.clear();
}
