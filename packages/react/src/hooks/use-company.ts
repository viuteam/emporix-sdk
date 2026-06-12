import { type UseQueryResult } from "@tanstack/react-query";
import { type LegalEntity } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { useEmporixQuery } from "./internal/use-emporix-query";

/** Fetches one legal entity by id. Disabled until a customer token is stored. */
export function useCompany(legalEntityId: string | undefined): UseQueryResult<LegalEntity> {
  const { client } = useEmporix();
  return useEmporixQuery({
    mode: "customer", site: "none", resource: "companies", args: [legalEntityId ?? null],
    enabled: legalEntityId !== undefined,
    queryFn: (ctx) => client.companies.get(legalEntityId as string, ctx),
  });
}
