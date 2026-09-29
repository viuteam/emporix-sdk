---
"@viu/emporix-sdk-react": minor
---

fix(react): customer-only hooks no longer throw during render without a token

Twenty-two hooks threw `Requires a logged-in customer` **during render** when no customer token was stored. Hooks cannot be called conditionally, so any component a guest also sees — an "add to shopping list" button, a points badge in the header — crashed the render for guests.

- **The seven reads** — `useMyReturns`, `useReturn`, `useShoppingLists`, `useApprovals`, `useApproval`, `useMyRewardPoints`, `useMyRewardPointsSummary` — now stay disabled until a customer token exists: no request, `data` undefined, no error. Their cache keys for a signed-in customer are unchanged.
- **The fifteen mutations** — `useCreateReturn`, the five shopping-list writes, `useCreateApproval`, `useUpdateApproval`, `useRedeemRewardPoints`, `useAddressMutations`, `useAddAddressTags`, `useRemoveAddressTags`, `useChangeEmail`, `useUpdateCustomer`, `useChangePassword` — render normally and reject with the same message when run without a token, as `useCancelOrder` and `useOrderTransition` already did. The token is read when the mutation runs.

This matches the Angular bindings. If you relied on the render-time throw — an error boundary as a login redirect, say — check for the token instead, or handle the rejected mutation.
