import { Component, signal } from "@angular/core";
import { isValidTenant, writeConfig, type DemoConfig } from "./config";

/**
 * Asks for the tenant and public storefront client id, then reloads.
 *
 * This exists so the example carries no configuration in source. A public
 * storefront client id is not a secret — it is shipped to every browser that
 * loads a storefront — but a tenant plus a client id is still somebody's
 * account, and committing one would make this example point at it forever.
 */
@Component({
  selector: "app-root",
  templateUrl: "./setup.html",
})
export class Setup {
  protected readonly tenant = signal("");
  protected readonly clientId = signal("");
  protected readonly siteCode = signal("");
  protected readonly currency = signal("");
  protected readonly targetLocation = signal("");
  protected readonly error = signal<string | null>(null);

  protected submit(event: Event): void {
    event.preventDefault();
    if (!isValidTenant(this.tenant())) {
      this.error.set("Tenant must be 3–16 lowercase letters or digits, starting with a letter.");
      return;
    }
    if (this.clientId().trim() === "") {
      this.error.set("A storefront client id is required.");
      return;
    }
    const config: DemoConfig = {
      tenant: this.tenant(),
      storefrontClientId: this.clientId(),
      siteCode: this.siteCode(),
      currency: this.currency(),
      targetLocation: this.targetLocation(),
    };
    writeConfig(config);
    // Reload rather than swapping providers at runtime: `provideEmporix` takes a
    // constructed client, and rebuilding the injector mid-session would leave
    // every already-injected signal pointing at the old one.
    location.reload();
  }
}
