import { STORAGE_KEYS, sessionCookieJar } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { LANGUAGES } from "../lib/site-context";
import { switchLanguage } from "../actions/site";
import { ActionForm } from "./action-form";

/**
 * One form per language rather than a `<select onChange>`, so it works without
 * JavaScript and needs no client component of its own.
 *
 * The active marker comes from the cookie. When nothing is chosen there is no
 * marker at all — because in that state Emporix uses the site's default language
 * and claiming «en is active» would be a guess.
 */
export async function LanguageSwitcher(): Promise<React.JSX.Element> {
  const jar = await sessionCookieJar({ readOnly: true, ...STORE_OPT });
  const active = jar.get(STORAGE_KEYS.language);

  return (
    <span className="cluster" style={{ gap: "var(--s-2)" }} aria-label="Language">
      {LANGUAGES.map((l) => (
        <ActionForm key={l} action={switchLanguage} submit={l === active ? `${l} ●` : l}>
          <input type="hidden" name="language" value={l} />
        </ActionForm>
      ))}
    </span>
  );
}
