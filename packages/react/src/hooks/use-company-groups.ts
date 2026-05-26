import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type IamGroup } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Lists IAM customer-groups for one legal entity. */
export function useCompanyGroups(
  legalEntityId: string | undefined,
): UseQueryResult<IamGroup[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: emporixKey("companies", ["groups", legalEntityId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null && legalEntityId !== undefined,
    queryFn: () =>
      client.customerGroups.listForCompany(legalEntityId as string, auth.customer(token as string)),
  });
}
