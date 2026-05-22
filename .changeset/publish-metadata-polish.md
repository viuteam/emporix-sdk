---
"@viu/emporix-sdk": patch
"@viu/emporix-sdk-react": patch
---

Pre-1.0 publish metadata polish:

- **`@viu/emporix-sdk-react`**: tighten the `@tanstack/react-query` peer
  range from `^5.0.0` to `^5.51.0`. This matches the version the package
  is developed and tested against. The previous range claimed support
  for v5.0–v5.50 that was never exercised in CI; tightening avoids a
  silent runtime mismatch for consumers who happen to be on those older
  patch versions.
- **Both packages**: replace the bare-string `author: "viuteam"` with an
  `author` object — `{ "name": "viu", "url": "https://github.com/viuteam" }`
  — so the npm package page shows "viu" (our display name) and links
  back to the GitHub org page (`viuteam`, the actual org slug).
- **`LICENSE` (root and per-package)**: the MIT copyright holder is now
  `VIU AG` (the legal entity) instead of the GitHub org slug `viuteam`,
  so license-compliance scanners attribute the package correctly.
