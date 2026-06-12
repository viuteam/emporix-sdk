import type { ClientContext } from "../core/context";
import type { AuthContext } from "../core/auth";
import { EmporixNotFoundError } from "../core/errors";

/** A single shopping-list line item. */
export interface ShoppingListItem {
  id?: number;
  productId: string;
  quantity: number;
  cuttingOption?: string;
  servicePackagingOption?: string;
  comment?: string;
  mixins?: Record<string, unknown>;
}

/** A shopping list, normalized from the per-customer wire envelope. */
export interface ShoppingList {
  key: string;
  name: string;
  items: ShoppingListItem[];
  mixins?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Input for create / replace. */
export interface ShoppingListDraft {
  name: string;
  items?: ShoppingListItem[];
  mixins?: Record<string, unknown>;
}

interface WireList {
  name?: string;
  items?: ShoppingListItem[];
  mixins?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

const RESERVED = new Set(["customerId", "metadata"]);

/**
 * Per-customer shopping lists (`/shoppinglist/{tenant}/shopping-lists`).
 * `auth` is required: a customer token manages the caller's own lists;
 * a service token (employee scope) can act on any `customerId`. The Emporix
 * API has no item-level CRUD, so `addItem`/`removeItem`/`setItemQuantity`
 * read the list and `PUT` the full body — **last-write-wins**.
 */
export class ShoppingListService {
  static readonly channel = "shopping-list" as const;
  constructor(private readonly ctx: ClientContext) {}

  private base(): string {
    return `/shoppinglist/${this.ctx.tenant}/shopping-lists`;
  }

  /** The caller's lists (or, with employee scope, all), normalized to an array. */
  async list(auth: AuthContext, opts: { name?: string } = {}): Promise<ShoppingList[]> {
    const envelopes = await this.ctx.http.request<Array<Record<string, unknown>>>({
      method: "GET",
      path: this.base(),
      auth,
      ...(opts.name ? { query: { name: opts.name } } : {}),
    });
    const out: ShoppingList[] = [];
    for (const env of envelopes ?? []) {
      for (const [key, value] of Object.entries(env)) {
        if (RESERVED.has(key) || value === null || typeof value !== "object") continue;
        const v = value as WireList;
        out.push({
          key,
          name: v.name ?? key,
          items: v.items ?? [],
          ...(v.mixins ? { mixins: v.mixins } : {}),
          ...(v.metadata ? { metadata: v.metadata } : {}),
        });
      }
    }
    return out;
  }

  /** Create a list; returns the new list id. */
  async create(draft: ShoppingListDraft, auth: AuthContext): Promise<{ id: string }> {
    return this.ctx.http.request<{ id: string }>({
      method: "POST",
      path: this.base(),
      auth,
      body: draft,
    });
  }

  /** Replace the named list (low-level PUT). */
  async replace(customerId: string, draft: ShoppingListDraft, auth: AuthContext): Promise<void> {
    await this.ctx.http.request<void>({
      method: "PUT",
      path: `${this.base()}/${encodeURIComponent(customerId)}`,
      auth,
      body: draft,
    });
  }

  /** Delete the named list, or all the customer's lists when `name` is omitted. */
  async delete(customerId: string, auth: AuthContext, opts: { name?: string } = {}): Promise<void> {
    await this.ctx.http.request<void>({
      method: "DELETE",
      path: `${this.base()}/${encodeURIComponent(customerId)}`,
      auth,
      ...(opts.name ? { query: { name: opts.name } } : {}),
    });
  }

  private async loadList(listName: string, auth: AuthContext): Promise<ShoppingList> {
    const lists = await this.list(auth, { name: listName });
    const found = lists.find((l) => l.name === listName);
    if (!found) throw new EmporixNotFoundError(`Shopping list "${listName}" not found`, 404);
    return found;
  }

  private async put(customerId: string, list: ShoppingList, items: ShoppingListItem[], auth: AuthContext): Promise<void> {
    await this.replace(
      customerId,
      { name: list.name, items, ...(list.mixins ? { mixins: list.mixins } : {}) },
      auth,
    );
  }

  /** Add/replace an item by `productId` (read-modify-write, last-write-wins). */
  async addItem(customerId: string, listName: string, item: ShoppingListItem, auth: AuthContext): Promise<void> {
    const list = await this.loadList(listName, auth);
    const items = [...list.items.filter((i) => i.productId !== item.productId), item];
    await this.put(customerId, list, items, auth);
  }

  /** Remove an item by `productId` (no-op if absent). */
  async removeItem(customerId: string, listName: string, productId: string, auth: AuthContext): Promise<void> {
    const list = await this.loadList(listName, auth);
    const items = list.items.filter((i) => i.productId !== productId);
    await this.put(customerId, list, items, auth);
  }

  /** Set an item's quantity; `quantity <= 0` removes it. Adds the item if absent. */
  async setItemQuantity(customerId: string, listName: string, productId: string, quantity: number, auth: AuthContext): Promise<void> {
    if (quantity <= 0) return this.removeItem(customerId, listName, productId, auth);
    const list = await this.loadList(listName, auth);
    let items = list.items.map((i) => (i.productId === productId ? { ...i, quantity } : i));
    if (!items.some((i) => i.productId === productId)) items = [...items, { productId, quantity }];
    await this.put(customerId, list, items, auth);
  }
}
