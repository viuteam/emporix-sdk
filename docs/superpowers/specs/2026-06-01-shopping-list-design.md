# Shopping List — Design

- **Date:** 2026-06-01
- **Status:** Approved (design); pending implementation plan
- **Packages:** `@viu/emporix-sdk` + `@viu/emporix-sdk-react`
- **Branch:** `feat/shopping-list`
- **Part of:** the 7-service rollout — sub-project #1 of 7 (the only one with React hooks).

## 1. Context & motivation

The Emporix **Shopping List Service** manages named, per-customer shopping
lists (CRUD, mixin-capable). It is the only one of the 7 newly-requested
services that is genuinely storefront/customer-facing — a logged-in customer
manages their **own** lists with their customer token (no OAuth scope needed),
so it warrants both an SDK binding and React hooks.

### Verified API facts (via Emporix docs)
- **Base path:** `/shoppinglist/{tenant}/shopping-lists` (prefix `shoppinglist`, resource `shopping-lists`).
- **Endpoints:**
  - `GET /shopping-lists` (`?name`) — the caller's own lists (customerId resolved from token); employee+scope gets all.
  - `POST /shopping-lists` — create; returns `{ id }`.
  - `GET /shopping-lists/{customerId}` — employee-only (403 for a customer token on someone else).
  - `PUT /shopping-lists/{customerId}` — replace (customer: own only).
  - `DELETE /shopping-lists/{customerId}` (`?name`) — delete; without `name` deletes **all** the customer's lists.
- **No item-level CRUD** — items change via a full `PUT`; remove an item via `quantity: 0` or by omitting it.
- **No pagination** — only the `name` filter.
- **Dual auth:** `CustomerAccessToken` (customer manages own, no scope) OR `clientCredentials` with `shoppinglist.shoppinglist_read` / `_manage` / `_delete`.
- **Awkward wire shape:** the GET response is an object (`customerId` + dynamic list keys + a deprecated top-level `metadata`), not an array.
- **Spec URL (verified):** `checkout/shopping-list/api-reference/api.yml`.

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| D1 | SDK surface | Low-level (`list`/`create`/`replace`/`delete`) **+ item helpers** (`addItem`/`removeItem`/`setItemQuantity`) via read-modify-write, **last-write-wins** (no version locking). |
| D2 | Response normalization | The SDK normalizes the wire map into a clean `ShoppingList[]` (each with a `key`). Consumers never see the raw map. |
| D3 | Auth | `auth: AuthContext` is a **required** parameter (no default) — like `LocationsService`. Customer token = own lists; service token = any customer. |
| D4 | React | Customer-only hooks (`useCustomerOnlyCtx`). The list query needs no `customerId` (token-resolved); write/item mutations receive `customerId` as a **mutation variable** (storage holds only the token, not the id). Stale-time 30s; mutations invalidate the lists query. |
| D5 | Concurrency | Last-write-wins. No optimistic `metadata.version` handling (YAGNI for per-customer lists). |

## 3. SDK surface (`packages/sdk/src/services/shopping-list.ts`)

```ts
export interface ShoppingListItem {
  id?: number;                 // server-assigned
  productId: string;
  quantity: number;
  cuttingOption?: string;
  servicePackagingOption?: string;
  comment?: string;
  mixins?: Record<string, unknown>;
}

export interface ShoppingList {
  key: string;                 // the list's key in the response map
  name: string;
  items: ShoppingListItem[];
  mixins?: Record<string, unknown>;
  metadata?: { createdAt?: unknown; modifiedAt?: unknown; version?: number };
}

export interface ShoppingListDraft {
  name: string;
  items?: ShoppingListItem[];
  mixins?: Record<string, unknown>;
}

class ShoppingListService {
  // reads/writes (auth required)
  list(auth: AuthContext, opts?: { name?: string }): Promise<ShoppingList[]>;   // GET, normalize map → array
  create(draft: ShoppingListDraft, auth: AuthContext): Promise<{ id: string }>; // POST
  replace(customerId: string, draft: ShoppingListDraft, auth: AuthContext): Promise<void>; // PUT
  delete(customerId: string, auth: AuthContext, opts?: { name?: string }): Promise<void>;  // DELETE

  // item helpers — read-modify-write, last-write-wins
  addItem(customerId: string, listName: string, item: ShoppingListItem, auth: AuthContext): Promise<void>;
  removeItem(customerId: string, listName: string, productId: string, auth: AuthContext): Promise<void>;
  setItemQuantity(customerId: string, listName: string, productId: string, quantity: number, auth: AuthContext): Promise<void>;
}
```

- `list` reads the wire map and emits `ShoppingList[]` (skipping the `customerId` and deprecated top-level `metadata` keys).
- Item helpers: `list({name})` → locate the target list → mutate `items` (add / drop / set quantity; `quantity:0` drops) → `replace(...)`. Throws `EmporixNotFoundError` if the named list doesn't exist.
- Wired on the client as `client.shoppingLists`; logger `ServiceName` gains `"shopping-list"`.

## 4. React hooks (`packages/react/src/hooks/use-shopping-lists.ts`)

Customer-only (`useCustomerOnlyCtx`); `customerId` from the session/profile. Key convention `emporixKey("shopping-lists", [...], { tenant, authKind, siteCode })`.

- `useShoppingLists(opts?: { name?: string }): UseQueryResult<ShoppingList[]>` — stale-time 30s.
- `useCreateShoppingList()` — mutation → `create`.
- `useDeleteShoppingList()` — mutation → `delete`.
- `useAddToShoppingList()` / `useRemoveFromShoppingList()` / `useSetShoppingListItemQuantity()` — mutations → item helpers.
- All mutations `invalidateQueries` the `"shopping-lists"` key on success.

## 5. Testing

**SDK** (`packages/sdk/tests/services/shopping-list.test.ts`):
- `list` normalizes the wire map → `ShoppingList[]` (correct `key`/`name`/`items`; `customerId`/top-level `metadata` excluded).
- `create` POSTs the draft, returns `{ id }`.
- `addItem` / `removeItem` / `setItemQuantity` perform GET-then-PUT with the expected mutated body.
- `delete` with and without `name`.
- Authorization header carries the supplied customer token.

**React** (`packages/react/tests/use-shopping-lists.test.tsx`):
- `useShoppingLists` returns the normalized lists (customer token from storage).
- A mutation (e.g. `useAddToShoppingList`) invalidates and refetches the lists query.

## 6. Wire shapes (resolved from `api.yml`)

- **POST** `/shopping-lists` body (own) = `{ name, items? }` → response `{ id }`.
- **GET** `/shopping-lists` (`?name`) response = array of per-customer envelopes
  `[{ customerId, <listName>: { name, items, mixins?, metadata? } }]` → SDK normalizes to `ShoppingList[]` (one entry per list-name key, `key` = that name).
- **PUT** `/shopping-lists/{customerId}` body = a single list `{ name, items, mixins? }` (replaces the list identified by `name`).
- **DELETE** `/shopping-lists/{customerId}` (`?name`; no `name` → all the customer's lists).
- **`customerId` in React:** caller-supplied via mutation variables (storage exposes only the token).
- Codegen still confirms exact generated type names; the thin public types in §3 absorb any naming differences.

## 7. Out of scope (YAGNI)

- Pagination (the API has none).
- Optimistic version locking (D5 — last-write-wins).
- Employee/admin bulk flows beyond passing a service `AuthContext`.

## 8. File-by-file change list

| File | Change |
|---|---|
| `packages/sdk/scripts/fetch-specs.ts` | add `shopping-list` spec entry |
| `packages/sdk/src/generated/shopping-list/**` | generated (committed) |
| `packages/sdk/src/services/shopping-list.ts` | new service + types |
| `packages/sdk/src/shopping-list.ts` | re-export |
| `packages/sdk/src/core/logger.ts` | add `"shopping-list"` to `ServiceName` |
| `packages/sdk/src/client.ts` | wire `shoppingLists` |
| `packages/sdk/src/index.ts` | re-export |
| `packages/sdk/tests/services/shopping-list.test.ts` | SDK tests |
| `packages/react/src/hooks/use-shopping-lists.ts` | React hooks |
| `packages/react/src/hooks/index.ts`, `packages/react/src/index.ts` | export hooks |
| `packages/react/tests/use-shopping-lists.test.tsx` | React tests |
| `docs/shopping-list.md` | usage doc |
| `.changeset/shopping-list.md` | minor for both packages |
