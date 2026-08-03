import {
  SESSION_MAX_AGE,
  STORAGE_KEYS,
  type SessionCookieJar,
} from "@viu/emporix-sdk-next/session";

/** Demo-owned, so it is prefixed to stay out of the package's namespace. */
const COUNT = "demo.cartCount";

/**
 * The ONLY place that writes the cart id.
 *
 * The count sits next to it in the session so the shell can show a badge without
 * an Emporix call. The alternative would be a `withEmporixSession` per page view,
 * and the guest path deliberately builds a NEW client per call — a shared guest
 * client would be a shared cart. On top of that a read-only jar cannot persist a
 * rotated anonymous session, so the documented refresh-token reuse would go from
 * «three reads on /cart» to «every page view», plus a token round-trip per page.
 *
 * Keeping both writes in one function is what makes drift structurally
 * impossible rather than merely unlikely.
 */
export function setCart(
  jar: SessionCookieJar,
  cart: { id?: string; items?: unknown[] } | null,
): void {
  const id = cart?.id;
  if (cart === null || id === undefined) {
    jar.delete(STORAGE_KEYS.cartId);
    jar.delete(COUNT);
    return;
  }
  jar.set(STORAGE_KEYS.cartId, id, SESSION_MAX_AGE.cartId);
  jar.set(COUNT, String(cart.items?.length ?? 0), SESSION_MAX_AGE.cartId);
}

/** Line count for the shell badge. Zero Emporix calls. */
export function cartCount(jar: SessionCookieJar): number {
  // Without a cart id a count is meaningless, and this is what covers logout:
  // SESSION_COOKIES in session-auth.ts is a fixed list, our demo key is not on
  // it and would otherwise outlive the logout.
  if (jar.get(STORAGE_KEYS.cartId) === null) return 0;
  // `Number.isInteger` rather than a truthiness test: `Number(null)` is 0, not
  // NaN — the same trap that made every unstamped session hit the 90-day ceiling.
  const n = Number(jar.get(COUNT));
  return Number.isInteger(n) && n > 0 ? n : 0;
}
