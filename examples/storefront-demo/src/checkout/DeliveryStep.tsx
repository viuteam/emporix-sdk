import { useMemo } from "react";
import { useShippingZones } from "@viu/emporix-sdk-react";
import { pickFee, resolveZone } from "@viu/emporix-sdk";
import { money } from "@viu/emporix-examples-shared";
import { pickText } from "../lib/adapters";
import { countryName } from "../lib/countries";
import { Alert } from "../components/ui/Alert";
import { Button } from "../components/ui/Button";
import { RadioCard } from "../components/ui/RadioCard";
import { Spinner } from "../components/ui/Spinner";
import { freeFrom, type DeliveryChoice } from "./totals";

/**
 * The methods of the zone that ships to `country`, each priced from its fee
 * table at the order value (`CheckoutTotals.orderValue`: items net on a
 * tax-exclusive site). Lives outside the step so the checkout can preselect a
 * method before step 3 ever opens.
 */
export function useDeliveryOptions(
  country: string,
  orderValue: number | undefined,
): { options: DeliveryChoice[]; isLoading: boolean } {
  const { data: zones, isLoading } = useShippingZones();
  const options = useMemo(() => {
    const zone = resolveZone(zones, country);
    const zoneId = zone?.id;
    if (!zone || !zoneId) return [];
    return (zone.methods ?? [])
      .filter((m) => m.active !== false && (m.fees?.length ?? 0) > 0)
      .flatMap((m): DeliveryChoice[] => {
        const fee = pickFee(m.fees, orderValue ?? 0);
        const methodId = m.id;
        if (!fee || !methodId) return [];
        const free = freeFrom(m.fees);
        return [
          {
            methodId,
            zoneId,
            methodName: pickText(m.name, methodId),
            amount: fee.cost.amount,
            ...(m.shippingTaxCode ? { shippingTaxCode: m.shippingTaxCode } : {}),
            ...(free !== undefined ? { freeFrom: free } : {}),
          },
        ];
      });
  }, [zones, country, orderValue]);
  return { options, isLoading };
}

/** What the order goes out with when no method resolves: the pre-redesign behaviour, now stated in the step. */
export function fallbackDelivery(country: string): DeliveryChoice {
  return { methodId: "free", zoneId: country, methodName: "Free Shipping", amount: 0 };
}

/** Step 3: one radio card per method, with its price and free-delivery threshold. */
export function DeliveryStep({
  options,
  isLoading,
  country,
  currency,
  includesTax,
  value,
  onChange,
  onContinue,
}: {
  options: DeliveryChoice[];
  isLoading: boolean;
  country: string;
  currency: string;
  includesTax: boolean;
  value: string | null;
  onChange: (methodId: string) => void;
  onContinue: () => void;
}) {
  return (
    <div>
      {!includesTax && options.length > 0 ? <p className="field__hint">Prices excl. VAT.</p> : null}
      {isLoading ? (
        <Spinner label="Loading delivery options" />
      ) : options.length === 0 ? (
        <Alert tone="warning">
          No delivery method is configured for {countryName(country)} on this site. The order goes out with a
          free-shipping placeholder (<code>methodId: "free"</code>).
        </Alert>
      ) : (
        <div className="radio-list">
          {options.map((o) => (
            <RadioCard
              key={o.methodId}
              name="delivery"
              value={o.methodId}
              checked={value === o.methodId}
              onChange={onChange}
              title={o.methodName}
              description={o.freeFrom !== undefined ? `Free from ${money(o.freeFrom, currency)}` : undefined}
              aside={o.amount === 0 ? "Free" : money(o.amount, currency)}
            />
          ))}
        </div>
      )}
      <div className="co-actions">
        <Button variant="accent" onClick={onContinue} disabled={isLoading}>
          Continue to payment
        </Button>
      </div>
    </div>
  );
}
