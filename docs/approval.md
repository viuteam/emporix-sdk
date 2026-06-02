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
const { id } = await create.mutateAsync({ resource: { resourceType: "CART", resourceId } });

const decide = useUpdateApproval();
await decide.mutateAsync({
  approvalId: "approval-id",
  ops: [{ op: "replace", path: "/status", value: "APPROVED" }],
});
```

The hooks require a logged-in customer (they throw without a stored token) and
use the customer token. Mutations invalidate the approvals list.
