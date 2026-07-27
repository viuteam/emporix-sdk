---
"@viu/emporix-sdk-react": minor
---

fix(react): export the remaining hooks-barrel symbols from the package root

Twelve symbols were reachable only through the `@viu/emporix-sdk-react/hooks`
subpath because the package-root barrel omitted them, so the top-level import
the README documents did not resolve:

- Hooks: `useApprovals`, `useApproval`, `useCreateApproval`, `useUpdateApproval`,
  `useCategorySearch`
- Types: `UseUpdateApprovalVars`, `UseOrderOptions`, `UseCancelOrderVars`,
  `UseOrderTransitionVars`, `UseReorderVars`, `UseReorderResult`,
  `UseUpdateSalesOrderVars`

All twelve are now re-exported from the root like every other hook, so the root
barrel and the `./hooks` subpath expose the same surface again.
