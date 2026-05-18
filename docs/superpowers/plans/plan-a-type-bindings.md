# Plan A — Generated-Type Bindings

These are the canonical generated symbols each service re-exports.
Verified against `packages/sdk/src/generated/*/types.gen.ts` on 2026-05-18.

| Public name (unchanged) | Generated symbol | Source module | Line |
|---|---|---|---|
| `Product` | `BasicProductWithId \| BundleProductWithId \| ParentVariantProductWithId` | `../generated/product` | 602/661/718 |
| `Media` | `ProductMedia[number]` (see note) | `../generated/product` | 492 |
| `Cart` | `Cart` | `../generated/cart` | 142 |
| `Category` | `Category` | `../generated/category` | 138 |
| `CategoryNode` | `CategoryTree` | `../generated/category` | 460 |
| `CheckoutResult` | `ResponseCheckout` | `../generated/checkout` | 247 |
| `PaymentMode` | `PaymentModeFrontendResponse` | `../generated/payment` | 137 |
| `Customer` | `Customer` | `../generated/customer` | 130 |
| `Address` | `Address` | `../generated/customer` | 20 |

**Note — `Media`:** generated `ProductMedia` is declared as `Array<{ … }>`
(a list type, not a single entry). `ProductService.media.list` returns
`Promise<Media[]>`, so `Media` must be the **element** type:
`export type Media = ProductMedia[number];`. Using `ProductMedia` directly
would make the return `Array<Array<…>>`.

`CheckoutInput`, `QuoteCheckoutInput`, `CheckoutPaymentMethod`,
`CheckoutAddress`, `CheckoutCustomer`, `CartAddress`, `AuthorizePaymentInput`
stay hand-written — they are request *inputs*, not API responses. Only
response/return types switch.

`CustomerSession` is NOT switched: the login wire body is snake_case and the
camelCase variants are deprecated; the hand mapping is a prior bug fix.
