import { describe, it, expectTypeOf } from "vitest";
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
} from "../../src/services/currency-types";

describe("currency types", () => {
  it("currency + exchange-rate types are usable", () => {
    expectTypeOf<Currency>().not.toBeNever();
    expectTypeOf<CurrencyList>().toBeArray();
    expectTypeOf<CurrencyInput>().not.toBeNever();
    expectTypeOf<CurrencyUpdate>().not.toBeNever();
    expectTypeOf<CurrencyCreated>().not.toBeNever();
    expectTypeOf<ExchangeRate>().not.toBeNever();
    expectTypeOf<ExchangeRateList>().toBeArray();
    expectTypeOf<ExchangeRateInput>().not.toBeNever();
    expectTypeOf<ExchangeRateUpdate>().not.toBeNever();
    expectTypeOf<ExchangeRateCreated>().not.toBeNever();
  });
});
