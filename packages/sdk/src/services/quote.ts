import type { ClientContext, PaginatedItems } from "../core/context";
import type { AuthContext } from "../core/auth";
import { errorFromResponse } from "../core/errors";
import type {
  Quote,
  QuoteDraft,
  QuoteCreated,
  QuoteUpdate,
  QuoteHistory,
  ListQuotesQuery,
  QuoteReason,
  QuoteReasonDraft,
  QuoteReasonUpdate,
  QuoteReasonCreated,
  ListQuoteReasonsQuery,
} from "./quote-types";

export type {
  Quote,
  QuoteDraft,
  QuoteCreated,
  QuoteUpdate,
  QuoteHistory,
  ListQuotesQuery,
  QuoteReason,
  QuoteReasonDraft,
  QuoteReasonUpdate,
  QuoteReasonCreated,
  ListQuoteReasonsQuery,
} from "./quote-types";

/**
 * Quote Service (`/quote/{tenant}/…`): B2B quotes and quote reasons. Quotes are
 * customer-owned and never anonymous, so every method takes a REQUIRED `auth`:
 * pass `auth.customer(token)` for a customer's own quotes, or `auth.service()`
 * (an admin token) for `quote_manage`-scoped ops (`delete`, reason mutations).
 */
export class QuoteService {
  static readonly channel = "quote" as const;
  constructor(private readonly ctx: ClientContext) {}

  private quotesBase(): string {
    return `/quote/${this.ctx.tenant}/quotes`;
  }

  private _reasons?: QuoteReasonsResource;
  /** Quote reasons config (`/quote-reasons`). CRUD sub-resource. */
  get reasons(): QuoteReasonsResource {
    return (this._reasons ??= new QuoteReasonsResource(this.ctx));
  }

  /** List quotes, wrapped in {@link PaginatedItems}. Pass `{}` for no filter. */
  async list(query: ListQuotesQuery, auth: AuthContext): Promise<PaginatedItems<Quote>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const q: Record<string, string | number> = { pageNumber, pageSize };
    if (query.q) q.q = query.q;
    if (query.sort) q.sort = query.sort;
    const items = await this.ctx.http.request<Quote[]>({
      method: "GET",
      path: this.quotesBase(),
      auth,
      query: q,
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Create a quote (`POST /quotes`, 201). */
  async create(draft: QuoteDraft, auth: AuthContext): Promise<QuoteCreated> {
    return this.ctx.http.request<QuoteCreated>({
      method: "POST",
      path: this.quotesBase(),
      auth,
      body: draft,
    });
  }

  /** Retrieve one quote by id. */
  async get(quoteId: string, auth: AuthContext): Promise<Quote> {
    return this.ctx.http.request<Quote>({
      method: "GET",
      path: `${this.quotesBase()}/${encodeURIComponent(quoteId)}`,
      auth,
    });
  }

  /** Apply an update-op array to a quote (`PATCH /quotes/{id}`, 204). */
  async update(quoteId: string, update: QuoteUpdate, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PATCH",
      path: `${this.quotesBase()}/${encodeURIComponent(quoteId)}`,
      auth,
      body: update,
    });
  }

  /** Delete a quote (`DELETE /quotes/{id}`). Requires the admin `quote_manage` scope. */
  async delete(quoteId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.quotesBase()}/${encodeURIComponent(quoteId)}`,
      auth,
    });
  }

  /** Retrieve a quote's change history (`GET /quotes/{id}/history`). */
  async history(quoteId: string, auth: AuthContext): Promise<QuoteHistory> {
    return this.ctx.http.request<QuoteHistory>({
      method: "GET",
      path: `${this.quotesBase()}/${encodeURIComponent(quoteId)}/history`,
      auth,
    });
  }

  /**
   * Generate a quote PDF (`POST /quotes/{id}/pdf`). Returns the raw PDF bytes.
   * Uses `requestRaw` (no typed-error mapping) — a non-2xx is thrown explicitly.
   */
  async generatePdf(quoteId: string, auth: AuthContext): Promise<Blob> {
    const path = `${this.quotesBase()}/${encodeURIComponent(quoteId)}/pdf`;
    const res = await this.ctx.http.requestRaw({ method: "POST", path, auth });
    if (!res.ok) {
      const body = await res.text();
      throw errorFromResponse(res.status, `POST ${path} failed: ${res.status}`, body);
    }
    return await res.blob();
  }
}

/**
 * Quote reasons (`/quote/{tenant}/quote-reasons`). Config data. Like the rest
 * of the quote domain, every method takes a REQUIRED `auth`: reads accept a
 * customer or admin token; `create`/`update`/`delete` need the admin
 * `quote.quote_manage` scope (`auth.service()`).
 */
export class QuoteReasonsResource {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/quote/${this.ctx.tenant}/quote-reasons`;
  }

  /** List reasons, wrapped in {@link PaginatedItems}. Pass `{}` for no paging override. */
  async list(query: ListQuoteReasonsQuery, auth: AuthContext): Promise<PaginatedItems<QuoteReason>> {
    const pageNumber = query.pageNumber ?? 1;
    const pageSize = query.pageSize ?? 60;
    const items = await this.ctx.http.request<QuoteReason[]>({
      method: "GET",
      path: this.base(),
      auth,
      query: { pageNumber, pageSize },
    });
    return { items, pageNumber, pageSize, hasNextPage: items.length === pageSize };
  }

  /** Retrieve one reason by id. */
  async get(reasonId: string, auth: AuthContext): Promise<QuoteReason> {
    return this.ctx.http.request<QuoteReason>({
      method: "GET",
      path: `${this.base()}/${encodeURIComponent(reasonId)}`,
      auth,
    });
  }

  /** Create a reason (`POST /quote-reasons`). Requires the admin `quote_manage` scope. */
  async create(draft: QuoteReasonDraft, auth: AuthContext): Promise<QuoteReasonCreated> {
    return this.ctx.http.request<QuoteReasonCreated>({
      method: "POST",
      path: this.base(),
      auth,
      body: draft,
    });
  }

  /**
   * Replace a reason (`PUT /quote-reasons/{id}`, 204). `draft.metadata.version`
   * is required for optimistic locking. Requires the admin `quote_manage` scope.
   */
  async update(reasonId: string, draft: QuoteReasonUpdate, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(reasonId)}`,
      auth,
      body: draft,
    });
  }

  /** Delete a reason (`DELETE /quote-reasons/{id}`). Requires the admin `quote_manage` scope. */
  async delete(reasonId: string, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(reasonId)}`,
      auth,
    });
  }
}
