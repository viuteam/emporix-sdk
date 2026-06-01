import { describe, it, expectTypeOf } from "vitest";
import type {
  WebhookSubscription,
  WebhookSubscriptionUpdateItem,
  WebhookSubscriptionUpdateResultItem,
  WebhookConfig,
  WebhookConfigDraft,
  WebhookConfigCreated,
  WebhookStatisticsQuery,
  DeleteConfigOptions,
} from "../../src/services/webhook-types";

describe("webhook types", () => {
  it("WebhookSubscriptionUpdateItem requires eventType", () => {
    const item: WebhookSubscriptionUpdateItem = { eventType: "product.created", action: "SUBSCRIBE" };
    expectTypeOf(item.eventType).toEqualTypeOf<string>();
  });

  it("WebhookSubscriptionUpdateResultItem carries a per-item status (optional upstream)", () => {
    const r = { eventType: "product.created", code: 200, status: "OK" } as WebhookSubscriptionUpdateResultItem;
    expectTypeOf(r.eventType).toEqualTypeOf<string | undefined>();
    expectTypeOf(r.code).toEqualTypeOf<number | undefined>();
  });

  it("WebhookConfigCreated is { code }", () => {
    const c: WebhookConfigCreated = { code: "cfg_1" };
    expectTypeOf(c.code).toEqualTypeOf<string>();
  });

  it("WebhookStatisticsQuery fields are optional YYYY-MM strings", () => {
    const q: WebhookStatisticsQuery = { fromYearMonth: "2026-01" };
    expectTypeOf(q.fromYearMonth).toEqualTypeOf<string | undefined>();
    expectTypeOf(q.toYearMonth).toEqualTypeOf<string | undefined>();
  });

  it("DeleteConfigOptions.force is an optional boolean", () => {
    const o: DeleteConfigOptions = { force: true };
    expectTypeOf(o.force).toEqualTypeOf<boolean | undefined>();
  });

  it("WebhookSubscription / WebhookConfig / WebhookConfigDraft are exported", () => {
    expectTypeOf<WebhookSubscription>().not.toBeNever();
    expectTypeOf<WebhookConfig>().not.toBeNever();
    expectTypeOf<WebhookConfigDraft>().not.toBeNever();
  });
});
