import { Link } from "react-router-dom";
import { ProfileForm } from "../../account/ProfileForm";
import { PasswordForm } from "../../account/PasswordForm";
import { RequireAuth } from "./RequireAuth";

export function Profile() {
  return (
    <RequireAuth>
      <div className="container" style={{ paddingBlock: "var(--s-6)", maxWidth: "44rem" }}>
        <Link to="/account" className="u-underline muted" style={{ fontSize: "var(--step--1)" }}>← Account</Link>
        <h2 className="serif" style={{ marginBlock: "var(--s-3) var(--s-5)" }}>Profile & password</h2>
        <div className="surface" style={{ padding: "var(--s-5)" }}>
          <ProfileForm />
        </div>
        <div className="surface" style={{ padding: "var(--s-5)", marginTop: "var(--s-5)" }}>
          <PasswordForm />
        </div>
      </div>
    </RequireAuth>
  );
}
