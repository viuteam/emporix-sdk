---
"@viu/emporix-sdk-react": patch
---

default the cookie storage adapter's `Secure` attribute to on for https origins. Token cookies no longer ride plain http in production by default; localhost/http dev is unaffected (protocol-sniffed). Pass `secure: false` explicitly only for non-https deployments.
