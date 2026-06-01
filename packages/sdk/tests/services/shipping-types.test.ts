import { describe, it, expectTypeOf } from "vitest";
import type {
  Site,
  SiteList,
  FindSiteInput,
  Zone,
  ZoneList,
  ShippingMethod,
  ShippingMethodList,
  ShippingGroup,
  ShippingGroupList,
  CgRelation,
  CgRelationList,
  QuoteInput,
  QuoteResult,
  QuoteSlotInput,
  MinimumFee,
  ResourceCreated,
} from "../../src/services/shipping-types";

describe("shipping types", () => {
  it("all Phase-1 types are usable", () => {
    expectTypeOf<Site>().not.toBeNever();
    expectTypeOf<SiteList>().not.toBeNever();
    expectTypeOf<FindSiteInput>().not.toBeNever();
    expectTypeOf<Zone>().not.toBeNever();
    expectTypeOf<ZoneList>().not.toBeNever();
    expectTypeOf<ShippingMethod>().not.toBeNever();
    expectTypeOf<ShippingMethodList>().not.toBeNever();
    expectTypeOf<ShippingGroup>().not.toBeNever();
    expectTypeOf<ShippingGroupList>().not.toBeNever();
    expectTypeOf<CgRelation>().not.toBeNever();
    expectTypeOf<CgRelationList>().not.toBeNever();
    expectTypeOf<QuoteInput>().not.toBeNever();
    expectTypeOf<QuoteResult>().not.toBeNever();
    expectTypeOf<QuoteSlotInput>().not.toBeNever();
    expectTypeOf<MinimumFee>().not.toBeNever();
    expectTypeOf<ResourceCreated>().not.toBeNever();
  });
});
