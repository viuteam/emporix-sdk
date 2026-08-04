/**
 * The persisted-session layer: the {@link EmporixStorage} contract and the two
 * framework-free implementations of it that are not browser-specific.
 *
 * It lives in the core SDK for the same reason {@link STORAGE_KEYS} does — none
 * of it is a React concern. A cookie-backed storage fits Next, Remix, SvelteKit,
 * Nitro or a plain Node handler equally, and `@viu/emporix-sdk-next` needed
 * exactly this and nothing else from `@viu/emporix-sdk-react`.
 *
 * `@viu/emporix-sdk-react` re-exports all of it and keeps the browser backends
 * (memory, localStorage, sessionStorage, document.cookie), which genuinely belong
 * there.
 */
import { auth, type AuthContext, type StoredAnonymousSession } from "./auth";
import { STORAGE_KEYS, type EmporixStorageKey } from "./session-keys";

/**
 * The subset of an anonymous session a browser storage keeps.
 *
 * Derived from {@link StoredAnonymousSession} rather than re-declared: a server
 * store may additionally persist the access token and its expiry, a browser one
 * deliberately does not (the client is long-lived and holds the token in memory,
 * so writing it would only expose a bearer token to JavaScript).
 */
export type PersistedAnonymousSession = Pick<
  StoredAnonymousSession,
  "refreshToken" | "sessionId"
>;

/** Pluggable persistence for SDK session state. SSR-safe by default (memory). */
export interface EmporixStorage {
  // Customer token (unchanged).
  getCustomerToken(): string | null;
  setCustomerToken(token: string | null): void;
  subscribe?(listener: (token: string | null) => void): () => void;

  // Active guest / customer cart id.
  getCartId(): string | null;
  setCartId(id: string | null): void;

  // Anonymous session — used by DefaultTokenProvider (via EmporixProvider
  // wiring) to preserve sessionId across page reloads.
  getAnonymousSession(): PersistedAnonymousSession | null;
  setAnonymousSession(session: PersistedAnonymousSession | null): void;

  // Active site code (MS-2). `null` = no site bound yet.
  getSiteCode(): string | null;
  setSiteCode(code: string | null): void;

  // Active language (Accept-Language). `null` = use the site/tenant default.
  getLanguage(): string | null;
  setLanguage(language: string | null): void;

  // Active legal entity id (B2B). `null` = B2C mode.
  getActiveLegalEntityId(): string | null;
  setActiveLegalEntityId(id: string | null): void;

  // Refresh token — optional persistence. When absent, B2B company-switch
  // falls back to a local-state-only update (no server-side token rescope).
  getRefreshToken(): string | null;
  setRefreshToken(token: string | null): void;

  // SaaS token (the checkout `saas-token` header). Persisted so a logged-in
  // customer can still complete checkout after a page reload — the refresh
  // endpoint does not re-mint it. Optional: a custom adapter may omit these,
  // in which case the saasToken stays in-memory only.
  getSaasToken?(): string | null;
  setSaasToken?(token: string | null): void;

  /**
   * Subscribe to any storage write. The listener receives the key that
   * changed. Returns an unsubscribe function. Optional — backends may no-op.
   * Used by the telemetry layer to emit `storage.write` events.
   */
  subscribeAll?(listener: (key: EmporixStorageKey) => void): () => void;
}

/** Backward-compat alias. New code should prefer {@link EmporixStorage}. */
export type TokenStorage = EmporixStorage;

/**
 * Parses a stored anonymous session (from Web Storage or a cookie) into a
 * {@link PersistedAnonymousSession}. Returns `null` for absent, malformed or
 * incomplete values — a half-written session must not become a half-valid one.
 */
export function parseAnonymousSession(raw: string | null): PersistedAnonymousSession | null {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedAnonymousSession>;
    return typeof parsed.refreshToken === "string" && typeof parsed.sessionId === "string"
      ? { refreshToken: parsed.refreshToken, sessionId: parsed.sessionId }
      : null;
  } catch {
    return null;
  }
}

/** Backend-agnostic cookie accessor. `set` absent means the storage is read-only. */
export interface CookieIo {
  get(name: string): string | null;
  /** `null` deletes the cookie. */
  set?(name: string, value: string | null): void;
}

/**
 * Builds an {@link EmporixStorage} over a cookie accessor. Contains the whole
 * name-to-accessor mapping so no backend repeats it.
 *
 * `opts.notify` is a callback rather than a flag so this module stays free of
 * listener-set lifetime: the browser backend owns a `createListenerSet`, passes
 * its `notify` here, and attaches `subscribeAll` to the result itself. This
 * function never sets `subscribeAll` — the server backend therefore has none,
 * which is correct: a server render has no lifetime to observe.
 */
export function createCookieBackedStorage(
  io: CookieIo,
  opts: { tokenName?: string; notify?: (key: EmporixStorageKey) => void } = {},
): EmporixStorage {
  const tokenName = opts.tokenName ?? STORAGE_KEYS.customerToken;
  const notify = opts.notify;

  // Read-only mode: warn once per key so a genuine bug surfaces, but a render
  // loop cannot flood the log.
  const warned = new Set<EmporixStorageKey>();
  const write = (name: string, value: string | null, key: EmporixStorageKey): void => {
    if (io.set === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        // eslint-disable-next-line no-console
        console.warn(
          `[emporix] storage is read-only; ignoring write to "${key}". ` +
            "Provide a `set` accessor to enable writes (e.g. from a Server Action).",
        );
      }
      return;
    }
    io.set(name, value);
    notify?.(key);
  };

  return {
    getCustomerToken: () => io.get(tokenName),
    setCustomerToken: (t) => write(tokenName, t, "customerToken"),

    getCartId: () => io.get(STORAGE_KEYS.cartId),
    setCartId: (id) => write(STORAGE_KEYS.cartId, id, "cartId"),

    getAnonymousSession: () => parseAnonymousSession(io.get(STORAGE_KEYS.anonymousSession)),
    setAnonymousSession: (s) =>
      write(
        STORAGE_KEYS.anonymousSession,
        s === null
          ? null
          : JSON.stringify({ refreshToken: s.refreshToken, sessionId: s.sessionId }),
        "anonymousSession",
      ),

    getSiteCode: () => io.get(STORAGE_KEYS.siteCode),
    setSiteCode: (code) => write(STORAGE_KEYS.siteCode, code, "siteCode"),

    getLanguage: () => io.get(STORAGE_KEYS.language),
    setLanguage: (l) => write(STORAGE_KEYS.language, l, "language"),

    getActiveLegalEntityId: () => io.get(STORAGE_KEYS.activeLegalEntityId),
    setActiveLegalEntityId: (id) =>
      write(STORAGE_KEYS.activeLegalEntityId, id, "activeLegalEntityId"),

    getRefreshToken: () => io.get(STORAGE_KEYS.refreshToken),
    setRefreshToken: (t) => write(STORAGE_KEYS.refreshToken, t, "refreshToken"),

    getSaasToken: () => io.get(STORAGE_KEYS.saasToken),
    setSaasToken: (t) => write(STORAGE_KEYS.saasToken, t, "saasToken"),
  };
}

/**
 * A synchronous cookie accessor supplied by the caller. Deliberately
 * synchronous: {@link EmporixStorage} is synchronous throughout, so any
 * `await` (e.g. Next's `await cookies()`) belongs to the caller.
 *
 * Omit `set` for a read-only storage. Next.js forbids cookie writes during a
 * Server Component render — only Server Actions and Route Handlers may write.
 */
export interface ServerCookieJar {
  get(name: string): string | null;
  /** `null` deletes the cookie. */
  set?(name: string, value: string | null): void;
}

/**
 * An {@link EmporixStorage} reading (and optionally writing) through a
 * caller-supplied cookie jar — for RSC, Server Actions, Route Handlers, or any
 * other server runtime. No framework import: the jar shape fits Next, Remix,
 * SvelteKit, Nitro or a plain Node handler.
 *
 * `subscribe` / `subscribeAll` are absent: a server render has no lifetime over
 * which to observe changes.
 *
 * ```ts
 * // Next.js Server Component (read-only)
 * const jar = await cookies();
 * const storage = createServerStorage({ get: (n) => jar.get(n)?.value ?? null });
 *
 * // Next.js Server Action (read-write)
 * const jar = await cookies();
 * const storage = createServerStorage({
 *   get: (n) => jar.get(n)?.value ?? null,
 *   set: (n, v) =>
 *     v === null
 *       ? jar.delete(n)
 *       : jar.set(n, v, { httpOnly: true, sameSite: "lax", secure: true, path: "/" }),
 * });
 * ```
 */
export function createServerStorage(jar: ServerCookieJar): EmporixStorage {
  return createCookieBackedStorage(
    jar.set !== undefined ? { get: jar.get, set: jar.set } : { get: jar.get },
  );
}

/**
 * Resolves the {@link AuthContext} a server-side read should use, mirroring
 * exactly what the React `useEmporixQuery` resolves on the client: the customer
 * context when a token is stored, anonymous otherwise.
 *
 * Use this rather than hand-rolling it — `authKind` is part of every React-Query
 * key, so a mismatch here produces a silent cache miss (a second fetch after
 * hydration, no error).
 */
export function serverAuth(storage: EmporixStorage): AuthContext {
  const token = storage.getCustomerToken();
  return token !== null ? auth.customer(token) : auth.anonymous();
}
