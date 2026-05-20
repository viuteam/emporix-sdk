# Plan — Customer Segments Type Bindings

Verified against `packages/sdk/src/generated/customer-segment/types.gen.ts`
on 2026-05-20.

| Public alias | Generated symbol |
|---|---|
| `Segment` | `SegmentResponse` (= `SegmentUpdateBulk & { metadata? }`) |
| `SegmentItem` | `ItemAssignmentResponse` |
| `SegmentCategoryTree` | `CategoryTreeResponse` (the whole array) |
| `SegmentCategoryTreeNode` | `CategoryTreeResponse[number]` (element) |

## Critical field shapes

**`ItemAssignmentResponse`** — the segment-item row:

```
{
  segmentId?: string;
  item?: { id?: string; code?: string; name?: { [k]: string } };
  type?: 'PRODUCT' | 'CATEGORY';
  // …
}
```

The product/category id is **nested as `item.id`**, NOT a flat
`itemId` field. `listMyProductIds` / `listMyCategoryIds` read `r.item?.id`
filtered by `r.type === "PRODUCT"` / `"CATEGORY"`.

**`CategoryTreeResponse`** is `Array<{ id, code, name, ... }>` — already
the array type. `getCategoryTree()` returns it directly as
`SegmentCategoryTreeNode[]` (= `CategoryTreeResponse`).
