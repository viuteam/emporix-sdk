import type {
  QuoteResponse as GenQuote,
  QuoteCreateRequest as GenQuoteCreate,
  QuoteCreateFromCartRequest as GenQuoteCreateFromCart,
  QuoteIdResponse as GenQuoteCreated,
  QuoteUpdateRequest as GenQuoteUpdate,
  QuoteHistory as GenQuoteHistory,
  QuoteReasonResponse as GenQuoteReason,
  QuoteReasonCreateRequest as GenQuoteReasonDraft,
  QuoteReasonUpdateRequest as GenQuoteReasonUpdate,
  QuoteReasonIdResponse as GenQuoteReasonCreated,
} from "../generated/quote";

/** A quote (read shape). */
export type Quote = GenQuote;
/** Body for {@link QuoteService.create} — a from-scratch quote or a from-cart quote. */
export type QuoteDraft = GenQuoteCreate | GenQuoteCreateFromCart;
/** Result of creating a quote — `{ id? }`. */
export type QuoteCreated = GenQuoteCreated;
/** Body for {@link QuoteService.update} — the upstream update-op array. */
export type QuoteUpdate = GenQuoteUpdate;
/** A quote's change history. */
export type QuoteHistory = GenQuoteHistory;

/** A quote reason (read shape). */
export type QuoteReason = GenQuoteReason;
/** Body for `reasons.create`. */
export type QuoteReasonDraft = GenQuoteReasonDraft;
/** Body for `reasons.update` (`metadata.version` required for optimistic locking). */
export type QuoteReasonUpdate = GenQuoteReasonUpdate;
/** Result of creating a quote reason — `{ id? }`. */
export type QuoteReasonCreated = GenQuoteReasonCreated;

/** Filter/pagination for {@link QuoteService.list}. */
export interface ListQuotesQuery {
  /** Emporix `q`-syntax filter. */
  q?: string;
  /** Sort spec (e.g. `createdAt:desc`). */
  sort?: string;
  pageNumber?: number;
  pageSize?: number;
}

/** Pagination for `reasons.list`. */
export interface ListQuoteReasonsQuery {
  pageNumber?: number;
  pageSize?: number;
}
