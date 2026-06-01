# Currency Service

Bindings for the Emporix **Currency Service** (`/currency/{tenant}/…`): currencies
and exchange rates.

> **Server-side.** Defaults to the service token (`currency.currency_read` /
> `currency.currency_manage`).

## Currencies

```ts
const currencies = await client.currencies.listCurrencies();
const eur = await client.currencies.getCurrency("EUR");
await client.currencies.createCurrency({ code: "EUR", /* … */ });
await client.currencies.updateCurrency("EUR", { /* … */ });
await client.currencies.deleteCurrency("EUR");
```

## Exchange rates

```ts
const rates = await client.currencies.listExchangeRates();
const rate = await client.currencies.getExchangeRate("EUR-USD");
await client.currencies.createExchangeRate({ /* … */ });
await client.currencies.updateExchangeRate("EUR-USD", { /* … */ });
await client.currencies.deleteExchangeRate("EUR-USD");
```

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set).
