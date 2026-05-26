import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type LegalEntity } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Lists the legal entities the calling customer is assigned to. */
export function useMyCompanies(): UseQueryResult<LegalEntity[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: emporixKey("companies", ["mine"], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null,
    queryFn: () => client.companies.listMine(auth.customer(token as string)),
  });
}
