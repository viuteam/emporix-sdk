import type { Metadata } from "next";
import Link from "next/link";
import { withEmporixSession } from "@viu/emporix-sdk-next/session";
import { pickText } from "@viu/emporix-examples-shared";

import { requireCustomer } from "../../../lib/require-customer";
import { ActionForm } from "../../../components/action-form";
import { changePassword, updateProfile } from "../../../actions/account";
import { emporixOptions } from "../../../lib/site-context";

/** Per visitor — see the reasoning on `app/cart/page.tsx`. */
export const metadata: Metadata = {
  title: "Profile",
  robots: { index: false, follow: true },
};

/**
 * Two forms, no client state.
 *
 * `defaultValue` rather than `value`: these inputs are uncontrolled, the browser
 * owns what is typed, and the server owns what is stored. storefront-demo keeps
 * the same fields in `useState` and syncs them — which is the reason its form has
 * to think about stale state after a save, and this one does not.
 */
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<React.JSX.Element> {
  const { lang } = await params;
  await requireCustomer("/account/profile");
  const customer = await withEmporixSession(
    (client, ctx) => client.customers.me(ctx),
    await emporixOptions(lang),
  );
  const c = customer as {
    firstName?: unknown;
    lastName?: unknown;
    contactEmail?: unknown;
    contactPhone?: unknown;
  };

  return (
    <main className="container" style={{ paddingBlock: "var(--s-6)" }}>
      <p className="eyebrow">
        <Link href="/account" className="u-underline">
          ← Account
        </Link>
      </p>
      <h1 style={{ marginBlock: "var(--s-2) var(--s-5)" }}>
        Profile
      </h1>

      <ActionForm action={updateProfile} submit="Save">
        <label className="field__label" htmlFor="firstName">
          First name
        </label>
        <input
          id="firstName"
          className="input"
          name="firstName"
          defaultValue={pickText(c.firstName, "")}
        />
        <label className="field__label" htmlFor="lastName">
          Last name
        </label>
        <input
          id="lastName"
          className="input"
          name="lastName"
          defaultValue={pickText(c.lastName, "")}
        />
        <label className="field__label" htmlFor="contactEmail">
          Contact email
        </label>
        <input
          id="contactEmail"
          className="input"
          name="contactEmail"
          type="email"
          defaultValue={pickText(c.contactEmail, "")}
        />
        <label className="field__label" htmlFor="contactPhone">
          Phone
        </label>
        <input
          id="contactPhone"
          className="input"
          name="contactPhone"
          type="tel"
          defaultValue={pickText(c.contactPhone, "")}
        />
      </ActionForm>

      <h2 style={{ marginTop: "var(--s-6)" }}>
        Password
      </h2>
      <ActionForm action={changePassword} submit="Change">
        <label className="field__label" htmlFor="currentPassword">
          Current password
        </label>
        <input
          id="currentPassword"
          className="input"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
        />
        <label className="field__label" htmlFor="newPassword">
          New password
        </label>
        <input
          id="newPassword"
          className="input"
          name="newPassword"
          type="password"
          autoComplete="new-password"
        />
      </ActionForm>
    </main>
  );
}
