import type { Metadata } from "next";
import Link from "next/link";
import { emporixSession } from "@viu/emporix-sdk-next";
import { STORE_OPT } from "../../emporix";
import { Note, Sheet } from "../../components/sheet";
import { login, logout } from "../../actions/auth";
import { safeNext } from "../../lib/safe-next";

/** Per visitor — see the reasoning on `app/cart/page.tsx`. */
export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: true },
};

export default async function LoginPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<{ next?: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  const { customerToken } = await emporixSession(STORE_OPT);
  // Validated on the way in as well as on the way out. Rendering an attacker's
  // URL into a hidden field and only checking it in the action would work, but
  // then the bad value is in the page — and the page is what a reviewer reads.
  const next = safeNext((await searchParams).next);

  if (customerToken !== null) {
    return (
      <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
        <Sheet meta={{ route: "/[lang]/login", render: "dynamic", because: "session cookie" }}>
          <p className="eyebrow">Session</p>
          <h1 style={{ marginBlock: "var(--s-2) var(--s-4)" }}>Logged in</h1>
          <p className="muted">
            The token is in an httpOnly cookie. This page read it on the server.
          </p>
          <p className="cluster" style={{ marginTop: "var(--s-5)" }}>
            <Link href="/account" className="btn btn--outline">
              Your account →
            </Link>
            <form action={logout}>
              <button type="submit" className="btn btn--ghost btn--sm">
                Log out
              </button>
            </form>
          </p>
        </Sheet>
      </main>
    );
  }

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <Sheet
        meta={{ route: "/[lang]/login", render: "dynamic", because: "session cookie" }}
        rail={
          <Note title="The token never ships">
            The password goes to a Server Action, Emporix answers with a token, and the
            token goes into an httpOnly cookie. No step of that runs in the browser,
            which is the whole claim of this example.
          </Note>
        }
      >
        <p className="eyebrow">Session</p>
        <h1 style={{ marginBlock: "var(--s-2) var(--s-4)" }}>Login</h1>
        {next !== "/" ? (
          <p className="muted">
            You need an account for <code>{next}</code>.
          </p>
        ) : null}
        {/* `.form-col` rather than the viewport width: without the bound the email
            field was 1'190px wide in a 1440px window. */}
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
      </Sheet>
    </main>
  );
}
