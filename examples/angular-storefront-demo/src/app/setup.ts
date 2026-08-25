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
  template: `
    <div class="setup stack">
      <h1>Configure the demo</h1>
      <p class="muted small">
        Stored in <code>localStorage</code> only. Nothing is sent anywhere until you browse.
      </p>

      <form class="card stack" (submit)="submit($event)">
        <label>
          <span>Tenant</span>
          <input
            required
            autocomplete="off"
            placeholder="acme"
            [value]="tenant()"
            (input)="tenant.set($any($event.target).value)"
          />
        </label>
        <label>
          <span>Storefront client id (public)</span>
          <input
            required
            autocomplete="off"
            [value]="clientId()"
            (input)="clientId.set($any($event.target).value)"
          />
        </label>
        <label>
          <span>Site code (optional)</span>
          <input
            autocomplete="off"
            placeholder="main"
            [value]="siteCode()"
            (input)="siteCode.set($any($event.target).value)"
          />
        </label>
        <label>
          <span>Currency (optional)</span>
          <input
            autocomplete="off"
            placeholder="CHF"
            maxlength="3"
            [value]="currency()"
            (input)="currency.set($any($event.target).value.toUpperCase())"
          />
        </label>
        <label>
          <span>Target location for pricing (optional, ISO-2)</span>
          <input
            autocomplete="off"
            placeholder="CH"
            maxlength="2"
            [value]="targetLocation()"
            (input)="targetLocation.set($any($event.target).value.toUpperCase())"
          />
        </label>

        @if (error(); as e) {
          <div class="notice error small"><strong>{{ e }}</strong></div>
        }
        <button class="primary" type="submit">Start</button>
      </form>

      <p class="small muted">
        Prices only resolve when currency, site and target location together match a price
        list on the tenant. If products render but prices say «unavailable», that pairing is
        what to check first.
      </p>
    </div>
  `,
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
