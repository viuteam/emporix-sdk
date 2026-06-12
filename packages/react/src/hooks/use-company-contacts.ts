import { type UseQueryResult } from "@tanstack/react-query";
import { type ContactAssignment } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

/** Lists contact assignments for one legal entity. */
export function useCompanyContacts(
  legalEntityId: string | undefined,
): UseQueryResult<ContactAssignment[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "companies", args: ["contacts", legalEntityId ?? null],
    enabled: legalEntityId !== undefined,
    queryFn: (ctx) => client.contacts.listForCompany(legalEntityId as string, ctx),
  });
}
