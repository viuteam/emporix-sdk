import { EmporixError } from "@viu/emporix-sdk";

/**
 * An error message worth reading.
 *
 * `EmporixError.message` is only the status line; the reason lives in `.body`.
 * Dropping it turns «400» into a guessing game — which is exactly what happened
 * while building the checkout page, and again while chasing the cart merge.
 *
 * Shared by every Server Action here, so the message a shopper sees and the
 * message in the log are the same string.
 */
export function describeError(e: unknown): string {
  if (e instanceof EmporixError) {
    const detail = typeof e.body === "string" ? e.body : JSON.stringify(e.body);
    return `${e.message} — ${detail}`;
  }
  return e instanceof Error ? e.message : String(e);
}
