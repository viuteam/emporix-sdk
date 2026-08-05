---
"@viu/emporix-sdk-next": patch
---

Docs only for the package. `examples/next-server-first` now flattens the category
tree into a cached index instead of walking it per render: the tenant's tree is
1'631 nodes and 378 KiB of full category objects, and a category page needed three
things out of it — a label, a breadcrumb and the direct children.

Worth stating what this is worth now rather than repeating the number from the
analysis: since the catalog routes moved to ISR, a render only happens on a cache
miss, so this is a per-miss saving shared across every category path and both
listing pages within the hour — not the per-request one it would have been before.

`category-walk.ts` is gone with it; the walk it did per render is now done once
per hour by `buildIndex`.
