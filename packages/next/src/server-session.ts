import { cookies } from "next/headers";
import type { AuthContext } from "@viu/emporix-sdk";
import { cookieName, readCookie, sealCookie } from "./cookie-name";
import { SESSION_MAX_AGE, emporixSessionHandle } from "./session-cookies";
import type { EmporixSessionStore } from "./session-store";
import {
  createServerStorage,
  serverAuth,
  type ServerCookieJar,
} from "@viu/emporix-sdk-react/ssr";
import type { EmporixStorage } from "@viu/emporix-sdk-react";

/** The Emporix session as it exists on the server for one request. */
export interface EmporixServerSession {
  /** Session state backed by the request's cookies. */
  storage: EmporixStorage;
  /** `auth.customer(token)` when a token is stored, else `auth.anonymous()`. */
  auth: AuthContext;
  customerToken: string | null;
  cartId: string | null;
  siteCode: string | null;
  language: string | null;
  legalEntityId: string | null;
  /**
   * Persists a store-backed session. A no-op in cookie mode, where the storage
   * setters already wrote through.
   */
  flush(): Promise<void>;
}

function build(storage: EmporixStorage): EmporixServerSession {
  return {
    storage,
    auth: serverAuth(storage),
    customerToken: storage.getCustomerToken(),
    cartId: storage.getCartId(),
    siteCode: storage.getSiteCode(),
    language: storage.getLanguage(),
    legalEntityId: storage.getActiveLegalEntityId(),
    flush: async () => {},
  };
}

/**
 * The Emporix session for the current request, **read-only**.
 *
 * Use this in Server Components. Next forbids cookie writes during a render, so
 * the storage's setters no-op and warn once per key rather than throwing inside
 * a render.
 *
 * ```ts
 * const { auth, siteCode } = await emporixSession();
 * const product = await getEmporixClient().products.get(id, undefined, auth);
 * ```
 *
 * Note: pass a customer `auth` only to `getEmporixClient({ tagged: false })` —
 * see {@link createTaggingFetch}.
 */
export async function emporixSession(
  opts: { store?: EmporixSessionStore } = {},
): Promise<EmporixServerSession> {
  // Goes through emporixSessionHandle rather than cookies() directly: the handle knows
  // the __Host- prefix, the codec, and — with a store — that the values are not
  // in the browser at all.
  const handle = await emporixSessionHandle({
    readOnly: true,
    ...(opts.store !== undefined ? { store: opts.store } : {}),
  });
  const io: ServerCookieJar = { get: (name) => handle.get(name) };
  return build(createServerStorage(io));
}

/**
 * The Emporix session for the current request, **read-write**. Valid only in
 * Server Actions and Route Handlers — Next throws if a Server Component writes
 * a cookie during render.
 *
 * Defaults are `httpOnly: true, sameSite: "lax", secure: true, path: "/"`.
 *
 * Caveat worth knowing before you use it for the customer token: an `httpOnly`
 * cookie cannot be read by the browser-side `createCookieStorage`, so the React
 * provider will mount unauthenticated. The supported pattern stays reading the
 * cookie on the server and passing `initialCustomerToken` into the provider.
 */
export async function emporixSessionMutable(
  opts: {
    sameSite?: "lax" | "strict" | "none";
    secure?: boolean;
    httpOnly?: boolean;
    store?: EmporixSessionStore;
  } = {},
): Promise<EmporixServerSession> {
  if (opts.store !== undefined) {
    // Store mode ignores the attribute overrides: there is exactly one cookie
    // left, the sid, and its attributes are the package's business. The
    // overrides stay a cookie-mode feature rather than being widened into the
    // handle for one caller.
    const handle = await emporixSessionHandle({ store: opts.store });
    const io: ServerCookieJar = {
      get: (name) => handle.get(name),
      set: (name, value) => {
        if (value === null) handle.delete(name);
        else handle.set(name, value, SESSION_MAX_AGE.customerToken);
      },
    };
    // `createServerStorage` writes synchronously, so the store write has to
    // happen after the caller is done. Handing back a `flush` is the honest
    // shape — a silent write-behind would lie about when state lands.
    return { ...build(createServerStorage(io)), flush: () => handle.flush() };
  }
  const jar = await cookies();
  const attrs = {
    httpOnly: opts.httpOnly ?? true,
    sameSite: opts.sameSite ?? ("lax" as const),
    secure: opts.secure ?? true,
    path: "/",
  };
  const io: ServerCookieJar = {
    get: (name) => readCookie(name, (wire) => jar.get(wire)?.value),
    // Writes need the single right name; `attrs.secure` is what this variant
    // actually puts on the cookie, so the name must follow it.
    set: (name, value) => {
      if (value === null) jar.delete(cookieName(name, attrs.secure));
      else jar.set(cookieName(name, attrs.secure), sealCookie(name, value), attrs);
    },
  };
  return build(createServerStorage(io));
}
