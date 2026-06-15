import { useEffect } from "react";
import { usePaymentModes } from "@viu/emporix-sdk-react";
import { Spinner } from "../components/ui/Spinner";

/**
 * Renders the tenant's configured frontend payment modes as a radio list and
 * reports the selected mode id (or `null` when none are available, which the
 * checkout maps to the demo "custom" provider). Default-selects the first mode.
 */
export function PaymentSelector({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (modeId: string | null) => void;
}) {
  const { data: modes, isLoading, isError } = usePaymentModes();

  useEffect(() => {
    if (value !== null) return;
    const first = modes?.[0];
    if (first?.id) onChange(first.id);
  }, [modes, value, onChange]);

  return (
    <div className="stack" style={{ gap: "var(--s-3)" }}>
      <p className="eyebrow">Payment</p>
      {isLoading ? (
        <Spinner label="Loading payment options" />
      ) : isError || !modes || modes.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--step--1)" }}>
          No configured payment modes available — using the demo “custom” provider.
        </p>
      ) : (
        <div className="stack" style={{ gap: "var(--s-2)" }}>
          {modes.map((m) => (
            <label
              key={m.id}
              className="cluster"
              style={{ gap: "var(--s-2)", alignItems: "center" }}
            >
              <input
                type="radio"
                name="paymentMode"
                value={m.id}
                checked={value === m.id}
                onChange={() => onChange(m.id ?? null)}
              />
              <span>{m.code ?? m.id}</span>
              {m.integrationType ? (
                <span className="muted" style={{ fontSize: "var(--step--1)" }}>
                  · {m.integrationType}
                </span>
              ) : null}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
