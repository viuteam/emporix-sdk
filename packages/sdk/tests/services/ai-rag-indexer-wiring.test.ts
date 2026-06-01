import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { RagIndexerService } from "../../src/services/ai-rag-indexer";

describe("EmporixClient ai rag indexer wiring", () => {
  it("exposes the ragIndexer service", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.ragIndexer).toBeInstanceOf(RagIndexerService);
  });
});
