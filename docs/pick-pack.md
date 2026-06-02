# Pick-Pack Service

Bindings for the Emporix **Pick-Pack Service** (`/pick-pack/{tenant}/…`):
fulfillment / packlist orders, assignees, packaging, packing events, and
recalculation jobs.

> **Server-side.** Defaults to the service (clientCredentials) token
> (`pickpack.pickpack_view` / `pickpack.pickpack_manage`). These "orders" are
> fulfillment/packlist orders — distinct from `client.orders`. Several mutating
> endpoints return an acknowledgement (`{ message?, code? }`).

```ts
// packlist orders
const packlist = await client.pickPack.listOrders();
const order = await client.pickPack.getOrder("order-id");
await client.pickPack.updateOrder("order-id", { /* status … */ });
await client.pickPack.finishOrder("order-id");
const cycles = await client.pickPack.listOrderCycles(); // string ids

// assignees + packaging
await client.pickPack.addAssignee("order-id", { /* … */ });
await client.pickPack.removeAssignee("order-id", "assignee-id");
await client.pickPack.updatePackaging("order-id", { products: [] });

// packing events
await client.pickPack.createEvent({ /* … */ });
const events = await client.pickPack.listEvents();

// recalculation jobs
const { jobId } = await client.pickPack.triggerRecalculation({ /* … */ });
const job = await client.pickPack.getRecalculationJob(jobId!);
```

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
