import { useMutation, type UseMutationResult } from "@tanstack/react-query";
import { auth, type SessionAttributeInput } from "@viu/emporix-sdk";
import { useEmporix } from "../provider";

/** Adds an attribute to the current session context (session derived from the token; anonymous). */
export function useAddSessionAttribute(): UseMutationResult<void, unknown, SessionAttributeInput> {
  const { client } = useEmporix();
  return useMutation({
    mutationFn: (attribute) => client.sessionContext.addAttribute(attribute, auth.anonymous()),
  });
}

/** Removes a named attribute from the current session context (anonymous). */
export function useRemoveSessionAttribute(): UseMutationResult<void, unknown, string> {
  const { client } = useEmporix();
  return useMutation({
    mutationFn: (name) => client.sessionContext.removeAttribute(name, auth.anonymous()),
  });
}
