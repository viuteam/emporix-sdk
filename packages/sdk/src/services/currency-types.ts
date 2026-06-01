/**
 * Public types for the Currency Service — stable names aliased over the
 * generated `currency-service` types. The list endpoints return plain arrays.
 */
import type {
  CurrencyRetrieval,
  CurrencyCreation,
  CurrencyUpdate as GenCurrencyUpdate,
  CurrencyCreationResponse,
  ExchangeRateRetrieval,
  ExchangeRateCreationRequest,
  ExchangeRateUpdateRequest,
  ExchangeRateResponse,
} from "../generated/currency-service";

/** A currency (read shape). */
export type Currency = CurrencyRetrieval;
/** List of currencies (`GET /currencies`) — a plain array. */
export type CurrencyList = CurrencyRetrieval[];
/** Create body (`POST /currencies`). */
export type CurrencyInput = CurrencyCreation;
/** Update body (`PUT /currencies/{code}`). */
export type CurrencyUpdate = GenCurrencyUpdate;
/** `POST /currencies` (201) response. */
export type CurrencyCreated = CurrencyCreationResponse;

/** An exchange rate (read shape). */
export type ExchangeRate = ExchangeRateRetrieval;
/** List of exchange rates (`GET /exchanges`) — a plain array. */
export type ExchangeRateList = ExchangeRateRetrieval[];
/** Create body (`POST /exchanges`). */
export type ExchangeRateInput = ExchangeRateCreationRequest;
/** Update body (`PUT /exchanges/{code}`). */
export type ExchangeRateUpdate = ExchangeRateUpdateRequest;
/** `POST /exchanges` (201) response. */
export type ExchangeRateCreated = ExchangeRateResponse;
