import type { ReactNode } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { EmporixClient } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./storage/index";
import type { EmporixTelemetryEvent } from "./telemetry";

export interface EmporixContextValue {
  client: EmporixClient;
  storage: EmporixStorage;
}

export interface SiteContextValue {
  siteCode: string | null;
  /** MS-4 populates this from the active site's DTO. */
  currency: string | null;
  /** MS-4 populates this from the active site's DTO. */
  targetLocation: string | null;
  /** Active language for localized reads (Accept-Language). `null` = site/tenant default. */
  language: string | null;
  /**
   * Asynchronous site switch. Updates local state + storage immediately
   * (optimistic), then PATCHes `/session-context/{tenant}/me/context` so
   * the server sees the same site on the next request. When no session
   * context exists yet (first visit, before any cart), the PATCH is
   * skipped — local state still flips.
   *
   * `isSwitching` is `true` while the PATCH is in flight. `switchError`
   * surfaces a PATCH failure; the optimistic state is NOT rolled back
   * (the cache was already invalidated, the UI already moved on).
   */
  setSite: (code: string | null) => Promise<void>;
  /**
   * Switch the active currency at runtime. Re-binds the anonymous price context
   * (so guest pricing changes even before a cart exists), clears the
   * currency-bound guest cart, and PATCHes an existing server session context.
   * The chosen currency must be in the active site's `availableCurrencies`.
   */
  setCurrency: (currency: string) => Promise<void>;
  /**
   * Switch the active language at runtime. Sets the `Accept-Language` request
   * header (via `setStorefrontContext`), invalidates the React-Query cache so
   * localized reads refetch, and PATCHes an existing server session context.
   * Does NOT clear the cart (language does not affect pricing).
   */
  setLanguage: (language: string) => Promise<void>;
  isSwitching: boolean;
  switchError: Error | null;
}

/**
 * What the app knows about its Backend-for-Frontend session, for
 * `customerSession: "proxy"`. The proxy answers the customer's identity — e.g. a
 * `/bff/user` endpoint — and the app passes it in; the provider asks nothing
 * itself, because any probe through the proxy would answer 401 for a guest.
 */
export interface EmporixProxySession {
  /** `true` while the proxy session belongs to a logged-in customer. Default `false`. */
  authenticated?: boolean;
  /**
   * What `useCustomerSession().login` does — usually a navigation to the proxy's
   * login (`location.assign("/bff/login")`). Its input is ignored. Unset, `login`
   * rejects.
   */
  login?: () => void | Promise<void>;
  /** What `useCustomerSession().logout` does — usually a navigation to the proxy's logout. Unset, `logout` rejects. */
  logout?: () => void | Promise<void>;
}

/** Props for {@link EmporixProvider}. */
export interface EmporixProviderProps {
  client: EmporixClient;
  queryClient?: QueryClient;
  storage?: EmporixStorage;
  initialCustomerToken?: string;
  /**
   * Who owns the customer token.
   *
   * `"owned"` (default) — the storefront model: the token came from a login this
   * provider performed or restored, may be refreshed, and belongs to a shop
   * customer who may have legal entities.
   *
   * `"external"` — the token was handed in by a host application (an Emporix
   * Managed Dashboard module, an embedded admin UI). The SDK never refreshes it,
   * never bootstraps a company context from it, and treats a changed
   * `initialCustomerToken` as authoritative: hooks read the token from the prop,
   * so the render that changes it already sends the new one, and storage receives
   * it right after that render. While the prop is set, a token written to storage
   * from inside the tree does not reach the hooks. `autoRefreshCustomerToken` is
   * ignored; `onCustomerSessionExpired` still fires on a 401.
   *
   * `"proxy"` — a Backend for Frontend holds the tokens and the browser holds
   * none; the client must be built with `proxy` (see `docs/bff.md`). It is the
   * default for such a client, and any other value with one — or `"proxy"`
   * without one — throws. Whether a customer is logged in comes from
   * `proxySession.authenticated`; hooks then take their customer paths with
   * `PROXY_CUSTOMER_TOKEN` as a marker that is never sent. Nothing is written to
   * the token slots of `storage`, no anonymous session is stored, no token is
   * refreshed, and no company context is bootstrapped. `useCustomerSession`'s
   * `login` / `logout` call `proxySession.login` / `.logout`; its token-minting
   * actions reject. `onCustomerSessionExpired` fires on every 401 the proxy
   * answers; `autoRefreshCustomerToken` and `initialCustomerToken` cannot be used.
   */
  customerSession?: "owned" | "external" | "proxy";
  /** The proxy session, for `customerSession: "proxy"`. Ignored otherwise. */
  proxySession?: EmporixProxySession;
  /**
   * Initial site code. Resolution order: this prop → `storage.getSiteCode()` →
   * `client.config.credentials.storefront.context.siteCode` → `null`.
   */
  initialSiteCode?: string;
  /**
   * Initial active language. Resolution order: this prop → `storage.getLanguage()`
   * → `client.config.credentials.storefront.context.language` → `null` (then
   * seeded from the active site's `defaultLanguage` on mount). A language the
   * active site does not list in `languages` is replaced by its `defaultLanguage`
   * on mount, and in storage too. Languages are matched regardless of case, as
   * Emporix does: `en-nl` on a site listing `en-NL` becomes `en-NL`.
   */
  initialLanguage?: string;
  /**
   * Initial active legal-entity id (B2B). When set, the CompanyContext
   * provider tries to match it against `companies.listMine()` once the
   * customer is loaded; mismatches are dropped silently.
   */
  initialActiveLegalEntityId?: string | null;
  /**
   * Opt-in telemetry callback. Receives a typed event stream covering cache
   * hit/miss, refetches, errors, mutations, auth refreshes, storage writes,
   * and consumer-emitted custom events. Wire this to Datadog/Sentry/custom
   * analytics. The handler is wrapped in try/catch — a throwing handler
   * never breaks the provider.
   */
  onTelemetry?: (event: EmporixTelemetryEvent) => void;
  /**
   * Opt in to reactive customer-token auto-refresh: on a `customer`-kind 401,
   * the SDK refreshes once (via the stored refresh token + anonymous auth) and
   * retries. Default: false (the customer token stays caller-owned).
   */
  autoRefreshCustomerToken?: boolean;
  /**
   * Called when a customer-token refresh is needed but fails (refresh token
   * expired/revoked) or no refresh token is stored. Use to drive logout /
   * redirect to login. With `customerSession: "proxy"`: called on every 401 the
   * proxy answers — parallel requests call it once each.
   */
  onCustomerSessionExpired?: () => void;
  children: ReactNode;
}
