/**
 * Public types for the Audit Log (Changelog) Service — stable names aliased over
 * the generated `audit-logs-changelog` types.
 */
import type { PaginatedItems } from "../core/context";
import type {
  ChangelogChangeItem,
  ChangelogRelatedItem,
  GetChangelogRetrieveTenantChangelogsData,
  PathValueChange,
} from "../generated/audit-logs-changelog";

/**
 * One recorded change to a platform document.
 *
 * Every field is optional in the spec — including `at`, `entity` and `entityId`.
 * Read them defensively; this is a preview service and the shape may grow.
 */
export type AuditLogEntry = ChangelogChangeItem;

/** What happened to the document: an insert, an update/replace, or a delete. */
export type AuditLogChangeType = NonNullable<ChangelogChangeItem["type"]>;

/**
 * Before/after values for one changed field path.
 *
 * Both sides are `unknown` and both may be absent — `before` is missing on a
 * create, `after` on a delete, and either can be omitted when the service could
 * not derive it from the change patch.
 */
export type AuditLogPathChange = PathValueChange;

/**
 * An entity linked to a changed document — the junction rows that make a change
 * findable from either side (a `group-assignment` relates to its `group` and its
 * `customer`).
 */
export type AuditLogRelatedEntity = ChangelogRelatedItem;

/** The `q` / `page` / `size` the endpoint accepts, straight from the spec. */
type WireQuery = NonNullable<GetChangelogRetrieveTenantChangelogsData["query"]>;

/** Options for {@link AuditLogService.list}. */
export interface AuditLogQuery {
  /**
   * Raw Emporix `q` filter. Supported fields: `entity`, `entityId` (requires
   * `entity`), `type`, `actor`, `occurredAt`, `related.entity` /
   * `related.entityId` (or `related:elemMatch(...)`), and
   * `compoundLogicalQuery` for nested `OR` / `AND`.
   *
   * A plain `string`, not a `QueryFor<E>` mixin filter, on purpose: a
   * `MixinFilter` targets an entity's own fields, and this endpoint indexes
   * change metadata rather than the document — so a filter built for `"ORDER"`
   * would name fields the changelog does not have.
   */
  q?: WireQuery["q"];
  /** One-based page number. Default `1`. */
  pageNumber?: WireQuery["page"];
  /** Entries per page. Default `20`, maximum `100` — the service rejects more with a `400`. */
  pageSize?: WireQuery["size"];
}

/**
 * A page of audit-log entries.
 *
 * The service returns its paging in the body rather than in headers, so this
 * carries `totalElements` / `totalPages` on top of the SDK-wide
 * {@link PaginatedItems} shape — the same treatment `ImportPage` gets, and for
 * the same reason.
 */
export type AuditLogPage = PaginatedItems<AuditLogEntry> & {
  /** Total entries matching the query, across all pages. */
  totalElements: number;
  /** Total number of pages for the matching result set. */
  totalPages: number;
};
