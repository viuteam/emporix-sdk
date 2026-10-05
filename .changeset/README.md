# Changesets

Run `pnpm changeset` before opening a PR that changes any file under
`packages/*` — CI's `pnpm changeset status` gate counts every file, not only
`src/**`. A PR that releases nothing takes the `no-release` label or an empty
changeset (`pnpm changeset --empty`). See `CONTRIBUTING.md` for the full
workflow. Versions are driven by changesets, not commit messages.
