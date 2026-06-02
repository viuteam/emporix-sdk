import { describe, it, expectTypeOf } from "vitest";
import type {
  PickOrder,
  PickOrderList,
  Assignee,
  PackingEvent,
  PackingEventList,
  OrderCycleList,
  OrderStatusChange,
  RecalculationJobInput,
  RecalculationJob,
  PickPackAck,
  RecalculationJobCreated,
} from "../../src/services/pick-pack-types";

describe("pick-pack types", () => {
  it("types are usable", () => {
    expectTypeOf<PickOrder>().not.toBeNever();
    expectTypeOf<PickOrderList>().toBeArray();
    expectTypeOf<Assignee>().not.toBeNever();
    expectTypeOf<PackingEvent>().not.toBeNever();
    expectTypeOf<PackingEventList>().toBeArray();
    expectTypeOf<OrderCycleList>().toBeArray();
    expectTypeOf<OrderStatusChange>().not.toBeNever();
    expectTypeOf<RecalculationJobInput>().not.toBeNever();
    expectTypeOf<RecalculationJob>().not.toBeNever();
    const ack = { message: "ok" } as PickPackAck;
    expectTypeOf(ack.code).toEqualTypeOf<number | undefined>();
    const created = { jobId: "j1" } as RecalculationJobCreated;
    expectTypeOf(created.jobId).toEqualTypeOf<string | undefined>();
  });
});
