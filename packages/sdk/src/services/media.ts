import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixError, errorFromResponse } from "../core/errors";
import type {
  AssetCreateBlob,
  AssetCreateLink,
  AssetUpdateBlob,
  AssetUpdateLink,
  GetAsset,
  RefId,
} from "../generated/media";

/** Generated media types (caller sends the exact wire shape). */
export type AssetCreateBlobInput = AssetCreateBlob;
export type AssetCreateLinkInput = AssetCreateLink;
export type AssetUpdateBlobInput = AssetUpdateBlob;
export type AssetUpdateLinkInput = AssetUpdateLink;
export type AssetUpdateInput = AssetUpdateBlob | AssetUpdateLink;
export type Asset = GetAsset;
export type AssetRefId = RefId;

/**
 * Filter / pagination options for {@link MediaService.list}. The explicit
 * fields are typed for autocomplete; the index signature stays open so
 * Emporix `q`-syntax filters like `"refIds.id"` can be passed verbatim.
 */
export interface ListAssetsQuery {
  pageNumber?: number;
  pageSize?: number;
  /** Emporix sort syntax, e.g. `"name,metadata.createdAt:desc"`. */
  sort?: string;
  /** Emporix `q`-syntax filter, e.g. `"name:hero"`. */
  q?: string;
  [key: string]: string | number | undefined;
}

/**
 * Result of {@link MediaService.download}. The endpoint's behaviour depends
 * on the asset's `access`:
 * - `PUBLIC` assets respond with a 30x redirect whose `Location` header
 *   carries the externally-cacheable storage URL — useful when the
 *   storefront wants to send the user there directly.
 * - `PRIVATE` assets respond with the raw bytes (plus an `ETag` header
 *   for caching). The asset is delivered through Cloudinary behind the
 *   server-side service token, never publicly addressable.
 */
export type DownloadResult =
  | { kind: "redirect"; url: string }
  | {
      kind: "bytes";
      data: ArrayBuffer;
      etag?: string;
      contentType?: string;
    };

const SERVICE: AuthContext = { kind: "service" };

function isProductRef(r: AssetRefId, productId: string): boolean {
  return r.type === "PRODUCT" && r.id === productId;
}

/**
 * Media assets (BLOB/LINK). All endpoints require a backend-only scope
 * (`media.asset_manage` / `media.asset_read`) — default auth: service.
 */
export class MediaService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/media/${this.ctx.tenant}/assets`;
  }

  /** Create an asset. BLOB uploads via multipart; LINK via JSON. */
  async create(
    input:
      | { kind: "blob"; file: Blob; body: AssetCreateBlobInput }
      | { kind: "link"; body: AssetCreateLinkInput },
    auth: AuthContext = SERVICE,
  ): Promise<{ id: string }> {
    if (input.kind === "blob") {
      const fd = new FormData();
      fd.set("file", input.file);
      fd.set("body", JSON.stringify(input.body));
      return this.ctx.http.request<{ id: string }>({
        method: "POST",
        path: this.base(),
        auth,
        body: fd,
      });
    }
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: input.body,
    });
  }

  /**
   * List assets, wrapped in the shared {@link PaginatedItems} envelope so
   * callers can iterate over pages consistently with the rest of the SDK.
   * `hasNextPage` is the standard SDK heuristic: `true` when the returned
   * page is full (`items.length === requested pageSize`). Pagination
   * defaults match Emporix's server defaults (`pageNumber: 1`,
   * `pageSize: 60`) so an empty `query` produces stable expectations.
   */
  async list(
    query: ListAssetsQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<Asset>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const items = await this.ctx.http.request<Asset[]>({
      method: "GET",
      path: this.base(),
      auth,
      query: { ...query, pageNumber, pageSize },
    });
    return {
      items,
      pageNumber,
      pageSize,
      hasNextPage: items.length === pageSize,
    };
  }

  /** Fetch an asset by id. */
  async get(assetId: string, auth: AuthContext = SERVICE): Promise<Asset> {
    return this.ctx.http.request<Asset>({
      method: "GET",
      path: `${this.base()}/${assetId}`,
      auth,
    });
  }

  /**
   * Update an asset. The input is a discriminated union mirroring
   * {@link create}:
   * - `{ kind: "json", body }` — metadata-only patch (BLOB or LINK).
   *   Sends `application/json`. Used for `refIds`, `details`, `metadata`,
   *   or `url` changes.
   * - `{ kind: "blob", file, body }` — replaces the BLOB file content
   *   (max 10MB) AND patches metadata in the same request. Sends
   *   `multipart/form-data`.
   *
   * `type` and `access` are immutable per Emporix — they must match the
   * existing asset's values. Optimistic-locking is via `body.metadata.version`;
   * the server returns 409 Conflict on a stale version.
   */
  async update(
    assetId: string,
    input:
      | { kind: "json"; body: AssetUpdateInput }
      | { kind: "blob"; file: Blob; body: AssetUpdateBlobInput },
    auth: AuthContext = SERVICE,
  ): Promise<Asset> {
    if (input.kind === "blob") {
      const fd = new FormData();
      fd.set("file", input.file);
      fd.set("body", JSON.stringify(input.body));
      return this.ctx.http.request<Asset>({
        method: "PUT",
        path: `${this.base()}/${assetId}`,
        auth,
        body: fd,
      });
    }
    return this.ctx.http.request<Asset>({
      method: "PUT",
      path: `${this.base()}/${assetId}`,
      auth,
      body: input.body,
    });
  }

  /** Remove an asset. */
  async remove(assetId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${assetId}`,
      auth,
    });
  }

  /**
   * Download an asset by id. Returns a discriminated union:
   * - `{ kind: "redirect", url }` for `PUBLIC` assets (server-side 30x with
   *   the storage URL in `Location`).
   * - `{ kind: "bytes", data }` for `PRIVATE` assets (server-side 200 with
   *   the asset bytes; `etag` + `contentType` headers are exposed for
   *   caching). When the server reports `text/plain` Content-Type (the
   *   OpenAPI-documented format), the SDK decodes the base64 stream into
   *   an `ArrayBuffer` transparently; binary Content-Types are passed
   *   through verbatim.
   *
   * Implementation note: uses `redirect: "manual"` so the redirect-location
   * is observable. In Node.js this works; in a browser the redirect Location
   * is intentionally hidden by fetch — there, `PUBLIC` downloads will
   * surface as an opaque-redirect and the SDK throws. Browser code should
   * use the asset's `url` field from `get()` for `LINK` assets, or the
   * direct storage URL for `PUBLIC` `BLOB` assets (typically delivered via
   * an `<img>` tag rather than `download()`).
   */
  async download(
    assetId: string,
    auth: AuthContext = SERVICE,
  ): Promise<DownloadResult> {
    const path = `${this.base()}/${assetId}/download`;
    const res = await this.ctx.http.requestRaw(
      { method: "GET", path, auth },
      { redirect: "manual" },
    );

    // PUBLIC: server-side redirect — capture Location.
    if (res.status >= 300 && res.status < 400) {
      const url = res.headers.get("location");
      if (!url) {
        throw new EmporixError(
          `media.download: ${res.status} response without a Location header`,
          res.status,
        );
      }
      return { kind: "redirect", url };
    }

    // PRIVATE: bytes.
    if (res.ok) {
      const etag = res.headers.get("etag") ?? undefined;
      const contentType = res.headers.get("content-type") ?? undefined;
      let data: ArrayBuffer;
      if (contentType?.startsWith("text/plain")) {
        // Per OpenAPI spec the server returns the byte stream as a
        // base64-encoded text/plain body. Decode once into raw bytes
        // so callers always see an ArrayBuffer.
        const text = await res.text();
        const bin = atob(text);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        data = arr.buffer;
      } else {
        data = await res.arrayBuffer();
      }
      return {
        kind: "bytes",
        data,
        ...(etag !== undefined ? { etag } : {}),
        ...(contentType !== undefined ? { contentType } : {}),
      };
    }

    // Error: surface via the standard EmporixError hierarchy.
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    throw errorFromResponse(res.status, `GET ${path} → ${res.status}`, parsed);
  }

  /** Multipart upload sugar: builds `AssetCreateBlob` from input. */
  async uploadFile(
    input: {
      file: Blob;
      productId?: string;
      filename?: string;
      mimeType?: string;
      access?: "PUBLIC" | "PRIVATE";
    },
    auth: AuthContext = SERVICE,
  ): Promise<{ id: string }> {
    const body: AssetCreateBlobInput = {
      type: "BLOB",
      access: input.access ?? "PUBLIC",
      ...(input.productId
        ? { refIds: [{ type: "PRODUCT", id: input.productId }] }
        : {}),
      ...(input.filename || input.mimeType
        ? {
            details: {
              ...(input.filename ? { filename: input.filename } : {}),
              ...(input.mimeType ? { mimeType: input.mimeType } : {}),
            },
          }
        : {}),
    };
    return this.create({ kind: "blob", file: input.file, body }, auth);
  }

  /**
   * Replace the file content of an existing BLOB asset. Sugar over
   * {@link update} with `kind: "blob"`. `access` is required because the
   * field is immutable and the server validates that the patch matches.
   * Pass `version` from `asset.metadata.version` if you want optimistic
   * locking (recommended when concurrent writers are possible).
   */
  async replaceFile(
    assetId: string,
    input: {
      file: Blob;
      access: "PUBLIC" | "PRIVATE";
      filename?: string;
      mimeType?: string;
      version?: number;
    },
    auth: AuthContext = SERVICE,
  ): Promise<Asset> {
    const body: AssetUpdateBlobInput = {
      type: "BLOB",
      access: input.access,
      ...(input.filename || input.mimeType
        ? {
            details: {
              ...(input.filename ? { filename: input.filename } : {}),
              ...(input.mimeType ? { mimeType: input.mimeType } : {}),
            },
          }
        : {}),
      ...(input.version !== undefined
        ? { metadata: { version: input.version } }
        : {}),
    };
    return this.update(assetId, { kind: "blob", file: input.file, body }, auth);
  }

  /** External-URL sugar: builds `AssetCreateLink`. */
  async link(
    input: { url: string; productId?: string; access?: "PUBLIC" | "PRIVATE" },
    auth: AuthContext = SERVICE,
  ): Promise<{ id: string }> {
    const body: AssetCreateLinkInput = {
      type: "LINK",
      access: input.access ?? "PUBLIC",
      url: input.url,
      ...(input.productId
        ? { refIds: [{ type: "PRODUCT", id: input.productId }] }
        : {}),
    };
    return this.create({ kind: "link", body }, auth);
  }

  /** Idempotently add a PRODUCT refId to an asset. */
  async attachToProduct(
    assetId: string,
    productId: string,
    auth: AuthContext = SERVICE,
  ): Promise<Asset> {
    const a = await this.get(assetId, auth);
    const refIds: AssetRefId[] = a.refIds ?? [];
    if (refIds.some((r) => isProductRef(r, productId))) return a;
    const next: AssetRefId[] = [...refIds, { type: "PRODUCT", id: productId }];
    // Preserve the asset's type discriminator so the update body satisfies
    // the AssetUpdateBlob | AssetUpdateLink union.
    const patch = { type: a.type, refIds: next } as unknown as AssetUpdateInput;
    return this.update(assetId, { kind: "json", body: patch }, auth);
  }

  /** Remove a PRODUCT refId from an asset (no-op if absent). */
  async detachFromProduct(
    assetId: string,
    productId: string,
    auth: AuthContext = SERVICE,
  ): Promise<Asset> {
    const a = await this.get(assetId, auth);
    const refIds: AssetRefId[] = a.refIds ?? [];
    const next = refIds.filter((r) => !isProductRef(r, productId));
    if (next.length === refIds.length) return a;
    const patch = { type: a.type, refIds: next } as unknown as AssetUpdateInput;
    return this.update(assetId, { kind: "json", body: patch }, auth);
  }

  /** Convenience: list assets attached to a product (server-side filter). */
  async listForProduct(
    productId: string,
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<Asset>> {
    return this.list({ "refIds.id": productId }, auth);
  }
}

// Re-export so consumers can `import { isProductRef } from "@viu/emporix-sdk/media"`?
// Internal helper — kept module-private; convenience methods in Task 4 use it.
export const _internalMedia = { isProductRef };
