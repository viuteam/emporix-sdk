import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SiteCurrencySwitcher } from "./SiteCurrencySwitcher";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { CartBadge } from "./CartBadge";
import { AccountMenu } from "./AccountMenu";

export function Header() {
  const nav = useNavigate();
  const [q, setQ] = useState("");

  function search(e: FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (v) nav(`/search?q=${encodeURIComponent(v)}`);
  }

  return (
    <header className="site-header">
      <div className="utility-bar">
        <div className="container utility-bar__inner">
          <SiteCurrencySwitcher />
          <LanguageSwitcher />
        </div>
      </div>
      <div className="container main-bar">
        <Link to="/" className="wordmark">
          Demo Store
        </Link>
        <form onSubmit={search} className="main-bar__search" role="search">
          <input
            className="input"
            type="search"
            placeholder="Search products…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search products"
          />
        </form>
        <nav className="main-bar__nav" aria-label="Account and cart">
          <AccountMenu />
          <CartBadge />
        </nav>
      </div>
    </header>
  );
}
