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
