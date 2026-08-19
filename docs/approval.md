# Approval Service

Bindings for the Emporix **Approval Service** (`/approval/{tenant}`): B2B
cart/quote approval workflows — buyers raise an approval request, an authorized
approver approves or rejects it.

> **Customer-token only.** Every endpoint authenticates with a
> `CustomerAccessToken` (there is no OAuth2 / clientCredentials variant). The
> methods keep the SDK's uniform trailing `auth` argument, but you must pass
> `auth.customer(token)` — or use the React hooks (below), which supply the
> browser context. The service token will be rejected by Emporix.

## Core — `client.approvals`

```ts
import { auth } from "@viu/emporix-sdk";

const cust = auth.customer(customerToken);

// List (paginated: pageNumber / pageSize / sort / q)
const list = await client.approvals.listApprovals({ pageSize: 20, q: "status:PENDING" }, cust);

// Read one
const approval = await client.approvals.getApproval("approval-id", cust);

// Create a cart or quote approval request → { id }
const { id } = await client.approvals.createApproval(
  { resource: { resourceType: "CART", resourceId: "cart-id" } },
  cust,
);

// Approve / reject / amend via a JSON-Patch op-array (resolves to void)
await client.approvals.updateApproval(
  "approval-id",
  [{ op: "replace", path: "/status", value: "APPROVED" }],
  cust,
);

// Delete
await client.approvals.deleteApproval("approval-id", cust);

// Pre-checks
const { permitted } = await client.approvals.checkPermitted(
  { resourceType: "CART", resourceId: "cart-id" },
  cust,
);
const approvers = await client.approvals.searchApprovers(
  { resourceType: "CART", resourceId: "cart-id" },
  cust,
);
```

`updateApproval` takes a **JSON-Patch operation array** (the same shape as
`client.returns.patchReturn`) and returns `204 No Content`. Express an approve or
reject decision as a `replace` on `/status`.

`checkPermitted` and `searchApprovers` are pre-flight helpers (does this resource
need approval? who can approve it?) — they are core-only; no React hooks.

## React hooks (customer self-service)

```tsx
import {
  useApprovals,
  useApproval,
  useCreateApproval,
  useUpdateApproval,
} from "@viu/emporix-sdk-react";

const { data: approvals } = useApprovals();
const { data: one } = useApproval("approval-id");

const create = useCreateApproval();
// Flat — `resourceId` and `resourceType` sit on the request itself, not nested under
// a `resource` key. `details` is mandatory for a CART approval: it is what will be
// ordered once approved.
const { id } = await create.mutateAsync({
  action: "CHECKOUT",
  resourceType: "CART",
  resourceId,
  approver: { userId: approverId },
  details,
});

const decide = useUpdateApproval();
await decide.mutateAsync({
  approvalId: "approval-id",
  ops: [{ op: "replace", path: "/status", value: "APPROVED" }],
});
```

The hooks require a logged-in customer (they throw without a stored token) and
use the customer token. Mutations invalidate the approvals list.

## Measured behaviour that the spec does not describe

All of this was measured against tenant `viu`, site `cosanum-b2b`, on 2026-08-18
while building a B2B storefront. None of it is in the Emporix documentation, and two
items contradicted the generated types.

### `createApproval` consumes the cart

The moment an approval is created on a cart, that cart leaves the customer Cart API:

- `carts.get(cartId)` → **404**
- `carts.getCurrent({ create: false })` → **null**

This happens immediately, not when the decision is made, and **declining or
withdrawing does not bring it back**. Functionally this is sound — the approver
decides on a fixed basket that must not change underneath them — but it has three
consequences for a storefront:

1. A stored cart id must be dropped from the session, or a cart badge keeps counting
   a cart that no longer exists and the cart/checkout pages 404.
2. The approval itself becomes the only source. `resource` carries the line items and
   totals, `details` carries shipping, addresses and payment.
3. After a decline or withdrawal the requester has to rebuild the basket. Saying so is
   kinder than offering a «request again» that cannot work.

`checkout.placeOrder` still reaches the cart by id. That is what makes the approved
order possible at all:

```ts
const approval = await client.approvals.getApproval(approvalId, auth);
const { permitted } = await client.approvals.checkPermitted(
  { action: "CHECKOUT", resourceType: "CART", resourceId: approval.resource.id },
  auth,
);
if (permitted) {
  // `details` is the snapshot the approver saw — ordering from it means the order
  // cannot drift from what was approved.
  await client.checkout.placeOrder(
    { cartId: approval.resource.id, customer, ...approval.details },
    auth,
    { siteCode },
  );
}
```

### `checkPermitted` does not tell you *who* may order

It answers `permitted: true` for the **approver** as well as the requester. The
service gates whether the cart may be checked out, not by whom. If your process says
the requester places the order, enforce it yourself — compare `requestor.userId`
against `customers.me()`.

### The approver comment needs `add`

`replace` on `/approverComment` answers `APPROVAL-400010` («Missing field
"approverComment"») because the field does not exist on a fresh approval. PATCH is
atomic, so that failure also drops the status change: the decision silently does not
happen. Use `approvalStatusPatch()`, which gets both this and the op's casing right:

```ts
import { approvalStatusPatch } from "@viu/emporix-sdk";

await client.approvals.updateApproval(
  approvalId,
  approvalStatusPatch("DECLINED", "Quantity too high"),
  auth,
);
```

### Line items carry no product name

`resource.items[]` has `quantity`, `itemPrice` and `itemYrn` — no name. Resolve names
separately via the product id. Note that on an approval the `itemYrn` is often the
bare product id rather than a full YRN, so `productIdFromYrn` returns `""` and you
need the sibling `itemId` as a fallback.

### The create payload is flat

`resourceId` and `resourceType` sit directly on the request object, not nested under
`resource`. The generated type has this right; the online documentation shows the
nested form and is wrong.
