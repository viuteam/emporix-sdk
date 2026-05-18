import type { TokenStorage } from "./index";
import { createMemoryStorage } from "./memory";

const DEFAULT_NAME = "emporix.customerToken";

/** Cookie-backed store. Consumer must set SameSite/Secure for CSRF safety. */
export function createCookieStorage(
  opts: { name?: string; secure?: boolean; sameSite?: "lax" | "strict" | "none" } = {},
): TokenStorage {
  const name = opts.name ?? DEFAULT_NAME;
  const sameSite = opts.sameSite ?? "lax";
  const secure = opts.secure ?? false;
  if (typeof document === "undefined") {
    // eslint-disable-next-line no-console
    console.warn("[emporix] document unavailable; cookie storage falling back to in-memory");
    return createMemoryStorage();
  }
  const read = (): string | null => {
    for (const part of document.cookie.split("; ")) {
      const [k, ...v] = part.split("=");
      if (k === name) return decodeURIComponent(v.join("=")) || null;
    }
    return null;
  };
  return {
    getCustomerToken: read,
    setCustomerToken: (t) => {
      const attrs = `path=/; SameSite=${sameSite}${secure ? "; Secure" : ""}`;
      document.cookie =
        t === null
          ? `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; ${attrs}`
          : `${name}=${encodeURIComponent(t)}; ${attrs}`;
    },
  };
}
