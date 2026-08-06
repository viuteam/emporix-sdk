"use client";
import { useActionState, useEffect, useRef } from "react";
import { notifySessionChanged } from "../lib/session-changed";

export interface ActionState {
  error: string | null;
}

/** Every action wired to {@link ActionForm} has this shape. */
export type FormAction = (state: ActionState, form: FormData) => Promise<ActionState>;

/**
 * The **only** client component for forms in this demo, and the reason there is
 * one at all: `useActionState` needs a client component to hold the returned
 * state.
 *
 * It takes the action as a prop rather than being written per form. Server
 * Actions are serializable across the boundary, and `children` stays
 * server-rendered — so eight forms need one `"use client"`, not eight.
 *
 * This makes the actions **return** their error instead of throwing it, which is
 * the shape a real app wants anyway: a failed coupon should not be a Next error
 * page.
 *
 * The alternative — redirect back with `?error=…` — needs no client component at
 * all, which is why `/checkout` still does exactly that. It also writes error
 * text into a shareable URL, and that is a defect rather than a cosmetic
 * difference. Worth knowing that both shapes are in here on purpose.
 *
 * Note the demo's other client component, `typeahead.tsx`, makes catalog calls
 * through the proxy with no token. Neither of the two holds an Emporix token, so
 * the mode's claim is intact.
 */
export function ActionForm({
  action,
  submit,
  children,
  className,
  submitClassName = "btn btn--sm",
}: {
  action: FormAction;
  submit: string;
  children?: React.ReactNode;
  /** The submit button's classes. The product tiles and the PDP want their own. */
  submitClassName?: string;
  /**
   * Layout for the form, because a `<form>` gives its children none.
   *
   * Without it the button butted straight against the bottom edge of the field —
   * visible in the cart summary. The cart line wants the opposite, namely label,
   * field and button on one row, and gets that from the inline flow already. Hence a
   * prop rather than a fixed value.
   */
  className?: string;
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState(action, { error: null });

  // Tell the shell to re-read the session once this action has finished.
  //
  // Every cart and account mutation in this demo goes through this one component, so
  // this is the one place that has to say it — the same reason the component exists at
  // all. Watching `pending` fall rather than wrapping the action keeps `action` a Server
  // Action reference, which is what makes these forms work with JavaScript off.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !pending) notifySessionChanged();
    wasPending.current = pending;
  }, [pending]);

  return (
    <form action={formAction} {...(className !== undefined ? { className } : {})}>
      {children}
      {state.error !== null ? (
        <p role="alert" className="muted" style={{ color: "var(--redline)" }}>
          {state.error}
        </p>
      ) : null}
      <button type="submit" className={submitClassName} disabled={pending}>
        {pending ? "…" : submit}
      </button>
    </form>
  );
}
