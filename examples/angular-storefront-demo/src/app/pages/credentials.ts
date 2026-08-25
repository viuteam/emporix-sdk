import { Component, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { injectCustomerCredentials, injectCustomerSession } from "@viu/emporix-sdk-angular";

/**
 * Account credentials: password, login email, and the double opt-in helpers.
 *
 * The page is split along the auth boundary on purpose, because that boundary is
 * the whole subtlety. The top half needs a signed-in customer. The bottom half is
 * anonymous by design — a visitor following a confirmation link out of their inbox
 * has no session, so gating those on a login would make the link dead.
 */
@Component({
  selector: "app-credentials",
  imports: [RouterLink],
  templateUrl: "./credentials.html",
})
export class Credentials {
  protected readonly session = injectCustomerSession();
  protected readonly creds = injectCustomerCredentials();

  protected readonly currentPassword = signal("");
  protected readonly newPassword = signal("");
  protected readonly newEmail = signal("");
  protected readonly emailPassword = signal("");
  protected readonly emailToken = signal("");
  protected readonly signupToken = signal("");
  protected readonly resendEmail = signal("");
  protected readonly done = signal<string | null>(null);

  /** Clear the credential out of the signal once it has been sent. */
  private finish(message: string, ...clear: Array<{ set: (v: string) => void }>): void {
    for (const s of clear) s.set("");
    this.done.set(message);
  }

  protected async changePassword(event: Event): Promise<void> {
    event.preventDefault();
    this.done.set(null);
    try {
      await this.creds.changePassword({
        currentPassword: this.currentPassword(),
        newPassword: this.newPassword(),
      });
      this.finish("Password changed.", this.currentPassword, this.newPassword);
    } catch {
      // `creds.error()` carries it; the template renders that.
    }
  }

  protected async changeEmail(event: Event): Promise<void> {
    event.preventDefault();
    this.done.set(null);
    try {
      await this.creds.changeEmail({
        newEmail: this.newEmail(),
        password: this.emailPassword(),
      });
      this.finish("Confirmation sent to the new address.", this.emailPassword);
    } catch {
      /* surfaced via creds.error() */
    }
  }

  protected async confirmEmailChange(event: Event): Promise<void> {
    event.preventDefault();
    this.done.set(null);
    try {
      await this.creds.confirmEmailChange({ token: this.emailToken() });
      this.finish("Email change confirmed.", this.emailToken);
    } catch {
      /* surfaced via creds.error() */
    }
  }

  protected async confirmSignup(event: Event): Promise<void> {
    event.preventDefault();
    this.done.set(null);
    try {
      await this.session.confirmSignup(this.signupToken());
      this.finish("Signup confirmed — you are signed in.", this.signupToken);
    } catch {
      /* surfaced via session.error() */
    }
  }

  protected async resendActivation(event: Event): Promise<void> {
    event.preventDefault();
    this.done.set(null);
    try {
      await this.creds.resendActivation({ email: this.resendEmail() });
      this.finish("Activation link sent.");
    } catch {
      /* surfaced via creds.error() */
    }
  }
}
