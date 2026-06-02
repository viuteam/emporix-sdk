---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add Emporix Approval Service bindings for B2B cart/quote approval workflows.

Core `client.approvals` (`ApprovalService`): `listApprovals`, `getApproval`,
`createApproval`, `updateApproval` (JSON-Patch approve/reject), `deleteApproval`,
`checkPermitted`, and `searchApprovers`. Every endpoint is customer-token-only.

React: `useApprovals`, `useApproval`, `useCreateApproval`, and `useUpdateApproval`
(customer-only) for B2B approval self-service.
