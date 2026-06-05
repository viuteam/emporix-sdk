import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  auth,
  type AuthContext,
  type InvokeCloudFunctionOptions,
} from "@viu/emporix-sdk";
import { useEmporix } from "../provider";
import { emporixKey } from "./internal/query-keys";

/** Variables for {@link useInvokeCloudFunction}. */
export interface InvokeCloudFunctionVars<TReq = unknown>
  extends InvokeCloudFunctionOptions<TReq> {
  functionId: string;
  /** Override the auto-resolved auth (customer-if-token-else-anonymous). */
  auth?: AuthContext;
}

/**
 * Imperatively invoke a cloud function (any method). Auth is resolved
 * automatically (customer if a token is stored, else anonymous) unless an
 * explicit `auth` is passed in the variables. Service auth is intentionally
 * not exposed in React.
 */
export function useInvokeCloudFunction<TRes = unknown, TReq = unknown>(): UseMutationResult<
  TRes,
  unknown,
  InvokeCloudFunctionVars<TReq>
> {
  const { client, storage } = useEmporix();
  return useMutation({
    mutationFn: (vars: InvokeCloudFunctionVars<TReq>) => {
      const { functionId, auth: authOverride, ...options } = vars;
      const token = storage.getCustomerToken();
      const authCtx = authOverride ?? (token ? auth.customer(token) : auth.anonymous());
      return client.cloudFunctions.invoke<TRes, TReq>(functionId, options, authCtx);
    },
  });
}

/**
 * Query a (read-style) cloud function with React-Query caching. Defaults to
 * GET. Disabled while `functionId` is `undefined`. Auth resolves like
 * {@link useInvokeCloudFunction}; pass `options.auth` to override.
 */
export function useCloudFunction<TRes = unknown>(
  functionId: string | undefined,
  options?: InvokeCloudFunctionOptions & { auth?: AuthContext },
  queryOptions?: { enabled?: boolean; staleTime?: number },
): UseQueryResult<TRes> {
  const { client, storage } = useEmporix();
  const token = storage.getCustomerToken();
  const { auth: authOverride, ...invokeOptions } = options ?? {};
  const authCtx = authOverride ?? (token ? auth.customer(token) : auth.anonymous());
  return useQuery({
    queryKey: emporixKey(
      "cloud-function",
      [functionId ?? null, invokeOptions.path ?? null, invokeOptions.query ?? null],
      { tenant: client.tenant, authKind: token ? "customer" : "anonymous" },
    ),
    enabled: (queryOptions?.enabled ?? true) && functionId !== undefined,
    ...(queryOptions?.staleTime !== undefined ? { staleTime: queryOptions.staleTime } : {}),
    queryFn: () =>
      client.cloudFunctions.invoke<TRes>(
        functionId as string,
        { method: "GET", ...invokeOptions },
        authCtx,
      ),
  });
}
