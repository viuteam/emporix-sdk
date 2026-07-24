---
"@viu/emporix-sdk": minor
---

Add `client.invoices` (invoice-generation jobs) and `client.quotes` (B2B quotes
CRUD + PDF + history, with a `client.quotes.reasons` config sub-resource),
backed by the generated `invoice` / `quote` types. Quote-domain methods take a
required `auth` argument (customer or admin token — quotes are never
anonymous). The OAuth Service is intentionally not wrapped — its token grant is
owned by the SDK auth core.
