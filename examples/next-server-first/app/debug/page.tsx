"use client";

import { useEffect, useState } from "react";

/**
 * Renders what the browser can actually see. If any Emporix secret appears here,
 * the mode has failed — and it fails visibly rather than silently.
 */
export default function DebugPage(): React.JSX.Element {
  const [cookies, setCookies] = useState<string[]>([]);
  useEffect(() => {
    setCookies(document.cookie.split("; ").filter((c) => c.length > 0));
  }, []);
  const suspicious = cookies.filter((c) =>
    /customerToken|refreshToken|saasToken|anonymousSession|cartId/.test(c),
  );
  return (
    <main>
      <h1>What the browser can read</h1>
      <p>
        Expected: only <code>emporix.siteCode</code> and <code>emporix.language</code>.
      </p>
      <ul>
        {cookies.length === 0 ? <li>(nothing)</li> : cookies.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <p style={{ fontWeight: 700, color: suspicious.length > 0 ? "crimson" : "green" }}>
        {suspicious.length > 0
          ? `FAIL — ${suspicious.length} secret cookie(s) readable from JavaScript`
          : "PASS — no secret is readable from JavaScript"}
      </p>
    </main>
  );
}
