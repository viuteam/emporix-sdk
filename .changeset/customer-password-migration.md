---
"@viu/emporix-sdk": minor
---

feat(sdk): expose the customer password-migration endpoints

`client.customerAdmin` gains the four operations Emporix added to the Customer
Service: `getPasswordMigrationRetention`, `configurePasswordMigrationRetention`
and `deletePasswordMigrationRetention` for the retention window, plus
`importCustomers` for the bulk import.

Together they cover migrating customers off a legacy shop. Configure a retention
window, import customers carrying `legacyAuth`, and each legacy password hash is
replaced with an Emporix hash on that customer's first successful login. Without
an active config the import is rejected — the order matters.

`importCustomers` answers **207 Multi-Status**, so per-item failures arrive as
data with their own `code` rather than throwing. Inspect every entry.

All four need a service token with `customer.import_read` or
`customer.import_manage`, so there are no React hooks — see `docs/customer-admin.md`.
