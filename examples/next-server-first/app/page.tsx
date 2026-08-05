import { redirect } from "next/navigation";
import { STORAGE_KEYS, emporixSessionHandle } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "./emporix";
import { DEFAULT_LANGUAGE, isLanguage } from "./lib/languages";

/**
 * The unprefixed entry, and the only page that still reads the language cookie
 * to decide what to show.
 *
 * That is not a leftover. Somebody arriving at `/` has to be sent somewhere, and
 * sending them to the language they last chose is worth one cheap hop — this
 * page makes no Emporix call, so being dynamic costs a cookie read and nothing
 * else. Everything it redirects to is static.
 *
 * The same shape covers `/categories`, which the header links to unprefixed.
 */
export default async function RootRedirect(): Promise<never> {
  const handle = await emporixSessionHandle({ readOnly: true, ...STORE_OPT });
  const chosen = handle.get(STORAGE_KEYS.language);
  redirect(`/${chosen !== null && isLanguage(chosen) ? chosen : DEFAULT_LANGUAGE}`);
}
