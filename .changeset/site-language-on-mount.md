---
"@viu/emporix-sdk-react": patch
"@viu/emporix-sdk-angular": patch
---

fix(react): replace a language the active site does not offer, and persist the reset

On mount, a language restored from storage (or passed in or configured) that is not in the active site's `languages` now gives way to the site's `defaultLanguage`. Before, only a missing language was filled, so a language switcher showed a value its options did not contain. Switching to a site that does not offer the active language already reset it, but only in memory: the next reload restored the unsupported language from storage. Both resets are now written to storage. Same fix in `EmporixProvider` and `provideEmporix`.
