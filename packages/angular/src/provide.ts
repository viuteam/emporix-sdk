import { inject, makeEnvironmentProviders, type EnvironmentProviders } from "@angular/core";
import { provideTanStackQuery, QueryClient } from "@tanstack/angular-query-experimental";
import {
  createMemoryStorage,
  EmporixNotFoundError,
  type EmporixClient,
  type EmporixStorage,
} from "@viu/emporix-sdk";
import { EMPORIX_CLIENT, EMPORIX_SITE, EMPORIX_SITE_INTERNAL, EMPORIX_STORAGE } from "./tokens";
import { createSiteState } from "./site";

export interface EmporixConfig {
  client: EmporixClient;
  /** Defaults to an in-memory storage: SSR-safe, no persistence. */
  storage?: EmporixStorage;
  /** Bring your own to share one cache with the host application. */
  queryClient?: QueryClient;
  /** Initial site code. Order: this → storage → client config → null. */
  initialSiteCode?: string;
  /** Initial language. Order: this → storage → client config → null. */
  initialLanguage?: string;
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
 * Called once from `provideEmporix`. React needs a ref guard here because its
 * provider re-renders; an `EnvironmentProviders` factory runs once per injector,
 * so there is nothing to guard against.
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
 * @example
 * ```ts
 * bootstrapApplication(AppComponent, {
 *   providers: [provideEmporix({ client: createEmporixClient({ ... }) })],
 * })
 * ```
 */
export function provideEmporix(config: EmporixConfig): EnvironmentProviders {
  const storage = config.storage ?? createMemoryStorage();
  const queryClient = config.queryClient ?? new QueryClient();
  applyEmporixQueryDefaults(queryClient);
  const site = createSiteState(config.client, storage, {
    ...(config.initialSiteCode !== undefined ? { siteCode: config.initialSiteCode } : {}),
    ...(config.initialLanguage !== undefined ? { language: config.initialLanguage } : {}),
  });
  return makeEnvironmentProviders([
    { provide: EMPORIX_CLIENT, useValue: config.client },
    { provide: EMPORIX_STORAGE, useValue: storage },
    { provide: EMPORIX_SITE, useValue: site },
    { provide: EMPORIX_SITE_INTERNAL, useValue: site.internal },
    provideTanStackQuery(queryClient),
  ]);
}

/** The SDK client and session storage. Must be called in an injection context. */
export function injectEmporix(): { client: EmporixClient; storage: EmporixStorage } {
  return { client: inject(EMPORIX_CLIENT), storage: inject(EMPORIX_STORAGE) };
}
