import { type UseQueryResult } from "@tanstack/react-query";
import { type LegalEntity } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

/** Lists the legal entities the calling customer is assigned to. */
export function useMyCompanies(): UseQueryResult<LegalEntity[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "companies", args: ["mine"],
    queryFn: (ctx) => client.companies.listMine(ctx),
  });
}
