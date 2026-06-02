# Vendor Service

Bindings for the Emporix **Vendor Service** (`/vendor/{tenant}/…`): vendors and
their locations.

> **Server-side.** Defaults to the service (clientCredentials) token
> (`vendor.vendor_read` / `vendor.vendor_manage`). PUT methods are upserts.
> Vendor **locations** are the vendor's own pickup/warehouse locations — distinct
> from the customer-management `client.locations`.

## Vendors

```ts
const vendors = await client.vendors.listVendors();
const v = await client.vendors.getVendor("vendor-id");
const { id } = await client.vendors.createVendor({ /* … */ });
await client.vendors.updateVendor("vendor-id", { /* … */ }); // PUT upsert
await client.vendors.deleteVendor("vendor-id");

// structured search
const found = await client.vendors.searchVendors({ /* filter … */ });
```

## Vendor locations

```ts
const locations = await client.vendors.listVendorLocations();
const loc = await client.vendors.getVendorLocation("location-id");
await client.vendors.createVendorLocation({ /* … */ });
await client.vendors.updateVendorLocation("location-id", { /* … */ });
await client.vendors.deleteVendorLocation("location-id");
```

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
