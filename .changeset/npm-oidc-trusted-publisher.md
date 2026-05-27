---
---

Switch the release workflow to npm Trusted Publisher (OIDC) instead of an `NPM_TOKEN` secret. The published artifacts and provenance attestations are unchanged from a consumer's perspective; only the CI authentication path is different. No version bump.
