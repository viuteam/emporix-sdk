import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
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
export type AssetUpdateInput = AssetUpdateBlob | AssetUpdateLink;
export type Asset = GetAsset;
export type AssetRefId = RefId;

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

  /** List assets. Optional `query` is passed through to Emporix verbatim. */
  async list(
    query?: Record<string, string | number | undefined>,
    auth: AuthContext = SERVICE,
  ): Promise<Asset[]> {
    return this.ctx.http.request<Asset[]>({
      method: "GET",
      path: this.base(),
      auth,
      ...(query ? { query } : {}),
    });
  }

  /** Fetch an asset by id. */
  async get(assetId: string, auth: AuthContext = SERVICE): Promise<Asset> {
    return this.ctx.http.request<Asset>({
      method: "GET",
      path: `${this.base()}/${assetId}`,
      auth,
    });
  }

  /** Update an asset (e.g. swap `refIds` or `access`). */
  async update(
    assetId: string,
    patch: AssetUpdateInput,
    auth: AuthContext = SERVICE,
  ): Promise<Asset> {
    return this.ctx.http.request<Asset>({
      method: "PUT",
      path: `${this.base()}/${assetId}`,
      auth,
      body: patch,
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
    return this.update(assetId, patch, auth);
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
    return this.update(assetId, patch, auth);
  }

  /** Convenience: list assets attached to a product (server-side filter). */
  async listForProduct(productId: string, auth: AuthContext = SERVICE): Promise<Asset[]> {
    return this.list({ "refIds.id": productId }, auth);
  }
}

// Re-export so consumers can `import { isProductRef } from "@viu/emporix-sdk/media"`?
// Internal helper — kept module-private; convenience methods in Task 4 use it.
export const _internalMedia = { isProductRef };
