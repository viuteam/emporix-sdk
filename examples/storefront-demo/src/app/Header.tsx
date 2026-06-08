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
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 30,
        borderBottom: "1px solid var(--line)",
        background: "color-mix(in oklab, var(--paper) 86%, transparent)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div
        className="container"
        style={{ display: "flex", alignItems: "center", gap: "var(--s-5)", paddingBlock: "var(--s-4)" }}
      >
        <Link to="/" className="serif" style={{ fontSize: "var(--step-1)", letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>
          Maison<span style={{ color: "var(--oxblood)" }}>—</span>Demo
        </Link>
        <form onSubmit={search} style={{ flex: 1, maxWidth: "26rem" }}>
          <input
            className="input"
            placeholder="Search the catalogue…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search products"
          />
        </form>
        <nav className="cluster" style={{ gap: "var(--s-4)", marginLeft: "auto", fontSize: "var(--step--1)" }}>
          <LanguageSwitcher />
          <SiteCurrencySwitcher />
          <Link to="/" className="u-underline">Shop</Link>
          <AccountMenu />
          <CartBadge />
        </nav>
      </div>
    </header>
  );
}
