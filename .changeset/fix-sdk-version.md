---
"@viu/emporix-sdk": patch
---

Report the real package version as `sdkVersion` on every log line instead of the
hardcoded `0.0.0` placeholder. The version is now read from `package.json` and
inlined at build time (browser-safe, no runtime filesystem access).
