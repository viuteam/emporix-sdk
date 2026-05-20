---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add `MediaService`. `client.media.create({ kind: "blob" | "link", ... })`
posts to `POST /media/{tenant}/assets` (multipart for BLOB, JSON for LINK);
convenience helpers `uploadFile`, `link`, `attachToProduct`,
`detachFromProduct`, `listForProduct` wrap the common product-attachment
flows. `HttpClient` now passes `FormData` bodies through `fetch` verbatim
(no Content-Type/JSON-stringify). React adds a thin `useProductMedia(id)`
hook that reads `productMedia` from the existing product query (no
service-token call in the browser).

BREAKING: `ProductService.media` is removed — it called a path
(`/product/{tenant}/products/{id}/media`) that does not exist in the
Emporix Product API. Migrate to `client.media.listForProduct(productId)`
(admin/server) or read `product.productMedia` from `client.products.get`
(storefront).
