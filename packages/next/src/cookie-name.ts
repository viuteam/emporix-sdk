import {
  cookieEncryptionEnabled,
  decryptCookie,
  encryptCookie,
  SEAL_MARKER,
} from "./cookie-crypto";
import { reportEmporixError } from "./error-reporting";

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
  if (!cookieEncryptionEnabled()) {
    // Turning encryption OFF is the mirror of turning it on, and it was
    // missing: a sealed value with no key configured is unreadable, not
    // plaintext. Returning it handed a ciphertext to whatever expected a cart
    // id — found live, as a 404 from Emporix for cart «v1.0EnVJ4…».
    return raw.startsWith(SEAL_MARKER) ? null : raw;
  }
  try {
    return decryptCookie(name, raw);
  } catch (cause) {
    // Either a rotation dropped a key that is still in use, or the value was
    // tampered with. Both are worth a signal; neither should 500 the page.
    reportEmporixError({
      code: "session.cookie_undecryptable",
      degradedTo: "cookie reads as absent",
      cause,
      severity: "warning",
      // The cookie NAME, not its value — that is what tells you which rotation
      // went wrong, and it carries nothing secret.
      context: { cookie: name },
    });
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
