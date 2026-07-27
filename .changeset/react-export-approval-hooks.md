---
"@viu/emporix-sdk-react": minor
---

fix(react): export approval hooks from the package root

`useApprovals`, `useApproval`, `useCreateApproval`, `useUpdateApproval` and the
`UseUpdateApprovalVars` type were reachable only through the
`@viu/emporix-sdk-react/hooks` subpath — the package-root barrel omitted them,
so `import { useApprovals } from "@viu/emporix-sdk-react"` failed to resolve
even though the README lists them as top-level hooks. They are now re-exported
from the root like every other hook.
