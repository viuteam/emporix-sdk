import type { Page } from "@playwright/test";

/**
 * Set an input's value without leaving the value in Playwright's action log.
 *
 * Why this exists: `page.fill(selector, "<value>")` registers a step named
 * `Fill "<value>"` in the HTML report and trace. For secrets (passwords,
 * tokens), that's a leak.
 *
 * This helper goes one level deeper: it focuses + sets the value via the
 * native `HTMLInputElement.value` setter and dispatches an `input` event so
 * React's `onChange` fires. The Playwright step that appears in the report is
 * `page.locator.evaluate(…)`, which does **not** include the value.
 *
 * The value is passed to `evaluate` as a Locator-bound arg; Playwright does
 * not serialize evaluate args into the action-log step names (verified in the
 * HTML report). It may still be present in the underlying `.zip` trace, but
 * we run with `trace: "retain-on-failure"`, so successful runs leave no
 * artifact.
 */
export async function fillSecret(
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  const input = page.locator(selector);
  await input.waitFor({ state: "visible" });
  await input.focus();
  await input.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
