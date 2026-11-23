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

## Admin writes

Writes default to the service token and need `availability.availability_manage`.
`create` (`POST`), `update` (`PUT`, an upsert) and `delete` work on one
product/site; `bulkCreate`, `bulkUpdate` and `bulkDelete` take arrays and answer
`207` with one result per entry.

`patch` and `bulkPatch` (added upstream on 2026-11-23) change only the fields a
JSON-Patch names:

```ts
await client.availability.patch("PRODUCT-1", "main", [
  { op: "REPLACE", path: "/stockLevel", value: 42 },
]);

const results = await client.availability.bulkPatch([
  { productId: "P1", site: "main", data: [{ op: "REPLACE", path: "/stockLevel", value: 42 }] },
  { productId: "P2", site: "main", data: [{ op: "REMOVE", path: "/stockLevel" }] },
]);
```

| Trap | Detail |
| --- | --- |
| Upper-case `op` | `"REPLACE"` or `"REMOVE"` — unlike the lower-case media JSON-Patch, and there is no `add`. |
| Patch never creates | A missing availability, including a calculated bundle, is `404` (thrown by `patch`, an entry in `bulkPatch`). Use `update` to upsert. |
| `400` is not only a bad patch | A missing product or site, a vendor that does not own the product, or mixin metadata that fails validation also answer `400`; the record stays unchanged. |
| Bulk limits | At most 200 entries — more is a whole-call `400`; an empty array resolves to `[]`. A patched entry's `id` is `"{site}:{productId}"`. |

Neither method has been verified against a live tenant yet.

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
