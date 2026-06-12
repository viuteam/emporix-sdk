import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Currency,
  CurrencyList,
  CurrencyInput,
  CurrencyUpdate,
  CurrencyCreated,
  ExchangeRate,
  ExchangeRateList,
  ExchangeRateInput,
  ExchangeRateUpdate,
  ExchangeRateCreated,
} from "./currency-types";

export type {
  Currency,
  CurrencyList,
  CurrencyInput,
  CurrencyUpdate,
  CurrencyCreated,
  ExchangeRate,
  ExchangeRateList,
  ExchangeRateInput,
  ExchangeRateUpdate,
  ExchangeRateCreated,
} from "./currency-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Currency Service (`/currency/{tenant}/…`): currencies and exchange
 * rates. Server-side; defaults to the service token.
 */
export class CurrencyService {
  static readonly channel = "currency" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/currency/${this.ctx.tenant}`;
  }

  // --- Currencies ---

  /** List all currencies. */
  async listCurrencies(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<CurrencyList> {
    return this.ctx.http.request<CurrencyList>({
      method: "GET",
      path: `${this.base()}/currencies`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one currency by code. */
  async getCurrency(code: string, auth: AuthContext = SERVICE): Promise<Currency> {
    return this.ctx.http.request<Currency>({
      method: "GET",
      path: `${this.base()}/currencies/${encodeURIComponent(code)}`,
      auth,
    });
  }

  /** Create a currency. */
  async createCurrency(input: CurrencyInput, auth: AuthContext = SERVICE): Promise<CurrencyCreated> {
    return this.ctx.http.request<CurrencyCreated>({
      method: "POST",
      path: `${this.base()}/currencies`,
      auth,
      body: input,
    });
  }

  /** Update a currency by code. */
  async updateCurrency(code: string, input: CurrencyUpdate, auth: AuthContext = SERVICE): Promise<Currency> {
    return this.ctx.http.request<Currency>({
      method: "PUT",
      path: `${this.base()}/currencies/${encodeURIComponent(code)}`,
      auth,
      body: input,
    });
  }

  /** Delete a currency by code. */
  async deleteCurrency(code: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/currencies/${encodeURIComponent(code)}`,
      auth,
    });
  }

  // --- Exchange rates ---

  /** List all exchange rates. */
  async listExchangeRates(
    query: Record<string, string | number> = {},
    auth: AuthContext = SERVICE,
  ): Promise<ExchangeRateList> {
    return this.ctx.http.request<ExchangeRateList>({
      method: "GET",
      path: `${this.base()}/exchanges`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one exchange rate by code. */
  async getExchangeRate(code: string, auth: AuthContext = SERVICE): Promise<ExchangeRate> {
    return this.ctx.http.request<ExchangeRate>({
      method: "GET",
      path: `${this.base()}/exchanges/${encodeURIComponent(code)}`,
      auth,
    });
  }

  /** Create an exchange rate. */
  async createExchangeRate(input: ExchangeRateInput, auth: AuthContext = SERVICE): Promise<ExchangeRateCreated> {
    return this.ctx.http.request<ExchangeRateCreated>({
      method: "POST",
      path: `${this.base()}/exchanges`,
      auth,
      body: input,
    });
  }

  /** Update an exchange rate by code. */
  async updateExchangeRate(code: string, input: ExchangeRateUpdate, auth: AuthContext = SERVICE): Promise<ExchangeRate> {
    return this.ctx.http.request<ExchangeRate>({
      method: "PUT",
      path: `${this.base()}/exchanges/${encodeURIComponent(code)}`,
      auth,
      body: input,
    });
  }

  /** Delete an exchange rate by code. */
  async deleteExchangeRate(code: string, auth: AuthContext = SERVICE): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/exchanges/${encodeURIComponent(code)}`,
      auth,
    });
  }
}
