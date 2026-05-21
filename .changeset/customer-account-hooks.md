---
"@viu/emporix-sdk-react": minor
---

Add customer-account hooks to `@viu/emporix-sdk-react`:

- `useUpdateCustomer()` — mutation for profile updates, invalidates `useCustomerSession.customer`.
- `useChangePassword()` — mutation for password change. Customer-only.
- `useCustomerAddresses()` — query for the customer's address list.
- `useAddressMutations()` — `{ add, update, remove }` mutations following the `useCartMutations` shape.
- `usePasswordReset()` — 2-step anonymous flow: `{ request, confirm }`.

Internal: a shared `useCustomerOnlyCtx` helper now lives in `hooks/internal/use-read-auth.ts` for hooks that intentionally throw on missing customer token. The previously-local `customerOnlyCtx` in `useCheckout` stays (with different semantics — gates a query via `enabled`).

No SDK change.
