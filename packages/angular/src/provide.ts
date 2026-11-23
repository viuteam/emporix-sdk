import {
  inject,
  InjectionToken,
  makeEnvironmentProviders,
  PLATFORM_ID,
  provideEnvironmentInitializer,
  type EnvironmentProviders,
} from "@angular/core";
import { isPlatformServer } from "@angular/common";
import { provideTanStackQuery, QueryClient } from "@tanstack/angular-query-experimental";
import {
  createMemoryStorage,
  createProxySessionStorage,
  EmporixNotFoundError,
  type EmporixClient,
  type EmporixStorage,
} from "@viu/emporix-sdk";
import {
  EMPORIX_CLIENT,
  EMPORIX_COMPANY,
  EMPORIX_COMPANY_INTERNAL,
  EMPORIX_PROXY_SESSION,
  EMPORIX_SITE,
  EMPORIX_SITE_INTERNAL,
  EMPORIX_STORAGE,
  type EmporixProxySession,
} from "./tokens";
import { createSiteState, type EmporixSiteInternal } from "./site";
import { createCompanyState, type EmporixCompanyInternal } from "./company";
import { createRescope } from "./company-switch";

export interface EmporixConfig {
  /**
   * The SDK client, or a factory for one. A factory runs once per application
   * injector, in its injection context.
   *
   * Under server-side rendering, pass a factory. Every request bootstraps its own
   * application, and the guest (anonymous) session lives on the client, so one
   * instance serving every request gives every guest the same cart. On the server
   * an instance that already serves another application throws.
   */
  client: EmporixClient | (() => EmporixClient);
  /**
   * Defaults to an in-memory storage, a new one per application injector, with
   * no persistence. A factory runs like `client`'s — so it can `inject(REQUEST)`
   * to read the request's cookies — and the same server rule applies.
   */
  storage?: EmporixStorage | (() => EmporixStorage);
  /**
   * Bring your own to share one cache with the host application. A factory runs
   * like `client`'s, and the same server rule applies: query keys carry no user
   * id, so a cache shared across requests serves one customer's data to the next.
   */
  queryClient?: QueryClient | (() => QueryClient);
  /** Initial site code. Order: this → storage → client config → null. */
  initialSiteCode?: string;
  /** Initial language. Order: this → storage → client config → null. */
  initialLanguage?: string;
  /**
   * Initial active legal entity. Order: this → storage → null.
   *
   * Matched against what the tenant says the customer is assigned to, so an id
   * they no longer belong to does not stay active.
   */
  initialLegalEntityId?: string;
  /**
   * Proxy (BFF) mode, for a `client` built with `proxy` — see `docs/bff.md`.
   * With such a client the browser holds no token: `storage` gets a view in front
   * of it whose token slots stay empty, the customer paths run on
   * `PROXY_CUSTOMER_TOKEN` (a marker, never sent) while `authenticated` is true,
   * `injectCustomerSession().login` / `.logout` call these callbacks, its
   * token-minting actions reject, and no company context is bootstrapped. A 401
   * goes to the client's own `proxy.onUnauthorized`. Throws with a client that is
   * not in proxy mode.
   */
  proxySession?: EmporixProxySession;
}

/**
 * Balanced query defaults, scoped to the `["emporix"]` key namespace.
 *
 * A 404 is an answer, not a failure worth repeating: the resource is gone and
 * the retry bills the tenant for the same answer. Emporix charges per API call,
 * and a stale cart id — one closed by a checkout on another device — is exactly
 * the case that would pay it on every mount.
 */
const DEFAULT_QUERY_OPTIONS = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
  retry: (count: number, error: unknown) =>
    !(error instanceof EmporixNotFoundError) && count < 1,
} as const;

/**
 * Fill gaps in the `["emporix"]` defaults without overriding intent. A
 * consumer's explicit choices win, whether set globally or emporix-scoped —
 * both are spread after ours. Host-application queries outside the namespace
 * are untouched.
 *
 * Called by `provideEmporix` once per application injector. React needs a ref
 * guard here because its provider re-renders; a provider factory runs once per
 * injector, and a second run on the same client is idempotent.
 */
export function applyEmporixQueryDefaults(qc: QueryClient): void {
  qc.setQueryDefaults(["emporix"], {
    ...DEFAULT_QUERY_OPTIONS,
    ...qc.getDefaultOptions().queries,
    ...qc.getQueryDefaults(["emporix"]),
  });
}

/**
 * Wires the SDK into an Angular application.
 *
 * Composes `provideTanStackQuery` internally, mirroring how React's
 * `EmporixProvider` renders `QueryClientProvider` itself — one call, one
 * ownership model, no second thing for the consumer to remember.
 *
 * Everything per-session — storage, query cache, site and company state — is
 * built by provider factories, once per application injector. A module-level
 * `appConfig` is therefore safe under server-side rendering, where every request
 * bootstraps its own application from it.
 *
 * @example
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideEmporix({ client: () => new EmporixClient({ ... }) })],
 * })
 * ```
 */
export function provideEmporix(config: EmporixConfig): EnvironmentProviders {
  // A client value is checked now, so the misconfiguration fails at startup; a
  // factory's client is checked when the factory runs.
  if (typeof config.client !== "function") assertProxyPairing(config.client, config.proxySession);
  const rt = (): EmporixRuntime => inject(EMPORIX_RUNTIME);
  return makeEnvironmentProviders([
    { provide: EMPORIX_RUNTIME, useFactory: () => createRuntime(config) },
    { provide: EMPORIX_CLIENT, useFactory: () => rt().client },
    { provide: EMPORIX_STORAGE, useFactory: () => rt().storage },
    { provide: EMPORIX_PROXY_SESSION, useFactory: () => rt().proxySession },
    { provide: EMPORIX_SITE, useFactory: () => rt().site },
    { provide: EMPORIX_SITE_INTERNAL, useFactory: () => rt().site.internal },
    { provide: EMPORIX_COMPANY, useFactory: () => rt().company },
    { provide: EMPORIX_COMPANY_INTERNAL, useFactory: () => rt().company },
    { provide: EMPORIX_QUERY_CLIENT, useFactory: () => rt().queryClient },
    provideTanStackQuery(EMPORIX_QUERY_CLIENT),
    // Built at bootstrap rather than on first use: the site fetch and the
    // company bootstrap must already be running when a component logs in.
    provideEnvironmentInitializer(() => inject(EMPORIX_RUNTIME)),
  ]);
}

/** What `provideEmporix` builds, once per application injector. */
interface EmporixRuntime {
  client: EmporixClient;
  storage: EmporixStorage;
  queryClient: QueryClient;
  site: EmporixSiteInternal;
  company: EmporixCompanyInternal;
  proxySession: EmporixProxySession | null;
}

const EMPORIX_RUNTIME = new InjectionToken<EmporixRuntime>("EMPORIX_RUNTIME");
const EMPORIX_QUERY_CLIENT = new InjectionToken<QueryClient>("EMPORIX_QUERY_CLIENT");

function createRuntime(config: EmporixConfig): EmporixRuntime {
  const onServer = isPlatformServer(inject(PLATFORM_ID));
  const client = own(config.client, "client", onServer);
  const proxied = assertProxyPairing(client, config.proxySession);
  const baseStorage =
    config.storage === undefined ? createMemoryStorage() : own(config.storage, "storage", onServer);
  const storage = proxied
    ? createProxySessionStorage(baseStorage, config.proxySession?.authenticated ?? false)
    : baseStorage;
  const queryClient =
    config.queryClient === undefined
      ? new QueryClient()
      : own(config.queryClient, "queryClient", onServer);
  applyEmporixQueryDefaults(queryClient);
  // The guest session lives on the client. Keeping it in the storage is what lets
  // a guest's cart survive a reload — the wiring React's provider does too. Safe
  // because on the server this client serves this application only (see `own`).
  // `?.` because a proxy client has no anonymous store, and test doubles no provider.
  client.tokenProvider?.attachAnonymousStore?.({
    read: () => storage.getAnonymousSession(),
    write: (session) => storage.setAnonymousSession(session),
  });
  const site = createSiteState(client, storage, {
    ...(config.initialSiteCode !== undefined ? { siteCode: config.initialSiteCode } : {}),
    ...(config.initialLanguage !== undefined ? { language: config.initialLanguage } : {}),
  });
  // One rescope queue per injector, built here rather than in
  // `injectCompanySwitch`, so the bootstrap's auto-pick and every user click
  // serialize against each other. See `createRescope`.
  const company = createCompanyState(
    client,
    storage,
    {
      ...(config.initialLegalEntityId !== undefined
        ? { legalEntityId: config.initialLegalEntityId }
        : {}),
      ...(proxied ? { proxied } : {}),
    },
    createRescope(client, storage, queryClient, proxied),
  );
  return {
    client,
    storage,
    queryClient,
    site,
    company,
    proxySession: proxied ? (config.proxySession ?? {}) : null,
  };
}

/** Throws on a `proxySession` without a proxy-mode client; returns whether the client is one. */
function assertProxyPairing(
  client: EmporixClient,
  proxySession: EmporixProxySession | undefined,
): boolean {
  // `?.` because test doubles often carry no config at all.
  const proxied = client.config?.proxy !== undefined;
  if (proxySession !== undefined && !proxied) {
    throw new Error(
      "provideEmporix: proxySession needs a client built with `proxy` — without it the SDK " +
        "requests tokens itself. See docs/bff.md.",
    );
  }
  return proxied;
}

/**
 * Instances serving an application on the server. Never released: the guest
 * session and the cache outlive the application, so a second application on the
 * same instance is a second request reading the first one's session.
 */
const servingOnServer = new WeakSet<object>();

/** Resolves a value or factory; on the server, refuses an instance another application uses. */
function own<T extends object>(source: T | (() => T), name: string, onServer: boolean): T {
  const value = typeof source === "function" ? (source as () => T)() : source;
  if (onServer) {
    if (servingOnServer.has(value)) {
      throw new Error(
        `provideEmporix: this ${name} already serves another application. Under server-side ` +
          `rendering every request bootstraps its own application, and a shared ${name} hands ` +
          `one visitor's session to the next. Pass a factory that builds a new one ` +
          `(\`${name}: () => ...\`). See docs/angular.md#server-side-rendering.`,
      );
    }
    servingOnServer.add(value);
  }
  return value;
}

/** The SDK client and session storage. Must be called in an injection context. */
export function injectEmporix(): { client: EmporixClient; storage: EmporixStorage } {
  return { client: inject(EMPORIX_CLIENT), storage: inject(EMPORIX_STORAGE) };
}
