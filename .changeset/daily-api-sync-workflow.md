---
"@viu/emporix-sdk": patch
---

Add a daily GitHub Actions workflow that re-fetches the vendored Emporix OpenAPI specs, regenerates the SDK types, smoke-tests the bundle via `check:treeshake`, and opens/updates a single PR whenever the specs drift from upstream.
