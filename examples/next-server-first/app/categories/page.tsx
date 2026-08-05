import { redirect } from "next/navigation";
import { STORAGE_KEYS, emporixSessionHandle } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import { DEFAULT_LANGUAGE, isLanguage } from "../lib/languages";

/**
 * The unprefixed `/categories` the header links to, redirected to the visitor's
 * language. Same reasoning as `app/page.tsx`: one dynamic hop with no Emporix
 * call, landing on a static page.
 *
 * The header could build `/de/categories` itself, but only by learning the
 * routing rules — and it renders on session routes too, where there is no
 * language in the URL to read.
 */
export default async function CategoriesRedirect(): Promise<never> {
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  const chosen = handle.get(STORAGE_KEYS.language);
  redirect(
    `/${chosen !== null && isLanguage(chosen) ? chosen : DEFAULT_LANGUAGE}/categories`,
  );
}
