# Plan — Media Service Type Bindings

Verified against `packages/sdk/src/generated/media/types.gen.ts` on 2026-05-20.

| Public alias | Generated symbol |
|---|---|
| `AssetCreateBlobInput` | `AssetCreateBlob` |
| `AssetCreateLinkInput` | `AssetCreateLink` |
| `Asset` (read shape) | `GetAsset` (= `Asset & { id?, type?: 'BLOB'\|'LINK', … }`) |
| `AssetUpdateInput` | `AssetUpdateBlob \| AssetUpdateLink` |
| `AssetRefId` | `RefId` (`{ type?: string; id?: string }`) |
| List response (200) | `GetAsset[]` |
| Create response (201) | `{ id: string }` (modeled inline; generated wrapper is status-indexed) |

`GetMediaListAssetsResponse` and `PostMediaCreateAssetResponse` are
status-code-indexed wrappers, not the success-body shapes. Use `GetAsset[]`
for list and the inline `{ id: string }` for create-201.
