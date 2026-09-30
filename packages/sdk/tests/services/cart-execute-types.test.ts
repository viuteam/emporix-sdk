import { describe, it, expectTypeOf } from "vitest";
import type { CartCommand, CartItemInput, CartItemUpdate } from "../../src/services/cart";

const item = {} as CartItemInput;
const update = {} as CartItemUpdate;

describe("CartCommand", () => {
  it("types each command's body from its REST operation", () => {
    const chain: CartCommand[] = [
      { type: "AddCartItem", data: item },
      { type: "UpdateCartItem", data: update, options: { itemId: "1", partial: true } },
      { type: "AddCartItemsBatch", data: [item] },
      { type: "ApplyCartDiscount", data: { code: "SAVE10" } },
      { type: "DeleteCartItem", options: { itemId: "1" } },
      { type: "GetCart", options: { expandCalculation: false, zipCode: "8001", countryCode: "CH" } },
      { type: "DeleteCartDiscounts", options: { codes: ["SAVE10"] } },
      { type: "RefreshCart" },
    ];
    expectTypeOf(chain).toEqualTypeOf<CartCommand[]>();
  });

  it("rejects what the server would reject", () => {
    // @ts-expect-error unknown command type
    const unknownType: CartCommand = { type: "CreateCart" };
    // @ts-expect-error AddCartItem carries its item body
    const missingBody: CartCommand = { type: "AddCartItem" };
    // @ts-expect-error AddCartItem takes one item; AddCartItemsBatch takes the array
    const arrayBody: CartCommand = { type: "AddCartItem", data: [item] };
    // @ts-expect-error not an option of any command
    const unknownOption: CartCommand = { type: "GetCart", options: { foo: true } };
    // @ts-expect-error a discount body needs its code
    const discountWithoutCode: CartCommand = { type: "ApplyCartDiscount", data: { name: "x" } };
    expectTypeOf([unknownType, missingBody, arrayBody, unknownOption, discountWithoutCode]).toBeArray();
  });

  it("narrows data by type", () => {
    const body = (c: CartCommand) => (c.type === "AddCartItem" ? c.data : undefined);
    expectTypeOf(body).returns.toEqualTypeOf<CartItemInput | undefined>();
  });
});
