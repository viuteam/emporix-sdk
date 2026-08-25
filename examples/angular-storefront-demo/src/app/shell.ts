import { Component, computed, inject } from "@angular/core";
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from "@angular/router";
import {
  injectCart,
  injectCustomerSession,
  injectEmporix,
  injectEmporixSite,
  injectEmporixSiteSwitch,
} from "@viu/emporix-sdk-angular";
import { cartLines } from "@viu/emporix-examples-shared";
import { clearConfig } from "./config";

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
  templateUrl: "./shell.html",
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
