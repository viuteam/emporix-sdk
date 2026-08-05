"use client";
import { useActionState } from "react";

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
}: {
  action: FormAction;
  submit: string;
  children?: React.ReactNode;
  /**
   * Layout des Formulars, weil das `<form>` seinen Kindern keines gibt.
   *
   * Ohne das stiess der Knopf ohne Abstand an die Unterkante des Feldes — in der
   * Warenkorb-Summary sichtbar. Die Warenkorbzeile will das Gegenteil, naemlich
   * Beschriftung, Feld und Knopf in einer Reihe, und bekommt das schon vom
   * Inline-Fluss. Darum ein Prop und kein fester Wert.
   */
  className?: string;
}): React.JSX.Element {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} {...(className !== undefined ? { className } : {})}>
      {children}
      {state.error !== null ? (
        <p role="alert" className="muted" style={{ color: "var(--oxblood)" }}>
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn btn--sm" disabled={pending}>
        {pending ? "…" : submit}
      </button>
    </form>
  );
}
