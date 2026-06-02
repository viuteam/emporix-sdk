import { describe, it, expect } from "vitest";
import { EmporixClient } from "../../src/client";
import { ApprovalService } from "../../src/services/approval";

function client() {
  return new EmporixClient({
    tenant: "acme",
    host: "https://api.emporix.io",
    credentials: { backend: { clientId: "b", secret: "s" }, storefront: { clientId: "sf" } },
    logger: false,
  } as never);
}

describe("approval wiring", () => {
  it("exposes client.approvals as an ApprovalService", () => {
    expect(client().approvals).toBeInstanceOf(ApprovalService);
  });

  it("accepts the 'approval' logger service name", () => {
    expect(() => client().getLogLevel("approval")).not.toThrow();
  });
});
