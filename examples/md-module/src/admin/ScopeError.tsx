import { EmporixForbiddenError, EmporixInsufficientScopeError } from "@viu/emporix-sdk";

/**
 * Renders a 403 as the configuration answer it is.
 *
 * This is the failure a dashboard operator will actually hit — a user whose role
 * was never granted the scope — and a stack trace tells them nothing they can
 * act on. Branches on the SDK's error class rather than sniffing `.status`, and
 * names the scope when the tenant sent one.
 *
 * Returns `null` for anything else, so a caller can render it above the generic
 * error without checking first.
 */
export function ScopeError({ error }: { error: unknown }): React.JSX.Element | null {
  if (!(error instanceof EmporixForbiddenError)) return null;
  const scope =
    error instanceof EmporixInsufficientScopeError ? error.requiredScope : undefined;
  return (
    <p role="alert">
      This dashboard user's token does not carry
      {scope !== undefined ? ` the scope ${scope}` : " the scope for this operation"}. Grant it
      in the Managed Dashboard's user administration — the module cannot widen its own scopes.
    </p>
  );
}
