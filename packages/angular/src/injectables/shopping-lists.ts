import { type Injector, type Signal } from "@angular/core";
import type { CreateQueryResult } from "@tanstack/angular-query-experimental";
import type { EmporixClient } from "@viu/emporix-sdk";
import { injectEmporix } from "../provide";
import { injectEmporixQuery } from "../inject-query";
import { injectCustomerSession } from "../customer-session";
import { writeBundle } from "../write-bundle";

type ShoppingLists = Awaited<ReturnType<EmporixClient["shoppingLists"]["list"]>>;
type ShoppingListDraft = Parameters<EmporixClient["shoppingLists"]["create"]>[0];
type ShoppingListItem = Parameters<EmporixClient["shoppingLists"]["addItem"]>[2];

/** 30 seconds — a list changes only when its owner changes it. */
const SHOPPING_LIST_STALE = 30_000;

export interface ShoppingListOpts {
  injector?: Injector;
  enabled?: boolean;
}

const pass = (o: ShoppingListOpts): { injector?: Injector } =>
  o.injector !== undefined ? { injector: o.injector } : {};

/**
 * The signed-in customer's shopping lists, optionally filtered by name.
 *
 * `mode: "customer"` rather than a token assertion: a guest gets no request and
 * no error. React's hook resolves its context with `useCustomerOnlyCtx()` in the
 * hook body, which throws during render when nobody is signed in — a crash on a
 * page a guest is allowed to open.
 */
export function injectShoppingLists(
  name?: Signal<string | undefined>,
  opts: ShoppingListOpts = {},
): CreateQueryResult<ShoppingLists> {
  const { client } = injectEmporix();
  return injectEmporixQuery<ShoppingLists, readonly [string | null]>(
    () => {
      const filter = name?.() ?? null;
      return {
        resource: "shopping-lists",
        args: [filter] as const,
        site: "full",
        mode: "customer",
        ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
        // `list(auth, opts)` — the context comes first here, unlike every other
        // read facade in the SDK.
        queryFn: (ctx) => client.shoppingLists.list(ctx, filter !== null ? { name: filter } : {}),
        staleTime: SHOPPING_LIST_STALE,
      };
    },
    pass(opts),
  );
}

/**
 * Writes against the customer's shopping lists.
 *
 * `remove`, not `delete`: the facade method is `delete`, but a reserved word as
 * an object method reads badly at the call site.
 *
 * Every `customerId` is optional and defaults to the signed-in customer's own
 * id, taken from the session profile that is already cached under `customer-me`.
 * The facade wants it on four of five calls and React makes every call site
 * supply it, which means a storefront has to fetch its own id before it can add
 * something to a wishlist.
 */
export interface EmporixShoppingListMutations {
  isPending: Signal<boolean>;
  error: Signal<Error | null>;
  create(draft: ShoppingListDraft): Promise<{ id: string }>;
  /** Deletes one named list, or every list of the customer when `name` is omitted. */
  remove(vars: { customerId?: string; name?: string }): Promise<void>;
  /** Adds or replaces an item, matched by `productId`. */
  addItem(vars: { customerId?: string; listName: string; item: ShoppingListItem }): Promise<void>;
  removeItem(vars: { customerId?: string; listName: string; productId: string }): Promise<void>;
  /** Sets an item's quantity. `<= 0` removes it; an absent item is added. */
  setItemQuantity(vars: {
    customerId?: string;
    listName: string;
    productId: string;
    quantity: number;
  }): Promise<void>;
}

export function injectShoppingListMutations(): EmporixShoppingListMutations {
  const { client } = injectEmporix();
  const session = injectCustomerSession();
  const b = writeBundle([["emporix", "shopping-lists"]], { customerOnly: true });

  const resolveCustomerId = (explicit?: string): string => {
    const id = explicit ?? session.customer()?.id;
    if (id === undefined || id === "") {
      throw new Error(
        "injectShoppingListMutations: no customerId — pass one, or wait for the session profile to resolve",
      );
    }
    return id;
  };

  return {
    isPending: b.isPending,
    error: b.error,
    create: (draft) =>
      b.write((ctx) => client.shoppingLists.create(draft, ctx), "createShoppingList"),
    remove: (v) =>
      b.write(
        (ctx) =>
          client.shoppingLists.delete(
            resolveCustomerId(v.customerId),
            ctx,
            v.name !== undefined ? { name: v.name } : {},
          ),
        "deleteShoppingList",
      ),
    addItem: (v) =>
      b.write(
        (ctx) =>
          client.shoppingLists.addItem(
            resolveCustomerId(v.customerId),
            v.listName,
            v.item,
            ctx,
          ),
        "addToShoppingList",
      ),
    removeItem: (v) =>
      b.write(
        (ctx) =>
          client.shoppingLists.removeItem(
            resolveCustomerId(v.customerId),
            v.listName,
            v.productId,
            ctx,
          ),
        "removeFromShoppingList",
      ),
    setItemQuantity: (v) =>
      b.write(
        (ctx) =>
          client.shoppingLists.setItemQuantity(
            resolveCustomerId(v.customerId),
            v.listName,
            v.productId,
            v.quantity,
            ctx,
          ),
        "setShoppingListItemQuantity",
      ),
  };
}
