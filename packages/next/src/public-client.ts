import type { AnonymousSession, TokenProvider } from "@viu/emporix-sdk";

const DEFAULT_HOST = "https://api.emporix.io";
/** Discarded by the public route; never sent to Emporix. */
const PLACEHOLDER = "proxied";

/**
 * A `TokenProvider` that mints nothing and calls nothing.
 *
 * This is what makes "no token in the browser" true rather than aspirational.
 * The SDK's default provider fetches an anonymous token over the **global**
 * `fetch` (`core/auth.ts`), which a rewriting `fetch` cannot intercept — so the
 * only way to keep a token out of the browser is not to request one.
 *
 * Pair it with {@link createProxyFetch} and a route built by
 * `createEmporixPublicRoute`, which substitutes the server's real token.
 */
export function createProxyTokenProvider(): TokenProvider {
  const session: AnonymousSession = {
    accessToken: PLACEHOLDER,
    refreshToken: PLACEHOLDER,
    sessionId: PLACEHOLDER,
    expiresIn: 3600,
  };
  return {
    getToken: () => Promise.resolve(PLACEHOLDER),
    getAnonymousToken: () => Promise.resolve(session),
    refreshAnonymous: () => Promise.resolve(session),
  };
}

/**
 * A `fetch` that rewrites Emporix URLs onto a same-origin route.
 *
 * Only the host is replaced; path and query survive, so the route can apply
 * `emporixTagsForUrl` to the reconstructed upstream URL unchanged.
 */
export function createProxyFetch(opts: { base?: string } = {}): typeof globalThis.fetch {
  const base = opts.base ?? "/api/emporix";
  // Compare parsed origins, never a string prefix: `startsWith(host)` also
  // matches `https://api.emporix.io.evil.com`, which is a different host.
  // CodeQL flags exactly this as js/incomplete-url-substring-sanitization.
  const hostOrigin = new URL(process.env.NEXT_PUBLIC_EMPORIX_HOST ?? DEFAULT_HOST).origin;
  return (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      // Relative or unparseable — not an Emporix URL, pass it through.
      return globalThis.fetch(input, init);
    }
    if (parsed.origin !== hostOrigin) return globalThis.fetch(input, init);
    return globalThis.fetch(`${base}${parsed.pathname}${parsed.search}`, init);
  };
}
