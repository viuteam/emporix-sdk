# Returns Service

Bindings for the Emporix **Returns Service** (`/return/{tenant}/returns`): CRUD
over returns (RMA).

> **Mixed audience.** Defaults to the service token. A customer can manage their
> own returns (`returns_*_own`) — pass `auth.customer(token)`, or use the React
> hooks (below). There is no dedicated storefront token scheme; the customer
> token is an OAuth2 bearer.

## Core — `client.returns` (server-side)

```ts
const list = await client.returns.listReturns({ pageSize: 20, q: "status:OPEN" });
const r = await client.returns.getReturn("return-id");
const { id } = await client.returns.createReturn({ /* … */ });
await client.returns.updateReturn("return-id", { /* … */ });
// PATCH takes a JSON-Patch op array
await client.returns.patchReturn("return-id", [{ op: "replace", path: "/status", value: "APPROVED" }]);
await client.returns.deleteReturn("return-id");
```

`listReturns` is paginated (`pageSize` / `pageNumber` / `sort` / `q`). The read
shape is a customer- or employee-return variant.

## React hooks (customer self-service)

```tsx
import { useMyReturns, useReturn, useCreateReturn } from "@viu/emporix-sdk-react";

const { data: myReturns } = useMyReturns();
const { data: one } = useReturn("return-id");
const create = useCreateReturn();
const { id } = await create.mutateAsync({ /* … */ });
```

The hooks require a logged-in customer (they throw without a stored token) and
use the customer token.
