import { createEmporixWebhookRoute } from "@viu/emporix-sdk-next/webhook";

const secret = process.env.EMPORIX_WEBHOOK_SECRET;
// Throwing beats a route that quietly 401s every delivery because a variable is
// missing — that is the most expensive way to hide a configuration error, and it
// is the pattern this example already uses for the tenant.
if (secret === undefined || secret === "") {
  throw new Error("EMPORIX_WEBHOOK_SECRET is not set — see the README.");
}

/**
 * The trigger that was missing.
 *
 * `getEmporixClient()` tags cacheable catalog responses, and this route calls
 * `revalidateTag` on those tags (`webhook.ts:163`). Until this file existed the
 * tagged client had one half of a loop and no sender: the package shipped the
 * route factory, and no example mounted it.
 *
 * For carts, orders and customer data there is no equivalent and cannot be —
 * `emporixTagsForUrl` returns `[]` for those services on purpose, since they are
 * either per-shopper or secret. The `revalidatePath` calls in the cart actions are
 * therefore correct rather than the blunt instrument; they are the only instrument.
 */
export const POST = createEmporixWebhookRoute({
  secret,
  // Without this the delivery's age is not checked at all, and an intercepted
  // delivery stays replayable for as long as its signature is valid.
  maxAgeSeconds: 300,
});
