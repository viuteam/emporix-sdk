import { EmporixClient } from "@viu/emporix-sdk";
import { emporixTagsForUrl } from "./tags";

/** `next` is a Next.js extension to `RequestInit`, not part of the standard. */
interface NextRequestInit extends RequestInit {
  next?: { tags?: string[]; revalidate?: number };
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * A `fetch` that attaches Next cache tags to cacheable Emporix GETs and passes
 * everything else through untouched.
 *
 * Only GET is tagged — a cached mutation would be a correctness bug. Which URLs
 * are cacheable is decided by {@link emporixTagsForUrl}; cart, order, customer
 * and token endpoints map to no tags and are therefore never cached.
 *
 * This wrapper does NOT and CANNOT distinguish an anonymous from a
 * customer-scoped request: `AuthContext` is per call and both arrive as
 * `Bearer <jwt>`. Use {@link getEmporixClient} with `tagged: false` for anything
 * carrying a customer token — Next's fetch cache does not key on the
 * `Authorization` header, so a personalized response cached here would be
 * served to other visitors.
 */
export function createTaggingFetch(opts: {
  tenant: string;
  revalidate: number;
}): typeof globalThis.fetch {
  return (input, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method !== "GET") return globalThis.fetch(input, init);
    const tags = emporixTagsForUrl(urlOf(input), opts.tenant);
    if (tags.length === 0) return globalThis.fetch(input, init);
    const tagged: NextRequestInit = {
      ...init,
      next: { tags, revalidate: opts.revalidate },
    };
    return globalThis.fetch(input, tagged);
  };
}

export interface GetEmporixClientOptions {
  /** Default: `process.env.EMPORIX_TENANT`. */
  tenant?: string;
  /** Storefront (anonymous) client id. Default: `process.env.EMPORIX_STOREFRONT_CLIENT_ID`. */
  clientId?: string;
  /** Default: `process.env.EMPORIX_HOST`, else the SDK default. */
  host?: string;
  /**
   * Attach cache tags to cacheable GETs. Default `true`.
   * MUST be `false` for any client used with a customer token.
   */
  tagged?: boolean;
  /** Seconds; becomes `next: { revalidate }` on tagged GETs. Default 3600. */
  revalidate?: number;
  /**
   * Storefront request context, bound at anonymous login. Needed for
   * `prices.matchByContext`, and for prefetch-key parity with the client-side
   * `EmporixProvider` — the provider binds the same values, and a mismatch
   * turns a hydration cache hit into a miss.
   */
  context?: {
    currency?: string;
    siteCode?: string;
    targetLocation?: string;
    language?: string;
  };
}

const clients = new Map<string, EmporixClient>();

/**
 * A memoized `EmporixClient` for a Next server. One instance per distinct option
 * set, never one per request — a per-request client defeats the SDK's token
 * cache.
 *
 * The option set is deliberately narrow so the memoization key can cover all of
 * it. Need more configuration? Construct `new EmporixClient` yourself and pass
 * `fetch: createTaggingFetch({ tenant, revalidate })`.
 *
 * ```ts
 * getEmporixClient()                    // tagged + cacheable — anonymous reads
 * getEmporixClient({ tagged: false })   // untagged — anything with a customer token
 * ```
 */
export function getEmporixClient(opts: GetEmporixClientOptions = {}): EmporixClient {
  const tenant = opts.tenant ?? process.env.EMPORIX_TENANT;
  if (!tenant) {
    throw new Error("getEmporixClient: no tenant. Set EMPORIX_TENANT or pass { tenant }.");
  }
  const clientId = opts.clientId ?? process.env.EMPORIX_STOREFRONT_CLIENT_ID;
  if (!clientId) {
    throw new Error(
      "getEmporixClient: no storefront client id. Set EMPORIX_STOREFRONT_CLIENT_ID or pass { clientId }.",
    );
  }
  const host = opts.host ?? process.env.EMPORIX_HOST;
  const tagged = opts.tagged ?? true;
  const revalidate = opts.revalidate ?? 3600;

  // JSON.stringify is key-order-dependent, so the same context written with its
  // fields in a different order yields a second instance. Wasteful, not wrong.
  //
  // The map grows with the number of DISTINCT contexts, not with requests. An app
  // that derives the context per request — a visitor's language or site choice,
  // as `examples/next-server-first` does — therefore holds one client per
  // combination that actually occurs. Bounded by the configuration, not by
  // traffic, and no state crosses between visitors: the context is part of the
  // key, so two languages cannot share an instance.
  const key = `${tenant}|${clientId}|${host ?? ""}|${tagged}|${revalidate}|${JSON.stringify(opts.context ?? {})}`;
  const cached = clients.get(key);
  if (cached) return cached;

  const client = new EmporixClient({
    tenant,
    credentials: {
      storefront: {
        clientId,
        ...(opts.context !== undefined ? { context: opts.context } : {}),
      },
    },
    logger: false,
    ...(host !== undefined ? { host } : {}),
    ...(tagged ? { fetch: createTaggingFetch({ tenant, revalidate }) } : {}),
  });
  clients.set(key, client);
  return client;
}

/** Test-only: clears the memoization map so each test starts clean. */
export function __resetEmporixClients(): void {
  clients.clear();
}
