---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
"@viu/emporix-sdk-angular": minor
---

feat(sdk): wrap the last four never-built endpoints, and fix employee shopping-list edits

- `orders.listTransitions(orderId, auth, { saasToken? })` — the status transitions the customer may trigger on one of their orders, for example whether it can still be cancelled. React gets `useOrderTransitions(orderId)` and Angular `injectOrderTransitions(orderId)`; both refresh after a cancel or transition.
- `iam.users.listForVendor(vendorId, auth)` lists a vendor's Management Dashboard users with their groups; `iam.users.removeFromAllGroups(userId, auth)` takes a user out of every group at once.
- `shoppingLists.getForCustomer(customerId, auth, { name? })` reads one customer's lists.

**Fix:** with a service token, `shoppingLists.addItem`, `removeItem` and `setItemQuantity` now read the target customer's list through `getForCustomer`. They read through `list()`, which for an employee returns every customer's lists and ignores the name — so the first list of that name could belong to another customer, and its items were written into this one. A customer token still reads the caller's own lists.
