import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixAuthError } from "../core/errors";
import type {
  Match,
  MatchByContext,
  MatchResponse,
  CreatePrice,
  GetPrice,
  PriceModelDefinitionCreation,
  PriceModelRetrieval,
  PriceListCreation,
  PriceListUpdate,
  PriceList as GenPriceList,
  PriceListPriceCreation,
  PriceListPriceUpdate,
  PriceListPrice as GenPriceListPrice,
  PriceBulkResponseEntry,
} from "../generated/price";

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

/** A resolved/stored price (generated read shape). */
export type Price = GetPrice;
/** Create/upsert body for a flat price (generated). */
export type PriceCreateInput = CreatePrice;
/** A price model (read). */
export type PriceModel = PriceModelRetrieval;
/** Create/upsert body for a price model (generated). */
export type PriceModelInput = PriceModelDefinitionCreation;
/** A price list (read). */
export type PriceList = GenPriceList;
/** Create body for a price list (generated). */
export type PriceListInput = PriceListCreation;
/** Upsert body for a price list (generated). */
export type PriceListUpdateInput = PriceListUpdate;
/** A price inside a price list (read). */
export type PriceListPrice = GenPriceListPrice;
/** Add body for a price-list price (generated). */
export type PriceListPriceInput = PriceListPriceCreation;
/** Upsert body for a price-list price (generated). */
export type PriceListPriceUpdateInput = PriceListPriceUpdate;
/** Per-entry result of a bulk price operation (generated). */
export type PriceBulkResult = PriceBulkResponseEntry;

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
  static readonly channel = "price" as const;
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
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
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
      idempotent: true, // pure read over POST — safe to replay on 5xx/429
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

  // --- Admin CRUD (flat prices). Default auth: service. ---

  /** Creates a flat price. Default auth: service. */
  async create(input: PriceCreateInput, authCtx: AuthContext = SERVICE): Promise<Price> {
    return this.ctx.http.request<Price>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/prices`,
      auth: authCtx,
      body: input,
    });
  }

  /** Lists flat prices. Default auth: service. */
  async list(
    query?: Record<string, string | number>,
    authCtx: AuthContext = SERVICE,
  ): Promise<Price[]> {
    return this.ctx.http.request<Price[]>({
      method: "GET",
      path: `/price/${this.ctx.tenant}/prices`,
      auth: authCtx,
      ...(query ? { query } : {}),
    });
  }

  /** Retrieves one flat price by id. Default auth: service. */
  async get(priceId: string, authCtx: AuthContext = SERVICE): Promise<Price> {
    return this.ctx.http.request<Price>({
      method: "GET",
      path: `/price/${this.ctx.tenant}/prices/${priceId}`,
      auth: authCtx,
    });
  }

  /** Upserts a flat price by id (PUT). Default auth: service. */
  async upsert(priceId: string, input: PriceCreateInput, authCtx: AuthContext = SERVICE): Promise<Price> {
    return this.ctx.http.request<Price>({
      method: "PUT",
      path: `/price/${this.ctx.tenant}/prices/${priceId}`,
      auth: authCtx,
      body: input,
    });
  }

  /** Deletes a flat price by id. Default auth: service. */
  async delete(priceId: string, authCtx: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `/price/${this.ctx.tenant}/prices/${priceId}`,
      auth: authCtx,
    });
  }

  /** Searches flat prices (POST body query). Default auth: service. */
  async search(query: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<Price[]> {
    return this.ctx.http.request<Price[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/prices/search`,
      auth: authCtx,
      body: query,
    });
  }

  /** Creates multiple flat prices in one request. Default auth: service. */
  async bulkCreate(inputs: PriceCreateInput[], authCtx: AuthContext = SERVICE): Promise<PriceBulkResult[]> {
    return this.ctx.http.request<PriceBulkResult[]>({
      method: "POST",
      path: `/price/${this.ctx.tenant}/prices/bulk`,
      auth: authCtx,
      body: inputs,
    });
  }

  /** Upserts multiple flat prices in one request (PUT). Default auth: service. */
  async bulkUpsert(inputs: PriceCreateInput[], authCtx: AuthContext = SERVICE): Promise<PriceBulkResult[]> {
    return this.ctx.http.request<PriceBulkResult[]>({
      method: "PUT",
      path: `/price/${this.ctx.tenant}/prices/bulk`,
      auth: authCtx,
      body: inputs,
    });
  }

  /** Price-model admin CRUD (`/priceModels`). Default auth: service. */
  readonly models = {
    list: async (
      query?: Record<string, string | number>,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceModel[]> =>
      this.ctx.http.request<PriceModel[]>({
        method: "GET",
        path: `/price/${this.ctx.tenant}/priceModels`,
        auth: authCtx,
        ...(query ? { query } : {}),
      }),
    create: async (input: PriceModelInput, authCtx: AuthContext = SERVICE): Promise<PriceModel> =>
      this.ctx.http.request<PriceModel>({
        method: "POST",
        path: `/price/${this.ctx.tenant}/priceModels`,
        auth: authCtx,
        body: input,
      }),
    get: async (modelId: string, authCtx: AuthContext = SERVICE): Promise<PriceModel> =>
      this.ctx.http.request<PriceModel>({
        method: "GET",
        path: `/price/${this.ctx.tenant}/priceModels/${modelId}`,
        auth: authCtx,
      }),
    upsert: async (
      modelId: string,
      input: PriceModelInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceModel> =>
      this.ctx.http.request<PriceModel>({
        method: "PUT",
        path: `/price/${this.ctx.tenant}/priceModels/${modelId}`,
        auth: authCtx,
        body: input,
      }),
    delete: async (modelId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/price/${this.ctx.tenant}/priceModels/${modelId}`,
        auth: authCtx,
      });
    },
  };

  /** Price-list admin CRUD (`/price-lists`) + nested price management. Default auth: service. */
  readonly lists = {
    list: async (
      query?: Record<string, string | number>,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceList[]> =>
      this.ctx.http.request<PriceList[]>({
        method: "GET",
        path: `/price/${this.ctx.tenant}/price-lists`,
        auth: authCtx,
        ...(query ? { query } : {}),
      }),
    create: async (input: PriceListInput, authCtx: AuthContext = SERVICE): Promise<PriceList> =>
      this.ctx.http.request<PriceList>({
        method: "POST",
        path: `/price/${this.ctx.tenant}/price-lists`,
        auth: authCtx,
        body: input,
      }),
    search: async (query: Record<string, unknown>, authCtx: AuthContext = SERVICE): Promise<PriceList[]> =>
      this.ctx.http.request<PriceList[]>({
        method: "POST",
        path: `/price/${this.ctx.tenant}/price-lists/search`,
        auth: authCtx,
        body: query,
      }),
    get: async (listId: string, authCtx: AuthContext = SERVICE): Promise<PriceList> =>
      this.ctx.http.request<PriceList>({
        method: "GET",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}`,
        auth: authCtx,
      }),
    upsert: async (
      listId: string,
      input: PriceListUpdateInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceList> =>
      this.ctx.http.request<PriceList>({
        method: "PUT",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}`,
        auth: authCtx,
        body: input,
      }),
    delete: async (listId: string, authCtx: AuthContext = SERVICE): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}`,
        auth: authCtx,
      });
    },
    listPrices: async (
      listId: string,
      query?: Record<string, string | number>,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceListPrice[]> =>
      this.ctx.http.request<PriceListPrice[]>({
        method: "GET",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices`,
        auth: authCtx,
        ...(query ? { query } : {}),
      }),
    addPrice: async (
      listId: string,
      input: PriceListPriceInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceListPrice> =>
      this.ctx.http.request<PriceListPrice>({
        method: "POST",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices`,
        auth: authCtx,
        body: input,
      }),
    getPrice: async (
      listId: string,
      priceId: string,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceListPrice> =>
      this.ctx.http.request<PriceListPrice>({
        method: "GET",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/${priceId}`,
        auth: authCtx,
      }),
    upsertPrice: async (
      listId: string,
      priceId: string,
      input: PriceListPriceUpdateInput,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceListPrice> =>
      this.ctx.http.request<PriceListPrice>({
        method: "PUT",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/${priceId}`,
        auth: authCtx,
        body: input,
      }),
    deletePrice: async (
      listId: string,
      priceId: string,
      authCtx: AuthContext = SERVICE,
    ): Promise<void> => {
      await this.ctx.http.request<void>({
        method: "DELETE",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/${priceId}`,
        auth: authCtx,
      });
    },
    searchPrices: async (
      listId: string,
      query: Record<string, unknown>,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceListPrice[]> =>
      this.ctx.http.request<PriceListPrice[]>({
        method: "POST",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/search`,
        auth: authCtx,
        body: query,
      }),
    bulkCreatePrices: async (
      listId: string,
      inputs: PriceListPriceInput[],
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceBulkResult[]> =>
      this.ctx.http.request<PriceBulkResult[]>({
        method: "POST",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/bulk`,
        auth: authCtx,
        body: inputs,
      }),
    bulkUpsertPrices: async (
      listId: string,
      inputs: PriceListPriceInput[],
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceBulkResult[]> =>
      this.ctx.http.request<PriceBulkResult[]>({
        method: "PUT",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/bulk`,
        auth: authCtx,
        body: inputs,
      }),
    bulkDeletePrices: async (
      listId: string,
      body: Record<string, unknown>,
      authCtx: AuthContext = SERVICE,
    ): Promise<PriceBulkResult[]> =>
      this.ctx.http.request<PriceBulkResult[]>({
        method: "DELETE",
        path: `/price/${this.ctx.tenant}/price-lists/${listId}/prices/bulk`,
        auth: authCtx,
        body,
      }),
  };
}
