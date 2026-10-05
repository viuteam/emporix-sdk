import type { ReactNode } from "react";

export type StepState = "open" | "done" | "todo";

/**
 * One section of the checkout accordion. Open: the full content. Done: a
 * one-line summary with «Edit». To do: the title only.
 */
export function CheckoutStep({
  index,
  title,
  state,
  summary,
  onEdit,
  children,
}: {
  index: number;
  title: string;
  state: StepState;
  summary?: ReactNode;
  onEdit?: (() => void) | undefined;
  children?: ReactNode;
}) {
  return (
    <section className={`co-step co-step--${state}`} aria-label={title}>
      <div className="co-step__head">
        <span className="co-step__num" aria-hidden="true">
          {state === "done" ? "✓" : index}
        </span>
        <div>
          <h2 className="co-step__title">{title}</h2>
          {state === "done" && summary ? <p className="co-step__summary">{summary}</p> : null}
        </div>
        {state === "done" && onEdit ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onEdit} aria-label={`Edit ${title}`}>
            Edit
          </button>
        ) : null}
      </div>
      {state === "open" ? <div className="co-step__body">{children}</div> : null}
    </section>
  );
}
