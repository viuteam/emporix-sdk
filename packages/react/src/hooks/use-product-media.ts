import type { Media } from "@viu/emporix-sdk";
import { useProduct } from "./queries";

/**
 * Reads `productMedia` from the existing product query — no Media-Service
 * call (those need a server-only scope). For admin/server flows, use
 * `client.media.listForProduct(productId)` instead.
 */
export function useProductMedia(productId: string): {
  data: Media[] | undefined;
  isLoading: boolean;
  error: unknown;
} {
  const q = useProduct(productId);
  const data = (q.data as { productMedia?: Media[] } | undefined)?.productMedia;
  return { data, isLoading: q.isLoading, error: q.error };
}
