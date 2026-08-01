import { cookies, headers } from "next/headers";

/**
 * Cookie lifetimes for the server-first mode. Values are the package's
 * defaults, not Emporix's — the session security review recorded that there was
 * no application-side session lifetime at all, and this is where one is set.
 */
export const BFF_MAX_AGE = {
  customerToken: 8 * 60 * 60,
  refreshToken: 30 * 24 * 60 * 60,
  saasToken: 8 * 60 * 60,
  cartId: 30 * 24 * 60 * 60,
  anonymousSession: 30 * 24 * 60 * 60,
  activeLegalEntityId: 30 * 24 * 60 * 60,
} as const;

/** A narrow cookie surface so the attribute policy lives in exactly one place. */
export interface BffCookieJar {
  get(name: string): string | null;
  /** No-op when the jar is read-only (a Server Component render). */
  set(name: string, value: string, maxAgeSeconds: number): void;
  /** No-op when the jar is read-only. */
  delete(name: string): void;
}

/**
 * `Secure` is derived, not hard-coded. Hard `true` silently drops the cookie on
 * a plain-http staging host, which is fail-closed and miserable to diagnose.
 * Behind a TLS-terminating proxy the forwarded header is the only signal
 * available inside a Server Action; without it, production is assumed secure.
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
export async function bffCookieJar(
  opts: { readOnly?: boolean } = {},
): Promise<BffCookieJar> {
  const jar = await cookies();
  const readOnly = opts.readOnly ?? false;
  const secure = await isSecure();
  return {
    get: (name) => jar.get(name)?.value ?? null,
    set: (name, value, maxAgeSeconds) => {
      if (readOnly) return;
      jar.set(name, value, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: maxAgeSeconds,
      });
    },
    delete: (name) => {
      if (readOnly) return;
      jar.delete(name);
    },
  };
}
