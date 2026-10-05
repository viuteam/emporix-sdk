import { describe, expect, it } from "vitest";
import robots from "../app/robots";
import { LANGUAGES } from "../app/lib/languages";

function disallowed(): string[] {
  const { rules } = robots();
  const rule = Array.isArray(rules) ? rules[0] : rules;
  const disallow = rule?.disallow ?? [];
  return Array.isArray(disallow) ? disallow : [disallow];
}

describe("robots", () => {
  it("disallows the per-visitor routes under every language prefix", () => {
    // The routes live under `/[lang]/`, and a Disallow matches by prefix, so
    // `/cart` never covered `/de/cart`.
    for (const lang of LANGUAGES) {
      for (const route of ["/search", "/cart", "/checkout", "/login", "/account", "/debug"]) {
        expect(disallowed()).toContain(`/${lang}${route}`);
      }
    }
  });

  it("keeps the API proxy out", () => {
    expect(disallowed()).toContain("/api/");
  });
});
