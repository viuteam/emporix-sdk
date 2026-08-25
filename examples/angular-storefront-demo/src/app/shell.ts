import { Component, computed, inject, signal } from "@angular/core";
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import {
  injectCustomerSession,
  injectEmporix,
  injectEmporixSite,
  injectEmporixSiteSwitch,
} from "@viu/emporix-sdk-angular";
import { clearConfig } from "./config";
import { cartLines } from "@viu/emporix-examples-shared";
import { injectCart } from "@viu/emporix-sdk-angular";

/**
 * Header, footer and the router outlet.
 *
 * Everything reactive here comes from the package's signals: the site context,
 * the customer session, and a cart read keyed on the stored cart id. Nothing
 * polls and nothing subscribes by hand.
 */
@Component({
  selector: "app-root",
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="site-header">
      <div class="wrap row">
        <a class="brand" routerLink="/">Emporix Angular</a>
        <nav class="nav">
          <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">
            Catalog
          </a>
          <a routerLink="/search" routerLinkActive="active">Search</a>
        </nav>
        <span class="spacer"></span>
        <nav class="nav small">
          @if (sites().length > 1) {
            <select
              [value]="site.siteCode() ?? ''"
              (change)="onSite($any($event.target).value)"
              [disabled]="site.isSwitching()"
              aria-label="Site"
            >
              @for (s of sites(); track s) {
                <option [value]="s">{{ s }}</option>
              }
            </select>
          }
          @if (site.currency()) {
            <span class="muted">{{ site.currency() }}</span>
          }
          <a routerLink="/cart" routerLinkActive="active">
            Cart
            @if (itemCount() > 0) {
              <span class="badge">{{ itemCount() }}</span>
            }
          </a>
          @if (session.isAuthenticated()) {
            <a routerLink="/account" routerLinkActive="active">Account</a>
            <button class="link" type="button" (click)="logout()">Sign out</button>
          } @else {
            <a routerLink="/login" routerLinkActive="active">Sign in</a>
          }
        </nav>
      </div>
      @if (site.switchError()) {
        <div class="wrap small notice error">
          <strong>Site switch failed:</strong> {{ site.switchError()?.message }} — the shop stayed
          on the new selection on purpose; the cache was already cleared.
        </div>
      }
    </header>

    <main class="wrap">
      <router-outlet />
    </main>

    <footer class="wrap">
      Tenant <strong>{{ tenant }}</strong> ·
      <button class="link" type="button" (click)="reconfigure()">change configuration</button>
      · built on <code>&#64;viu/emporix-sdk-angular</code>
    </footer>
  `,
})
export class Shell {
  private readonly emporix = injectEmporix();
  private readonly router = inject(Router);
  protected readonly site = injectEmporixSite();
  protected readonly session = injectCustomerSession();
  private readonly switcher = injectEmporixSiteSwitch();

  protected readonly tenant = this.emporix.client.tenant;

  private readonly cart = injectCart();

  protected readonly itemCount = computed(() => cartLines(this.cart.data()).length);

  /** Site codes offered by the tenant. Empty until the site DTO resolves. */
  protected readonly sites = computed(() => {
    const active = this.site.siteCode();
    return active !== null ? [active] : [];
  });

  protected async onSite(code: string): Promise<void> {
    await this.switcher.setSite(code === "" ? null : code);
  }

  protected async logout(): Promise<void> {
    await this.session.logout();
    await this.router.navigateByUrl("/");
  }

  protected reconfigure(): void {
    clearConfig();
    location.reload();
  }
}
