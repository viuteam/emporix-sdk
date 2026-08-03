// Resolved when @viu/emporix-sdk-next/session is pulled in outside the server graph.
// Hand-written and NOT built: tsup's `clean: true` would delete it from dist/.
// Exports nothing on purpose — the bundler's failure to find the named export is
// the primary guard, and this throw is the backstop.
throw new Error(
  "@viu/emporix-sdk-next/session is server-only: it reads and writes session cookies " +
    "and handles refresh tokens. It was resolved outside the server graph — most " +
    'likely imported from a "use client" module. Move the import into a Server ' +
    "Action, a Route Handler, or a Server Component.",
);
