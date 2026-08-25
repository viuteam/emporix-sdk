import { Component, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { injectCustomerSession } from "@viu/emporix-sdk-angular";

@Component({
  selector: "app-login",
  imports: [RouterLink],
  template: `
    <h1>{{ mode() === "login" ? "Sign in" : "Create an account" }}</h1>

    <form class="card stack" style="max-width:420px" (submit)="submit($event)">
      <label>
        <span>Email</span>
        <input
          type="email"
          autocomplete="email"
          required
          [value]="email()"
          (input)="email.set($any($event.target).value)"
        />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password"
          [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
          required
          [value]="password()"
          (input)="password.set($any($event.target).value)"
        />
      </label>
      <button class="primary" type="submit" [disabled]="session.isPending()">
        {{ session.isPending() ? "Working…" : mode() === "login" ? "Sign in" : "Sign up" }}
      </button>
      <button class="link" type="button" (click)="toggle()">
        {{ mode() === "login" ? "Need an account?" : "Already have an account?" }}
      </button>
    </form>

    @if (session.error(); as e) {
      <div class="notice error" style="max-width:420px"><strong>Failed.</strong> {{ e.message }}</div>
    }
    @if (signedUp()) {
      <div class="notice" style="max-width:420px">
        Account created. Emporix may require email confirmation before the first sign-in.
      </div>
    }

    <p class="small muted" style="max-width:420px; margin-top:1.5rem">
      Signing in does more than store a token: the guest cart is merged into the customer cart,
      and the customer's <code>preferredSite</code> is applied if it differs. See
      <a routerLink="/cart">the cart</a> after signing in with items in it.
    </p>
  `,
})
export class Login {
  protected readonly session = injectCustomerSession();
  private readonly router = inject(Router);

  protected readonly mode = signal<"login" | "signup">("login");
  protected readonly email = signal("");
  protected readonly password = signal("");
  protected readonly signedUp = signal(false);

  protected toggle(): void {
    this.mode.update((m) => (m === "login" ? "signup" : "login"));
    this.signedUp.set(false);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const input = { email: this.email(), password: this.password() };
    try {
      if (this.mode() === "signup") {
        await this.session.signup(input);
        this.signedUp.set(true);
        this.mode.set("login");
      } else {
        await this.session.login(input);
        // Clear the field rather than leaving a credential in a live signal.
        this.password.set("");
        await this.router.navigateByUrl("/account");
      }
    } catch {
      // `session.error()` already carries it; the template renders that.
    }
  }
}
