import { useEffect, useMemo } from "react";
import { useShippingZones } from "@viu/emporix-sdk-react";
import type { ZoneList, ShippingMethod } from "@viu/emporix-sdk";
import { Spinner } from "../components/ui/Spinner";
import { pickText } from "../lib/adapters";
import { money } from "../lib/format";

type ShippingZone = ZoneList[number];
type Fee = ShippingMethod["fees"][number];

/** The chosen delivery option, shaped for the checkout `shipping` payload. */
export type SelectedShipping = {
  methodId: string;
  zoneId: string;
  methodName: string;
  amount: number;
  shippingTaxCode?: string;
};

/** The zone whose `shipTo` covers `country`, else the default zone, else first. */
export function resolveZone(zones: ZoneList | undefined, country: string): ShippingZone | undefined {
  if (!zones || zones.length === 0) return undefined;
  const c = country.trim().toUpperCase();
  const byCountry = c
    ? zones.find((z) => (z.shipTo ?? []).some((s) => s.country?.toUpperCase() === c))
    : undefined;
  return byCountry ?? zones.find((z) => z.default) ?? zones[0];
}

/** The applicable fee: highest `minOrderValue` ≤ cart total, else the first fee. */
export function pickFee(fees: Fee[] | undefined, cartTotal: number): Fee | undefined {
  if (!fees || fees.length === 0) return undefined;
  const eligible = fees
    .filter((f) => (f.minOrderValue?.amount ?? 0) <= cartTotal)
    .sort((a, b) => (b.minOrderValue?.amount ?? 0) - (a.minOrderValue?.amount ?? 0));
  return eligible[0] ?? fees[0];
}

function toSelected(
  method: ShippingMethod,
  zone: ShippingZone,
  cartTotal: number | undefined,
): SelectedShipping | null {
  const fee = pickFee(method.fees, cartTotal ?? 0);
  if (!fee || !method.id || !zone.id) return null;
  return {
    methodId: method.id,
    zoneId: zone.id,
    methodName: pickText(method.name, method.id),
    amount: fee.cost.amount,
    ...(method.shippingTaxCode ? { shippingTaxCode: method.shippingTaxCode } : {}),
  };
}

function sameSelection(a: SelectedShipping | null, b: SelectedShipping | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.methodId === b.methodId && a.zoneId === b.zoneId && a.amount === b.amount;
}

/**
 * Lets the shopper pick a delivery option from the methods of the zone that
 * matches the shipping country. Reports a `SelectedShipping` via `onChange`, or
 * `null` when nothing resolves (the checkout then uses its free fallback).
 */
export function ShippingSelector({
  country,
  cartTotal,
  value,
  onChange,
}: {
  country: string;
  cartTotal: number | undefined;
  value: SelectedShipping | null;
  onChange: (s: SelectedShipping | null) => void;
}) {
  const { data: zones, isLoading, isError } = useShippingZones();

  const zone = useMemo(() => resolveZone(zones, country), [zones, country]);
  const methods = useMemo<ShippingMethod[]>(
    () => (zone?.methods ?? []).filter((m) => m.active !== false && (m.fees?.length ?? 0) > 0),
    [zone],
  );

  // Keep the parent's selection in sync with the resolved zone/methods and the
  // cart total. Idempotent: only pushes a change when the result actually
  // differs, so it converges instead of looping.
  useEffect(() => {
    const first = methods[0];
    if (!zone || !first) {
      if (value !== null) onChange(null);
      return;
    }
    const current = value ? methods.find((m) => m.id === value.methodId) : undefined;
    const target = toSelected(current ?? first, zone, cartTotal);
    if (!sameSelection(target, value)) onChange(target);
  }, [zone, methods, cartTotal, value, onChange]);

  return (
    <div className="stack" style={{ gap: "var(--s-3)" }}>
      <p className="eyebrow">Delivery</p>
      {isLoading ? (
        <Spinner label="Loading delivery options" />
      ) : isError || !zone || methods.length === 0 ? (
        <p className="muted" style={{ fontSize: "var(--step--1)" }}>
          No configured delivery options for this destination — using free shipping.
        </p>
      ) : (
        <div className="stack" style={{ gap: "var(--s-2)" }}>
          {methods.map((m) => {
            const fee = pickFee(m.fees, cartTotal ?? 0);
            return (
              <label
                key={m.id}
                className="cluster"
                style={{ gap: "var(--s-2)", alignItems: "center" }}
              >
                <input
                  type="radio"
                  name="shippingMethod"
                  value={m.id}
                  checked={value?.methodId === m.id}
                  onChange={() => onChange(toSelected(m, zone, cartTotal))}
                />
                <span>{pickText(m.name, m.id ?? "")}</span>
                {fee ? (
                  <span className="muted" style={{ fontSize: "var(--step--1)" }}>
                    · {money(fee.cost.amount, fee.cost.currency)}
                  </span>
                ) : null}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
