# Customer Service (admin)

Bindings for the Emporix tenant-managed **Customer Service**
(`/customer/{tenant}/customers`): admin/seller CRUD over customer profiles and
their addresses.

> **Server-side.** Defaults to the service (clientCredentials) token. This is the
> **seller/admin** view of customers — distinct from the storefront
> `client.customers` (signup/login/me). Public types are prefixed `AdminCustomer*`.

## Customer profiles

```ts
const customers = await client.customerAdmin.listCustomers();
const found = await client.customerAdmin.searchCustomers({ /* filter … */ });
const c = await client.customerAdmin.getCustomer("C0123");
const { id } = await client.customerAdmin.createCustomer({ /* … */ });
await client.customerAdmin.upsertCustomer("C0123", { /* … */ }); // PUT
await client.customerAdmin.patchCustomer("C0123", { /* … */ });
await client.customerAdmin.deleteCustomer("C0123");
```

## Addresses

```ts
const addresses = await client.customerAdmin.listAddresses("C0123");
const a = await client.customerAdmin.getAddress("C0123", "address-id");
await client.customerAdmin.addAddress("C0123", { /* … */ });
await client.customerAdmin.upsertAddress("C0123", "address-id", { /* … */ });
await client.customerAdmin.patchAddress("C0123", "address-id", { /* … */ });
await client.customerAdmin.deleteAddress("C0123", "address-id");

// tags are passed as a query param (?tags=…)
await client.customerAdmin.addAddressTags("C0123", "address-id", ["home", "default"]);
await client.customerAdmin.removeAddressTags("C0123", "address-id", ["home"]);
```

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
