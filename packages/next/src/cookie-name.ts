import { cookieEncryptionEnabled, decryptCookie, encryptCookie } from "./cookie-crypto";

/**
 * The wire name of a session cookie.
 *
 * `__Host-` makes the browser enforce Secure, Path=/ and no Domain, which stops
 * a compromised subdomain from injecting a cookie for the parent domain. We
 * already satisfy all three conditions.
 *
 * Tied to the same `secure` derivation the attributes use, deliberately: a
 * browser refuses `__Host-` cookies over plain http, so on a local http host the
 * prefix has to come off — and if that decision lived in a second place the two
 * would drift.
 */
export function cookieName(base: string, secure: boolean): string {
  return secure ? `__Host-${base}` : base;
}

/**
 * Seals a value when a key is configured, passes it through when not.
 *
 * The AAD is the BASE name, never the prefixed one. A move from http to https
 * changes the prefix, and binding to the prefixed name would make every cookie
 * unreadable at that moment.
 */
export function sealCookie(name: string, value: string): string {
  return cookieEncryptionEnabled() ? encryptCookie(name, value) : value;
}

/**
 * Opens a stored value, or `null` when it cannot be read.
 *
 * `null` rather than a throw: an unreadable cookie must behave like a missing
 * one, so that dropping a key from the rotation list logs everyone out instead
 * of returning 500s. That is the mass-logout lever working as intended.
 */
export function openCookie(name: string, raw: string | undefined): string | null {
  if (raw === undefined) return null;
  if (!cookieEncryptionEnabled()) return raw;
  try {
    return decryptCookie(name, raw);
  } catch {
    return null;
  }
}

/**
 * Reads a session cookie, prefixed name first, bare name as fallback.
 *
 * Reading both costs nothing and removes the need to know `secure` on this
 * path — a value sits under one name or the other. It also carries a session
 * across a move from http to https, which deriving the single expected name
 * would not.
 *
 * The prefixed name wins, so an injected bare cookie cannot shadow a real one.
 */
export function readCookie(
  name: string,
  lookup: (wire: string) => string | undefined,
): string | null {
  return openCookie(name, lookup(cookieName(name, true)) ?? lookup(name));
}
