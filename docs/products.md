# Products

`client.products` reads the Emporix Product Service. Standard reads: `get`,
`getByCode`, `list` / `listAll`, `search`, `searchByIds`.

## Variant children

Emporix products have a `productType` of `BASIC`, `PARENT_VARIANT`, `VARIANT`, or
`BUNDLE`. A `PARENT_VARIANT` product's variants are separate `VARIANT` products
that reference the parent via `parentVariantId`. The SDK encapsulates the search
query so you don't build it by hand.

```ts
// All variant children as a flat array (loads every page; default pageSize 200)
const children = await client.products.listVariantChildren("PARENT-1");

// Streaming, page by page — for large variant sets
for await (const variant of client.products.listVariantChildrenAll("PARENT-1")) {
  render(variant);
}
```

A parent with no children resolves to `[]` (it never throws). Internally this
runs `search("productType:VARIANT parentVariantId:<id>")` — space-separated
fields are combined with implicit AND, per Emporix's query-parameter syntax.

## React

```tsx
import { useVariantChildren } from "@viu/emporix-sdk-react";

function VariantPicker({ parentId }: { parentId: string }) {
  const { data: variants } = useVariantChildren(parentId);
  return <>{variants?.map((v) => <Option key={v.id} variant={v} />)}</>;
}
```

The hook defaults to the anonymous/customer token (override via `options.auth`),
uses a 60s stale time, and its cache key contains `parentVariantId`.
