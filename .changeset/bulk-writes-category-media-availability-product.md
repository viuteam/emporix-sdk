---
"@viu/emporix-sdk": minor
---

feat(sdk): add bulk writes for categories, media, availability and products

Wraps the nine endpoints Emporix added on 2026-11-23:

- `categories.bulkCreate`, `categories.bulkPatch` and `categories.assignments.bulkRemoveByReference`;
- `media.bulkCreate` (a JSON array for LINK assets, multipart with one file per item for BLOB assets), `media.bulkPatch` and `media.bulkRemove`;
- `availability.patch` and `availability.bulkPatch` (JSON-Patch with upper-case `op`);
- `products.bulkPatch`.

Every bulk call takes up to 200 entries and resolves with one result per entry (`207` Multi-Status) instead of throwing for a failed entry. None of the partial updates creates a missing record. The methods are not yet verified against a live tenant.
