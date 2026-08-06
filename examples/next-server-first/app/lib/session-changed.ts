/**
 * The one signal that says «the session changed, re-read it».
 *
 * Needed because the shell's personalised bits are a **client** island by design.
 * `SessionNav` reads `/api/session/nav` in an effect, and an effect runs once per
 * *mount* — while a Server Action neither remounts a client component nor tells it
 * anything. Measured 2026-08-06 after adding a product to the cart: the server
 * answered `{cartCount: 1}` and the header still showed a bare `Cart`, with exactly
 * **one** `/api/session/nav` request in the network log. A full page load fixed it,
 * which is the tell — F5 is a new mount.
 *
 * `revalidatePath` cannot fix that: it re-renders the server tree, and React keeps the
 * state of a client component that stays at the same position. Server-rendering the nav
 * would fix it and is not available — a `cookies()` read in the root layout turns all
 * four catalog routes from `●` to `ƒ`, which is the whole point of the ISR work. Without
 * per-component dynamic boundaries there is no third option.
 *
 * So: a `window` event, deliberately. Not a context provider — «no provider» is a claim
 * this demo makes on its front page — and not a store. Two lines of mechanism for two
 * client components that need to agree about one thing.
 */
export const SESSION_CHANGED = "emporix:session-changed";

/** Call after a mutation that could change the cart count or the login state. */
export function notifySessionChanged(): void {
  // Guarded for the server: `ActionForm` is a client component, but its module graph is
  // also walked during the RSC render.
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_CHANGED));
}

/** Subscribe. Returns the unsubscribe, shaped for an effect's cleanup. */
export function onSessionChanged(listener: () => void): () => void {
  window.addEventListener(SESSION_CHANGED, listener);
  return () => window.removeEventListener(SESSION_CHANGED, listener);
}
