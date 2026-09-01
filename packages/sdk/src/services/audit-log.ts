import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { ChangelogHistoryResponse } from "../generated/audit-logs-changelog";
import type { AuditLogPage, AuditLogQuery } from "./audit-log-types";

export type {
  AuditLogChangeType,
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
   * List changes across the tenant, newest occurrence first.
   *
   * **The window defaults to the last 30 days.** When `q` carries no
   * conjunctive `occurredAt` lower bound, the service silently applies a
   * trailing 30-day window — an unfiltered call is *not* «everything ever». Pass
   * an explicit top-level or `AND`-ed `occurredAt` range to widen it; an
   * `occurredAt` that appears only inside an `OR` arm does not lift the default.
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
}
