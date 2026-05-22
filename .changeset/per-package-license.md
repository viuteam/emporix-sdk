---
"@viu/emporix-sdk": patch
"@viu/emporix-sdk-react": patch
---

Include LICENSE in the published npm tarballs. The `files` array already
declared `LICENSE` but the file was only present at the repo root; npm
publishes per-package, so a copy now lives inside each package directory.
Fixes "License: not specified" on npmjs.com and unblocks corporate
license-compliance scanners (Snyk, Black Duck).
