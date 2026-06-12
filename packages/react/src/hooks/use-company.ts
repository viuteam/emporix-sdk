import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type LegalEntity } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";
import { useCustomerToken } from "./internal/use-storage-snapshot";

/** Fetches one legal entity by id. Disabled until a customer token is stored. */
export function useCompany(legalEntityId: string | undefined): UseQueryResult<LegalEntity> {
  const { client } = useEmporix();
  const token = useCustomerToken();
  return useQuery({
    queryKey: emporixKey("companies", [legalEntityId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null && legalEntityId !== undefined,
    queryFn: () => client.companies.get(legalEntityId as string, auth.customer(token as string)),
  });
}
