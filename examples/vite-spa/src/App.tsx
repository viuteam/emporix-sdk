import { useState } from "react";
import { Route, Routes, Link } from "react-router-dom";
import { useProducts, useCustomerSession } from "@viu/emporix-sdk-react";
import { GuestCheckout } from "./GuestCheckout";

// Emporix product `name` is localized — a `{ [locale]: string }` map (or a
// plain string for some tenants). Render it defensively.
function displayName(name: unknown, fallback: string): string {
  if (typeof name === "string") return name;
  if (name && typeof name === "object") {
    const values = Object.values(name as Record<string, unknown>);
    if (typeof values[0] === "string") return values[0];
  }
  return fallback;
}

function Catalog(): React.JSX.Element {
  const { data, isLoading } = useProducts({ pageSize: 12 });
  if (isLoading) return <p>Loading…</p>;
  return (
    <ul>
      {data?.items.map((p) => (
        <li key={p.id}>{displayName(p.name, p.id ?? "")}</li>
      ))}
    </ul>
  );
}

function Login(): React.JSX.Element {
  const { login, logout, isAuthenticated, customer } = useCustomerSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  if (isAuthenticated) {
    return (
      <div>
        <p>Signed in as {customer?.contactEmail ?? "…"}</p>
        <button onClick={logout}>Log out</button>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void login({ email, password });
      }}
    >
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email" />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password"
      />
      <button type="submit">Log in</button>
    </form>
  );
}

/** SPA root: anonymous catalog browse + customer login (token in localStorage). */
export function App(): React.JSX.Element {
  return (
    <main>
      <nav>
        <Link to="/">Catalog</Link> | <Link to="/account">Account</Link> |{" "}
        <Link to="/guest">Guest checkout</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Catalog />} />
        <Route path="/account" element={<Login />} />
        <Route path="/guest" element={<GuestCheckout />} />
      </Routes>
    </main>
  );
}
