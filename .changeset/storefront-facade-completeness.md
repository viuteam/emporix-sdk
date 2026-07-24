---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add storefront-facing facade methods and matching React hooks. Additive and
backward-compatible.

- **Cart** — `carts.validate`, `listItems`, `refresh`, `changeSite`,
  `changeCurrency`, `updateItemsBatch` (state-changing ops re-fetch and return
  the updated cart). Hooks: `useCartValidation`, `useCartItems`, and
  `refresh`/`changeSite`/`changeCurrency`/`updateItemsBatch` on the
  `useCartMutations` bundle.
- **Customer** — double opt-in (`confirmSignup`/`resendActivation`),
  login-email change (`changeEmail`/`confirmEmailChange`), and address
  `get`/`addTags`/`removeTags`. Hooks: `useConfirmSignup`,
  `useResendActivation`, `useChangeEmail`, `useConfirmEmailChange`,
  `useCustomerAddress`, `useAddAddressTags`, `useRemoveAddressTags`.
- **Category** — `categories.parents`, `childCategories` (dedicated
  `/subcategories`), `getTree` (single tree by id). Hooks:
  `useCategoryParents`, `useChildCategories`, `useCategoryTreeById`.
- **Payment** — `payments.getMode`, `initialize` (frontend, no scope). Hooks:
  `usePaymentMode`, `useInitializePayment`.
- **Session context** — `sessionContext.addAttribute`/`removeAttribute`. Hooks:
  `useAddSessionAttribute`, `useRemoveSessionAttribute`.
