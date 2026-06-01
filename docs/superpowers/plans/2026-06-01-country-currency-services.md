# Country + Currency Services Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Emporix **Country** and **Currency** services as two core SDK services, `client.countries` (countries + regions) and `client.currencies` (currencies + exchange rates), in one branch/PR.

**Architecture:** Types generated via `@hey-api/openapi-ts`; `country-types.ts`/`currency-types.ts` alias the generated types. Two service classes default to the service token (overridable). Standard tenant base paths. No React.

**Tech Stack:** TypeScript, Vitest + MSW, `@hey-api/openapi-ts`, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-01-country-currency-services-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `country-service` + `currency-service` URLs |
| `packages/sdk/specs/{country,currency}-service.yml` | fetched OpenAPI |
| `packages/sdk/src/generated/{country,currency}-service/` | generated types |
| `packages/sdk/src/services/{country,currency}-types.ts` | public type aliases |
| `packages/sdk/src/services/{country,currency}.ts` | `CountryService` / `CurrencyService` |
| `packages/sdk/src/{country,currency}.ts` | facade re-exports |
| `packages/sdk/src/core/logger.ts` | add `"country"`, `"currency"` to `ServiceName` |
| `packages/sdk/src/client.ts` | construct + expose `countries`, `currencies` |
| `packages/sdk/src/index.ts` | re-export the facades |
| `packages/sdk/tests/services/{country,currency}-types.test.ts` | type-level tests |
| `packages/sdk/tests/services/{country,currency}.test.ts` | MSW tests |
| `packages/sdk/tests/services/country-currency-wiring.test.ts` | wiring test (both) |
| `docs/country.md`, `docs/currency.md` | usage docs |
| `CLAUDE.md` | service-list update |
| `.changeset/country-currency-services.md` | release entry (sdk only) |

All commands run from the repo root: `/Users/dominic.fritschi/projects/viu/emporix-sdk`.

**Branch:** create `feat/country-currency-services` off current `main`, commit the spec + plan docs first:
```bash
git checkout main && git pull
git checkout -b feat/country-currency-services
git add docs/superpowers/specs/2026-06-01-country-currency-services-design.md docs/superpowers/plans/2026-06-01-country-currency-services.md
git commit -m "docs(sdk): add country and currency services design spec and plan"
```

---

## Task 1: Generate Country + Currency types (codegen)

- [ ] **Step 1: Add the spec entries**

In `packages/sdk/scripts/fetch-specs.ts`, add (after the `label-service` entry):

```ts
  "country-service": `${BASE}/configuration/country-service/api-reference/api.yml`,
  "currency-service": `${BASE}/configuration/currency-service/api-reference/api.yml`,
```

(Both URLs verified live → HTTP 200.)

- [ ] **Step 2: Fetch + generate**

```bash
pnpm -F @viu/emporix-sdk fetch:specs
pnpm -F @viu/emporix-sdk generate
```

- [ ] **Step 3: Verify the generated type names**

```bash
grep -nE "^export type " packages/sdk/src/generated/country-service/types.gen.ts | grep -viE "Data =|Error|Responses|Response =|ClientOptions|Trait|Page|Metadata"
grep -nE "^export type " packages/sdk/src/generated/currency-service/types.gen.ts | grep -viE "Data =|Error|Responses|Response =|ClientOptions|Trait|Page|Metadata"
```
Record (scratch note):
- Country: `Country`, `Region`, `CountryUpdate`, list wrappers (`GetCountries`/`GetRegions` — array vs paged).
- Currency: `CurrencyRetrieval`, `CurrencyCreation`, `CurrencyUpdate`, `CurrencyCreationResponse`, `ExchangeRateRetrieval`, `ExchangeRateCreationRequest`, `ExchangeRateUpdateRequest`, `ExchangeRateResponse`.

Confirm list shapes + create/update/delete response codes:
```bash
grep -nE "body\??: [A-Za-z]|200:|201:|204:|url: '" packages/sdk/src/generated/currency-service/types.gen.ts | head -50
grep -nE "200:|url: '" packages/sdk/src/generated/country-service/types.gen.ts | head
```

- [ ] **Step 4: Keep the change focused** — `git status --short`; restore unrelated drift; stage only country/currency paths.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/scripts/fetch-specs.ts packages/sdk/specs/country-service.yml packages/sdk/specs/currency-service.yml packages/sdk/src/generated/country-service packages/sdk/src/generated/currency-service
git commit -m "feat(sdk): generate country and currency types"
```

---

## Task 2: CountryService (types + service)

- [ ] **Step 1: Failing type test** — `packages/sdk/tests/services/country-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type { Country, CountryList, CountryUpdate, Region, RegionList } from "../../src/services/country-types";

describe("country types", () => {
  it("types are usable", () => {
    expectTypeOf<Country>().not.toBeNever();
    expectTypeOf<CountryList>().not.toBeNever();
    expectTypeOf<CountryUpdate>().not.toBeNever();
    expectTypeOf<Region>().not.toBeNever();
    expectTypeOf<RegionList>().not.toBeNever();
  });
});
```

- [ ] **Step 2: Verify it fails** — `pnpm -F @viu/emporix-sdk exec tsc --noEmit 2>&1 | grep country-types`

- [ ] **Step 3: Write `country-types.ts`** (swap names for the real generated ones):

```ts
import type {
  Country as GenCountry,
  Region as GenRegion,
  CountryUpdate as GenCountryUpdate,
  GetCountries,
  GetRegions,
} from "../generated/country-service";

/** A country (read shape). */
export type Country = GenCountry;
/** List of countries (`GET /countries`). */
export type CountryList = GetCountries;
/** PATCH body for a country. */
export type CountryUpdate = GenCountryUpdate;
/** A region (read shape). */
export type Region = GenRegion;
/** List of regions (`GET /regions`). */
export type RegionList = GetRegions;
```

> If `GetCountries`/`GetRegions` are inline arrays rather than named types, set
> `CountryList = Country[]` / `RegionList = Region[]` and import only what's used.

- [ ] **Step 4: Failing service test** — `packages/sdk/tests/services/country.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CountryService } from "../../src/services/country";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "country" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CountryService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/country/acme";

describe("CountryService", () => {
  it("listCountries GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/countries`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ code: "DE" }]);
      }),
    );
    await svc().listCountries();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getCountry fetches one by code", async () => {
    server.use(http.get(`${BASE}/countries/DE`, () => HttpResponse.json({ code: "DE" })));
    expect((await svc().getCountry("DE")) as { code?: string }).toEqual({ code: "DE" });
  });

  it("getCountry throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/countries/XX`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getCountry("XX")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("patchCountry PATCHes the code", async () => {
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/countries/DE`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ code: "DE" });
      }),
    );
    await svc().patchCountry("DE", { active: true } as never);
    expect(body).toEqual({ active: true });
  });

  it("listRegions GETs regions", async () => {
    server.use(http.get(`${BASE}/regions`, () => HttpResponse.json([{ code: "DE-BY" }])));
    await expect(svc().listRegions()).resolves.toBeDefined();
  });

  it("getRegion fetches one region", async () => {
    server.use(http.get(`${BASE}/regions/DE-BY`, () => HttpResponse.json({ code: "DE-BY" })));
    expect((await svc().getRegion("DE-BY")) as { code?: string }).toEqual({ code: "DE-BY" });
  });

  it("encodeURIComponent-escapes the country code", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/country/acme/countries/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getCountry("a/b");
    expect(pathname).toBe("/country/acme/countries/a%2Fb");
  });
});
```

- [ ] **Step 5: Verify it fails** — `pnpm -F @viu/emporix-sdk exec vitest run tests/services/country.test.ts`

- [ ] **Step 6: Write `country.ts` + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type { Country, CountryList, CountryUpdate, Region, RegionList } from "./country-types";

export type { Country, CountryList, CountryUpdate, Region, RegionList } from "./country-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Country Service (`/country/{tenant}/…`): countries and regions
 * master data. Server-side; defaults to the service token (reads also work
 * with an anonymous token). Countries are predefined — no create/delete.
 */
export class CountryService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/country/${this.ctx.tenant}`;
  }

  /** List all countries. */
  async listCountries(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<CountryList> {
    return this.ctx.http.request<CountryList>({
      method: "GET",
      path: `${this.base()}/countries`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one country by code. */
  async getCountry(countryCode: string, auth: AuthContext = SERVICE): Promise<Country> {
    return this.ctx.http.request<Country>({
      method: "GET",
      path: `${this.base()}/countries/${encodeURIComponent(countryCode)}`,
      auth,
    });
  }

  /** Partially update a country by code. */
  async patchCountry(countryCode: string, patch: CountryUpdate, auth: AuthContext = SERVICE): Promise<Country> {
    return this.ctx.http.request<Country>({
      method: "PATCH",
      path: `${this.base()}/countries/${encodeURIComponent(countryCode)}`,
      auth,
      body: patch,
    });
  }

  /** List all regions. */
  async listRegions(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<RegionList> {
    return this.ctx.http.request<RegionList>({
      method: "GET",
      path: `${this.base()}/regions`,
      auth,
      ...(Object.keys(query).length ? { query } : {}),
    });
  }

  /** Retrieve one region by code. */
  async getRegion(regionCode: string, auth: AuthContext = SERVICE): Promise<Region> {
    return this.ctx.http.request<Region>({
      method: "GET",
      path: `${this.base()}/regions/${encodeURIComponent(regionCode)}`,
      auth,
    });
  }
}
```

Facade `packages/sdk/src/country.ts`:

```ts
export * from "./services/country";
```

- [ ] **Step 7: Run tests + typecheck** — both country tests + `pnpm -F @viu/emporix-sdk typecheck`.

- [ ] **Step 8: Commit (two commits)**

```bash
git add packages/sdk/src/services/country-types.ts packages/sdk/tests/services/country-types.test.ts
git commit -m "feat(sdk): add country public types"
git add packages/sdk/src/services/country.ts packages/sdk/src/country.ts packages/sdk/tests/services/country.test.ts
git commit -m "feat(sdk): add country service"
```

---

## Task 3: CurrencyService (types + service)

- [ ] **Step 1: Failing type test** — `packages/sdk/tests/services/currency-types.test.ts`:

```ts
import { describe, it, expectTypeOf } from "vitest";
import type {
  Currency, CurrencyList, CurrencyInput, CurrencyUpdate, CurrencyCreated,
  ExchangeRate, ExchangeRateList, ExchangeRateInput, ExchangeRateUpdate, ExchangeRateCreated,
} from "../../src/services/currency-types";

describe("currency types", () => {
  it("currency + exchange-rate types are usable", () => {
    expectTypeOf<Currency>().not.toBeNever();
    expectTypeOf<CurrencyList>().not.toBeNever();
    expectTypeOf<CurrencyInput>().not.toBeNever();
    expectTypeOf<CurrencyUpdate>().not.toBeNever();
    expectTypeOf<CurrencyCreated>().not.toBeNever();
    expectTypeOf<ExchangeRate>().not.toBeNever();
    expectTypeOf<ExchangeRateList>().not.toBeNever();
    expectTypeOf<ExchangeRateInput>().not.toBeNever();
    expectTypeOf<ExchangeRateUpdate>().not.toBeNever();
    expectTypeOf<ExchangeRateCreated>().not.toBeNever();
  });
});
```

- [ ] **Step 2: Verify it fails** — `... | grep currency-types`

- [ ] **Step 3: Write `currency-types.ts`** (swap names for the real generated ones):

```ts
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
/** List of currencies (`GET /currencies`). */
export type CurrencyList = CurrencyRetrieval[];
/** Create body (`POST /currencies`). */
export type CurrencyInput = CurrencyCreation;
/** Update body (`PUT /currencies/{code}`). */
export type CurrencyUpdate = GenCurrencyUpdate;
/** `POST /currencies` response. */
export type CurrencyCreated = CurrencyCreationResponse;

/** An exchange rate (read shape). */
export type ExchangeRate = ExchangeRateRetrieval;
/** List of exchange rates (`GET /exchanges`). */
export type ExchangeRateList = ExchangeRateRetrieval[];
/** Create body (`POST /exchanges`). */
export type ExchangeRateInput = ExchangeRateCreationRequest;
/** Update body (`PUT /exchanges/{code}`). */
export type ExchangeRateUpdate = ExchangeRateUpdateRequest;
/** `POST /exchanges` response. */
export type ExchangeRateCreated = ExchangeRateResponse;
```

> If the list endpoints return a named paged envelope, set `CurrencyList` /
> `ExchangeRateList` to that type instead of the array.

- [ ] **Step 4: Failing service test** — `packages/sdk/tests/services/currency.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { CurrencyService } from "../../src/services/currency";
import { HttpClient } from "../../src/core/http";
import { DefaultTokenProvider } from "../../src/core/auth";
import { LevelResolver } from "../../src/core/logger";
import { EmporixNotFoundError } from "../../src/core/errors";
import { MemoryLogger } from "../helpers/memory-logger";

const server = setupServer(
  http.post("https://api.emporix.io/oauth/token", () =>
    HttpResponse.json({ access_token: "svc-tok", token_type: "Bearer", expires_in: 3599 }),
  ),
);
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function svc() {
  const cfg = {
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    cache: { expirationBufferSeconds: 60, maxLifetimeSeconds: 3600 },
  } as never;
  const tokenProvider = new DefaultTokenProvider(cfg);
  const logger = new MemoryLogger(new LevelResolver({ level: "silent" }), { service: "currency" });
  const httpClient = new HttpClient({
    host: "https://api.emporix.io",
    provider: tokenProvider,
    logger,
    retry: { maxAttempts: 1 },
    timeouts: { connectMs: 1000, readMs: 1000 },
  });
  return new CurrencyService({ tenant: "acme", http: httpClient, tokenProvider, logger });
}

const BASE = "https://api.emporix.io/currency/acme";

describe("CurrencyService", () => {
  it("listCurrencies GETs with a service token", async () => {
    let seenAuth: string | null = null;
    server.use(
      http.get(`${BASE}/currencies`, ({ request }) => {
        seenAuth = request.headers.get("authorization");
        return HttpResponse.json([{ code: "EUR" }]);
      }),
    );
    await svc().listCurrencies();
    expect(seenAuth).toBe("Bearer svc-tok");
  });

  it("getCurrency / createCurrency / updateCurrency / deleteCurrency", async () => {
    let created: unknown = null;
    let updated: unknown = null;
    server.use(
      http.get(`${BASE}/currencies/EUR`, () => HttpResponse.json({ code: "EUR" })),
      http.post(`${BASE}/currencies`, async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ code: "EUR" }, { status: 201 });
      }),
      http.put(`${BASE}/currencies/EUR`, async ({ request }) => {
        updated = await request.json();
        return HttpResponse.json({ code: "EUR" });
      }),
      http.delete(`${BASE}/currencies/EUR`, () => new HttpResponse(null, { status: 204 })),
    );
    expect((await svc().getCurrency("EUR")) as { code?: string }).toEqual({ code: "EUR" });
    await svc().createCurrency({ code: "EUR", name: "Euro" } as never);
    expect(created).toEqual({ code: "EUR", name: "Euro" });
    await svc().updateCurrency("EUR", { name: "Euro €" } as never);
    expect(updated).toEqual({ name: "Euro €" });
    await expect(svc().deleteCurrency("EUR")).resolves.toBeUndefined();
  });

  it("getCurrency throws EmporixNotFoundError on 404", async () => {
    server.use(http.get(`${BASE}/currencies/XX`, () => HttpResponse.json({ status: 404, message: "x" }, { status: 404 })));
    await expect(svc().getCurrency("XX")).rejects.toBeInstanceOf(EmporixNotFoundError);
  });

  it("exchange rates: list / get / create / update / delete", async () => {
    let created: unknown = null;
    server.use(
      http.get(`${BASE}/exchanges`, () => HttpResponse.json([{ code: "EUR-USD" }])),
      http.get(`${BASE}/exchanges/EUR-USD`, () => HttpResponse.json({ code: "EUR-USD" })),
      http.post(`${BASE}/exchanges`, async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ code: "EUR-USD" }, { status: 201 });
      }),
      http.put(`${BASE}/exchanges/EUR-USD`, () => HttpResponse.json({ code: "EUR-USD" })),
      http.delete(`${BASE}/exchanges/EUR-USD`, () => new HttpResponse(null, { status: 204 })),
    );
    await expect(svc().listExchangeRates()).resolves.toBeDefined();
    expect((await svc().getExchangeRate("EUR-USD")) as { code?: string }).toEqual({ code: "EUR-USD" });
    await svc().createExchangeRate({ code: "EUR-USD", rate: 1.1 } as never);
    expect(created).toEqual({ code: "EUR-USD", rate: 1.1 });
    await expect(svc().updateExchangeRate("EUR-USD", { rate: 1.2 } as never)).resolves.toBeDefined();
    await expect(svc().deleteExchangeRate("EUR-USD")).resolves.toBeUndefined();
  });

  it("encodeURIComponent-escapes the currency code", async () => {
    let pathname = "";
    server.use(
      http.get("https://api.emporix.io/currency/acme/currencies/*", ({ request }) => {
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({});
      }),
    );
    await svc().getCurrency("a/b");
    expect(pathname).toBe("/currency/acme/currencies/a%2Fb");
  });
});
```

> If Task 1 found create/update return 204 or a different body, adjust the mocks
> + return types. Drop `as never` if the aliased inputs accept the literals.

- [ ] **Step 5: Verify it fails** — `pnpm -F @viu/emporix-sdk exec vitest run tests/services/currency.test.ts`

- [ ] **Step 6: Write `currency.ts` + facade**

```ts
import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import type {
  Currency, CurrencyList, CurrencyInput, CurrencyUpdate, CurrencyCreated,
  ExchangeRate, ExchangeRateList, ExchangeRateInput, ExchangeRateUpdate, ExchangeRateCreated,
} from "./currency-types";

export type {
  Currency, CurrencyList, CurrencyInput, CurrencyUpdate, CurrencyCreated,
  ExchangeRate, ExchangeRateList, ExchangeRateInput, ExchangeRateUpdate, ExchangeRateCreated,
} from "./currency-types";

const SERVICE: AuthContext = { kind: "service" };

/**
 * Emporix Currency Service (`/currency/{tenant}/…`): currencies and exchange
 * rates. Server-side; defaults to the service token.
 */
export class CurrencyService {
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/currency/${this.ctx.tenant}`;
  }

  // --- Currencies ---

  /** List all currencies. */
  async listCurrencies(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<CurrencyList> {
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
  async listExchangeRates(query: Record<string, string | number> = {}, auth: AuthContext = SERVICE): Promise<ExchangeRateList> {
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
```

Facade `packages/sdk/src/currency.ts`:

```ts
export * from "./services/currency";
```

- [ ] **Step 7: Run tests + typecheck** — both currency tests + typecheck.

- [ ] **Step 8: Commit (two commits)**

```bash
git add packages/sdk/src/services/currency-types.ts packages/sdk/tests/services/currency-types.test.ts
git commit -m "feat(sdk): add currency public types"
git add packages/sdk/src/services/currency.ts packages/sdk/src/currency.ts packages/sdk/tests/services/currency.test.ts
git commit -m "feat(sdk): add currency service"
```

---

## Task 4: Wire both services onto EmporixClient

- [ ] **Step 1: Failing wiring test** — `packages/sdk/tests/services/country-currency-wiring.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { CountryService } from "../../src/services/country";
import { CurrencyService } from "../../src/services/currency";

describe("EmporixClient country/currency wiring", () => {
  it("exposes the country and currency services", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.countries).toBeInstanceOf(CountryService);
    expect(sdk.currencies).toBeInstanceOf(CurrencyService);
  });
});
```

- [ ] **Step 2: Verify it fails.**

- [ ] **Step 3a: `ServiceName`** — in `logger.ts`, after `| "label"`:

```ts
  | "country"
  | "currency"
```

- [ ] **Step 3b: `client.ts`** — imports after `LabelService`:

```ts
import { CountryService } from "./services/country";
import { CurrencyService } from "./services/currency";
```
Fields after `labels`:
```ts
  readonly countries: CountryService;
  readonly currencies: CurrencyService;
```
Construct after `this.labels = ...`:
```ts
    this.countries = new CountryService(mk("country"));
    this.currencies = new CurrencyService(mk("currency"));
```

- [ ] **Step 3c: barrel** — in `index.ts`, after `export * from "./label";`:

```ts
export * from "./country";
export * from "./currency";
```

- [ ] **Step 4: Run wiring test, full suite, typecheck, build**

```bash
pnpm -F @viu/emporix-sdk exec vitest run tests/services/country-currency-wiring.test.ts
pnpm -F @viu/emporix-sdk test
pnpm -F @viu/emporix-sdk typecheck
pnpm -F @viu/emporix-sdk build
```

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/core/logger.ts packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/tests/services/country-currency-wiring.test.ts
git commit -m "feat(sdk): expose country and currency services on the client"
```

---

## Task 5: Documentation

- [ ] **Step 1: `docs/country.md`**

````markdown
# Country Service

Bindings for the Emporix **Country Service** (`/country/{tenant}/…`): country and
region master data.

> **Server-side.** Defaults to the service token (`country.country_read` /
> `country.country_manage` / `country.region_read`); reads also work with an
> anonymous token. Countries are predefined — list/get/patch only (no create/delete).

```ts
const countries = await client.countries.listCountries();
const de = await client.countries.getCountry("DE");
await client.countries.patchCountry("DE", { active: true });
const regions = await client.countries.listRegions();
const region = await client.countries.getRegion("DE-BY");
```
````

- [ ] **Step 2: `docs/currency.md`**

````markdown
# Currency Service

Bindings for the Emporix **Currency Service** (`/currency/{tenant}/…`): currencies
and exchange rates.

> **Server-side.** Defaults to the service token (`currency.currency_read` /
> `currency.currency_manage`).

```ts
// currencies
const currencies = await client.currencies.listCurrencies();
const eur = await client.currencies.getCurrency("EUR");
await client.currencies.createCurrency({ code: "EUR", /* … */ });
await client.currencies.updateCurrency("EUR", { /* … */ });
await client.currencies.deleteCurrency("EUR");

// exchange rates
const rates = await client.currencies.listExchangeRates();
const rate = await client.currencies.getExchangeRate("EUR-USD");
await client.currencies.createExchangeRate({ /* … */ });
await client.currencies.updateExchangeRate("EUR-USD", { /* … */ });
await client.currencies.deleteExchangeRate("EUR-USD");
```
````

- [ ] **Step 3: CLAUDE.md** — append `Country, Currency` to the service list:

```
…, RewardPoints, Brand, Label, Country, Currency) | yes (`@viu/emporix-sdk`) |
```

- [ ] **Step 4: Commit**

```bash
git add docs/country.md docs/currency.md CLAUDE.md
git commit -m "docs(sdk): document the country and currency services"
```

---

## Task 6: Changeset

- [ ] **Step 1: `.changeset/country-currency-services.md`**

```markdown
---
"@viu/emporix-sdk": minor
---

Add Emporix Country and Currency Service bindings via `client.countries`
(countries + regions: `listCountries`/`getCountry`/`patchCountry`/`listRegions`/
`getRegion`) and `client.currencies` (currencies + exchange rates: full CRUD on
both). Server-side only — these use the service (clientCredentials) token.
```

- [ ] **Step 2: Verify** — `pnpm changeset status` (the new changeset adds `@viu/emporix-sdk`).

- [ ] **Step 3: Commit**

```bash
git add .changeset/country-currency-services.md
git commit -m "chore(release): add country and currency services changeset"
```

---

## Final verification (after all tasks)

```bash
pnpm -F @viu/emporix-sdk test && pnpm -F @viu/emporix-sdk typecheck && pnpm -F @viu/emporix-sdk lint
pnpm -F @viu/emporix-sdk build
```
All expected to pass.

---

## Self-Review (performed while writing)

- **Spec coverage:** D1 full coverage → Country 5 methods (no create/delete), Currency 10 methods (currencies + exchange rates) in Tasks 2/3 + tests. D2 two services one branch → Tasks 2/3 + wiring Task 4. D3 no React → no React tasks. D4 service-token default → `const SERVICE` per method. D5 codegen + aliasing → Task 1 + 2/3. Standard tenant base paths `/country/${tenant}`, `/currency/${tenant}` asserted in tests. Docs/changeset → Tasks 5/6 (sdk only). No gaps.
- **Placeholder scan:** No TBD/TODO. Every code step has full code. Upstream-dependent uncertainties (generated names, list-envelope vs array, create/update/delete response codes) are concrete `grep`/note verifications with fallbacks.
- **Type consistency:** Public names `Country`/`CountryList`/`CountryUpdate`/`Region`/`RegionList` and `Currency`/`CurrencyList`/`CurrencyInput`/`CurrencyUpdate`/`CurrencyCreated`/`ExchangeRate`/`ExchangeRateList`/`ExchangeRateInput`/`ExchangeRateUpdate`/`ExchangeRateCreated` are identical across Tasks 2/3 (defs), the services (imports + re-exports), and the tests. Method names match across services, the wiring test, and the docs. Loggers `"country"`/`"currency"` match `mk(...)` and the `ServiceName` additions. Commit scopes are `sdk`/`release` with lowercase verbs (commitlint-safe).
```
