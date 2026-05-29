# Availability

Site-aware product availability via the Emporix Availability Service. Exposed as
`client.availability` (SDK) and the `useAvailability` / `useAvailabilities` hooks
(React).

## Scope & auth

Reads require the `availability.availability_view` scope. Calls default to the
anonymous (storefront) token — which works only if your storefront client carries
that scope (the same assumption price matching makes). Pass `auth.service()` for a
server-side service token, or a customer token for a customer context.

There is **no restock-date / availability-date field** in the API. A record
carries `available`, optional `stockLevel`, `productId`, `site`, and (for bundles)
`bundleAvailabilities`.

## SDK

```ts
// Single product
const a = await client.availability.get("PRODUCT-1", "main");
if (a.available) render(a.stockLevel);

// Tenants without stock management: treat "no record" as available
const a2 = await client.availability.get("PRODUCT-1", "main", auth.anonymous(), {
  defaultAvailableOnNotFound: true,
});

// Batch — one request, result is in input order
const list = await client.availability.getMany(["P1", "P2", "P3"], "main");
// Missing products come back as { available: false } unless
// defaultAvailableOnNotFound is set (then { available: true }).
```

`getMany` issues a single `POST /availability/{tenant}/availability/search`. The
result always has the same length and order as `productIds`.

## React

```tsx
import { useAvailability, useAvailabilities } from "@viu/emporix-sdk-react";

function StockBadge({ productId, site }: { productId: string; site: string }) {
  const { data } = useAvailability(productId, site);
  return <span>{data?.available ? "In stock" : "Sold out"}</span>;
}

function Grid({ ids, site }: { ids: string[]; site: string }) {
  const { data } = useAvailabilities(ids, site, { defaultAvailableOnNotFound: true });
  return <>{data?.map((a) => <Tile key={a.productId} a={a} />)}</>;
}
```

Both hooks default to the anonymous token (pass `customerToken` to override),
use a 30s stale time, and accept `defaultAvailableOnNotFound`.
