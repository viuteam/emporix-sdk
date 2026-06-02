import { describe, it, expectTypeOf } from "vitest";
import type {
  AdminCustomer,
  AdminCustomerList,
  AdminCustomerInput,
  AdminCustomerUpdate,
  AdminCustomerPatch,
  AdminCustomerCreated,
  AdminCustomerAddress,
  AdminCustomerAddressList,
  AdminCustomerAddressInput,
  AdminCustomerAddressUpdate,
} from "../../src/services/customer-admin-types";

describe("customer-admin types", () => {
  it("types are usable", () => {
    expectTypeOf<AdminCustomer>().not.toBeNever();
    expectTypeOf<AdminCustomerList>().toBeArray();
    expectTypeOf<AdminCustomerInput>().not.toBeNever();
    expectTypeOf<AdminCustomerUpdate>().not.toBeNever();
    expectTypeOf<AdminCustomerPatch>().not.toBeNever();
    expectTypeOf<AdminCustomerCreated>().not.toBeNever();
    expectTypeOf<AdminCustomerAddress>().not.toBeNever();
    expectTypeOf<AdminCustomerAddressList>().toBeArray();
    expectTypeOf<AdminCustomerAddressInput>().not.toBeNever();
    expectTypeOf<AdminCustomerAddressUpdate>().not.toBeNever();
  });
});
