# Searching by mixin (custom) fields

Mixins are namespaced custom fields stored under `<entity>.mixins.<schemaKey>.<attribute>`.
The Emporix `q` query parameter filters by these fields. `@viu/emporix-mixins` provides a
type-safe builder that turns a generated `MixinDescriptor` into a `q` filter.

## Build a filter

```ts
import { mixinQuery, and, or, raw } from "@viu/emporix-mixins";
import { mixins } from "./generated/mixins/registry"; // from `emporix-mixins generate`

// Equals, range, in-list, regex, exists, localized:
const q = mixinQuery(mixins.attrs, {
  color: "Blue",                       // equals
  qty: { gte: 10, lte: 20 },           // range
  size: { in: ["S", "M"] },            // in-list
  note: { regex: "sale" },             // regex
  promo: { exists: true },             // present
  title: { lang: "en", eq: "Sale" },   // localized → mixins.attrs.title.en:Sale
});

// Combine: and() is space-joined AND; or() needs a compound-capable service.
const q2 = or(
  mixinQuery(mixins.attrs, { color: "Blue" }),
  mixinQuery(mixins.attrs, { color: "Black" }),
);

// raw() escapes a non-mixin clause and composes inside and()/or():
const q3 = and(mixinQuery(mixins.attrs, { color: "Blue" }), raw("published:true"));
```

Attribute names and value types are checked at compile time, and the entity is carried through
`MixinDescriptor<T, E>` → `MixinFilter<E>`, so a filter built for one entity cannot be passed to
another entity's search.

## Use it

```ts
import { useProductSearch } from "@viu/emporix-sdk-react";

const { data } = useProductSearch(q);          // React
const page = await client.products.search(q);  // SDK
```

## Localized fields

Localized attributes are stored language-keyed. Add `lang` to target one language —
the builder appends the language segment to the path:

```ts
mixinQuery(mixins.attrs, { title: { lang: "en", regex: "sale" } });
// → mixins.attrs.title.en:~sale
```

## Capability matrix

| Service | mixin `q` filter | `or()` (`compoundLogicalQuery`) | In the SDK |
|---|---|---|---|
| Product | yes | **yes** | `products.search` / `useProductSearch` |
| Category | yes | no (use `and()`) | `categories.search` / `useCategorySearch` |
| Order | yes | no (use `and()`) | `orders.listMine({ q })` / `useMyOrders({ q })` |
| Customer (admin) | yes | no (use `and()`) | `customerAdmin.searchCustomers({ q })` |
| Vendor (admin) | yes | no (use `and()`) | `vendor.searchVendors({ q })` |
| Cart, Price, Availability | yes | varies | not wired yet (admin/niche) |
| Approval, Segment, Fee, Schema instances | no mixins | — | raw `q` string only |

Passing an `or()` filter to a service that does not support `compoundLogicalQuery` throws.

## Limitations (this release)

- **Values containing whitespace** throw (the safe `q` escaping is unverified) — use `raw()`.
- `exists`/`missing` is emitted at the attribute path; confirm attribute-level semantics on your tenant.
- The localized indexed path (`mixins.<key>.<attr>.<lang>`) should be confirmed against your tenant.
