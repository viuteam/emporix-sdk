---
"@viu/emporix-sdk-react": minor
---

B2B foundation:

- New `CompanyContextProvider` (auto-mounted inside `EmporixProvider`) and `useActiveCompany()` hook.
- New B2B read hooks: `useMyCompanies`, `useCompany`, `useCompanyContacts`, `useCompanyLocations`, `useCompanyGroups`.
- New admin mutation hooks: `useCreateCompany`/`useUpdateCompany`/`useDeleteCompany`, `useAssignContact`/`useUpdateContactAssignment`/`useUnassignContact`, `useCreateLocation`/`useUpdateLocation`/`useDeleteLocation`.
- Convenience hook `useCompanySwitcher()`.
- New storage keys `"activeLegalEntityId"` and `"refreshToken"` with `get`/`set` helpers on every backend (`useCustomerSession` writes the refresh token through them on login/refresh, clears on logout).
- New SSR prop `EmporixProvider.initialActiveLegalEntityId` for hydration.
- New telemetry event `{ type: "company:switched", from, to, durationMs }`.
- `useCart`, `useCheckout`, `useCustomerAddresses`, `useActiveCart`, `usePaymentModes` now include the active `legalEntityId` in their query keys (and `useCheckout` merges it into the order payload) so cart/orders are scoped per company.

Switching company calls `customer.refresh({ legalEntityId })` (eager token rescope), drops the stored cart id, and invalidates company-scoped queries. Without a persisted refresh token in storage, switch falls back to a local-state-only update.
