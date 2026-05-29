import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { TenantConfigService } from "../../src/services/tenant-config";
import { ClientConfigService } from "../../src/services/client-config";

describe("EmporixClient configuration wiring", () => {
  it("exposes tenantConfig and clientConfig services", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.tenantConfig).toBeInstanceOf(TenantConfigService);
    expect(sdk.clientConfig).toBeInstanceOf(ClientConfigService);
  });
});
