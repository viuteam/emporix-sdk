---
"@viu/emporix-sdk": minor
---

Anonymous session continuity: when the cached anonymous access token is
expired (or rejected with a 401), the SDK now **refreshes via the refresh
token first**, preserving the same `sessionId` (and thus the anonymous
cart), and only falls back to a brand-new anonymous login if the refresh
fails. Previously every expiry/401 started a fresh session with a new
`sessionId`. Adds an optional `expireAnonymous()` to the `TokenProvider`
interface (used by the HTTP 401 path to keep the refresh token);
`invalidateAnonymous()` still performs a full reset.
