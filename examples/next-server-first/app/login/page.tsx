import { emporixSession } from "@viu/emporix-sdk-next";
import { login, logout } from "../actions/auth";

export default async function LoginPage(): Promise<React.JSX.Element> {
  const { customerToken } = await emporixSession();
  if (customerToken !== null) {
    return (
      <main>
        <h1>Logged in</h1>
        <p>The token is in an httpOnly cookie. This page read it on the server.</p>
        <form action={logout}>
          <button type="submit">Log out</button>
        </form>
      </main>
    );
  }
  return (
    <main>
      <h1>Login</h1>
      <form action={login}>
        <input name="email" type="email" placeholder="email" required />
        <input name="password" type="password" placeholder="password" required />
        <button type="submit">Log in</button>
      </form>
    </main>
  );
}
