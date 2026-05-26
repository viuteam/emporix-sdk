import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type Location } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Lists locations owned by one legal entity. */
export function useCompanyLocations(
  legalEntityId: string | undefined,
): UseQueryResult<Location[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: emporixKey("companies", ["locations", legalEntityId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null && legalEntityId !== undefined,
    queryFn: () =>
      client.locations.listForCompany(legalEntityId as string, auth.customer(token as string)),
  });
}
