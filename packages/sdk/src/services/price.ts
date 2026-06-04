import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixAuthError } from "../core/errors";
import type { Match, MatchByContext, MatchResponse } from "../generated/price";

/** Session-context match request body (generated). */
export type PriceMatchByContextInput = MatchByContext;

/** Explicit-context match request body (generated). */
export type PriceMatchInput = Match;

/** Item (product or price) a price was matched for. */
export interface PriceMatchItemRef {
  itemType?: string;
  id?: string;
  /** Localized (or plain) product name — present on the live API, absent from the OpenAPI doc. */
  name?: Record<string, string> | string;
}

/**
 * A resolved price. Superset of the generated match-response schema: the
 * deployed API returns the matched item under `itemId` (with a localized
 * `name`), while the OpenAPI doc/codegen call it `itemRef`.
 */
export type PriceMatch = Omit<MatchResponse, "itemRef"> & {
  /** Item the price was matched for, as returned by the API. */
  itemId?: PriceMatchItemRef;
  /**
   * @deprecated The OpenAPI doc names this `itemRef`, but the deployed API
   * returns `itemId`. Mirrored from `itemId` for back-compat — prefer `itemId`.
   */
  itemRef?: PriceMatchItemRef;
};

/**
 * Normalizes a raw match row: the deployed API returns `itemId`, while the
 * codegen type calls it `itemRef`. Expose `itemId` canonically and mirror it
 * to the deprecated `itemRef` so existing consumers keep working.
 */
function normalizeMatch(raw: MatchResponse): PriceMatch {
  const itemId = (raw as MatchResponse & { itemId?: PriceMatchItemRef }).itemId ?? raw.itemRef;
  const base = raw as PriceMatch;
  if (!itemId) return base;
  // Mirror only id/type into the deprecated itemRef (drop name); build without
  // explicit `undefined` for exactOptionalPropertyTypes.
  const itemRef: PriceMatchItemRef = {
    ...(itemId.itemType !== undefined ? { itemType: itemId.itemType } : {}),
    ...(itemId.id !== undefined ? { id: itemId.id } : {}),
  };
  return { ...base, itemId, itemRef };
}

/** Options for {@link PriceService.matchByContextChunked}. */
export interface MatchByContextChunkedOptions {
  /** Items per request. Default 50. Must be >= 1. */
  chunkSize?: number;
  /** Maximum number of requests in flight at once. Default 4. Must be >= 1. */
  concurrency?: number;
  /** Invoked once per failed chunk (default mode only — not when throwing). */
  onChunkError?: (err: unknown, chunkIndex: number) => void;
  /** When true, the first failing chunk rejects the whole call. Default false. */
  throwOnAnyChunkError?: boolean;
}

const ANON: AuthContext = { kind: "anonymous" };
const SERVICE: AuthContext = { kind: "service" };

function requireContextAuth(auth: AuthContext | undefined): AuthContext {
  const a = auth ?? ANON;
  if (a.kind === "anonymous" || a.kind === "customer" || a.kind === "raw") return a;
  throw new EmporixAuthError(
    "match-prices-by-context requires an anonymous, customer, or raw AuthContext",
  );
}

/**
 * Price matching. The Cart service does not resolve prices — call this
 * explicitly before rendering money and again right before placing an order.
 * The SDK is stateless: it never caches or revalidates prices.
 */
export class PriceService {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Resolves prices using the session context bound to the bearer token
   * (currency/site/country were set at anonymous-login time). Default auth:
   * anonymous; pass a customer/raw context for personalized pricing.
   */
  async matchByContext(
    input: PriceMatchByContextInput,
    auth?: AuthContext,
  ): Promise<PriceMatch[]> {
    const rows = await this.ctx.http.request<MatchResponse[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/match-prices-by-context`,
      auth: requireContextAuth(auth),
      body: input,
    });
    return rows.map(normalizeMatch);
  }

  /**
   * Resolves prices from an explicit context. Default auth: service
   * (requires `price.price_read` / `price.price_manage`).
   */
  async match(input: PriceMatchInput, auth: AuthContext = SERVICE): Promise<PriceMatch[]> {
    const rows = await this.ctx.http.request<MatchResponse[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/match-prices`,
      auth,
      body: input,
    });
    return rows.map(normalizeMatch);
  }

  /**
   * Chunked variant of {@link matchByContext} for large `items` arrays. The
   * Emporix backend handles only a limited number of items per request
   * (production limit ~50), so this splits `input.items` into chunks and runs
   * `matchByContext` with bounded concurrency.
   *
   * By default a failing chunk is skipped (its items are absent from the
   * result) and `opts.onChunkError` is called once for it; pass
   * `throwOnAnyChunkError: true` to reject on the first failure instead.
   *
   * **Result order is not guaranteed** — match entries back to your items by
   * `priceId` / `itemId.id`.
   */
  async matchByContextChunked(
    input: PriceMatchByContextInput,
    opts: MatchByContextChunkedOptions = {},
    auth?: AuthContext,
  ): Promise<PriceMatch[]> {
    const chunkSize = opts.chunkSize ?? 50;
    const concurrency = opts.concurrency ?? 4;
    if (chunkSize < 1) throw new Error("chunkSize must be >= 1");
    if (concurrency < 1) throw new Error("concurrency must be >= 1");

    const items = input.items ?? [];
    if (items.length === 0) return [];

    const chunks: PriceMatchByContextInput[] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push({ ...input, items: items.slice(i, i + chunkSize) });
    }

    const results: PriceMatch[][] = new Array(chunks.length);
    let cursor = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        const idx = cursor++;
        const chunk = chunks[idx];
        if (chunk === undefined) return; // past the end
        try {
          results[idx] = await this.matchByContext(chunk, auth);
        } catch (err) {
          if (opts.throwOnAnyChunkError) throw err;
          results[idx] = [];
          opts.onChunkError?.(err, idx);
        }
      }
    };

    const workerCount = Math.min(concurrency, chunks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    return results.flat();
  }
}
