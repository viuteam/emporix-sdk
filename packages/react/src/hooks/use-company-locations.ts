import { type UseQueryResult } from "@tanstack/react-query";
import { type Location } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

/** Lists locations owned by one legal entity. */
export function useCompanyLocations(
  legalEntityId: string | undefined,
): UseQueryResult<Location[]> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "companies", args: ["locations", legalEntityId ?? null],
    enabled: legalEntityId !== undefined,
    queryFn: (ctx) => client.locations.listForCompany(legalEntityId as string, ctx),
  });
}
