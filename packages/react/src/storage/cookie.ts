import { createListenerSet, type EmporixStorage, type EmporixStorageKey } from "./index";
import { createMemoryStorage } from "./memory";
import { createCookieBackedStorage } from "./cookie-core";

/**
 * Cookie-backed store. `Secure` defaults to on for https origins; override
 * with `secure: false` only for non-https dev setups. Consumer must still pick
 * an appropriate `sameSite` for CSRF safety.
 */
export function createCookieStorage(
  opts: { name?: string; secure?: boolean; sameSite?: "lax" | "strict" | "none" } = {},
): EmporixStorage {
  const sameSite = opts.sameSite ?? "lax";
  // Default: Secure on https origins. Tokens must not ride plain-http
  // cookies in production; localhost/http dev keeps working without opts.
  const secure =
    opts.secure ?? (typeof location !== "undefined" && location.protocol === "https:");
  if (typeof document === "undefined") {
    // eslint-disable-next-line no-console
    console.warn("[emporix] document unavailable; cookie storage falling back to in-memory");
    return createMemoryStorage();
  }
  const attrs = `path=/; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
  const all = createListenerSet<EmporixStorageKey>();
  const storage = createCookieBackedStorage(
    {
      get: (name) => {
        for (const part of document.cookie.split("; ")) {
          const [k, ...v] = part.split("=");
          if (k === name) return decodeURIComponent(v.join("=")) || null;
        }
        return null;
      },
      set: (name, value) => {
        document.cookie =
          value === null
            ? `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attrs}`
            : `${name}=${encodeURIComponent(value)}; ${attrs}`;
      },
    },
    {
      ...(opts.name !== undefined ? { tokenName: opts.name } : {}),
      notify: (key) => all.notify(key),
    },
  );
  return { ...storage, subscribeAll: (l) => all.add(l) };
}
