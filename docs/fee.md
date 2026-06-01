# Fee Service

Bindings for the Emporix **Fee Service** (`/fee/{tenant}/…`): fee definitions
plus the `itemFees` / `productFees` mappings that attach them to catalog items.

> **Server-side only.** Writes require the backend `fee.fee_*` / `fee.item_*`
> scopes and GETs require a valid token, all served by the **service
> (clientCredentials) token**. Never construct these calls from a browser — the
> admin token must not be exposed. Use them in Node, Next.js route handlers /
> server actions, or other trusted backends.

## Fee definitions — `client.fees`

```ts
// list (paginated, server defaults pageNumber:1 / pageSize:60)
const page = await client.fees.list({ pageSize: 100, q: "siteCode:main" });
page.items;        // Fee[]
page.hasNextPage;  // true when the page was full

// get / create / update / delete
const fee = await client.fees.get("fee_1");
await client.fees.create({
  name: { en: "Small order fee" },
  code: "small-order",
  feeType: "PERCENT",
  feePercentage: 2.5,
  siteCode: "main",
  active: true,
});
await client.fees.update("fee_1", { /* full FeeDraft */ } as never);
await client.fees.delete("fee_1");
```

`feeType` selects the amount field: `PERCENT` → `feePercentage`; `ABSOLUTE` /
`ABSOLUTE_MULTIPLY_ITEMQUANTITY` → `feeAbsolute: { amount, currency }`. Set
`taxCode` whenever `taxable` is true. For a `PAYMENTTYPE` fee, `code` **must
equal the payment-mode code** or the fee is silently ignored.

## Item-fee mappings

```ts
const all = await client.fees.listItemFees();
const forItem = await client.fees.getItemFees("urn:yaas:…:product:p1");
await client.fees.createItemFee({ itemYrn: "urn:…:p1", feeIds: ["fee_1"], siteCode: "main" });

// set replaces the whole list by default; pass { partial: true } to merge
await client.fees.setItemFees("urn:…:p1", ["fee_1", "fee_2"]);
await client.fees.setItemFees("urn:…:p1", ["fee_3"], { partial: true });

// delete all mappings for the YRN, or one fee from it
await client.fees.deleteItemFees("urn:…:p1");
await client.fees.deleteItemFees("urn:…:p1", "fee_1");

// search by YRNs + site
const found = await client.fees.searchItemFees({ itemYrns: ["urn:…:p1"], siteCode: "main" });
```

## Product-fee mappings

```ts
const fees = await client.fees.getProductFees("p1");
await client.fees.setProductFees("p1", ["fee_1"]);           // destructive replace
await client.fees.setProductFees("p1", ["fee_2"], { partial: true });
await client.fees.deleteProductFees("p1");
```

## Quirks to know

- **Silent `siteCode` filtering:** a wrong or missing `siteCode` yields an empty
  array, not an error.
- **Destructive `set`:** `setItemFees` / `setProductFees` replace the entire fee
  list unless `partial: true`.
- **Expiry:** an `activeTimespan` whose `endDate` has passed silently disables
  the fee.

## Overriding the token

All methods take an optional trailing `auth` argument (default: the `"backend"`
service credential set). Pass `auth.service("other-set")` to use a different
configured credential set, or `auth.raw(token)` for a pre-obtained token.

## Out of scope

`POST /itemFees/searchByProductId` and `/itemFees/searchByProductIds` are not
bound — use `searchItemFees` (by YRN) instead. No React hooks; the admin token
must stay server-side.
