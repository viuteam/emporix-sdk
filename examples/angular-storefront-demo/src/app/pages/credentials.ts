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
  template: `
    <h1>Credentials</h1>

    <h2>While signed in</h2>
    @if (!session.isAuthenticated()) {
      <p class="muted">
        Sign in to change your password or login email. <a routerLink="/login">Sign in →</a>
      </p>
    } @else {
      <div class="stack" style="max-width:460px">
        <form class="card stack" (submit)="changePassword($event)">
          <strong>Change password</strong>
          <label>
            <span>Current password</span>
            <input
              type="password"
              autocomplete="current-password"
              [value]="currentPassword()"
              (input)="currentPassword.set($any($event.target).value)"
            />
          </label>
          <label>
            <span>New password</span>
            <input
              type="password"
              autocomplete="new-password"
              [value]="newPassword()"
              (input)="newPassword.set($any($event.target).value)"
            />
          </label>
          <button type="submit" [disabled]="creds.isPending()">Change password</button>
          <p class="small muted">
            No cache is invalidated afterwards — no read query surfaces a password, so there is
            nothing stale to drop.
          </p>
        </form>

        <form class="card stack" (submit)="changeEmail($event)">
          <strong>Change login email</strong>
          <label>
            <span>New email</span>
            <input
              type="email"
              [value]="newEmail()"
              (input)="newEmail.set($any($event.target).value)"
            />
          </label>
          <label>
            <span>Current password</span>
            <input
              type="password"
              autocomplete="current-password"
              [value]="emailPassword()"
              (input)="emailPassword.set($any($event.target).value)"
            />
          </label>
          <button type="submit" [disabled]="creds.isPending()">Request change</button>
          <p class="small muted">
            Emporix sends a confirmation first, so the address on file does not change yet — but
            the profile carries the pending state, so it is refetched.
          </p>
        </form>
      </div>
    }

    <h2>Without a session</h2>
    <div class="stack" style="max-width:460px">
      <form class="card stack" (submit)="confirmEmailChange($event)">
        <strong>Confirm an email change</strong>
        <label>
          <span>Token from the email</span>
          <input
            [value]="emailToken()"
            (input)="emailToken.set($any($event.target).value)"
            autocomplete="off"
          />
        </label>
        <button type="submit" [disabled]="creds.isPending()">Confirm</button>
      </form>

      <form class="card stack" (submit)="confirmSignup($event)">
        <strong>Complete a signup</strong>
        <label>
          <span>Token from the activation email</span>
          <input
            [value]="signupToken()"
            (input)="signupToken.set($any($event.target).value)"
            autocomplete="off"
          />
        </label>
        <button type="submit" [disabled]="session.isPending()">Confirm and sign in</button>
        <p class="small muted">
          This one lives on <code>injectCustomerSession</code>, not here: it returns a full
          session, so it signs you in — tokens stored, guest cart merged,
          <code>preferredSite</code> honoured, exactly like a login.
        </p>
      </form>

      <form class="card stack" (submit)="resendActivation($event)">
        <strong>Resend the activation link</strong>
        <label>
          <span>Email</span>
          <input
            type="email"
            [value]="resendEmail()"
            (input)="resendEmail.set($any($event.target).value)"
          />
        </label>
        <button type="submit" [disabled]="creds.isPending()">Resend</button>
      </form>
    </div>

    @if (done(); as d) {
      <div class="notice" style="max-width:460px"><strong>{{ d }}</strong></div>
    }
    @if (creds.error(); as e) {
      <div class="notice error" style="max-width:460px"><strong>Failed.</strong> {{ e.message }}</div>
    }
    @if (session.error(); as e) {
      <div class="notice error" style="max-width:460px"><strong>Failed.</strong> {{ e.message }}</div>
    }
  `,
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
