import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  SequenceSchema,
  SequenceSchemaCreate,
  NextIdCommandRequest,
  NextIdResponse,
  NextIdOptions,
  NextIdsBatchRequest,
  NextIdsBatchResponse,
} from "./sequential-id-types";

export type {
  SequenceSchema,
  SequenceSchemaCreate,
  NextIdCommandRequest,
  NextIdResponse,
  NextIdOptions,
  BatchNextIdEntry,
  NextIdsBatchRequest,
  NextIdsBatchResponse,
} from "./sequential-id-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Sequential ID Service (`/sequential-id/{tenant}/…`): server-managed,
 * gap-free sequential identifiers (order/invoice numbers, etc.) driven by
 * tenant-defined sequence schemas.
 *
 * Requires the backend-only `sequentialid.schema_view` (read + next-id) /
 * `sequentialid.schema_manage` (CRUD + set-active) scopes — default auth:
 * service. Server-side use only; the service token must never reach a browser.
 *
 * Schemas are immutable upstream (no PATCH/PUT): to change one, `deleteSchema`
 * then `createSchema`. The `maxValue` is a hard cap with no auto-reset, and
 * only one schema may be active per type.
 */
export class SequentialIdService {
  static readonly channel = "sequential-id" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/sequential-id/${this.ctx.tenant}/schemas`;
  }

  /** List all sequence schemas for the tenant. */
  async listSchemas(auth: AuthContext = SERVICE): Promise<SequenceSchema[]> {
    return this.ctx.http.request<SequenceSchema[]>({
      method: "GET",
      path: this.base(),
      auth,
    });
  }

  /** Retrieve one sequence schema by id. */
  async getSchema(schemaId: string, auth: AuthContext = SERVICE): Promise<SequenceSchema> {
    return this.ctx.http.request<SequenceSchema>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(schemaId)}`,
      auth,
    });
  }

  /** Create a sequence schema. Schemas are immutable — there is no update. */
  async createSchema(
    schema: SequenceSchemaCreate,
    auth: AuthContext = SERVICE,
  ): Promise<SequenceSchema> {
    return this.ctx.http.request<SequenceSchema>({
      method: "POST",
      path: this.base(),
      auth,
      body: schema,
    });
  }

  /** Delete a sequence schema by id. */
  async deleteSchema(schemaId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(schemaId)}`,
      auth,
    });
  }

  /** Mark a schema active for its type (only one schema may be active per type). */
  async setActiveSchema(schemaId: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "POST",
      path: `${this.base()}/${encodeURIComponent(schemaId)}/setActive`,
      auth,
    });
  }

  /** Get the active schema for a given schema type. */
  async listSchemasByType(schemaType: string, auth: AuthContext = SERVICE): Promise<SequenceSchema> {
    return this.ctx.http.request<SequenceSchema>({
      method: "GET",
      path: `${this.base()}/types/${encodeURIComponent(schemaType)}`,
      auth,
    });
  }

  /**
   * Generate the next id for a schema type. `body` carries an optional
   * `sequenceKey` (independent sub-pool counter) and `placeholders`.
   * `opts.siteCode` derives time/country placeholders from the site's settings.
   */
  async nextId(
    schemaType: string,
    body: NextIdCommandRequest = {},
    opts: NextIdOptions = {},
    auth: AuthContext = SERVICE,
  ): Promise<NextIdResponse> {
    const query = opts.siteCode ? { siteCode: opts.siteCode } : undefined;
    return this.ctx.http.request<NextIdResponse>({
      method: "POST",
      path: `${this.base()}/types/${encodeURIComponent(schemaType)}/nextId`,
      auth,
      body,
      ...(query ? { query } : {}),
    });
  }

  /**
   * Generate next ids for multiple schema types in one call. NOTE: the batch
   * endpoint path omits the `{tenant}` segment — the service derives the
   * tenant from the token.
   */
  async nextIdsBatch(
    req: NextIdsBatchRequest,
    auth: AuthContext = SERVICE,
  ): Promise<NextIdsBatchResponse> {
    return this.ctx.http.request<NextIdsBatchResponse>({
      method: "POST",
      path: `/sequential-id/sequenceSchemaBatch/nextIds`,
      auth,
      body: req,
    });
  }
}
