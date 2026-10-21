---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": patch
"@viu/emporix-sdk-angular": patch
---

Variants of both models.

- **`listVariantChildren` finds dynamic variants.** It searched only `productType:VARIANT parentVariantId:<id>`, so a DYNAMIC_VARIANT tree answered `[]`. It now also searches `parentVariantPath:<id>`, which returns the DYNAMIC_VARIANT descendants of every level (checked against a live tenant). Both results are typed as the new `ProductVariant`. `useVariantChildren` and `injectVariantChildren` pick this up.
- **`Product` covers all five product types.** `VARIANT` and `DYNAMIC_VARIANT` products were missing from the union although every read returns them. `ProductVariant` carries `parentVariantId` and, for dynamic variants, `parentVariantPath`.
- **`products.get(id, auth)`.** The auth context can go second. `get(id, undefined, auth)` keeps working and is deprecated — its second parameter was never used.
