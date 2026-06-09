---
"@viu/emporix-sdk-react": minor
---

feat(react): add useActiveSite hook

`useActiveSite()` returns the active site's DTO (the one matching
`useSiteContext().siteCode`), derived from the shared `useSites()` query — so
consumers no longer re-implement `sites.find(s => s.code === siteCode)`.
