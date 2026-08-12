import { useState } from "react";
import { QueryClient } from "@tanstack/react-query";
import { EmporixProvider } from "@viu/emporix-sdk-react";
import { clientFor } from "./emporix";
import { ProductList } from "./ProductList";

/** Exactly the shape the Managed Dashboard passes in. */
export interface AppState {
  tenant: string;
  language: string;
  token: string;
}

/**
 * Fallback for a host that mounts the remote without props. The upstream
 * template does the same (`appState = { tenant: 'default', … }`), and for a good
 * reason: a crash inside a federated remote surfaces as a blank panel with a
 * stack trace pointing at bundled code, which is far harder to diagnose than a
 * sentence saying what is missing.
 *
 * `token: ""` rather than the template's `"default"` so the unconfigured case is
 * detectable — a literal "default" token would be sent to Emporix and come back
 * 401, which looks like an expired session rather than a wiring mistake.
 */
const UNCONFIGURED: AppState = { tenant: "default", language: "en", token: "" };

export default function RemoteComponent({
  appState = UNCONFIGURED,
}: {
  appState?: AppState;
}): React.JSX.Element {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [sessionDead, setSessionDead] = useState(false);

  // Before clientFor(): the SDK validates the tenant against
  // /^[a-z][a-z0-9]{2,15}$/ and would throw on a malformed one, which would be a
  // crash where a message belongs.
  if (appState.token === "") {
    return (
      <section>
        <h1>Not configured</h1>
        <p>
          This module received no dashboard session. The Managed Dashboard is expected to
          render it as{" "}
          <code>{"<RemoteComponent appState={{ tenant, language, token }} />"}</code> — the
          token is empty, so either no props were passed or the host is not wired up.
        </p>
      </section>
    );
  }

  if (sessionDead) {
    return <p>Your dashboard session expired. Reload the page to continue.</p>;
  }

  return (
    <EmporixProvider
      client={clientFor(appState.tenant)}
      queryClient={queryClient}
      initialCustomerToken={appState.token}
      // The host knows the language. Left unset, the provider seeds it from the
      // active site AFTER mount, which moves the query key and orphans whatever
      // was already fetched.
      initialLanguage={appState.language}
      customerSession="external"
      onCustomerSessionExpired={() => setSessionDead(true)}
    >
      <ProductList />
    </EmporixProvider>
  );
}
