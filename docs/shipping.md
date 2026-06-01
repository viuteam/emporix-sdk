# Shipping Service

Bindings for the Emporix **Shipping Service** (`/shipping/{tenant}/…`). **Phase 1**
covers shipping config: sites, zones, methods, cost/quote, groups, and
customer-group relations.

> **Server-side.** Defaults to the service token (`shipping.shipping_read` /
> `shipping.shipping_manage`). Most methods are **site-scoped** and take `site`
> as the first argument; `findSites` is tenant-level. Creates return a resource
> location; updates/patches/deletes resolve to `void`.

```ts
// sites
const sites = await client.shipping.findSites({ postalCode: "10115" });

// zones + methods (site-scoped)
const zones = await client.shipping.listZones("main");
const { id: zoneId } = await client.shipping.createZone("main", { name: { en: "Germany" } /* … */ });
const methods = await client.shipping.listMethods("main", zoneId);
await client.shipping.createMethod("main", zoneId, { name: { en: "Standard" } /* … */ });
await client.shipping.deleteMethod("main", zoneId, "method-id");

// cost
const quote = await client.shipping.quote("main", { cartId: "cart-1" /* … */ });
const minimum = await client.shipping.quoteMinimum("main", { cartId: "cart-1" });
const slotFee = await client.shipping.quoteSlot("main", { /* … */ });

// groups + customer-group relations
await client.shipping.listGroups("main");
await client.shipping.createGroup("main", { /* … */ });
await client.shipping.listCgRelations("main");
await client.shipping.getCgRelations("main", "C0123");
```

## Delivery scheduling (Phase 2)

All tenant-scoped under `/shipping/{tenant}` (no `site`).

```ts
// delivery windows
const windows = await client.shipping.getCartDeliveryWindows("cart-1");
await client.shipping.getAreaDeliveryWindows("area-1", "cart-1");
await client.shipping.validateDeliveryWindow({ /* … */ });

// delivery times + slots
const times = await client.shipping.listDeliveryTimes();
const { id: dtId } = await client.shipping.createDeliveryTime({ /* … */ });
await client.shipping.patchDeliveryTime(dtId, [{ op: "replace", path: "/name", value: "AM" }]);
const slots = await client.shipping.listSlots(dtId);
await client.shipping.createSlot(dtId, { /* … */ });
await client.shipping.deleteAllSlots(dtId);

// delivery cycles
const cycleId = await client.shipping.generateDeliveryCycle({ /* … */ });
```

`patchDeliveryTime` / `patchSlot` take a JSON-Patch op-array.
`generateDeliveryCycle` returns the new cycle id.

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
