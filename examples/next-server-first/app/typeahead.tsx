"use client";

import { useState } from "react";
import { EmporixClient } from "@viu/emporix-sdk";
import { createProxyFetch, createProxyTokenProvider } from "@viu/emporix-sdk-next/public-client";

/**
 * A client-side catalog read with NO token. The token provider makes no network
 * call at all; the rewriting fetch sends the request to /api/emporix, which
 * substitutes the server's real anonymous token.
 */
const client = new EmporixClient({
  tenant: process.env.NEXT_PUBLIC_EMPORIX_TENANT ?? "viu",
  credentials: { storefront: { clientId: "proxied" } },
  tokenProvider: createProxyTokenProvider(),
  fetch: createProxyFetch({ base: "/api/emporix" }),
  logger: false,
});

function label(name: unknown): string {
  if (typeof name === "string") return name;
  if (name !== null && typeof name === "object") {
    const first = Object.values(name as Record<string, unknown>)[0];
    if (typeof first === "string") return first;
  }
  return "";
}

export function Typeahead(): React.JSX.Element {
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <input
        placeholder="search (client-side, no token)"
        size={40}
        onChange={(e) => {
          const q = e.target.value;
          if (q.length < 2) {
            setNames([]);
            return;
          }
          client.products
            .list({ pageSize: 50 })
            .then((page) => {
              setError(null);
              setNames(
                page.items
                  .map((p) => label(p.name))
                  .filter((n) => n.toLowerCase().includes(q.toLowerCase()))
                  .slice(0, 5),
              );
            })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        }}
      />
      {error !== null && <p style={{ color: "crimson" }}>{error}</p>}
      <ul>
        {names.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
