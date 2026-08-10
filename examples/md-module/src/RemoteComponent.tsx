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

export default function RemoteComponent({
  appState,
}: {
  appState: AppState;
}): React.JSX.Element {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  const [sessionDead, setSessionDead] = useState(false);

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
