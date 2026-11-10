/**
 * Proxy (BFF) mode pieces that are not HTTP: the token provider that refuses to
 * mint, and the storage view the framework bindings put in front of their
 * storage. The HTTP side lives in `HttpClient`; see `EmporixProxyConfig`.
 */
import { EmporixAuthError } from "./errors";
import type { TokenProvider } from "./auth";
import type { EmporixStorage } from "./session-storage";
import type { EmporixStorageKey } from "./session-keys";
import { createListenerSet } from "./browser-storage";

/**
 * What a proxy-mode storage reports as the customer token while the proxy
 * session belongs to a logged-in customer.
 *
 * A marker, not a token: in proxy mode `HttpClient` sends no `Authorization`
 * header, so whatever a `customer` {@link AuthContext} carries never leaves the
 * browser. It exists so that every "is a customer logged in?" check written
 * against `getCustomerToken()` keeps working without a token in the browser.
 */
export const PROXY_CUSTOMER_TOKEN = "emporix-proxy-session";

/**
 * The token provider of a proxy-mode client. Every token request throws: the
 * proxy holds the tokens, and a request for one is a bug that would otherwise
 * end in a token in the browser. `setAnonymousContext` is a no-op — binding a
 * guest session to a site and currency is the proxy's job then.
 */
export function createProxyModeTokenProvider(): TokenProvider {
  const refuse = (): never => {
    throw new EmporixAuthError(
      "The client runs in proxy mode: the proxy attaches the token, so the SDK requests none",
    );
  };
  return {
    getToken: async () => refuse(),
    getAnonymousToken: async () => refuse(),
    refreshAnonymous: async () => refuse(),
    setAnonymousContext: () => {},
  };
}

/** Keys that hold a token. A proxy-mode storage neither reads nor writes them. */
const TOKEN_KEYS: ReadonlySet<EmporixStorageKey> = new Set<EmporixStorageKey>([
  "customerToken",
  "anonymousSession",
  "refreshToken",
  "saasToken",
]);

/** An {@link EmporixStorage} whose customer state is set from outside. */
export interface ProxySessionStorage extends EmporixStorage {
  /**
   * Whether the proxy session belongs to a logged-in customer. A change notifies
   * `subscribe` and `subscribeAll` listeners as a `customerToken` change.
   */
  setProxyAuthenticated(authenticated: boolean): void;
}

/**
 * Wraps a storage for proxy mode. Cart id, site, language and active legal
 * entity pass through to `base`; the token slots do not:
 *
 * - `getCustomerToken()` answers {@link PROXY_CUSTOMER_TOKEN} or `null`, as
 *   `setProxyAuthenticated` last said;
 * - the anonymous session, refresh token and SaaS token read as `null`;
 * - writes to any of them are dropped, so nothing ever puts a token into `base`.
 *
 * A token already in `base` — from a session before the switch to proxy mode —
 * is hidden, not removed.
 */
export function createProxySessionStorage(
  base: EmporixStorage,
  authenticated: boolean,
): ProxySessionStorage {
  let current = authenticated;
  const tokenListeners = createListenerSet<string | null>();
  const keyListeners = createListenerSet<EmporixStorageKey>();
  const token = (): string | null => (current ? PROXY_CUSTOMER_TOKEN : null);
  const drop = (): void => {};

  return {
    getCustomerToken: token,
    setCustomerToken: drop,
    subscribe: (listener) => tokenListeners.add(listener),

    getCartId: () => base.getCartId(),
    setCartId: (id) => base.setCartId(id),

    getAnonymousSession: () => null,
    setAnonymousSession: drop,

    getSiteCode: () => base.getSiteCode(),
    setSiteCode: (code) => base.setSiteCode(code),

    getLanguage: () => base.getLanguage(),
    setLanguage: (language) => base.setLanguage(language),

    getActiveLegalEntityId: () => base.getActiveLegalEntityId(),
    setActiveLegalEntityId: (id) => base.setActiveLegalEntityId(id),

    getRefreshToken: () => null,
    setRefreshToken: drop,
    getSaasToken: () => null,
    setSaasToken: drop,

    subscribeAll(listener) {
      const own = keyListeners.add(listener);
      const passed = base.subscribeAll?.((key) => {
        if (!TOKEN_KEYS.has(key)) listener(key);
      });
      return () => {
        own();
        passed?.();
      };
    },

    setProxyAuthenticated(next) {
      if (next === current) return;
      current = next;
      tokenListeners.notify(token());
      keyListeners.notify("customerToken");
    },
  };
}
