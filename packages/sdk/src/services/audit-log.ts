import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  ChangelogCursorPageResponse,
  ChangelogHistoryResponse,
} from "../generated/audit-logs-changelog";
import type {
  AuditLogCursorPage,
  AuditLogCursorQuery,
  AuditLogPage,
  AuditLogQuery,
} from "./audit-log-types";

export type {
  AuditLogChangeType,
  AuditLogCursorPage,
  AuditLogCursorQuery,
  AuditLogEntry,
  AuditLogPage,
  AuditLogPathChange,
  AuditLogQuery,
  AuditLogRelatedEntity,
} from "./audit-log-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * The body envelope → {@link AuditLogPage}. `pageNumber` / `pageSize` come from
 * the server's echo rather than from what was requested, so the page describes
 * what actually came back.
 */
function toPage(wire: ChangelogHistoryResponse): AuditLogPage {
  const pageNumber = wire.page ?? 1;
  const totalPages = wire.totalPages ?? 0;
  return {
    items: wire.items ?? [],
    pageNumber,
    pageSize: wire.size ?? 0,
    hasNextPage: pageNumber < totalPages,
    totalElements: wire.totalElements ?? 0,
    totalPages,
  };
}

/**
 * Emporix Audit Log Service, upstream «Audit Logs (Changelog) Service»
 * (`/changelog/{tenant}/changelogs`): tenant-wide change history for platform
 * entities — who changed what, when, and from which value to which.
 *
 * **Service-account only.** Reads need the `changelog.changelog_read` scope
 * (`changelog.changelog_manage` also grants it) on the client credentials. There
 * is no customer or anonymous variant, which is why `@viu/emporix-sdk-react`
 * ships no hooks for it — call it from a server, never from a browser bundle.
 *
 * **Upstream marks this service as preview**: the contract may change without a
 * major version bump, and nearly every field of an entry is optional in the
 * spec.
 */
export class AuditLogService {
  static readonly channel = "audit-log" as const;

  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/changelog/${this.ctx.tenant}`;
  }

  /**
   * List changes across the tenant, newest occurrence first, by page number
   * (offset mode). Every page carries the totals; for long histories where the
   * count is not needed, {@link listByCursor} skips it.
   *
   * **The window defaults to the last 7 days** (the spec vendored on 2026-11-24
   * shortened it from 30 days). When `q` carries no `occurredAt` lower bound outside
   * an `OR` condition, the service silently applies that trailing window — an
   * unfiltered call is *not* «everything ever». Pass an explicit top-level or
   * `AND`-ed `occurredAt` range to widen it; an `occurredAt` that appears only
   * inside an `OR` arm does not lift the default.
   *
   * **`entityId` needs `entity`.** Filtering by id alone is a `400`, not an
   * empty page. There is no path-based history endpoint either — scoping to one
   * document means naming both in `q`:
   *
   * @example
   * ```ts
   * // The history of one order.
   * const page = await client.auditLogs.list({
   *   q: `entity:order entityId:${orderId}`,
   * });
   * for (const entry of page.items) {
   *   console.log(entry.at, entry.actor, entry.paths);
   * }
   *
   * // Everything a given person changed in June, across all entities.
   * await client.auditLogs.list({
   *   q: 'actor:"Jane Doe" occurredAt:(>"2026-06-01T00:00:00.000Z" AND <"2026-07-01T00:00:00.000Z")',
   *   pageSize: 100,
   * });
   * ```
   */
  async list(opts: AuditLogQuery = {}, auth: AuthContext = SERVICE): Promise<AuditLogPage> {
    const wire = await this.ctx.http.request<ChangelogHistoryResponse>({
      method: "GET",
      path: `${this.base()}/changelogs`,
      // Absent options are left off the wire entirely; the service applies its
      // own defaults (page 1, size 20) and sends back what it used.
      query: { q: opts.q, page: opts.pageNumber, size: opts.pageSize },
      auth,
    });
    return toPage(wire);
  }

  /**
   * List changes across the tenant, newest first, by cursor
   * (`pagination=cursor`). The service pages without counting the matches, so
   * the result has no page number and no totals — only the cursors to the older
   * (`nextCursor`) and newer (`prevCursor`) page, read from the `x-next-cursor`
   * / `x-prev-cursor` response headers.
   *
   * **A cursor is bound to `q` and `pageSize`.** Send both unchanged with every
   * `next` / `prev`; a changed value, a malformed cursor, or `next` and `prev`
   * together are each a `400`.
   *
   * **The time window is fixed by the first page.** It starts at the
   * `occurredAt` lower bound in `q` (or at the default 7-day window, see
   * {@link list}) and ends at the upper bound in `q` — or, without one, at the
   * moment of the first request. Entries recorded after that do not appear on
   * later pages; request a new first page to see them.
   *
   * @example
   * ```ts
   * const q = 'entity:order occurredAt:>"2026-06-01T00:00:00.000Z"';
   * let page = await client.auditLogs.listByCursor({ q, pageSize: 100 });
   * for (;;) {
   *   for (const entry of page.items) console.log(entry.at, entry.actor);
   *   if (page.nextCursor === undefined) break;
   *   page = await client.auditLogs.listByCursor({ q, pageSize: 100, next: page.nextCursor });
   * }
   * ```
   */
  async listByCursor(
    opts: AuditLogCursorQuery = {},
    auth: AuthContext = SERVICE,
  ): Promise<AuditLogCursorPage> {
    const { data, headers } = await this.ctx.http.requestWithMeta<ChangelogCursorPageResponse>({
      method: "GET",
      path: `${this.base()}/changelogs`,
      // `pagination=cursor` is sent even on the first page: without a cursor the
      // service would otherwise fall back to offset mode and count everything.
      // Absent options stay off the wire (HttpClient skips `undefined`).
      query: {
        pagination: "cursor",
        q: opts.q,
        size: opts.pageSize,
        next: opts.next,
        prev: opts.prev,
      },
      auth,
    });
    const nextCursor = headers.get("x-next-cursor") ?? undefined;
    const prevCursor = headers.get("x-prev-cursor") ?? undefined;
    // Spread conditionally — `exactOptionalPropertyTypes` rejects an explicit
    // `undefined` for an optional property.
    return {
      items: data?.items ?? [],
      hasNextPage: nextCursor !== undefined,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      ...(prevCursor === undefined ? {} : { prevCursor }),
    };
  }
}
