/**
 * The one worked error-reporting adapter. Deliberately console-only: the point
 * is the shape of the wiring, not a vendor. Swap the body for your tool.
 *
 * Next runs `register()` once per server process, before the first request —
 * which is why the seam is module-scope rather than a per-client option.
 * `getEmporixClient` is memoized on a string key, and a function cannot go in a
 * string key, so a per-client reporter would mean the first caller silently
 * wins for the whole process.
 */
import { setEmporixErrorReporter } from "@viu/emporix-sdk-next/session";

export async function register(): Promise<void> {
  setEmporixErrorReporter((event) => {
    // Group on `event.code`, never on a message: the SDK interpolates tenant and
    // path into messages, so a message fingerprint yields one bucket per request.
    //
    // `event.context` is already redacted by the package. `event.cause` is NOT —
    // a scrubbed stack trace is useless, so scrubbing it is this adapter's call.
    // eslint-disable-next-line no-console
    console[event.severity === "warning" ? "warn" : "error"]("[emporix]", {
      code: event.code,
      degradedTo: event.degradedTo,
      context: event.context,
      cause: event.cause instanceof Error ? event.cause.message : String(event.cause),
    });
  });
}
