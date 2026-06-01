import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { ShoppingListService } from "../../src/services/shopping-list";

describe("EmporixClient shopping list wiring", () => {
  it("exposes shoppingLists", () => {
    const sdk = new EmporixClient({
      tenant: "acme",
      credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
      logger: false,
    });
    expect(sdk.shoppingLists).toBeInstanceOf(ShoppingListService);
  });
});
