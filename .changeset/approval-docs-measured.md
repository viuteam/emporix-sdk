---
"@viu/emporix-sdk": patch
---

Document measured Approval-service behaviour: `createApproval` consumes the cart
(404 from the Cart API, not restored by decline or withdrawal), `checkPermitted`
answers `true` for the approver as well as the requester, and the approver comment
needs `add`. Also corrects the `useCreateApproval` example, which showed the payload
nested under `resource` and omitted the mandatory `action`, `approver` and `details`.
