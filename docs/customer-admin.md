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

## Password-migration retention

Migrating customers from a legacy shop means importing their old password hashes.
To avoid storing those indefinitely, Emporix gates the import behind a **retention
window**: configure one, import inside it, and each legacy hash is silently replaced
with an Emporix hash on that customer's first successful login.

```ts
await client.customerAdmin.configurePasswordMigrationRetention({
  retentionEndDate: "2027-01-31",       // required
  emailReminderDate: "2027-01-24",      // default: 7 days before the end date
  emailNotificationsEnabled: true,      // default: true
});

const config = await client.customerAdmin.getPasswordMigrationRetention();
await client.customerAdmin.deletePasswordMigrationRetention();
```

- **Configure before you import.** An import carrying `legacyAuth` is rejected
  while no active config exists.
- **When the window ends,** remaining unmigrated accounts require a password reset
  and their legacy credentials are cleared. With `emailNotificationsEnabled`, those
  customers get a reset mail, plus a reminder on `emailReminderDate` asking them to
  log in once so the migration can happen quietly.
- **To finish sooner,** re-`POST` the config with an earlier `retentionEndDate`
  rather than deleting it.
- **Scopes:** `customer.import_read` to read, `customer.import_manage` to write or
  delete. A service client without them gets a `403`.

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
