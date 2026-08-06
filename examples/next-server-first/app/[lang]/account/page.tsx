import type { Metadata } from "next";
import Link from "next/link";
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { pickText } from "@viu/emporix-examples-shared";

import { requireCustomer } from "../../lib/require-customer";
import { emporixOptions } from "../../lib/site-context";

/** Per visitor — see the reasoning on `app/cart/page.tsx`. */
export const metadata: Metadata = {
  title: "Account",
  robots: { index: false, follow: true },
};

/**
 * The account overview, and the first page behind the gate.
 *
 * `requireCustomer` redirects when no token is stored, so everything below it can
 * assume a customer. storefront-demo does the same with a `RequireAuth` component
 * that redirects from the client — which means it renders once, unauthenticated,
 * before deciding. This never does.
 */
export default async function AccountPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  await requireCustomer(lang, `/${lang}/account`);
  const customer = await withEmporixSession(
    (client, ctx) => client.customers.me(ctx),
    await emporixOptions(lang),
  );
  // `contactEmail`, not `email` — the latter is empty on this shape. Checked
  // against `storefront-demo/src/account/ProfileForm.tsx`, which reads the same
  // four fields against the real tenant.
  const c = customer as {
    firstName?: unknown;
    lastName?: unknown;
    contactEmail?: unknown;
  };
  const name = `${pickText(c.firstName, "")} ${pickText(c.lastName, "")}`.trim();

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">Account</p>
      <h1 style={{ marginBlock: "var(--s-2) var(--s-2)" }}>
        {name === "" ? "Your account" : name}
      </h1>
      <p className="muted" style={{ marginBottom: "var(--s-6)" }}>
        {pickText(c.contactEmail, "")}
      </p>

      <nav className="cluster" style={{ gap: "var(--s-4)" }}>
        <Link href={`/${lang}/account/profile`} className="u-underline">
          Profile
        </Link>
        <Link href={`/${lang}/account/addresses`} className="u-underline">
          Addresses
        </Link>
        <Link href={`/${lang}/account/orders`} className="u-underline">
          Orders
        </Link>
      </nav>
    </main>
  );
}
