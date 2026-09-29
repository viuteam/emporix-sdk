import type { ClientContext, PaginatedItems } from "../core/context";
import { requestPage } from "../core/paged";
import type { AuthContext } from "../core/auth";
import { EmporixError, errorFromResponse } from "../core/errors";
import type {
  AssetCreateBlob,
  AssetCreateLink,
  AssetUpdateBlob,
  AssetUpdateLink,
  DownloadUrl,
  GetAsset,
  GetMediaRetrieveDownloadUrlData,
  PatchOperation,
  RefId,
  UploadSession,
  UploadSessionRequest,
} from "../generated/media";

/** Generated media types (caller sends the exact wire shape). */
export type AssetCreateBlobInput = AssetCreateBlob;
export type AssetCreateLinkInput = AssetCreateLink;
export type AssetUpdateBlobInput = AssetUpdateBlob;
export type AssetUpdateLinkInput = AssetUpdateLink;
export type AssetUpdateInput = AssetUpdateBlob | AssetUpdateLink;
export type Asset = GetAsset;
export type AssetRefId = RefId;
/** Partial-update body (`PATCH /assets/{id}`) — an RFC-6902 JSON-Patch op-array. */
export type AssetPatch = PatchOperation[];
/** Result of {@link MediaService.getDownloadUrl} — `{ provider, url, expiresAt? }`. */
export type AssetDownloadUrl = DownloadUrl;
/** Query for {@link MediaService.getDownloadUrl} — `{ disposition? }`. */
export type AssetDownloadUrlQuery = NonNullable<GetMediaRetrieveDownloadUrlData["query"]>;
/** Body for {@link MediaService.startUploadSession}: a BLOB create payload plus `uploadType`. */
export type AssetUploadSessionInput = UploadSessionRequest;
/** The storage instruction {@link MediaService.startUploadSession} returns. */
export type AssetUploadSession = UploadSession;

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
  /**
   * Ask for `X-Total-Count`. An SDK-side flag, not an Emporix query parameter:
   * it becomes a request header.
   */
  totalCount?: boolean;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Result of {@link MediaService.download}. The endpoint's behaviour depends
 * on the asset's `access`:
 * - `PUBLIC` assets respond with a 30x redirect whose `Location` header
 *   carries the externally-cacheable storage URL — useful when the
 *   storefront wants to send the user there directly.
 * - `PRIVATE` assets respond with the raw bytes (plus an `ETag` header
 *   for caching). The file lives in Google Cloud Storage and is reachable
 *   without the service token only through a signed URL from
 *   {@link MediaService.getDownloadUrl}.
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
  static readonly channel = "media" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/media/${this.ctx.tenant}/assets`;
  }

  /**
   * Create an asset. BLOB uploads via multipart (max 30 MB); LINK via JSON.
   * {@link startUploadSession} sends the file straight to storage instead.
   */
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
    // Destructured out because the rest of `query` is spread into the query
    // string: `totalCount` is an SDK-side flag that becomes a request header,
    // and would otherwise ride along as a stray `?totalCount=true`.
    const { totalCount, ...rest } = query;
    return requestPage<Asset>(
      this.ctx.http,
      {
        method: "GET",
        path: this.base(),
        auth,
        query: { ...rest, pageNumber, pageSize },
      },
      { pageNumber, pageSize, ...(totalCount === undefined ? {} : { totalCount }) },
    );
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
   *   (max 30 MB) AND patches metadata in the same request. Sends
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

  /**
   * Partially update an asset with an RFC-6902 JSON-Patch op-array
   * (`PATCH /assets/{id}`, HTTP 204 — nothing is returned).
   *
   * This is the way to change one field without resending the whole asset, and
   * the only way to touch a `BLOB` asset's metadata **without re-uploading the
   * file** — {@link update} in `blob` mode always replaces the bytes.
   *
   * Append to an array with a path ending in `/-`, which preserves the existing
   * entries:
   *
   * ```ts
   * await client.media.patch(assetId, [
   *   { op: "add", path: "/refIds/-", value: { id: "product1", type: "PRODUCT" } },
   * ]);
   * ```
   *
   * `type` and `access` are immutable here too, as with {@link update}. Only
   * `add`, `remove` and `replace` are accepted, and optimistic locking still
   * applies — a stale `metadata.version` gets a 409.
   */
  async patch(assetId: string, ops: AssetPatch, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.base()}/${encodeURIComponent(assetId)}`,
      auth,
      body: ops,
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
   * Emporix recommends {@link getDownloadUrl} for every download: here the file
   * passes through the Media API. A `413` means the asset's known size exceeds
   * the streaming limit (30 MB by default) — only {@link getDownloadUrl} can
   * serve it. A `409` means the asset is still `PENDING` from a direct upload
   * whose file has not reached storage.
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

  /**
   * Get a URL that serves the stored file straight from storage
   * (`GET /assets/{assetId}/download-url`). Emporix recommends it for every
   * download: the file never passes through the Media API, there is no size
   * limit, and the URL can be handed to a browser as it is.
   *
   * - `PRIVATE` BLOB → `provider: "GCS"`, a signed Google Cloud Storage URL that
   *   works without an Emporix token until `expiresAt` (15 minutes by default).
   * - `PUBLIC` BLOB → `provider: "CLOUDINARY"`, the permanent URL.
   * - `LINK` → `provider: "LINK"`, the stored URL.
   *
   * `disposition` (`attachment` by default, or `inline`) affects private URLs
   * only. Unlike {@link startUploadSession}, this works whether or not direct
   * upload is enabled for the tenant. A `409` means a direct upload is still
   * `PENDING` and its file has not reached storage; once it has, this call
   * completes the asset before answering.
   */
  async getDownloadUrl(
    assetId: string,
    query: AssetDownloadUrlQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<AssetDownloadUrl> {
    return this.ctx.http.request<AssetDownloadUrl>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(assetId)}/download-url`,
      auth,
      query: { ...query },
    });
  }

  /**
   * Start a direct upload of a `BLOB` asset (`POST /assets/upload-session`,
   * `201`). Emporix creates the asset as `PENDING` — `id` is its id — and
   * returns where to send the file. **This method does not send it**:
   *
   * - `upload.method === "PUT"` (a `PRIVATE` asset, `uploadType: "put"` or
   *   omitted): `PUT` the file to `upload.url` with every `upload.headers` entry.
   * - `upload.method === "POST"` (every `PUBLIC` asset, or `uploadType: "form"`):
   *   a multipart `POST` to `upload.url` with every `upload.fields` entry
   *   unchanged and the file part last.
   *
   * That request goes to Google Cloud Storage or Cloudinary, not to Emporix, so
   * it must not carry the Emporix token — which is also why a browser can make
   * it. The asset turns `READY` once storage confirms; until then, calls that
   * need the file answer `409`. The instruction is valid for 15 minutes (GCS) or
   * an hour (Cloudinary), and an unused session expires at `expiresAt`.
   *
   * Direct upload is enabled per tenant by Emporix Support. Without it the call
   * throws an `EmporixForbiddenError` whose `body.message` is `direct upload is
   * not enabled for this tenant`, and nothing is created — the same status as a
   * missing scope, so read the message.
   */
  async startUploadSession(
    input: AssetUploadSessionInput,
    auth: AuthContext = SERVICE,
  ): Promise<AssetUploadSession> {
    return this.ctx.http.request<AssetUploadSession>({
      method: "POST",
      path: `${this.base()}/upload-session`,
      auth,
      body: input,
    });
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
