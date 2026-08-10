---
"@viu/emporix-sdk": patch
"@viu/emporix-sdk-react": patch
"@viu/emporix-sdk-next": patch
"@viu/emporix-mixins": patch
---

docs: link the changelog from every package README

npmjs.com renders only a package's README — the registry has no changelog field
at all, so there is nothing for the website to show. Each README now carries a
Changelog section pointing at `CHANGELOG.md` on GitHub, at the copy inside the
published tarball (served by unpkg), and at the per-version Releases.

Published as a patch on purpose: npmjs.com shows the README of the *published*
version, so a docs-only change that is never released never reaches the page.

`@viu/emporix-mixins` also gains `README.md`, `CHANGELOG.md` and `LICENSE` in its
`files` array. It listed only `dist`, and while npm ships a README and a LICENSE
regardless, it does **not** ship a CHANGELOG — verified against the published
tarball, which had no `CHANGELOG.md`. The link the new section adds would have
been dead.
