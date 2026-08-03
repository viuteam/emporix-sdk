import { cookies, headers } from "next/headers";
import { cookieName, readCookie, sealCookie } from "./cookie-name";

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
 * Fallback lifetime when Emporix omits `expires_in`. Deliberately short: too
 * long means a dead token reaches a Server Component, which cannot recover.
 */
export const SESSION_FALLBACK_LIFETIME = 15 * 60;

/** A narrow cookie surface so the attribute policy lives in exactly one place. */
export interface SessionCookieJar {
  get(name: string): string | null;
  /** No-op when the jar is read-only (a Server Component render). */
  set(name: string, value: string, maxAgeSeconds: number): void;
  /** No-op when the jar is read-only. */
  delete(name: string): void;
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
 * The request's cookie jar with this package's attribute policy applied.
 *
 * Everything written through here is `httpOnly` — the whole point of the
 * server-first mode is that the browser never reads a token.
 */
export async function sessionCookieJar(
  opts: { readOnly?: boolean } = {},
): Promise<SessionCookieJar> {
  const jar = await cookies();
  const readOnly = opts.readOnly ?? false;
  const secure = await isSecure();
  return {
    get: (name) => readCookie(name, (wire) => jar.get(wire)?.value),
    set: (name, value, maxAgeSeconds) => {
      if (readOnly) return;
      jar.set(cookieName(name, secure), sealCookie(name, value), {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: maxAgeSeconds,
      });
    },
    delete: (name) => {
      if (readOnly) return;
      jar.delete(cookieName(name, secure));
    },
  };
}
