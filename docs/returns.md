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

## Sites

Since 2026-11-09 a return carries the `siteCode` and `restriction` of the orders
it references:

- **On create** the service copies both from the orders, so leave them out. A
  value that differs from the orders answers `400` «site does not match order»;
  orders that disagree among themselves answer `400` «orders belong to different
  sites».
- **Update and patch** do not accept them (`ReturnUpdate` has neither field).
  Attaching an order from another site answers the same `400`s.
- **Filter by site** with `q`: `listReturns({ q: "siteCode:DE" })`.
- **A site-limited employee scope** such as `returns.returns_manage--DE` only
  sees returns whose `restriction` matches. Any other return — including one with
  no `restriction`, which every return created before this change has — answers
  `404` on read, update, patch and delete, and is left out of `listReturns` and
  its `X-Total-Count`. Creating a return for another site answers `403`
  «Creating a return for this site is not allowed.». A scope without a suffix
  still sees every return.

## React hooks (customer self-service)

```tsx
import { useMyReturns, useReturn, useCreateReturn } from "@viu/emporix-sdk-react";

const { data: myReturns } = useMyReturns();
const { data: one } = useReturn("return-id");
const create = useCreateReturn();
const { id } = await create.mutateAsync({ /* … */ });
```

The hooks use the customer token. Without one the queries stay disabled and the
mutation rejects when run — rendering them for a guest does not throw.
