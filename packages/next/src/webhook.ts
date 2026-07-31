import { createHmac, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { emporixTags } from "./tags";

/** An Emporix webhook delivery. */
export interface EmporixWebhookEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** Recursively sorts object keys; array order is preserved. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeys(src[key]);
    return out;
  }
  return value;
}

/**
 * Serializes a parsed JSON value with all object keys — nested included — in
 * alphabetical order and no whitespace.
 *
 * This is what Emporix signs. Their documented example uses
 * `json-stable-stringify`; a recursive key-sort plus `JSON.stringify` produces
 * the same output for JSON values, so no dependency is added.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/**
 * Verifies the `emporix-event-signature` header: HMAC-SHA256, base64.
 *
 * **The signed payload is the canonicalized body, not the raw bytes.** Emporix
 * signs the parsed body with all fields and nested objects ordered
 * alphabetically — see
 * https://developer.emporix.io/ce/system-management/webhooks-user-guide/hmac-configuration
 * Verifying against the raw bytes rejects every real delivery.
 *
 * Note: this follows the vendor's published example and has not been verified
 * against a live delivery. Smoke-test one real webhook before relying on it in
 * production. `canonicalize: false` signs the raw bytes instead, as an escape
 * hatch if a tenant turns out to behave differently.
 */
export function verifyEmporixSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  opts: { canonicalize?: boolean } = {},
): boolean {
  if (signatureHeader === null || signatureHeader === "") return false;

  let signedPayload: string;
  if (opts.canonicalize === false) {
    signedPayload = rawBody;
  } else {
    try {
      signedPayload = canonicalJson(JSON.parse(rawBody));
    } catch {
      return false;
    }
  }

  const expected = Buffer.from(createHmac("sha256", secret).update(signedPayload).digest("base64"));
  const received = Buffer.from(signatureHeader);
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}

/** Maps an event type + payload to the cache tags it invalidates. */
function tagsForEvent(event: EmporixWebhookEvent): string[] {
  const id = typeof event.payload?.id === "string" ? event.payload.id : undefined;
  if (event.type.startsWith("product.")) {
    return id ? [emporixTags.product(id), emporixTags.products] : [emporixTags.products];
  }
  if (event.type.startsWith("category.")) {
    return id ? [emporixTags.category(id), emporixTags.categories] : [emporixTags.categories];
  }
  if (event.type.startsWith("price.")) return [emporixTags.prices];
  if (event.type.startsWith("availability.")) return [emporixTags.availability];
  return [];
}

/**
 * A Next Route Handler that verifies an Emporix webhook and invalidates the
 * matching cache tags.
 *
 * ```ts
 * // app/api/emporix/webhook/route.ts
 * import { createEmporixWebhookRoute } from "@viu/emporix-sdk-next/webhook";
 * export const POST = createEmporixWebhookRoute({
 *   secret: process.env.EMPORIX_WEBHOOK_SECRET!,
 *   maxAgeSeconds: 300,
 * });
 * ```
 *
 * A signature or replay-window failure returns 401 and revalidates nothing. A
 * throwing `onEvent` returns 500 so Emporix retries the delivery.
 */
export function createEmporixWebhookRoute(opts: {
  secret: string;
  /** Runs after revalidation. Throwing returns 500 and Emporix retries. */
  onEvent?: (event: EmporixWebhookEvent) => Promise<void> | void;
  /** Reject deliveries older than this, per `emporix-event-publish-time`. */
  maxAgeSeconds?: number;
  /** Verify against the raw bytes instead of the canonicalized body. */
  canonicalize?: boolean;
}): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const rawBody = await req.text();
    // exactOptionalPropertyTypes: build the object rather than passing
    // `{ canonicalize: undefined }`, which is a type error.
    const verifyOpts = opts.canonicalize !== undefined ? { canonicalize: opts.canonicalize } : {};
    const verified = verifyEmporixSignature(
      rawBody,
      req.headers.get("emporix-event-signature"),
      opts.secret,
      verifyOpts,
    );
    if (!verified) return new Response("invalid signature", { status: 401 });

    if (opts.maxAgeSeconds !== undefined) {
      const publishedAt = req.headers.get("emporix-event-publish-time");
      const publishedMs = publishedAt === null ? NaN : Date.parse(publishedAt);
      if (Number.isNaN(publishedMs)) {
        return new Response("missing or unparseable publish time", { status: 401 });
      }
      if (Date.now() - publishedMs > opts.maxAgeSeconds * 1000) {
        return new Response("delivery too old", { status: 401 });
      }
    }

    let event: EmporixWebhookEvent;
    try {
      event = JSON.parse(rawBody) as EmporixWebhookEvent;
    } catch {
      return new Response("unparseable body", { status: 400 });
    }

    for (const tag of tagsForEvent(event)) {
      revalidateTag(tag);
    }

    if (opts.onEvent) {
      try {
        await opts.onEvent(event);
      } catch {
        return new Response("handler failed", { status: 500 });
      }
    }

    return new Response(null, { status: 200 });
  };
}
