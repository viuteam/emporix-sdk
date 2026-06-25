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

/** Props for {@link EmporixProvider}. */
export interface EmporixProviderProps {
  client: EmporixClient;
  queryClient?: QueryClient;
  storage?: EmporixStorage;
  initialCustomerToken?: string;
  /**
   * Initial site code. Resolution order: this prop → `storage.getSiteCode()` →
   * `client.config.credentials.storefront.context.siteCode` → `null`.
   */
  initialSiteCode?: string;
  /**
   * Initial active language. Resolution order: this prop → `storage.getLanguage()`
   * → `client.config.credentials.storefront.context.language` → `null` (then
   * seeded from the active site's `defaultLanguage` on mount).
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
   * redirect to login.
   */
  onCustomerSessionExpired?: () => void;
  children: ReactNode;
}
