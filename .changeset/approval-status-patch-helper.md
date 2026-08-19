---
"@viu/emporix-sdk": minor
---

Add `approvalStatusPatch(status, approverComment?)`, which builds the JSON-Patch for
an approval decision. It encodes two measured quirks: the op is lowercase, and the
approver comment needs `add` rather than `replace` — `replace` on the absent
`approverComment` field answers APPROVAL-400010 and, because PATCH is atomic, drops
the status change with it.
