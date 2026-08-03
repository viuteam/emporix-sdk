import { createClient, type RedisClientType } from "redis";
import type { EmporixSessionStore } from "@viu/emporix-sdk-next/session";

const PREFIX = "emporix:session:";

let client: RedisClientType | undefined;

/**
 * Memoized like `getEmporixClient`. A module-level connection would leak one
 * socket per HMR reload in dev.
 */
function connection(url: string): RedisClientType {
  if (client === undefined) {
    client = createClient({ url }) as RedisClientType;
    // Without this a transient error becomes an unhandled rejection that takes
    // the whole server down.
    client.on("error", (e) => console.error("[redis]", e));
  }
  return client;
}

async function ready(url: string): Promise<RedisClientType> {
  const c = connection(url);
  if (!c.isOpen) await c.connect();
  return c;
}

/**
 * A Redis-backed session store, or `undefined` when no URL is configured.
 *
 * Returning `undefined` rather than throwing is what keeps both modes reachable:
 * drop the variable and the example runs on cookies, no code change.
 *
 * This lives in the example, not the package — that is what keeps
 * `@viu/emporix-sdk-next` at zero runtime dependencies. Copy it.
 */
export function sessionStore(): EmporixSessionStore | undefined {
  const url = process.env.EMPORIX_SESSION_REDIS_URL;
  if (url === undefined || url.length === 0) return undefined;
  return {
    read: async (id) => {
      const raw = await (await ready(url)).get(PREFIX + id);
      return raw === null ? null : (JSON.parse(raw) as Record<string, string>);
    },
    write: async (id, record, ttlSeconds) => {
      await (await ready(url)).set(PREFIX + id, JSON.stringify(record), { EX: ttlSeconds });
    },
    destroy: async (id) => {
      await (await ready(url)).del(PREFIX + id);
    },
  };
}
