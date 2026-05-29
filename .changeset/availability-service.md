---
"@viu/emporix-sdk": minor
"@viu/emporix-sdk-react": minor
---

Add AvailabilityService (`client.availability.get` / `.getMany`) and the
`useAvailability` / `useAvailabilities` React hooks for site-aware product
availability. `getMany` uses the batch `POST .../search` endpoint and returns
results in input order; an opt-in `defaultAvailableOnNotFound` treats products
with no stock record as available. New `@viu/emporix-sdk/availability` subpath export.
