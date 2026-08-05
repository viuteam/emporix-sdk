import { emporixSession } from "@viu/emporix-sdk-next";
import { STORE_OPT } from "../emporix";
import { login, logout } from "../actions/auth";
import { safeNext } from "../lib/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}): Promise<React.JSX.Element> {
  const { customerToken } = await emporixSession(STORE_OPT);
  // Validated on the way in as well as on the way out. Rendering an attacker's
  // URL into a hidden field and only checking it in the action would work, but
  // then the bad value is in the page — and the page is what a reviewer reads.
  const next = safeNext((await searchParams).next);

  if (customerToken !== null) {
    return (
      <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
        <h1 className="serif">Logged in</h1>
        <p className="muted">
          The token is in an httpOnly cookie. This page read it on the server.
        </p>
        <p>
          <a href="/account" className="u-underline">
            Your account →
          </a>
        </p>
        <form action={logout}>
          <button type="submit" className="btn btn--ghost btn--sm">
            Log out
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <h1 className="serif">Login</h1>
      {next !== "/" ? (
        <p className="muted">
          You need an account for <code>{next}</code>.
        </p>
      ) : null}
      {/* `.form-col` statt der Viewport-Breite: ohne die Begrenzung war das
          Email-Feld auf einem 1440px-Fenster 1'190px breit. */}
      <form action={login} className="form-col stack" style={{ marginTop: "var(--s-5)" }}>
        <input type="hidden" name="next" value={next} />
        <p className="field">
          <label className="field__label" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            className="input"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
        </p>
        <p className="field">
          <label className="field__label" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            className="input"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </p>
        <button type="submit" className="btn btn--accent">
          Log in
        </button>
      </form>
    </main>
  );
}
