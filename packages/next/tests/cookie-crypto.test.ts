import { describe, expect, it, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

const { cookieEncryptionEnabled, encryptCookie, decryptCookie } = await import(
  "../src/cookie-crypto"
);
const { openCookie } = await import("../src/cookie-name");
const { setEmporixErrorReporter, __resetEmporixErrorReporter } = await import(
  "../src/error-reporting"
);
type EmporixErrorEvent = import("../src/error-reporting").EmporixErrorEvent;

/** A valid 32-byte key, base64url — the format the env var takes. */
function key(): string {
  return randomBytes(32).toString("base64url");
}

afterEach(() => {
  delete process.env.EMPORIX_COOKIE_SECRET;
});

describe("cookie encryption", () => {
  it("round-trips a value", () => {
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.customerToken", "tok-1");
    expect(decryptCookie("emporix.customerToken", sealed)).toBe("tok-1");
  });

  it("produces a different ciphertext each time", () => {
    // A fresh IV per call. Identical ciphertexts would leak that two cookies
    // hold the same value.
    process.env.EMPORIX_COOKIE_SECRET = key();
    const a = encryptCookie("emporix.customerToken", "tok-1");
    const b = encryptCookie("emporix.customerToken", "tok-1");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered ciphertext", () => {
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.customerToken", "tok-1");
    // Flip the last character of the base64url body.
    const broken = sealed.slice(0, -1) + (sealed.endsWith("A") ? "B" : "A");
    expect(() => decryptCookie("emporix.customerToken", broken)).toThrow();
  });

  it("rejects a ciphertext moved to a different cookie name", () => {
    // The AAD. Without it a saasToken ciphertext could be pasted into the
    // customerToken cookie and would decrypt cleanly.
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.saasToken", "saas-1");
    expect(() => decryptCookie("emporix.customerToken", sealed)).toThrow();
  });

  it("decrypts with an older key still in the list", () => {
    const oldKey = key();
    process.env.EMPORIX_COOKIE_SECRET = oldKey;
    const sealed = encryptCookie("emporix.customerToken", "tok-1");
    // Rotation: the new key goes first, the old one stays for reading.
    process.env.EMPORIX_COOKIE_SECRET = `${key()},${oldKey}`;
    expect(decryptCookie("emporix.customerToken", sealed)).toBe("tok-1");
  });

  it("fails once the key leaves the list — the mass-logout lever", () => {
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.customerToken", "tok-1");
    process.env.EMPORIX_COOKIE_SECRET = key();
    expect(() => decryptCookie("emporix.customerToken", sealed)).toThrow();
  });

  it("rejects a plaintext value rather than passing it through", () => {
    // No plaintext fallback. Returning the value would silently defeat the
    // integrity guarantee for cartId and activeLegalEntityId.
    process.env.EMPORIX_COOKIE_SECRET = key();
    expect(() => decryptCookie("emporix.customerToken", "tok-1")).toThrow();
  });

  it("rejects a key that is not 32 bytes, naming the fix", () => {
    process.env.EMPORIX_COOKIE_SECRET = randomBytes(16).toString("base64url");
    expect(() => encryptCookie("emporix.customerToken", "tok-1")).toThrow(/randomBytes\(32\)/);
  });

  it("reports encryption off when the variable is absent", () => {
    expect(cookieEncryptionEnabled()).toBe(false);
  });
});

describe("turning encryption off", () => {
  it("treats a sealed value as unreadable when no secret is configured", async () => {
    // The mirror of «rejects a plaintext value»: without this, dropping the
    // secret hands the ciphertext straight through as if it were the value.
    // Found live — Emporix answered 404 for a cart called «v1.0EnVJ4…».
    const { openCookie } = await import("../src/cookie-name");
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.cartId", "cart-1");
    delete process.env.EMPORIX_COOKIE_SECRET;
    expect(openCookie("emporix.cartId", sealed)).toBeNull();
  });

  it("still passes a genuine plaintext value through", async () => {
    const { openCookie } = await import("../src/cookie-name");
    expect(openCookie("emporix.cartId", "cart-1")).toBe("cart-1");
  });
});

describe("a cookie sealed with a key that is gone", () => {
  afterEach(() => __resetEmporixErrorReporter());

  it("reports at warning and still reads as absent", () => {
    const seen: EmporixErrorEvent[] = [];
    setEmporixErrorReporter((e) => seen.push(e));

    // Seal with one key, then configure a different one — the rotation dropped
    // a key that was still in use.
    process.env.EMPORIX_COOKIE_SECRET = key();
    const sealed = encryptCookie("emporix.customerToken", "tok-1");
    process.env.EMPORIX_COOKIE_SECRET = key();

    // Unchanged: an unreadable cookie behaves like a missing one, which is the
    // mass-logout lever working as intended. It is just no longer silent.
    expect(openCookie("emporix.customerToken", sealed)).toBeNull();

    expect(seen.map((e) => e.code)).toEqual(["session.cookie_undecryptable"]);
    expect(seen[0]?.severity).toBe("warning");
    expect(seen[0]?.context).toEqual({ cookie: "emporix.customerToken" });
  });
});
