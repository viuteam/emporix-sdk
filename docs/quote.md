# Quote Service

Bindings for the Emporix **Quote Service** (`/quote/{tenant}/…`): B2B quotes
(CRUD, PDF, history) and quote reasons.

> **Auth is required on every method.** Quotes are customer-owned and never
> accept an anonymous context, so — unlike most SDK services — the trailing
> `auth` argument has **no default**. Pass:
> - `auth.customer(token)` — a logged-in customer acting on their **own** quotes
>   (`quote.quote_read_own` / `quote.quote_manage_own`);
> - `auth.service()` (or an admin token) — for `quote.quote_manage`-scoped
>   operations: `delete`, and every quote-reason mutation.
>
> There is no ambient customer token in the SDK core; supply it per call. (A
> future React binding could auto-resolve the stored customer token.)

## Quotes — `client.quotes`

```ts
import { auth } from "@viu/emporix-sdk";

const token = /* the customer's bearer token */;

// list (paginated; optional q / sort). Pass {} for no filter.
const page = await client.quotes.list({ q: "state:OPEN", sort: "createdAt:desc" }, auth.customer(token));
for (const q of page.items) console.log(q.id, q.businessModel);

// create — from scratch or from a cart
const { id } = await client.quotes.create(
  { customerId: "cust-1" /* … QuoteCreateRequest | QuoteCreateFromCartRequest */ },
  auth.customer(token),
);

// get one
const quote = await client.quotes.get(id!, auth.customer(token));

// update — the upstream update-op array (204, resolves void)
await client.quotes.update(id!, [{ op: "status", value: "APPROVED" }] as never, auth.customer(token));

// change history
const history = await client.quotes.history(id!, auth.customer(token));

// delete — needs the admin quote_manage scope
await client.quotes.delete(id!, auth.service());
```

### PDF

`generatePdf` returns the raw PDF bytes as a `Blob` (it uses the raw-response
path; a non-2xx throws the usual typed `EmporixError`).

```ts
const pdf = await client.quotes.generatePdf(id!, auth.customer(token)); // Blob
```

## Quote reasons — `client.quotes.reasons`

Configuration data. Reads accept a customer or admin token; `create` / `update`
/ `delete` need the admin `quote_manage` scope.

```ts
const reasons = await client.quotes.reasons.list({}, auth.service());

const { id: reasonId } = await client.quotes.reasons.create(
  { type: "DECLINE", code: "OUT_OF_STOCK", message: { en: "Out of stock" } },
  auth.service(),
);

// update requires metadata.version (optimistic locking); 204 → void
await client.quotes.reasons.update(
  reasonId!,
  { type: "DECLINE", code: "OUT_OF_STOCK", message: { en: "Sold out" }, metadata: { version: 0 } },
  auth.service(),
);

await client.quotes.reasons.delete(reasonId!, auth.service());
```
