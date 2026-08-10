import type { ClientContext, PaginatedItems } from "../core/context";
import { requestPage } from "../core/paged";
import type { AuthContext } from "../core/auth";
import type {
  Schema,
  SchemaDraft,
  SchemaUpdate,
  SchemaTypeName,
  ListSchemasQuery,
  CustomEntity,
  CustomEntityDraft,
  CustomInstance,
  CustomInstanceDraft,
  ListInstancesQuery,
  ListCustomEntitiesOptions,
  InstanceSearchBody,
  SearchInstancesQuery,
  BulkPatchInstanceItem,
  BulkInstanceResult,
  SchemaReference,
  SchemaReferenceInput,
  SchemaReferenceUpdateInput,
  SchemaReferenceCreated,
  SchemaInstanceBulkCreateItem,
  SchemaInstanceBulkUpsertItem,
  SchemaExport,
  SchemaImportInput,
  ListSchemaReferencesQuery,
} from "./schema-types";

export type {
  Schema,
  SchemaAttribute,
  SchemaTypeName,
  SchemaDraft,
  SchemaUpdate,
  CustomEntity,
  CustomInstance,
  CustomEntityDraft,
  CustomInstanceDraft,
  ListSchemasQuery,
  ListInstancesQuery,
  ListCustomEntitiesOptions,
  InstanceSearchBody,
  SearchInstancesQuery,
  BulkPatchInstanceItem,
  BulkInstanceResult,
  SchemaReference,
  SchemaReferenceInput,
  SchemaReferenceUpdateInput,
  SchemaReferenceCreated,
  SchemaInstanceBulkCreateItem,
  SchemaInstanceBulkUpsertItem,
  SchemaExport,
  SchemaImportInput,
  ListSchemaReferencesQuery,
} from "./schema-types";

const SERVICE: AuthContext = { kind: "service" };

/** Passes a `Blob` through; serializes a plain object into a JSON blob. */
function toJsonBlob(file: Blob | Record<string, unknown>): Blob {
  return file instanceof Blob
    ? file
    : new Blob([JSON.stringify(file)], { type: "application/json" });
}

/**
 * Schema Service (`/schema/{tenant}/…`): schemas, entity types, custom
 * entities and their instances. Requires the backend-only `schema.schema_*`
 * / `schema.custominstance_*` scopes — default auth: service. Server-side use
 * only; the service token must never reach a browser.
 */
export class SchemaService {
  static readonly channel = "schema" as const;
  constructor(private readonly ctx: ClientContext) {}

  private schemasBase(): string {
    return `/schema/${this.ctx.tenant}/schemas`;
  }

  private entitiesBase(): string {
    return `/schema/${this.ctx.tenant}/custom-entities`;
  }

  private instancesBase(type: string): string {
    return `${this.entitiesBase()}/${encodeURIComponent(type)}/instances`;
  }

  private referencesBase(): string {
    return `/schema/${this.ctx.tenant}/references`;
  }

  // --- (A) Schemas ---------------------------------------------------------

  /**
   * List schemas, wrapped in the shared {@link PaginatedItems} envelope.
   * `hasNextPage` is the standard SDK heuristic (`items.length === pageSize`).
   * Pagination defaults match the rest of the SDK (`pageNumber: 1`,
   * `pageSize: 60`).
   */
  async listSchemas(
    query: ListSchemasQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<Schema>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const q: Record<string, string | number> = { pageNumber, pageSize };
    if (query.q) q.q = query.q;
    if (query.type) q.type = query.type;
    return requestPage<Schema>(
      this.ctx.http,
      {
        method: "GET",
        path: this.schemasBase(),
        auth,
        query: q,
      },
      {
        pageNumber,
        pageSize,
        ...(query.totalCount === undefined ? {} : { totalCount: query.totalCount }),
      },
    );
  }

  /** Retrieve one schema by id. */
  async getSchema(id: string, auth: AuthContext = SERVICE): Promise<Schema> {
    return this.ctx.http.request<Schema>({
      method: "GET",
      path: `${this.schemasBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Create a schema. */
  async createSchema(draft: SchemaDraft, auth: AuthContext = SERVICE): Promise<Schema> {
    return this.ctx.http.request<Schema>({
      method: "POST",
      path: this.schemasBase(),
      auth,
      body: draft,
    });
  }

  /**
   * Update a schema. The upstream API requires `draft.metadata.version`; a
   * stale version yields 409 Conflict (propagated as the standard conflict
   * error).
   */
  async updateSchema(
    id: string,
    draft: SchemaUpdate,
    auth: AuthContext = SERVICE,
  ): Promise<Schema> {
    return this.ctx.http.request<Schema>({
      method: "PUT",
      path: `${this.schemasBase()}/${encodeURIComponent(id)}`,
      auth,
      body: draft,
    });
  }

  /** Delete a schema by id. */
  async deleteSchema(id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.schemasBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /**
   * Validate a schema document without persisting it (`POST /schemas/file`).
   * Returns the server's validation result verbatim.
   */
  async validateSchemaFile<R = unknown>(
    body: SchemaDraft,
    auth: AuthContext = SERVICE,
  ): Promise<R> {
    return this.ctx.http.request<R>({
      method: "POST",
      path: `${this.schemasBase()}/file`,
      auth,
      body,
    });
  }

  // --- (B) Types -----------------------------------------------------------

  /** List entity types that currently have at least one schema. */
  async listTypes(auth: AuthContext = SERVICE): Promise<SchemaTypeName[]> {
    return this.ctx.http.request<SchemaTypeName[]>({
      method: "GET",
      path: `/schema/${this.ctx.tenant}/types`,
      auth,
    });
  }

  /** Set the entity types a schema applies to (`PUT /schemas/{id}/types`). */
  async setSchemaTypes(
    id: string,
    types: SchemaTypeName[],
    auth: AuthContext = SERVICE,
  ): Promise<Schema> {
    return this.ctx.http.request<Schema>({
      method: "PUT",
      path: `${this.schemasBase()}/${encodeURIComponent(id)}/types`,
      auth,
      body: { types },
    });
  }

  // --- (C) Custom entities -------------------------------------------------

  /** List custom-entity definitions. `expandSchemas` inlines each schema body. */
  async listCustomEntities(
    opts: ListCustomEntitiesOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<CustomEntity[]> {
    return this.ctx.http.request<CustomEntity[]>({
      method: "GET",
      path: this.entitiesBase(),
      auth,
      ...(opts.expandSchemas ? { query: { expandSchemas: "true" } } : {}),
    });
  }

  /** Retrieve one custom-entity definition by id. */
  async getCustomEntity(id: string, auth: AuthContext = SERVICE): Promise<CustomEntity> {
    return this.ctx.http.request<CustomEntity>({
      method: "GET",
      path: `${this.entitiesBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Create a custom-entity definition. */
  async createCustomEntity(
    draft: CustomEntityDraft,
    auth: AuthContext = SERVICE,
  ): Promise<CustomEntity> {
    return this.ctx.http.request<CustomEntity>({
      method: "POST",
      path: this.entitiesBase(),
      auth,
      body: draft,
    });
  }

  /** Update a custom-entity definition. */
  async updateCustomEntity(
    id: string,
    draft: CustomEntityDraft,
    auth: AuthContext = SERVICE,
  ): Promise<CustomEntity> {
    return this.ctx.http.request<CustomEntity>({
      method: "PUT",
      path: `${this.entitiesBase()}/${encodeURIComponent(id)}`,
      auth,
      body: draft,
    });
  }

  /**
   * Delete a custom-entity definition. The server rejects with 409 if
   * instances or schemas still reference it (propagated as the standard
   * conflict error).
   */
  async deleteCustomEntity(id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.entitiesBase()}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  // --- (D) Custom instances ------------------------------------------------

  /**
   * List a custom entity's instances, wrapped in {@link PaginatedItems}.
   * `type` is the custom-entity type and is always the first argument.
   */
  async listInstances<T = Record<string, unknown>>(
    type: string,
    query: ListInstancesQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<CustomInstance<T>>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    // `totalCount` is an SDK-side flag, not an Emporix query parameter — it
    // becomes a request header in requestPage. Sending it in the query too
    // would be a stray `?totalCount=true` on every call.
    const { totalCount, ...rest } = query;
    return requestPage<CustomInstance<T>>(
      this.ctx.http,
      {
        method: "GET",
        path: this.instancesBase(type),
        auth,
        query: { ...rest, pageNumber, pageSize },
      },
      { pageNumber, pageSize, ...(totalCount === undefined ? {} : { totalCount }) },
    );
  }

  /**
   * Async-iterates every instance of a type.
   *
   * Not built on `iterateAll`: that helper drives pagination by page number, and
   * the server ignores `pageNumber` the moment a cursor is in play. This follows
   * `nextCursor` while the server offers one and falls back to `pageNumber + 1`
   * when it does not — so it is correct whether or not the tenant's deployment
   * emits cursor headers on a request that carries no cursor.
   */
  async *listAllInstances<T = Record<string, unknown>>(
    type: string,
    // Takes the full query type rather than an `Omit<…>`: `ListInstancesQuery`
    // has an index signature, so `Omit` would not actually forbid `next` — it
    // would only look like it did. The overrides below win regardless.
    query: ListInstancesQuery = {},
    auth: AuthContext = SERVICE,
  ): AsyncIterable<CustomInstance<T>> {
    let cursor: string | undefined;
    let pageNumber = 1;
    for (;;) {
      const page = await this.listInstances<T>(
        type,
        { ...query, pageNumber, ...(cursor === undefined ? {} : { next: cursor }) },
        auth,
      );
      for (const item of page.items) yield item;
      if (!page.hasNextPage) return;
      cursor = page.nextCursor;
      // Only advances while there is no cursor. Once cursor mode takes over the
      // server ignores pageNumber anyway, so leaving it pinned keeps the two
      // modes from interfering.
      if (cursor === undefined) pageNumber += 1;
    }
  }

  /** Retrieve one instance by id. */
  async getInstance<T = Record<string, unknown>>(
    type: string,
    id: string,
    auth: AuthContext = SERVICE,
  ): Promise<CustomInstance<T>> {
    return this.ctx.http.request<CustomInstance<T>>({
      method: "GET",
      path: `${this.instancesBase(type)}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /** Create an instance of a custom entity. */
  async createInstance<T = Record<string, unknown>>(
    type: string,
    draft: CustomInstanceDraft<T>,
    auth: AuthContext = SERVICE,
  ): Promise<CustomInstance<T>> {
    return this.ctx.http.request<CustomInstance<T>>({
      method: "POST",
      path: this.instancesBase(type),
      auth,
      body: draft,
    });
  }

  /** Replace an instance (full `PUT`). */
  async replaceInstance<T = Record<string, unknown>>(
    type: string,
    id: string,
    draft: CustomInstanceDraft<T>,
    auth: AuthContext = SERVICE,
  ): Promise<CustomInstance<T>> {
    return this.ctx.http.request<CustomInstance<T>>({
      method: "PUT",
      path: `${this.instancesBase(type)}/${encodeURIComponent(id)}`,
      auth,
      body: draft,
    });
  }

  /** Partially update an instance (`PATCH`). */
  async patchInstance<T = Record<string, unknown>>(
    type: string,
    id: string,
    patch: Partial<CustomInstanceDraft<T>>,
    auth: AuthContext = SERVICE,
  ): Promise<CustomInstance<T>> {
    return this.ctx.http.request<CustomInstance<T>>({
      method: "PATCH",
      path: `${this.instancesBase(type)}/${encodeURIComponent(id)}`,
      auth,
      body: patch,
    });
  }

  /**
   * Patch up to 200 custom instances of `type` in one call
   * (`PATCH /custom-entities/{type}/instances/bulk`). Returns a 207 envelope:
   * a per-item result array — a 207 is success, individual failures live in
   * each item's `code`/`status`.
   */
  async bulkPatchInstances(
    type: string,
    items: BulkPatchInstanceItem[],
    auth: AuthContext = SERVICE,
  ): Promise<BulkInstanceResult> {
    return this.ctx.http.request<BulkInstanceResult>({
      method: "PATCH",
      path: `${this.instancesBase(type)}/bulk`,
      auth,
      body: items,
    });
  }

  /**
   * Create multiple instances in one request
   * (`POST /custom-entities/{type}/instances/bulk`). Returns a 207 envelope:
   * a per-item result array — a 207 is success, individual failures live in
   * each item's `code`/`status`.
   */
  async bulkCreateInstances(
    type: string,
    items: SchemaInstanceBulkCreateItem[],
    auth: AuthContext = SERVICE,
  ): Promise<BulkInstanceResult> {
    return this.ctx.http.request<BulkInstanceResult>({
      method: "POST",
      path: `${this.instancesBase(type)}/bulk`,
      auth,
      body: items,
    });
  }

  /**
   * Upsert multiple instances in one request
   * (`PUT /custom-entities/{type}/instances/bulk`). Each item carries its `id`.
   * Returns the same 207 per-item envelope as {@link bulkCreateInstances}.
   */
  async bulkUpsertInstances(
    type: string,
    items: SchemaInstanceBulkUpsertItem[],
    auth: AuthContext = SERVICE,
  ): Promise<BulkInstanceResult> {
    return this.ctx.http.request<BulkInstanceResult>({
      method: "PUT",
      path: `${this.instancesBase(type)}/bulk`,
      auth,
      body: items,
    });
  }

  /**
   * Delete multiple instances by id
   * (`DELETE /custom-entities/{type}/instances/bulk`). Returns the same 207
   * per-item envelope as {@link bulkCreateInstances}.
   *
   * **Note:** the OpenAPI schema declares no request body for this operation,
   * but its description mandates one — "The IDs of items should be defined in
   * the request body as an array of strings" (example
   * `["firstId", "secondId"]`). The SDK follows the description and sends the
   * id array. Unverified against the live API.
   */
  async bulkDeleteInstances(
    type: string,
    ids: string[],
    auth: AuthContext = SERVICE,
  ): Promise<BulkInstanceResult> {
    return this.ctx.http.request<BulkInstanceResult>({
      method: "DELETE",
      path: `${this.instancesBase(type)}/bulk`,
      auth,
      body: ids,
    });
  }

  /**
   * Export custom entities and their schemas
   * (`POST /custom-entities/export`). Pass the entity types to include; the
   * result carries a base64 `data` payload plus `exportedAt`.
   */
  async exportCustomEntities(types: string[], auth: AuthContext = SERVICE): Promise<SchemaExport> {
    return this.ctx.http.request<SchemaExport>({
      method: "POST",
      path: `${this.entitiesBase()}/export`,
      auth,
      body: types,
    });
  }

  /**
   * Import custom entities and their schemas
   * (`POST /custom-entities/import`) from the base64 `data` produced by
   * {@link exportCustomEntities}.
   */
  async importCustomEntities(input: SchemaImportInput, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.entitiesBase()}/import`,
      auth,
      body: input,
    });
  }

  /** Delete an instance by id. */
  async deleteInstance(type: string, id: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.instancesBase(type)}/${encodeURIComponent(id)}`,
      auth,
    });
  }

  /**
   * Structured search over a custom entity's instances
   * (`POST /instances/search`), wrapped in {@link PaginatedItems}.
   *
   * The `query` parameter is third and `auth` fourth. This used to forward no
   * query parameters at all and report a hard-coded `hasNextPage: false`, so a
   * search could only ever return the server's default first page.
   */
  async searchInstances<T = Record<string, unknown>>(
    type: string,
    body: InstanceSearchBody,
    query: SearchInstancesQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<CustomInstance<T>>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const { totalCount, ...rest } = query;
    return requestPage<CustomInstance<T>>(
      this.ctx.http,
      {
        method: "POST",
        path: `${this.instancesBase(type)}/search`,
        auth,
        body,
        query: { ...rest, pageNumber, pageSize },
      },
      { pageNumber, pageSize, ...(totalCount === undefined ? {} : { totalCount }) },
    );
  }

  // --- (E) References ------------------------------------------------------

  /**
   * Reference entities (`/references`) — a schema plus an uploaded JSON file.
   * Create/update are `multipart/form-data` (parts `file` and `body`), like
   * the media service's blob upload. Default auth: service.
   */
  readonly references = {
    /**
     * List references, wrapped in {@link PaginatedItems}. Pagination defaults
     * match the rest of this service (`pageNumber: 1`, `pageSize: 60`).
     */
    list: async (
      query: ListSchemaReferencesQuery = {},
      auth: AuthContext = SERVICE,
    ): Promise<PaginatedItems<SchemaReference>> => {
      const pageNumber = query.pageNumber ?? 1;
      const pageSize = query.pageSize ?? 60;
      const q: Record<string, string | number> = { pageNumber, pageSize };
      if (query.sort) q.sort = query.sort;
      if (query.q) q.q = query.q;
      if (query.fields) q.fields = query.fields;
      if (query.type) q.type = query.type;
      return requestPage<SchemaReference>(
        this.ctx.http,
        {
          method: "GET",
          path: this.referencesBase(),
          auth,
          query: q,
        },
        {
          pageNumber,
          pageSize,
          ...(query.totalCount === undefined ? {} : { totalCount: query.totalCount }),
        },
      );
    },

    /** Retrieve one reference by id. */
    get: async (id: string, auth: AuthContext = SERVICE): Promise<SchemaReference> =>
      this.ctx.http.request<SchemaReference>({
        method: "GET",
        path: `${this.referencesBase()}/${encodeURIComponent(id)}`,
        auth,
      }),

    /**
     * Create a reference. `file` is the reference's JSON content — pass a
     * `Blob` to upload as-is, or a plain object to have it serialized into a
     * JSON blob. `body` carries the metadata.
     */
    create: async (
      input: { file: Blob | Record<string, unknown>; body: SchemaReferenceInput },
      auth: AuthContext = SERVICE,
    ): Promise<SchemaReferenceCreated> => {
      const fd = new FormData();
      fd.set("file", toJsonBlob(input.file));
      fd.set("body", JSON.stringify(input.body));
      return this.ctx.http.request<SchemaReferenceCreated>({
        method: "POST",
        path: this.referencesBase(),
        auth,
        body: fd,
      });
    },

    /**
     * Update a reference (multipart, like {@link create}). `options.version`
     * enables optimistic locking — the server answers 409 on a stale version.
     */
    update: async (
      id: string,
      input: { file: Blob | Record<string, unknown>; body: SchemaReferenceUpdateInput },
      options: { version?: number } = {},
      auth: AuthContext = SERVICE,
    ): Promise<void> => {
      const fd = new FormData();
      fd.set("file", toJsonBlob(input.file));
      fd.set("body", JSON.stringify(input.body));
      await this.ctx.http.request<void>({
        method: "PUT",
        path: `${this.referencesBase()}/${encodeURIComponent(id)}`,
        ...(options.version === undefined ? {} : { query: { version: options.version } }),
        auth,
        body: fd,
      });
    },

    /** Delete a reference by id. */
    delete: async (id: string, auth: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `${this.referencesBase()}/${encodeURIComponent(id)}`,
        auth,
      });
    },
  };
}
