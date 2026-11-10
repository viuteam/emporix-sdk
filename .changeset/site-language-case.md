---
"@viu/emporix-sdk-react": patch
"@viu/emporix-sdk-angular": patch
---

fix(react): match the active language against the site's languages regardless of case

Emporix compares language codes without regard to case since 2026-11-09 and accepts codes such as `en-NL`. The site state now does the same: a stored or active language that the site lists in another case — `en-nl` on a site with `en-NL` — is kept in the site's spelling, in storage too, instead of being replaced by the site's default language. This applies on mount and when switching sites, in both the React provider and the Angular site state.
