---
"@viu/emporix-sdk-react": patch
---

`useCloudFunction` keys on the kind of the auth context it calls with. It used the stored token's kind, so a read with an `auth` override shared the default read's cache entry and could answer with the other context's data.
