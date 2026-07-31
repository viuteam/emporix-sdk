// Resolved when @viu/emporix-sdk-next/service is pulled in outside the server
// graph. Hand-written and NOT built: tsup's `clean: true` would delete it from
// dist/. Exports nothing on purpose — the bundler's failure to find the named
// export is the primary guard, and this throw is the backstop for any bundler
// that includes the file anyway.
throw new Error(
  "@viu/emporix-sdk-next/service is server-only: it carries a client secret. " +
    "It was resolved outside the server graph — most likely imported from a " +
    '"use client" module. Move the import into a Route Handler, a Server Action, ' +
    "or a Server Component.",
);
