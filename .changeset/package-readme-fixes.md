---
"@viu/emporix-sdk": patch
"@viu/emporix-mixins": patch
---

docs: correct three stale claims in the SDK README, add the missing mixins LICENSE

Checked every verifiable claim in the sdk, react and mixins READMEs against the
code. The react one was clean. Three things in the SDK README were wrong:

- **`credentials.backend` was marked «(required)»**. It is not: `validateConfig`
  requires only that the `credentials` object exists, so `credentials: {}` is a
  legal credential-free client — which is exactly what `examples/md-module` does,
  where the Managed Dashboard host owns the token. The table now marks
  `credentials` itself as required and explains the empty case.
- **`customerGroups` was described as «read-only for now»**. It has `addMember`
  and `removeMember`, and the React README already documented the
  `useAddGroupMember` / `useRemoveGroupMember` hooks for them — the two READMEs
  contradicted each other.
- **`availability` was described as a read-only service** naming two of its nine
  methods. It has three reads defaulting to `anonymous` and six writes
  (`create`, `update`, `delete`, `bulkCreate`, `bulkUpdate`, `bulkDelete`)
  defaulting to `service`.

The documented tenant pattern was also the one from the error message
(`^[a-z][a-z0-9]+$`) rather than the one the code applies
(`^[a-z][a-z0-9]{2,15}$`); the prose «3–16 chars» was already right.

**`@viu/emporix-mixins` was shipping without a LICENSE file.** Its `files` array
has listed `LICENSE` since the changelog-links change, and `package.json`
declares `"license": "MIT"`, but the file itself never existed — so the published
tarball carried no license text. Added, identical to the other three packages.
Its README also gains the CI/npm badges and the Authors and License sections the
others have.
