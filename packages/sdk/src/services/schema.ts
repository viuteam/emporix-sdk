import type { ClientContext, PaginatedItems } from "../core/context";
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
} from "./schema-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Schema Service (`/schema/{tenant}/…`): schemas, entity types, custom
 * entities and their instances. Requires the backend-only `schema.schema_*`
 * / `schema.custominstance_*` scopes — default auth: service. Server-side use
 * only; the service token must never reach a browser.
 */
export class SchemaService {
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
    const items = await this.ctx.http.request<Schema[]>({
      method: "GET",
      path: this.schemasBase(),
      auth,
      query: q,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
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
    const items = await this.ctx.http.request<CustomInstance<T>[]>({
      method: "GET",
      path: this.instancesBase(type),
      auth,
      query: { ...query, pageNumber, pageSize },
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
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
   */
  async searchInstances<T = Record<string, unknown>>(
    type: string,
    body: InstanceSearchBody,
    auth: AuthContext = SERVICE,
  ): Promise<PaginatedItems<CustomInstance<T>>> {
    const items = await this.ctx.http.request<CustomInstance<T>[]>({
      method: "POST",
      path: `${this.instancesBase(type)}/search`,
      auth,
      body,
    });
    return { items, pageNumber: 1, pageSize: items.length, hasNextPage: false };
  }
}
