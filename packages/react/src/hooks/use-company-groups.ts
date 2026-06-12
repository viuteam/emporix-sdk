import { type UseQueryResult } from "@tanstack/react-query";
import { type IamGroup } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

/** Lists IAM customer-groups for one legal entity. */
export function useCompanyGroups(
  legalEntityId: string | undefined,
): UseQueryResult<IamGroup[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "companies", args: ["groups", legalEntityId ?? null],
    enabled: legalEntityId !== undefined,
    queryFn: (ctx) => client.customerGroups.listForCompany(legalEntityId as string, ctx),
  });
}
