---
"@viu/emporix-sdk": minor
---

Add Emporix tenant-managed Customer Service bindings via `client.customerAdmin`:
admin/seller CRUD over customer profiles (`listCustomers`, `searchCustomers`,
`getCustomer`, `createCustomer`, `upsertCustomer`, `patchCustomer`,
`deleteCustomer`) and their addresses (`listAddresses`, `getAddress`,
`addAddress`, `upsertAddress`, `patchAddress`, `deleteAddress`, `addAddressTags`,
`removeAddressTags`). Server-side only — distinct from the storefront
`client.customers`.
