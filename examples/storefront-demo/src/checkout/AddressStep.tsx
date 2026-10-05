import { useState } from "react";
import type { Address } from "@viu/emporix-sdk";
import { Button } from "../components/ui/Button";
import { AddressPicker } from "./AddressPicker";
import { addressErrors, type AddressDraft } from "./AddressFields";

/** Step 2: where the order goes. Errors appear once «Continue» was pressed. */
export function AddressStep({
  value,
  onChange,
  saved,
  countries,
  onContinue,
}: {
  value: AddressDraft;
  onChange: (patch: Partial<AddressDraft>) => void;
  saved: Address[];
  countries: string[];
  onContinue: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const errors = touched ? addressErrors(value, countries) : {};
  function next() {
    setTouched(true);
    if (Object.keys(addressErrors(value, countries)).length === 0) onContinue();
  }
  return (
    <div>
      <AddressPicker value={value} onChange={onChange} saved={saved} countries={countries} idPrefix="shipping" errors={errors} />
      <div className="co-actions">
        <Button variant="accent" onClick={next}>
          Continue to delivery
        </Button>
      </div>
    </div>
  );
}
