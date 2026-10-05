import { useState } from "react";
import type { Address, PaymentMode } from "@viu/emporix-sdk";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { RadioCard } from "../components/ui/RadioCard";
import { Spinner } from "../components/ui/Spinner";
import { AddressPicker } from "./AddressPicker";
import { addressErrors, type AddressDraft } from "./AddressFields";

export interface PaymentDraft {
  modeId: string | null;
  billingSame: boolean;
  billing: AddressDraft;
}

/** A readable name for a payment mode: `invoice` → «Invoice», `cash_on_delivery` → «Cash on delivery». */
export function modeLabel(m: PaymentMode): string {
  const words = (m.code ?? m.id ?? "payment").replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/** Step 4: the tenant's payment modes and the billing address. */
export function PaymentStep({
  modes,
  isLoading,
  value,
  onChange,
  saved,
  countries,
  onContinue,
}: {
  modes: PaymentMode[];
  isLoading: boolean;
  value: PaymentDraft;
  onChange: (patch: Partial<PaymentDraft>) => void;
  saved: Address[];
  countries: string[];
  onContinue: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const billingErrors = touched && !value.billingSame ? addressErrors(value.billing, countries) : {};
  function next() {
    setTouched(true);
    if (value.billingSame || Object.keys(addressErrors(value.billing, countries)).length === 0) onContinue();
  }
  return (
    <div>
      {isLoading ? (
        <Spinner label="Loading payment options" />
      ) : modes.length === 0 ? (
        <Alert tone="warning">
          No payment mode is configured for this tenant. The order goes out with the demo <code>custom</code> provider
          and stays <code>IN_CHECKOUT</code>.
        </Alert>
      ) : (
        <div className="radio-list">
          {modes.map((m) =>
            m.id ? (
              <RadioCard
                key={m.id}
                name="payment"
                value={m.id}
                checked={value.modeId === m.id}
                onChange={(id) => onChange({ modeId: id })}
                title={modeLabel(m)}
              />
            ) : null,
          )}
        </div>
      )}
      <label className="co-check">
        <input type="checkbox" checked={value.billingSame} onChange={(e) => onChange({ billingSame: e.target.checked })} />
        <span>Billing address same as shipping</span>
      </label>
      {!value.billingSame ? (
        <div className="co-step__body">
          <AddressPicker
            value={value.billing}
            onChange={(patch) => onChange({ billing: { ...value.billing, ...patch } })}
            saved={saved}
            countries={countries}
            idPrefix="billing"
            errors={billingErrors}
          />
        </div>
      ) : null}
      <div className="co-actions">
        <Button variant="accent" onClick={next} disabled={isLoading}>
          Review order
        </Button>
      </div>
    </div>
  );
}
