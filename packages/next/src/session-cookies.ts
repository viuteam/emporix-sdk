import { cookies, headers } from "next/headers";
import { cookieName, readCookie, sealCookie } from "./cookie-name";
import {
  isPublicSessionKey,
  newSessionId,
  recordTtl,
  SESSION_SID,
  type EmporixSessionStore,
} from "./session-store";

/**
 * Cookie lifetimes for the server-first mode. Values are the package's
 * defaults, not Emporix's — the session security review recorded that there was
 * no application-side session lifetime at all, and this is where one is set.
 */
export const SESSION_MAX_AGE = {
  customerToken: 8 * 60 * 60,
  refreshToken: 30 * 24 * 60 * 60,
  saasToken: 8 * 60 * 60,
  cartId: 30 * 24 * 60 * 60,
  anonymousSession: 30 * 24 * 60 * 60,
  activeLegalEntityId: 30 * 24 * 60 * 60,
} as const;

/**
 * Absolute expiry of the customer access token, epoch seconds.
 *
 * Deliberately **not** in `STORAGE_KEYS`: those eight are the session state the
 * browser backends share. This is bookkeeping for the server-first proxy alone,
 * so it lives at this layer.
 *
 * It exists because the Emporix customer access token is **opaque**, not a JWT —
 * only the `saasToken` is one. Reading an `exp` claim off it is impossible, so
 * the lifetime Emporix returns as `expires_in` is stored instead.
 */
export const SESSION_EXPIRES_AT = "emporix.customerTokenExpiresAt";

/**
 * Epoch seconds at which this session began. Not refreshed — that is the point.
 *
 * The idle window slides: `persistSession` rewrites the refresh cookie on every
 * refresh, so 30 days means 30 days of INACTIVITY and an actively used session
 * never expires. This is the ceiling that does not move.
 */
export const SESSION_STARTED_AT = "emporix.sessionStartedAt";

/** How long a session may live regardless of activity. */
export const SESSION_ABSOLUTE_MAX = 90 * 24 * 60 * 60;

/**
 * Fallback lifetime when Emporix omits `expires_in`. Deliberately short: too
 * long means a dead token reaches a Server Component, which cannot recover.
 */
export const SESSION_FALLBACK_LIFETIME = 15 * 60;

/**
 * Read/write access to this request's persisted Emporix session, with the
 * storage policy applied in exactly one place.
 *
 * Named a handle rather than a cookie jar, and that is a correction: cookies are
 * only one of the two backends. In store mode six of the eight
 * {@link STORAGE_KEYS} live in the store record and just two — `siteCode` and
 * `language` — stay cookies, so «cookie jar» described a quarter of the keys.
 * `sessionCookieJar` remains exported as a deprecated alias.
 */
export interface EmporixSessionHandle {
  get(name: string): string | null;
  /** No-op when the handle is read-only (a Server Component render). */
  set(name: string, value: string, maxAgeSeconds: number): void;
  /** No-op when the handle is read-only. */
  delete(name: string): void;
  /**
   * Persists a store-backed session. A no-op in cookie mode, where `set` has
   * already written through.
   *
   * Must be awaited by every mutating entry point. The read-only variant never
   * needs it, which halves the places that could forget.
   */
  flush(): Promise<void>;
  /** Drops the whole session, store record included. */
  destroy(): Promise<void>;
}

/**
 * `Secure` is derived, not hard-coded. Hard `true` silently drops the cookie on
 * a plain-http staging host, which is fail-closed and miserable to diagnose.
 *
 * Next guarantees the signal: `base-server.js` does
 * `req.headers['x-forwarded-proto'] ??= isHttps ? 'https' : 'http'`, so the
 * header is always present inside a request — `http` on a plain-http origin,
 * `https` behind a TLS-terminating proxy that sets it. The `NODE_ENV` branch
 * below is therefore unreachable in a Next request today; it stays as the safe
 * answer if that ever stops being true.
 */
async function isSecure(): Promise<boolean> {
  const proto = (await headers()).get("x-forwarded-proto");
  if (proto !== null && proto.length > 0) {
    return proto.split(",")[0]?.trim() === "https";
  }
  return process.env.NODE_ENV === "production";
}

/**
 * This request's session, with the package's storage policy applied.
 *
 * Every **cookie** written through here is `httpOnly` — the whole point of the
 * server-first mode is that the browser never reads a token. That holds for the
 * two public keys too; they are «public» in the sense that they stay cookies in
 * store mode rather than moving into the record, not that JavaScript can read
 * them. A browser-readable site or language cookie is `emporixSiteProxy`'s job.
 *
 * Pass a `store` and only `siteCode`, `language` and the `emporix.sid` pointer
 * remain cookies; everything else lives in the record and needs one
 * {@link EmporixSessionHandle.flush}.
 */
export async function emporixSessionHandle(
  opts: { readOnly?: boolean; store?: EmporixSessionStore } = {},
): Promise<EmporixSessionHandle> {
  const jar = await cookies();
  const readOnly = opts.readOnly ?? false;
  const secure = await isSecure();
  const store = opts.store;

  const cookieGet = (name: string): string | null =>
    readCookie(name, (wire) => jar.get(wire)?.value);
  const cookieSet = (name: string, value: string, maxAgeSeconds: number): void => {
    jar.set(cookieName(name, secure), sealCookie(name, value), {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: maxAgeSeconds,
    });
  };

  if (store === undefined) {
    return {
      get: cookieGet,
      set: (name, value, maxAgeSeconds) => {
        if (readOnly) return;
        cookieSet(name, value, maxAgeSeconds);
      },
      delete: (name) => {
        if (readOnly) return;
        jar.delete(cookieName(name, secure));
      },
      flush: async () => {},
      destroy: async () => {},
    };
  }

  // Store mode: hydrate once, mutate in memory, flush once. This is what lets a
  // synchronous handle sit on top of an async store — and `AnonymousSessionStore`
  // (sdk core/auth.ts:42) leaves no choice, it is declared synchronous and is
  // called mid-refresh.
  const sid = cookieGet(SESSION_SID);
  let record: Record<string, string> = {};
  if (sid !== null) {
    try {
      record = (await store.read(sid)) ?? {};
    } catch {
      // A store outage degrades to «logged out», not to a 500 on every page.
      record = {};
    }
  }
  let dirty = false;

  return {
    get: (name) => (isPublicSessionKey(name) ? cookieGet(name) : (record[name] ?? null)),
    set: (name, value, maxAgeSeconds) => {
      if (readOnly) return;
      if (isPublicSessionKey(name)) {
        cookieSet(name, value, maxAgeSeconds);
        return;
      }
      record[name] = value;
      dirty = true;
    },
    delete: (name) => {
      if (readOnly) return;
      if (isPublicSessionKey(name)) {
        jar.delete(cookieName(name, secure));
        return;
      }
      if (record[name] !== undefined) {
        delete record[name];
        dirty = true;
      }
    },
    flush: async () => {
      if (readOnly || !dirty) return;
      const id = sid ?? newSessionId();
      const ttl = recordTtl(record);
      await store.write(id, record, ttl);
      cookieSet(SESSION_SID, id, ttl);
      dirty = false;
    },
    destroy: async () => {
      if (readOnly) return;
      if (sid !== null) await store.destroy(sid);
      jar.delete(cookieName(SESSION_SID, secure));
      record = {};
      dirty = false;
    },
  };
}

/**
 * @deprecated Renamed to {@link emporixSessionHandle} in 0.5.0. The old name
 * described cookies, and in store mode six of the eight session keys are not
 * cookies at all. Same function, no behaviour change — switch the import.
 *
 * Scheduled for removal in **0.6.0**.
 */
export const sessionCookieJar = emporixSessionHandle;

/**
 * @deprecated Renamed to {@link EmporixSessionHandle} in 0.5.0. Scheduled for
 * removal in **0.6.0**.
 */
export type SessionCookieJar = EmporixSessionHandle;
