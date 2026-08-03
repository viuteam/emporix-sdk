import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for session cookie values.
 *
 * `node:crypto`, not WebCrypto, and that is not a preference: `crypto.subtle`
 * is async-only, while `AnonymousSessionStore` (sdk core/auth.ts:42) is declared
 * synchronous and is called mid-refresh. An async codec cannot back it.
 *
 * What this buys, precisely: a stolen ciphertext cannot be redeemed directly
 * against Emporix, only replayed against this app. It does NOT prevent session
 * hijacking — whoever holds the cookie is in either way.
 */
/** Marks a sealed value. Exported so a reader can recognise one even with no
 *  key configured — a `v1.` value is never usable plaintext. */
export const SEAL_MARKER = "v1.";
const PREFIX = SEAL_MARKER;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

const GENERATE =
  'node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64url\'))"';

let cachedRaw: string | undefined;
let cachedKeys: Buffer[] = [];

/**
 * The configured keys, first one encrypts. Cached on the raw env string so a
 * changed value is picked up — tests rely on that, and so does a redeploy.
 */
function keys(): Buffer[] {
  const raw = process.env.EMPORIX_COOKIE_SECRET;
  if (raw === undefined || raw.length === 0) {
    cachedRaw = undefined;
    cachedKeys = [];
    return cachedKeys;
  }
  if (raw === cachedRaw) return cachedKeys;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const buf = Buffer.from(s, "base64url");
      if (buf.length !== KEY_BYTES) {
        throw new Error(
          `EMPORIX_COOKIE_SECRET: every key must be ${KEY_BYTES} base64url bytes, got ${buf.length}. ` +
            `Generate one with: ${GENERATE}`,
        );
      }
      return buf;
    });
  if (parsed.length === 0) {
    throw new Error(`EMPORIX_COOKIE_SECRET is set but empty. Generate a key with: ${GENERATE}`);
  }
  cachedRaw = raw;
  cachedKeys = parsed;
  return cachedKeys;
}

/** Whether `EMPORIX_COOKIE_SECRET` is configured. */
export function cookieEncryptionEnabled(): boolean {
  const raw = process.env.EMPORIX_COOKIE_SECRET;
  return raw !== undefined && raw.length > 0;
}

/** Seals `value` for the cookie called `name`. The name is the AAD. */
export function encryptCookie(name: string, value: string): string {
  const [k] = keys();
  if (k === undefined) throw new Error("encryptCookie called with no key configured");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(name, "utf8"));
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
}

/**
 * Opens a sealed value. Throws on anything unexpected — a plaintext value, a
 * wrong cookie name, a tampered byte, or a key no longer in the list.
 *
 * Never returns the input unchanged: passing plaintext through would quietly
 * defeat the integrity guarantee for `cartId` and `activeLegalEntityId`, which
 * the app trusts.
 */
export function decryptCookie(name: string, value: string): string {
  if (!value.startsWith(PREFIX)) {
    throw new Error(`decryptCookie: ${name} is not sealed (missing ${PREFIX} marker)`);
  }
  const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error(`decryptCookie: ${name} is too short to be a sealed value`);
  }
  const iv = raw.subarray(0, IV_BYTES);
  const body = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  for (const k of keys()) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", k, iv);
      decipher.setAAD(Buffer.from(name, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch {
      // Wrong key — try the next. A rotation keeps old keys readable.
    }
  }
  throw new Error(`decryptCookie: ${name} could not be opened with any configured key`);
}
