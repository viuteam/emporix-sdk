import { Component, computed, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import {
  injectCustomerSession,
  injectShoppingListMutations,
  injectShoppingLists,
} from "@viu/emporix-sdk-angular";

/**
 * Shopping lists.
 *
 * Here to exercise a mutation bundle end to end against the live tenant: the read
 * is token-gated, the writes go through `writeBundle`, and the list refreshes from
 * the bundle's invalidation rather than from anything this component does.
 *
 * A guest sees an invitation to sign in, not an error. That is the deviation from
 * React worth seeing rendered: React's `useShoppingLists` throws during render
 * without a token, so this page could not exist for a guest at all.
 */
@Component({
  selector: "app-lists",
  imports: [RouterLink],
  templateUrl: "./lists.html",
})
export class Lists {
  protected readonly session = injectCustomerSession();

  /** Read inside the query's options callback — typing re-keys, no effect needed. */
  protected readonly filter = signal("");
  protected readonly lists = injectShoppingLists(this.filter.asReadonly());
  protected readonly mutations = injectShoppingListMutations();

  protected readonly rows = computed(() => this.lists.data() ?? []);
  protected readonly newName = signal("");
  protected readonly done = signal<string | null>(null);

  protected async create(event: Event): Promise<void> {
    event.preventDefault();
    this.done.set(null);
    const name = this.newName().trim();
    if (name === "") return;
    try {
      // No customerId passed: the bundle takes it from the session profile, which
      // is already cached under `customer-me`.
      await this.mutations.create({ name } as never);
      this.newName.set("");
      this.done.set(`Created «${name}».`);
    } catch {
      // `mutations.error()` carries it; the template renders that.
    }
  }

  protected async remove(name: string): Promise<void> {
    this.done.set(null);
    try {
      await this.mutations.remove({ name });
      this.done.set(`Deleted «${name}».`);
    } catch {
      // Rendered from `mutations.error()`.
    }
  }

  protected itemCount(row: unknown): number {
    return (row as { items?: unknown[] }).items?.length ?? 0;
  }

  protected nameOf(row: unknown): string {
    return (row as { name?: string }).name ?? "(unnamed)";
  }
}
