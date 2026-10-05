import { Link } from "react-router-dom";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";

export interface ReviewRow {
  step: number;
  label: string;
  value: string;
  onEdit: () => void;
}

export interface SubmitError {
  message: string;
  /** The cart is gone or already ordered: offer the way back. */
  toCart: boolean;
}

/** Step 5: everything in one place, the live-order warning at the button. */
export function ReviewStep({
  rows,
  total,
  tenant,
  busy,
  error,
  onPlace,
}: {
  rows: ReviewRow[];
  total: string;
  tenant: string;
  busy: boolean;
  error: SubmitError | null;
  onPlace: () => void;
}) {
  return (
    <div className="stack">
      <div className="co-review">
        {rows.map((r) => (
          <div key={r.step} className="co-review__block">
            <span className="co-review__label">{r.label}</span>
            <span className="co-review__value">{r.value}</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={r.onEdit} aria-label={`Edit ${r.label}`}>
              Edit
            </button>
          </div>
        ))}
      </div>
      <Alert tone="warning">
        <strong>Live order.</strong> Placing it creates a real order in tenant <strong>{tenant}</strong>.
      </Alert>
      {error ? (
        <Alert tone="danger">
          {error.message}
          {error.toCart ? (
            <>
              {" "}
              <Link to="/cart" className="u-underline">
                Back to the cart
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}
      <Button variant="accent" block onClick={onPlace} disabled={busy}>
        {busy ? "Placing order…" : `Place order · ${total}`}
      </Button>
    </div>
  );
}
