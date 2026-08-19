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

## Bulk customer import

```ts
const results = await client.customerAdmin.importCustomers([
  {
    firstName: "Ada",
    lastName: "Lovelace",
    account: { email: "ada@example.com", passwordHash: "<an Emporix-format hash>" },
  },
  {
    account: {
      email: "legacy@example.com",
      legacyAuth: { algorithm: "hybris-sha512-uid-salt", hash: "<legacy hash>" },
    },
  },
]);

const rejected = results.filter((r) => (r.code ?? 0) >= 400);
```

- **207 Multi-Status: partial failures do not throw.** The call resolves and each
  entry carries its own `code`. Code that only catches a rejected promise will
  report a clean import while individual customers were refused — always inspect
  the entries.
- **Exactly one credential per item.** `account.passwordHash` or
  `account.legacyAuth`, never both and never neither.
- **`legacyAuth` needs an active retention config.** See
  [Password-migration retention](#password-migration-retention).
- **Scope:** `customer.import_manage`.

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).

## Why there is no React hook

The retention and import operations need a service (clientCredentials) token
carrying `customer.import_read` or `customer.import_manage`. There is no customer
or anonymous variant, so nothing here can run in a browser — the same reason the
[Import Service](./import.md) and [Approval Service](./approval.md) have no hooks.
Drive them from a server route, a script, or a job.
