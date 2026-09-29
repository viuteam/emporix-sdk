---
"@viu/emporix-sdk": minor
---

feat(sdk): send paging and sort on every remaining POST search

Nine search methods outside the AI service sent their whole input as the request body: `companies.search`, `customerAdmin.searchCustomers`, `vendors.searchVendors`, `segments.search`, `segments.customers.search`, `segments.groups.search`, `segments.items.search`, `prices.lists.search` and `prices.lists.searchPrices`. Emporix reads paging and sort for these endpoints from the query string, so each one returned only the first page — a `pageNumber` passed in the input went into the body and was ignored.

They now send `pageNumber`, `pageSize` and `sort`, and — where the endpoint declares them — `fields`, `expand`, `legalEntityId` and `customerId` as query parameters, keeping the rest in the body. `prices.search` sends `expand` and `fees.searchItemFeesByProductIds` sends `siteFallback` the same way. The input types gained these keys, and `SearchPaging` is exported from the package root. A call without them goes out exactly as before.
