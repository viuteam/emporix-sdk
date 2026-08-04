"use server";

import { revalidatePath } from "next/cache";
import { STORAGE_KEYS, emporixSessionHandle } from "@viu/emporix-sdk-next/session";
import { STORE_OPT } from "../emporix";
import type { ActionState } from "../components/action-form";
import { LANGUAGES } from "../lib/site-context";

/** A year: a language choice is a preference, not a session. Same value the
 *  package's `emporixSiteProxy` uses for this cookie. */
const LANGUAGE_MAX_AGE = 60 * 60 * 24 * 365;

export async function switchLanguage(_state: ActionState, form: FormData): Promise<ActionState> {
  const language = String(form.get("language"));
  // An allowlist, not free text: this value ends up in a cookie and from there in
  // the `Accept-Language` header of every Emporix request the session makes.
  if (!LANGUAGES.includes(language as (typeof LANGUAGES)[number])) {
    return { error: "Unsupported language" };
  }

  const handle = await emporixSessionHandle(STORE_OPT);
  handle.set(STORAGE_KEYS.language, language, LANGUAGE_MAX_AGE);
  await handle.flush();

  // "layout", not the current page alone: the language changes every server-side
  // read, including the ones in pages the visitor has already cached.
  revalidatePath("/", "layout");
  return { error: null };
}
