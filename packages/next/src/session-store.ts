import { randomBytes } from "node:crypto";
import { STORAGE_KEYS } from "@viu/emporix-sdk";
import { SESSION_ABSOLUTE_MAX, SESSION_STARTED_AT } from "./session-cookies";

/**
 * A place to keep session values so the browser never holds them.
 *
 * The package ships no implementation on purpose — that is what keeps it at zero
 * runtime dependencies. `examples/next-server-first` has a Redis one to copy.
 *
 * Three methods, because a fourth would be something to get wrong. `write`
 * REPLACES the record rather than merging: a merge needs conflict rules for two
 * concurrent requests, and last-writer-wins is the right semantics for session
 * state anyway.
 */
export interface EmporixSessionStore {
  /** The record, or `null` when the id is unknown or expired. */
  read(id: string): Promise<Record<string, string> | null>;
  /** Replaces the record and sets its expiry. */
  write(id: string, record: Record<string, string>, ttlSeconds: number): Promise<void>;
  /** Removes the record. Must not throw when the id is unknown. */
  destroy(id: string): Promise<void>;
}

/** The only session cookie in store mode. */
export const SESSION_SID = "emporix.sid";

/**
 * How long a guest session lives, sliding.
 *
 * An anonymous session guards no account, so there is no reason for a hard
 * ceiling. What bounds the guest experience is Emporix's refresh token, not
 * this: the anonymous access token is valid for one hour and is renewed from
 * the refresh token.
 *
 * Seven rather than the thirty days the cookie mode uses, because in store mode
 * every visitor costs a key. With bot traffic that is a real operational line
 * item and this is the cheapest lever against it.
 */
export const SESSION_GUEST_MAX = 7 * 24 * 60 * 60;

/**
 * Values that stay cookies even in store mode.
 *
 * The site proxy writes them browser-readable on purpose, so a client-side
 * language switch works. Moving them into the store would defeat that.
 */
const PUBLIC_KEYS: readonly string[] = [STORAGE_KEYS.siteCode, STORAGE_KEYS.language];

export function isPublicSessionKey(name: string): boolean {
  return PUBLIC_KEYS.includes(name);
}

/**
 * 32 random bytes.
 *
 * Not sealed with `EMPORIX_COOKIE_SECRET`: encrypting a random id buys nothing,
 * because it already means nothing without the store.
 */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The remaining lifetime for a record, in seconds.
 *
 * Time-remaining rather than a fixed window, so the key dies exactly when the
 * session does and a sliding TTL cannot outlive a non-sliding ceiling.
 *
 * `Number(undefined)` is `NaN`, so `Number.isFinite` is enough here — unlike
 * `handle.get()`, which returns `null`, and `Number(null)` is **0**. That
 * difference already caused one bug in the session ceiling.
 */
export function recordTtl(record: Record<string, string>): number {
  const hasCustomer = record[STORAGE_KEYS.customerToken] !== undefined;
  if (!hasCustomer) return SESSION_GUEST_MAX;
  const startedAt = Number(record[SESSION_STARTED_AT]);
  if (!Number.isFinite(startedAt)) return SESSION_ABSOLUTE_MAX;
  const spent = Math.floor(Date.now() / 1000) - startedAt;
  return Math.max(1, SESSION_ABSOLUTE_MAX - spent);
}
