import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { auth, type ContactAssignment } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Lists contact assignments for one legal entity. */
export function useCompanyContacts(
  legalEntityId: string | undefined,
): UseQueryResult<ContactAssignment[]> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  return useQuery({
    queryKey: emporixKey("companies", ["contacts", legalEntityId ?? null], {
      tenant: client.tenant,
      authKind: token ? "customer" : "anonymous",
    }),
    enabled: token !== null && legalEntityId !== undefined,
    queryFn: () =>
      client.contacts.listForCompany(legalEntityId as string, auth.customer(token as string)),
  });
}
