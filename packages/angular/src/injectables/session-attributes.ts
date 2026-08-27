import { type Signal } from "@angular/core";
import type { EmporixClient } from "@viu/emporix-sdk";
import { injectEmporix } from "../provide";
import { writeBundle } from "../write-bundle";

type SessionAttributeInput = Parameters<EmporixClient["sessionContext"]["addAttribute"]>[0];

export interface EmporixSessionAttributeMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  add(attribute: SessionAttributeInput): Promise<void>;
  remove(name: string): Promise<void>;
}

/**
 * Attributes on the storefront's session context.
 *
 * **Written with the current context — customer if signed in, anonymous
 * otherwise — and not forced anonymous.** The endpoint is
 * `/session-context/{tenant}/me/context/attributes`, so `me` resolves to whoever
 * the bearer is: writing anonymously while signed in puts the attribute on a
 * different session than the one the shopper is using.
 *
 * That matters because this package already writes to the same service from
 * `injectEmporixSiteSwitch`, which passes the current context to
 * `sessionContext.patch`. Using anything else here would split site, currency and
 * attributes across two session contexts.
 *
 * React does force `auth.anonymous()` in `useAddSessionAttribute` while its own
 * site context passes the live context to `patch` — the two can land on different
 * sessions. That is the deviation, not this.
 *
 * Invalidates `["emporix", "session-context"]` only. Session attributes feed
 * pricing and segmentation server-side, but which reads they move is tenant
 * configuration, so blanket-invalidating the cache here would bill for guesses.
 */
export function injectSessionAttributeMutations(): EmporixSessionAttributeMutations {
  const { client } = injectEmporix();
  const b = writeBundle([["emporix", "session-context"]]);
  return {
    isPending: b.isPending,
    error: b.error,
    add: (attribute) =>
      b.write((ctx) => client.sessionContext.addAttribute(attribute, ctx), "addSessionAttribute"),
    remove: (name) =>
      b.write(
        (ctx) => client.sessionContext.removeAttribute(name, ctx),
        "removeSessionAttribute",
      ),
  };
}
