# Cart command chain: `carts.execute`, `useCartCommands`, `injectCartMutations().execute`

**Status:** design, not implemented.
**Scope:** one new method on `CartService` in `packages/sdk`, one new hook in
`packages/react`, one new member of the Angular cart mutation bundle, docs. It
depends on the Emporix API sync that vendors the endpoint; that sync is the
bot's job, not part of this change.

## Upstream

- Emporix changelog, 2026-09-30:
  [Cart Service – command chain endpoint for cart operations](https://developer.emporix.io/changelog#cart-service-command-chain-endpoint-for-cart-operations).
- Spec: `emporix/api-references`, `checkout/cart/api-reference/api.yml`, ticket
  COP-6488 (`emporix/api-references#524` and follow-up commits up to 2026-09-30).

`POST /cart/{tenant}/carts/{cartId}/execute` (operationId `POST-cart-execute`)
runs up to ten existing cart operations on one cart, in order, in one request:

| Part | Content |
|---|---|
| Body | `{ commands }`, 1–10 entries. Each has a `type` (14 values: `AddCartItem`, `UpdateCartItem`, `DeleteCartItem`, `DeleteCartItems`, `GetCart`, `AddCartItemsBatch`, `UpdateCartItemsBatch`, `UpdateCart`, `ApplyCartDiscount`, `GetCartDiscounts`, `DeleteCartDiscounts`, `DeleteCartDiscount`, `RefreshCart`, `ValidateCart`), an optional `data` (the equivalent REST request body) and optional `options` (the remaining path and query parameters: `itemId`, `partial`, `expandCalculation`, `zipCode`, `countryCode`, `resourceVersion`, `codes`, `discountIndex`) |
| Query | `onError`: `fail` (default, stop after the first non-2xx command) or `resume` (run every command). `versioning`: `skip` (default), `explicit` (every participating write sends `options.resourceVersion`, checked before anything runs) or `follow` (seed from the first participating write) |
| Headers | `session-id`, `legal-entity-id`, optional, shared by every command |
| `207` | `{ results: [{ index, type, code, status, data?, headers? }] }` for all-2xx chains **and** partial failures. `data` is the REST response body of the equivalent operation, or its REST error body (`code`, `status`, `message`); absent for a 204. `headers` carries `hybris-resource-version` when a write applied If-Match |
| `400` | the whole request is invalid (empty, more than 10 commands, unknown type, bad `onError`/`versioning`, missing `resourceVersion` under `explicit`) — **no command ran** |
| Security | a customer token, or OAuth2 `cart.cart_manage`; `cart.cart_manage_external_prices` when a command carries an external price, product, fee or discount |

The request takes about as long as its commands together. Emporix says so
explicitly and asks clients and gateways to size their timeouts for the whole
chain. The typical storefront chain is `AddCartItem` then `GetCart`: the
calculated cart comes back with the write.

## Where the repo stands (measured 2026-09-30)

- The bot's sync [#356](https://github.com/viuteam/emporix-sdk/pull/356) fetched
  at 12:25 UTC and saw `ai-service` and `site-settings-service` only; the cart
  change landed upstream afterwards. `packages/sdk/specs/cart.yml` does not
  contain the endpoint yet.
- Upstream versus vendored `cart.yml`: **+482 lines and nothing else** — one tag,
  one path, five schemas (`executeRequest`, `executeCommand`,
  `executeCommandOptions`, `executeResponse`, `executeCommandResult`). No
  `scripts/spec-patches.ts` entry concerns cart.
- `node .claude/skills/emporix-api-sync/scripts/coverage.mjs --spec cart`:
  24 live / 24 covered today; after the sync 25 live / 24 covered / 1 missing.
- Running `@hey-api/openapi-ts` on the upstream file yields `ExecuteRequest`,
  `ExecuteCommand`, `ExecuteCommandOptions`, `ExecuteResponse`,
  `ExecuteCommandResult` and `PostCartExecuteData`; `Discount` (the
  `POST …/discounts` body) and `CreatedCartItem` exist already.

## Why React needs a hook, not only the SDK method

The REST item writes do not return the cart. Per the generated types,
`POST …/items` answers `201 CreatedCartItem` (`{ itemId, yrn }`) and
`PUT …/items/{itemId}`, `DELETE …/items/{itemId}` and `DELETE …/items` answer
`204`; the execute examples in the spec show the same bodies. `useCartMutations`
therefore invalidates after most writes, and every item change costs two
requests: the write and the refetch.

A chain ending in `GetCart` returns the fresh cart in the same response, but only
code that knows the `useCart` cache key can put it there — and that key is
internal. A storefront calling `client.carts.execute` itself saves nothing,
because `useCart` still refetches. So the saving reaches React users only
through a hook.

Aside, out of scope: `CartService.addItem`, `updateItem`, `removeItem` and
`clear` are typed `Promise<Cart>`, which the spec contradicts. Fixing the return
types is a breaking change and belongs in its own major.

## Design

### SDK — `CartService.execute`

In `packages/sdk/src/services/cart.ts`, next to the existing aliases:

```ts
/** Body for applying a discount (`POST /carts/{id}/discounts`, generated). */
export type CartDiscountInput = Discount;

/**
 * Request body per command type of `execute`. The spec states this only in
 * prose (`data` is an untyped object there), so it is the one hand-written
 * piece. A command type missing here keeps the spec's untyped `data`.
 */
export interface CartCommandBodies {
  AddCartItem: CartItemInput;
  UpdateCartItem: CartItemUpdate;
  AddCartItemsBatch: CartItemInput[];
  UpdateCartItemsBatch: CartItemsBatchUpdateInput;
  UpdateCart: CartUpdateInput;
  ApplyCartDiscount: CartDiscountInput;
}

/** One command of an `execute` chain. */
export type CartCommand = {
  [T in ExecuteCommand["type"]]: Omit<ExecuteCommand, "type" | "data"> & { type: T } &
    (T extends keyof CartCommandBodies ? { data: CartCommandBodies[T] } : Pick<ExecuteCommand, "data">);
}[ExecuteCommand["type"]];

/** `onError` and `versioning` — both query parameters (generated). */
export type CartExecuteOptions = NonNullable<PostCartExecuteData["query"]>;
/** The `207` body: one result per command that ran, in order (generated). */
export type CartExecuteResult = ExecuteResponse;
/** One entry of `CartExecuteResult.results` (generated). */
export type CartCommandResult = ExecuteCommandResult;
```

Why the command type is derived and not written out: the generator already
provides the 14 names as a literal union. Deriving from it means a command type
Emporix adds later is usable right after the next sync — with the untyped
`data` until someone maps its body — and nothing drifts. What the generator
cannot provide is which type takes which body, so that mapping (six entries) is
hand-written. `options` stays the generated `ExecuteCommandOptions`, where every
field is optional: `itemId` and `discountIndex` are not type-enforced, and the
server reports a missing one on that command.

A scratch compile against the generated types, with the repo's compiler options
(`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), accepts
valid chains and rejects an unknown type, a missing body, an array where a single
item is expected, an unknown option and a discount without `code`; narrowing on
`type` yields the typed body.

The method:

```ts
async execute(
  cartId: string,
  commands: CartCommand[],
  auth: AuthContext,
  opts: CartExecuteOptions = {},
): Promise<CartExecuteResult>
```

1. **`onError` and `versioning` go into the query string**, the body is
   `{ commands }` only. The spec declares both `in: query`; sending them in the
   body is how nineteen search methods silently lost their paging (#350, #352).
2. **`encodeURIComponent(cartId)`**, per the facade standard for new code. The
   older cart methods lack it and stay as they are.
3. **Failures.** Unless `opts.onError` is `"resume"`, the first result whose
   `code` is not 2xx is thrown as `errorFromResponse(code, message, data)`: the
   same error class and body the equivalent REST call would have produced — so
   a 404 is an `EmporixNotFoundError` and a 403 with a missing-scope hint is an
   `EmporixInsufficientScopeError`. The message names the command's index and
   type. The commands before it have been applied, and the JSDoc says so. With
   `"resume"` the method resolves with every result; callers check `code`.
   - This deliberately differs from `addItemsBatch`, which never throws: a batch
     has no fail-fast mode, whereas `fail` is the server's own statement that
     the chain failed. Resolving would let a hook report success for a failed
     add-to-cart.
   - The thrown error does not carry the earlier results. A caller who needs
     them uses `"resume"`.
4. **Never retried.** `HttpClient` treats POST as non-idempotent; the call must
   not set `idempotent: true`, since a replay would apply the writes twice.
5. **`auth` is forwarded unguarded**, like `update` and `delete` and unlike the
   `requireCartAuth` storefront methods: the spec accepts a service token with
   `cart.cart_manage`, and the server enforces the scope. `auth` stays a
   required parameter without a default, as on every cart method.
6. **Left out:** the `session-id` and `legal-entity-id` headers (the SDK's REST
   cart calls send neither); a client-side 1–10 check (the server answers
   `400`); a per-call timeout (the JSDoc points at the client's
   `timeouts.readMs`); a fluent builder, which has no precedent in the SDK.

### React — `useCartCommands(cartId?)`

In `packages/react/src/hooks/use-cart.ts`:

```ts
export interface CartCommandsVars extends CartExecuteOptions {
  commands: CartCommand[];
}

export function useCartCommands(
  cartId?: string,
): UseMutationResult<CartExecuteResult, unknown, CartCommandsVars, { key: readonly unknown[] }>
```

- **Target resolution is shared with `useCartMutations`.** Its `resolveId` and
  `keyFor` move into an internal `useCartWriteTarget(cartId, hook)` returning
  `{ ctx, resolveId, keyFor }`, so both hooks provably hit the entry `useCart`
  reads. The id is resolved at mutate time; with none it throws
  `EmporixError("<hook>: no cartId available — …")`. `useCartMutations` keeps
  its behaviour and its error message.
- **`onMutate`** resolves the key and cancels in-flight queries for it, so an
  older refetch cannot land after the chain and overwrite the fresh cart.
- **`onSuccess`** seeds the cache when the chain *ends* with a cart `useCart`
  would show: the last result is a 2xx `GetCart` for the last command, without
  `expandCalculation: false`, `zipCode` or `countryCode`. Anything else
  invalidates. A write after the `GetCart` — the spec's own `follow` example
  ends like that — would make the returned cart stale; a zip/country or
  uncalculated read returns a different cart than `useCart`'s.
- **`onError`** invalidates the cart key, because the commands before the
  failure were applied, then the mutation rejects with the SDK's error.
- **No `forgetGoneCart`.** A command 404 can mean a missing *item* (Emporix's
  example: «Cart item not found in cart … with code 9»), and dropping the stored
  cart id for that would be wrong. A cart that is really gone answers 404 on the
  refetch, where `useCart` already forgets it.
- **No optimistic update**: a chain's effect cannot be predicted generically.
- Exported from `hooks/index.ts` and the package root, with `CartCommandsVars`.

### Angular — `injectCartMutations().execute(commands, opts?)`

A new member of the existing bundle, not a new injectable:

```ts
execute(commands: CartCommand[], opts?: CartExecuteOptions): Promise<CartExecuteResult>;
```

It invalidates `["emporix", "cart"]` and `["emporix", "cart-items"]` after
success (through `writeBundle`, like every member) **and after a failure** (a
local `catch`, because `writeBundle` invalidates only on success and a failed
chain may have applied writes). It does not seed the cache: the bundle's
documented rule is invalidation instead of cache surgery.

Parity after the change: React exports 113 hooks, 111 of them have an Angular
equivalent (40 under a different name or shape), 32 write operations sit in the
11 mutation bundles, and the injectable count stays 87.

### Docs and release

- New `docs/cart.md`: the command chain — example, options, error semantics, a
  traps table, scopes. Cart had no service page so far.
- `docs/react.md`: `useCartCommands` next to `useCartMutations`.
- `docs/angular.md` and `CLAUDE.md`: the `execute` member and the new counts.
- `packages/react/README.md` hooks table; a pointer from `packages/sdk/README.md`.
- `docs/emporix-upstream-changelog.md`: an entry with the measured counts.
- One changeset: `minor` for `@viu/emporix-sdk`, `@viu/emporix-sdk-react` and
  `@viu/emporix-sdk-angular`.

## Delivery

1. After the user's OK, trigger the bot with `gh workflow run api-sync.yml`. It
   opens `chore/emporix-api-sync` with `cart.yml` and the regenerated types; the
   user merges it. No own `fetch:specs` on this branch — that would compete with
   the bot's next run (the split #327 → #330 used before).
2. One feature PR from `feat/cart-execute` once the sync is on `main`.
3. Verification: `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`;
   `coverage.mjs --spec cart` at 25 / 25; each rule broken once on purpose to
   show the right test fails.
4. Optional live check on the `viu` tenant with an anonymous throwaway cart —
   only with the user's explicit OK.

## Testing

- **SDK** (`packages/sdk/tests/services/cart-execute.test.ts`, MSW): URL with an
  encoded id (`c/1` → `c%2F1`); `onError`/`versioning` in the query and absent
  when unset; the body holds `commands` only; `fail` throws the mapped class with
  the command's status and body and a message naming index and type; `resume`
  resolves with every result; a `503` is sent once; a service token passes.
  Type test (`cart-execute-types.test.ts`): valid chains compile, invalid ones
  carry `@ts-expect-error`, so removing a body mapping fails `pnpm typecheck`.
- **React** (`packages/react/tests/use-cart-commands.test.tsx`): seeds the cache
  from a trailing `GetCart` without a refetch; refetches when the chain does not
  end with `GetCart`, when a write follows it, and when it used
  `zipCode`/`countryCode`; refetches on failure and rejects with the mapped
  error while keeping the stored cart id on a command 404; forwards
  `onError`/`versioning`; resolves the id from storage at mutate time and names
  the hook when there is none; `useCartMutations` keeps its error message.
- **Angular** (`injectables.test.ts`, `injectables-smoke.test.ts`): `execute`
  passes id, commands and options through; invalidates on success and on
  failure; appears in the smoke table of cart mutations.

## Risks and open points

- **Not verified live.** The endpoint is hours old; the response shapes come from
  the spec and its examples. Named per method in the PR.
- **Timeouts.** A ten-command chain with calculations can exceed the client's
  default read timeout; the error is then a timeout while the server may have
  applied the writes. The hooks invalidate on error, so the UI recovers.
- **`versioning: "explicit"`** requires `resourceVersion` on participating writes;
  the type cannot express that, because it depends on a query parameter.
- **`useCartMutations` forgets the cart on an item-level 404** today — found
  while designing this, filed as a separate task, not changed here.

## Alternatives considered

- **Generated `ExecuteCommand` only.** Rejected: `data` would be
  `Record<string, unknown>`, with no autocomplete and no checks on the part of a
  command that is actually complex.
- **A hand-written 14-member union with a drift test.** Rejected in review: it
  restates names the generator already provides and needs a test only to guard
  the restatement.
- **Rewiring `useCartMutations` onto `execute`.** Deferred: it would save the
  second request for every existing storefront, but changes a widely used hook
  against an unverified endpoint. Revisit after a live check.
- **Never throwing on a `207`.** Rejected: hooks would report success for failed
  chains; `resume` already serves callers who inspect every result.
