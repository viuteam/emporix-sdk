---
"@viu/emporix-sdk-react": minor
---

Add `createSessionStorage` — a per-tab `sessionStorage`-backed storage adapter
(survives a page reload, cleared when the tab closes, not shared across tabs).
Adds `createLocalStorage` as the preferred name for `createLocalStorageStorage`,
which is now deprecated but still exported. Internally the `localStorage` and
`sessionStorage` adapters share one `fromWebStorage` helper.
