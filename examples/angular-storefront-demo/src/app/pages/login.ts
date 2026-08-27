import { Component, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { injectCustomerSession } from "@viu/emporix-sdk-angular";

@Component({
  selector: "app-login",
  imports: [RouterLink],
  templateUrl: "./login.html",
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
