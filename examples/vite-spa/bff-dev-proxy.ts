import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { Plugin } from "vite";

/**
 * A guest-only Backend for Frontend for `vite --mode bff`, so the SPA can run in
 * the SDK's proxy mode on a laptop. It does the BFF's side of `docs/bff.md` in
 * the smallest form that still shows each rule:
 *
 * - `GET /bff/session` starts a guest session (an `HttpOnly` cookie) and answers
 *   `{ authenticated: false }` — there is no login here;
 * - `/emporix/**` needs `X-CSRF: 1` and a session, forwards only allowlisted
 *   paths, and attaches an anonymous token it minted server-side;
 * - only named request headers go upstream, so `Cookie` and `Authorization`
 *   never do, and `Set-Cookie` never comes back.
 *
 * Not for production: sessions live in this process's memory, and it never logs a
 * customer in.
 */
export function bffDevProxy(opts: {
  tenant: string;
  /** The storefront client id. Read on the server only: it never reaches the bundle. */
  clientId: string;
  host?: string;
  /** Bound to the anonymous token, as `prices.matchByContext` needs it. */
  context: { siteCode: string; currency: string; targetLocation: string };
}): Plugin {
  const upstream = opts.host ?? "https://api.emporix.io";
  const sessions = new Map<string, { token: string; expiresAt: number } | null>();
  // Catalog, prices, sites and the guest cart: what the catalog page and a cart need.
  const allowedPaths = [/^\/product\//, /^\/category\//, /^\/price\//, /^\/site\//, /^\/cart\//, /^\/availability\//, /^\/session-context\//, /^\/media\//];
  const forwardedHeaders = ["accept", "accept-language", "content-language", "content-type", "emporix-tenant"];

  async function anonymousToken(sid: string): Promise<string> {
    const cached = sessions.get(sid);
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    // shortcut: logs in again on expiry, which starts a new Emporix session; a real BFF refreshes to keep its sessionId.
    const url = new URL(`${upstream}/customerlogin/auth/anonymous/login`);
    url.search = new URLSearchParams({ tenant: opts.tenant, client_id: opts.clientId, ...opts.context }).toString();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`anonymous login failed: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    sessions.set(sid, { token: body.access_token, expiresAt: Date.now() + (body.expires_in - 60) * 1000 });
    return body.access_token;
  }

  function sessionId(req: IncomingMessage): string | undefined {
    const sid = /(?:^|;\s*)bff-session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    return sid !== undefined && sessions.has(sid) ? sid : undefined;
  }

  function json(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(body));
  }

  async function forward(req: IncomingMessage, res: ServerResponse, url: URL, sid: string): Promise<void> {
    const path = url.pathname.slice("/emporix".length);
    const headers: Record<string, string> = {};
    for (const name of forwardedHeaders) {
      const value = req.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

    const call = async (): Promise<Response> =>
      fetch(`${upstream}${path}${url.search}`, {
        method: req.method ?? "GET",
        headers: { ...headers, Authorization: `Bearer ${await anonymousToken(sid)}` },
        ...(body ? { body } : {}),
      });
    let upstreamRes = await call();
    if (upstreamRes.status === 401) {
      // The token is the BFF's problem, not the browser's: mint a fresh one and
      // retry once. A 401 to the browser means "no session", nothing else.
      sessions.set(sid, null);
      upstreamRes = await call();
      if (upstreamRes.status === 401) return json(res, 502, { message: "Emporix rejected the BFF's token" });
    }

    res.statusCode = upstreamRes.status;
    upstreamRes.headers.forEach((value, name) => {
      if (!["set-cookie", "content-encoding", "content-length", "transfer-encoding", "connection"].includes(name)) {
        res.setHeader(name, value);
      }
    });
    if (!upstreamRes.body) return void res.end();
    // Piped, not buffered, so a text/event-stream reaches the browser as it arrives.
    Readable.fromWeb(upstreamRes.body as never).pipe(res);
  }

  return {
    name: "emporix-bff-dev-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? "/", "http://bff.local");
        if (url.pathname === "/bff/session") {
          if (!sessionId(req)) {
            const sid = randomUUID();
            sessions.set(sid, null);
            res.setHeader("Set-Cookie", `bff-session=${sid}; HttpOnly; SameSite=Strict; Path=/`);
          }
          return json(res, 200, { authenticated: false });
        }
        if (!url.pathname.startsWith("/emporix/")) return next();
        if (req.headers["x-csrf"] !== "1") return json(res, 403, { message: "missing X-CSRF header" });
        const sid = sessionId(req);
        if (!sid) return json(res, 401, { message: "no BFF session" });
        if (!allowedPaths.some((p) => p.test(url.pathname.slice("/emporix".length)))) {
          return json(res, 403, { message: "path not on the dev BFF's allowlist" });
        }
        forward(req, res, url, sid).catch((err: unknown) => json(res, 502, { message: String(err) }));
      });
    },
  };
}
