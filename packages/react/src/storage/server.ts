import { auth, type AuthContext } from "@viu/emporix-sdk";
import type { EmporixStorage } from "./index";
import { createCookieBackedStorage } from "./cookie-core";

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
 * exactly what `useEmporixQuery` resolves on the client: the customer context
 * when a token is stored, anonymous otherwise.
 *
 * Use this rather than hand-rolling it — `authKind` is part of every query key,
 * so a mismatch here produces a silent cache miss (a second fetch after
 * hydration, no error).
 */
export function serverAuth(storage: EmporixStorage): AuthContext {
  const token = storage.getCustomerToken();
  return token !== null ? auth.customer(token) : auth.anonymous();
}
