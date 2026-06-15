# Checkout: select a delivery (shipping) option

**Status:** Design approved — ready for implementation planning
**Date:** 2026-06-15
**Branch:** `feat/checkout-shipping-option` (from `main`, which already contains the address/payment checkout work)

## Summary

Extend the `storefront-demo` checkout so the shopper can choose a delivery
option from the shipping methods configured in Emporix, instead of the
hardcoded "Free Shipping". The shipping methods live under a zone; the zone is
resolved from the shipping country, and the cost comes from the method's
configured fee tier. This needs a new React hook (the SDK already exposes the
service) and a new example component.

## Goals

- List the tenant's configured shipping methods for the relevant zone and let
  the shopper pick one (guests and logged-in customers alike).
- Resolve the zone from the shipping address country, falling back to the
  default zone, then the first zone.
- Take the cost from the method's fee tier (highest `minOrderValue` ≤ cart
  total), and send the chosen method in the checkout `shipping` payload.

## Non-goals

- No SDK change: `ShippingService.listZones` already accepts any `AuthContext`;
  we pass a customer-or-anonymous context from the React hook.
- No `quote`-endpoint call for cost (client-side fee tiering chosen instead).
- No delivery-time / slot scheduling (Shipping "Phase 2").
- No changes to the other examples.

## Background / findings

- `examples/storefront-demo/src/pages/Checkout.tsx` (current `main`) hardcodes
  `shipping: { methodId: "free", zoneId: shipping.country, methodName: "Free Shipping", amount: 0 }`.
  It already has the `AddressSection` / `PaymentSelector` components and a
  `shipping: AddressDraft` state.
- The SDK `ShippingService` (`packages/sdk/src/services/shipping.ts`) has
  `listZones(site, query = {}, auth = SERVICE)`. The default auth is the service
  token, but the method **accepts any `AuthContext`** — no `requireCustomer`
  gate (unlike the old `listPaymentModes`). So no SDK change is needed; the hook
  passes the storefront's customer-or-anonymous context.
- The Emporix docs confirm `GET /shipping/{tenant}/{site}/zones` has
  `security: oAuth2: []` (no scope — a bearer token suffices; there is no 403
  branch), and supports query params `expand` (`methods`, `fees`) and
  `activeMethods`. So **one** call `listZones(site, { expand: "methods,fees",
  activeMethods: "true" })` returns zones with their active methods + fees
  inline.
- Types (`packages/sdk/src/generated/shipping/types.gen.ts`, re-exported via
  `@viu/emporix-sdk`):
  - `Zone = { id, default?, name: LocalizedValue, shipTo: ShipToItem[], methods?: Method[] }`
  - `ShipToItem = { country: string /* ISO2/ISO3 */, postalCode? }`
  - `Method = { id, name: LocalizedValue, maxOrderValue?, active?, fees: Fee[], shippingTaxCode?, shippingGroupId? }`
  - `Fee = { cost: MonetaryAmount, minOrderValue: MonetaryAmount, shippingGroupId? }`
  - `MonetaryAmount = { currency, amount }`
  - `LocalizedValue = string | { [lang]: string }`
  - `ZoneList = Zone[]` and `ShippingMethod` (= `Method`) are exported from
    `@viu/emporix-sdk`. (`Zone` singular is not re-exported by name; derive it as
    `ZoneList[number]` where needed.)
- `EmporixClient` exposes `client.shipping`.
- There is **no** existing React hook for shipping (0 matches under
  `packages/react/src/hooks`).
- The example already has `pickText(v, fallback)` in `src/lib/adapters.ts`,
  which resolves a `string | { locale: value }` `LocalizedValue` using a
  `LOCALE_ORDER` preference. Reuse it for method/zone names — no `lang` prop or
  bespoke localization helper needed.
- The example's `useReadSite().siteCode` gives the active site (default
  `"main"`); the React hook defaults the site to it.

## Design

Chosen over a two-hook split (`useShippingZones` + `useShippingMethods`, which
needs two calls) and over a `quote`-based cost (excluded by decision). One hook,
one call, client-side resolution — mirroring the payment-modes pattern.

### 1. React — new hook `useShippingZones`

New file `packages/react/src/hooks/use-shipping.ts`:

```ts
export function useShippingZones(
  options: { site?: string; enabled?: boolean } = {},
): UseQueryResult<ZoneList> {
  const { client } = useEmporix();
  const { ctx } = useReadAuth();          // customer if token, else anonymous
  const { siteCode } = useReadSite();
  const site = options.site ?? siteCode;
  return useQuery({
    queryKey: emporixKey("shipping-zones", [site], { tenant: client.tenant, authKind: ctx.kind }),
    enabled: (options.enabled ?? true) && !!site,
    queryFn: () => client.shipping.listZones(site, { expand: "methods,fees", activeMethods: "true" }, ctx),
    staleTime: 10 * 60_000,               // admin-configured config data
  });
}
```

Exported from `packages/react/src/hooks/index.ts` and `packages/react/src/index.ts`.

### 2. Example — `ShippingSelector` + pure helpers

New file `examples/storefront-demo/src/checkout/ShippingSelector.tsx`:

- Exported type:
  ```ts
  export type SelectedShipping = {
    methodId: string;
    zoneId: string;
    methodName: string;
    amount: number;
    shippingTaxCode?: string;
  };
  ```
- Props: `{ country: string; cartTotal: number | undefined; value: SelectedShipping | null; onChange: (s: SelectedShipping | null) => void }`.
- Uses `useShippingZones()`.
- Pure, independently testable helpers (in this file):
  - `resolveZone(zones, country)` → the zone whose `shipTo` contains `country`
    (case-insensitive); else the `default: true` zone; else the first; else
    `undefined`.
  - `pickFee(fees, cartTotal)` → the fee with the highest `minOrderValue.amount`
    ≤ `cartTotal` (or 0 when `cartTotal` is undefined); fallback to the first
    fee; `undefined` if `fees` is empty.
  - Method label via the existing `pickText(method.name, method.id ?? "")` from
    `../lib/adapters` (no new localization code).
- Renders the resolved zone's active methods as a radio list (label + the picked
  fee cost via `money(...)`). Default-selects the first method and reports the
  resolved `SelectedShipping` via `onChange`.
- Loading → spinner. Empty / error / no resolvable zone or method → a muted
  "Free Shipping" note and `onChange(null)` (the checkout then uses its free
  fallback).
- Re-resolves when `country` changes; when the current selection's method is no
  longer present, it re-selects the first available method.

### 3. Example — wire into `Checkout.tsx`

- Add state `const [selectedShipping, setSelectedShipping] = useState<SelectedShipping | null>(null);`.
- Render `<ShippingSelector country={shipping.country} cartTotal={total?.amount} value={selectedShipping} onChange={setSelectedShipping} />`
  between the address block and `<PaymentSelector>`.
- In `submit`, build the `shipping` field from the selection with a free
  fallback:
  ```ts
  shipping: selectedShipping
    ? {
        methodId: selectedShipping.methodId,
        zoneId: selectedShipping.zoneId,
        methodName: selectedShipping.methodName,
        amount: selectedShipping.amount,
        ...(selectedShipping.shippingTaxCode ? { shippingTaxCode: selectedShipping.shippingTaxCode } : {}),
      }
    : { methodId: "free", zoneId: shipping.country, methodName: "Free Shipping", amount: 0 },
  ```
- The summary aside additionally shows the selected shipping cost (a single
  line; falls back to nothing/"Free" when none).

### 4. Data flow

```
useShippingZones ─▶ ShippingSelector ─(resolveZone/pickFee/pickText)─▶ selectedShipping ─┐
shipping.country ───────────────────────────────────────────────────────────────────────┤
                                                                                         ├─▶ Checkout.submit() ─▶ placeOrder
PaymentSelector ─▶ selectedModeId ───────────────────────────────────────────────────────┘
```

### 5. Error handling

- No zones / methods, fetch error, or no resolvable zone → silent free fallback
  (`onChange(null)`); checkout stays usable.
- A country with no matching zone → default zone, then first zone.
- `pickFee` with no matching tier → first fee; with no fees → method not
  selectable (skipped / free fallback).

## Testing & verification

- **React** `packages/react/tests/use-shipping.test.tsx`: `useShippingZones`
  returns zones for an anonymous (guest) session **and** for a logged-in
  customer (MSW mocks `GET …/main/zones` returning a zone with active methods +
  fees, plus the anonymous-login endpoint).
- **Example (optional, recommended)** unit tests for the pure helpers
  `resolveZone` / `pickFee` if a test setup is added; otherwise they are covered
  via typecheck + manual check.
- **Changeset**: one `minor` for `@viu/emporix-sdk-react` (new `useShippingZones`
  hook). No SDK changeset (no SDK change).
- **Docs**: add `useShippingZones` to `docs/react.md` (hooks list + the
  staleness table, 10 min).
- **Example** (`@viu/emporix-examples-storefront-demo`): build the packages,
  then typecheck —
  `pnpm -F @viu/emporix-sdk build && pnpm -F @viu/emporix-sdk-react build`
  then `pnpm -F @viu/emporix-examples-storefront-demo typecheck`.
  Live order placement is optional/manual (it creates a real order in `viu`).

## Risks / open questions

- The free fallback (`methodId: "free"`) is only used when no configured method
  resolves; if the tenant requires a real method, the fallback order may be
  rejected — acceptable for the demo and covered by the existing "Live order"
  warning.
- Fee currency is assumed to match the cart currency (tenant-level); the picked
  fee's amount is sent as-is.
- Zone resolution matches on country only (not postal code), which is sufficient
  for the demo; postal-code-scoped zones would need `findSites`/`quote`.
